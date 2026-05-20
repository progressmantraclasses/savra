from __future__ import annotations

import json
import logging
import re

import groq
from groq import Groq

from config import get_settings
from models import PresentationContent

settings = get_settings()
logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are a slide content generator for school teachers in India.
Return ONLY valid JSON matching this exact schema — no markdown, no explanation:
{
  "title": "string",
    "color_theme": "string",
    "palette": ["#4ADE80", "#FDE68A", "#7DD3FC"],
  "slides": [
    {
      "slide_num": 1,
      "heading": "string",
            "slide_type": "bullets|stats|formula|mixed|image_focus",
            "bullets": ["string"],
            "stats": [{"label": "string", "value": "string"}],
            "formula": "string or null",
            "image_hint": "string or null",
            "accent_color": "#RRGGBB or null",
      "speaker_note": "string or null"
    }
  ]
}
Rules:
- Use diverse slide_type values across the deck, not all the same.
- For bullets/mixed/image_focus slides, include 3-6 concise bullets (max 14 words).
- For stats/mixed slides, include 2-4 stats with short values.
- For formula/mixed slides in STEM topics, include one accurate formula.
- Include image_hint for slides where a visual helps.
- Choose a coherent palette of 3-5 colors in hex.
- Pick accent_color from the palette for each slide.
Content must be appropriate for the specified grade level."""

_SIMPLE_KEYWORDS = set(settings.simple_subject_keywords)


def _should_use_haiku(topic: str, num_slides: int) -> bool:
    """Route ~30% of requests to Haiku with no quality loss."""
    if num_slides > settings.haiku_slide_threshold:
        return False
    return any(kw in topic.lower() for kw in _SIMPLE_KEYWORDS)


def _build_user_prompt(topic: str, grade: str, subject: str, num_slides: int) -> str:
    return (
        f"Generate a {num_slides}-slide presentation for {grade} students "
        f"on the subject '{subject}', topic: '{topic}'. "
        "Use a knowledge-rich style with suitable formulas, stats, visuals and bullets per slide. "
        "Follow the JSON schema exactly."
    )


def _strip_markdown_fences(text: str) -> str:
    """Remove accidental ```json ... ``` wrappers the model may emit."""
    return re.sub(r"^```[a-z]*\n?|```$", "", text.strip(), flags=re.MULTILINE).strip()


def _parse_response(raw: str) -> PresentationContent:
    cleaned = _strip_markdown_fences(raw)
    data = json.loads(cleaned)
    return PresentationContent(**data)


def _call_model(
    client: Groq,
    model: str,
    max_tokens: int,
    user_prompt: str,
) -> str:
    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": _SYSTEM_PROMPT,
            },
            {
                "role": "user",
                "content": user_prompt,
            }
        ],
        temperature=1,
        max_completion_tokens=max_tokens,
        top_p=1,
        response_format={"type": "json_object"}
    )
    return response.choices[0].message.content or ""


def generate_content(
    topic: str,
    grade: str,
    subject: str,
    num_slides: int,
) -> tuple[PresentationContent, str]:
    """
    Returns (PresentationContent, model_used).
    Tries primary model first; falls back to Haiku on 503 / timeout.
    Raises on two consecutive failures or persistent JSON parse errors.
    """
    client = Groq(api_key=settings.groq_api_key)
    user_prompt = _build_user_prompt(topic, grade, subject, num_slides)

    use_haiku_first = _should_use_haiku(topic, num_slides)
    primary = settings.fallback_model if use_haiku_first else settings.primary_model
    primary_tokens = (
        settings.fallback_max_tokens if use_haiku_first else settings.primary_max_tokens
    )

    for attempt, (model, max_tokens) in enumerate(
        [
            (primary, primary_tokens),
            (settings.fallback_model, settings.fallback_max_tokens),
        ]
    ):
        try:
            raw = _call_model(client, model, max_tokens, user_prompt)
        except groq.APIStatusError as exc:
            logger.warning(
                "LLM API error on attempt %d (model=%s): %s — %s",
                attempt + 1, model, exc.status_code, exc.message,
            )
            if attempt == 0:
                continue
            raise RuntimeError(
                f"Both models failed. Last error: {exc.status_code} {exc.message}"
            ) from exc

        try:
            content = _parse_response(raw)
            logger.info("LLM success", extra={"model": model, "attempt": attempt + 1})
            return content, model
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning(
                "LLM returned invalid JSON on attempt %d (model=%s): %s",
                attempt + 1, model, exc,
            )
            if attempt == 0:
                # Retry with fallback model
                continue
            raise RuntimeError("LLM returned invalid JSON after two attempts") from exc

    raise RuntimeError("LLM generation exhausted all retries")
