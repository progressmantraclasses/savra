from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Optional

import numpy as np
import redis
from sentence_transformers import SentenceTransformer

from config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# Loaded once at module import time — never per-request
_model: SentenceTransformer = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

COST_PER_CACHE_MISS_INR = 5.0  # Approximate average cost of one LLM+generation call


def _get_redis() -> redis.Redis:
    return redis.from_url(settings.redis_url, decode_responses=True)


def _cache_text(topic: str, grade: str, subject: str, num_slides: int) -> str:
    return f"{topic} {grade} {subject} {num_slides} slides"


def _embed(text: str) -> list[float]:
    vec = _model.encode(text, normalize_embeddings=True)
    return vec.tolist()


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a), np.array(b)
    return float(np.dot(va, vb))  # vectors are already L2-normalised


def _scan_cache_entries(r: redis.Redis) -> list[dict]:
    """Retrieve all cached PPT entries. O(n) — documented limit: 10K entries."""
    entries = []
    for key in r.scan_iter("ppt_cache:*"):
        raw = r.get(key)
        if raw:
            try:
                entries.append(json.loads(raw))
            except json.JSONDecodeError:
                pass
    return entries


def check_cache(
    topic: str, grade: str, subject: str, num_slides: int
) -> Optional[str]:
    """Return cached pptx_url if a semantically identical request exists, else None."""
    try:
        r = _get_redis()
        query_vec = _embed(_cache_text(topic, grade, subject, num_slides))
        entries = _scan_cache_entries(r)

        for entry in entries:
            similarity = _cosine_similarity(query_vec, entry["embedding"])
            if similarity >= settings.cache_similarity_threshold:
                r.incr("cache:hits")
                r.incrbyfloat("cache:cost_saved", COST_PER_CACHE_MISS_INR)
                logger.info(
                    "Cache HIT (similarity=%.4f)", similarity,
                    extra={"cache_hit": True},
                )
                return entry["pptx_url"]

        r.incr("cache:misses")
        return None

    except Exception as exc:
        # Redis down → bypass cache, never block job generation
        logger.warning("Redis unavailable, bypassing cache: %s", exc)
        return None


def store_cache(
    topic: str, grade: str, subject: str, num_slides: int, pptx_url: str
) -> None:
    """Persist a new embedding + PPTX URL in Redis."""
    try:
        r = _get_redis()
        text = _cache_text(topic, grade, subject, num_slides)
        embedding = _embed(text)
        key = f"ppt_cache:{uuid.uuid4()}"
        payload = json.dumps(
            {
                "text": text,
                "embedding": embedding,
                "pptx_url": pptx_url,
                "hit_count": 0,
                "created_at": time.time(),
            }
        )
        r.set(key, payload, ex=settings.cache_ttl_seconds)
    except Exception as exc:
        logger.warning("Failed to store cache entry: %s", exc)


def get_cache_stats() -> dict:
    """Return hit rate and estimated cost saved in INR."""
    try:
        r = _get_redis()
        hits = int(r.get("cache:hits") or 0)
        misses = int(r.get("cache:misses") or 0)
        cost_saved = float(r.get("cache:cost_saved") or 0.0)
        total = hits + misses
        return {
            "hits": hits,
            "misses": misses,
            "total": total,
            "hit_rate": round(hits / total, 4) if total else 0.0,
            "cost_saved_inr": round(cost_saved, 2),
        }
    except Exception as exc:
        logger.warning("Could not fetch cache stats: %s", exc)
        return {"error": "Redis unavailable"}
