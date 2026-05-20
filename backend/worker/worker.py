from __future__ import annotations

import asyncio
import logging

from celery import Celery
from celery.exceptions import SoftTimeLimitExceeded

from cache import check_cache, store_cache
from config import get_settings
from llm import generate_content
from pptx_gen import generate_pptx
from storage import delete_local, upload_pptx

settings = get_settings()
logger = logging.getLogger(__name__)
_PPT_STYLE_VERSION = "savra-premium-v3"

celery_app = Celery(
    "savra",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    worker_concurrency=settings.celery_concurrency,
    task_time_limit=settings.task_time_limit,
    task_soft_time_limit=settings.task_soft_time_limit,
    timezone="Asia/Kolkata",
)


def _run_async(coro):
    """Bridge async DB calls into the synchronous Celery task."""
    return asyncio.run(coro)


def _update_job_sync(job_id: str, **kwargs) -> None:
    from db import update_job
    _run_async(update_job(job_id, **kwargs))


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def generate_ppt_task(
    self,
    job_id: str,
    topic: str,
    grade: str,
    subject: str,
    num_slides: int,
) -> None:
    """
    Full PPT job lifecycle:
    cache check → LLM → PPTX generation → S3 upload → cache store → DB update
    """
    try:
        _update_job_sync(job_id, status="processing")

        cache_topic = f"[{_PPT_STYLE_VERSION}] {topic}"

        cached_url = check_cache(cache_topic, grade, subject, num_slides)
        if cached_url:
            _update_job_sync(job_id, status="done", output_url=cached_url)
            logger.info("Job %s resolved from cache", job_id)
            return

        content, model_used = generate_content(topic, grade, subject, num_slides)
        logger.info("LLM done (job_id=%s, model=%s)", job_id, model_used)

        local_path = generate_pptx(content, job_id, settings.pptx_template_path)

        signed_url = upload_pptx(job_id, local_path)
        delete_local(local_path)

        store_cache(cache_topic, grade, subject, num_slides, signed_url)

        _update_job_sync(job_id, status="done", output_url=signed_url)
        logger.info("Job %s completed successfully", job_id)

    except SoftTimeLimitExceeded:
        _update_job_sync(
            job_id,
            status="failed",
            error_msg="Task exceeded 90s soft time limit and was terminated",
        )
    except Exception as exc:
        error_msg = str(exc)
        logger.error("Job %s failed: %s", job_id, error_msg)

        try:
            self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            _update_job_sync(job_id, status="failed", error_msg=error_msg)
