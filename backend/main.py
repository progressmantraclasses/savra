
import hashlib
import logging
import time
import uuid

import redis as redis_lib
import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from cache import get_cache_stats
from config import get_settings
from db import close_pool, create_job, ensure_schema, get_job
from models import GenerateRequest, GenerateResponse, StatusResponse
from worker import generate_ppt_task

settings = get_settings()
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.add_log_level,
        structlog.processors.JSONRenderer(),
    ]
)
logger = structlog.get_logger()

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Savra PPT API", version="1.0.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid.uuid4())
    start = time.time()
    response = await call_next(request)
    duration_ms = round((time.time() - start) * 1000, 2)
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request",
        request_id=request_id,
        path=request.url.path,
        method=request.method,
        status_code=response.status_code,
        duration_ms=duration_ms,
    )
    return response


@app.on_event("startup")
async def startup():
    await ensure_schema()


@app.on_event("shutdown")
async def shutdown():
    await close_pool()


def _inflight_key(topic: str, grade: str, subject: str, num_slides: int) -> str:
    fingerprint = f"{topic}|{grade}|{subject}|{num_slides}"
    return "inflight:" + hashlib.sha256(fingerprint.encode()).hexdigest()[:16]


def _check_inflight(r: redis_lib.Redis, key: str) -> str | None:
    return r.get(key)


def _set_inflight(r: redis_lib.Redis, key: str, job_id: str) -> None:
    r.set(key, job_id, ex=180)  # auto-expires after 3 min (task time limit + buffer)


@app.post("/generate", response_model=GenerateResponse)
@limiter.limit(f"{settings.rate_limit_per_minute}/minute")
async def generate(request: Request, body: GenerateRequest) -> GenerateResponse:
    try:
        r = redis_lib.from_url(settings.redis_url, decode_responses=True)
        inflight_key = _inflight_key(body.topic, body.grade, body.subject, body.num_slides)
        existing_job_id = _check_inflight(r, inflight_key)
        if existing_job_id:
            return GenerateResponse(
                job_id=existing_job_id,
                status="queued",
                message="Identical job already in progress",
            )
    except redis_lib.RedisError:
        # Deduplication is best-effort; never block the request
        pass

    job_id = await create_job(
        user_id=body.user_id,
        topic=body.topic,
        grade=body.grade,
        subject=body.subject,
        num_slides=body.num_slides,
    )

    generate_ppt_task.delay(job_id, body.topic, body.grade, body.subject, body.num_slides)

    try:
        _set_inflight(r, inflight_key, job_id)
    except Exception:
        pass

    return GenerateResponse(job_id=job_id, status="queued", message="Job queued successfully")


@app.get("/status/{job_id}", response_model=StatusResponse)
async def status(job_id: str) -> StatusResponse:
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return StatusResponse(
        job_id=str(job["id"]),
        status=job["status"],
        output_url=job.get("output_url"),
        error=job.get("error_msg"),
    )


@app.get("/cache/stats")
async def cache_stats() -> dict:
    return get_cache_stats()


@app.get("/health")
async def health() -> JSONResponse:
    issues: list[str] = []

    try:
        r = redis_lib.from_url(settings.redis_url, decode_responses=True)
        r.ping()
    except redis_lib.RedisError:
        issues.append("Redis unreachable")

    try:
        from db import get_pool
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
    except Exception:
        issues.append("Database unreachable")

    if issues:
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "issues": issues},
        )
    return JSONResponse(content={"status": "healthy"})
