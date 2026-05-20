from __future__ import annotations

import logging
import os
import time

import cloudinary
import cloudinary.uploader
from cloudinary.exceptions import Error as CloudinaryError

from config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def _configure_cloudinary():
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True
    )


def upload_pptx(job_id: str, filepath: str) -> str:
    """
    Upload .pptx to Cloudinary and return a secure URL.
    Retries up to settings.upload_max_retries times with exponential back-off.
    """
    _configure_cloudinary()
    
    # We use raw resource_type since pptx is a raw file, not an image/video.
    public_id = f"pptx/{job_id}"
    delay = settings.upload_retry_base_delay

    for attempt in range(settings.upload_max_retries + 1):
        try:
            response = cloudinary.uploader.upload(
                filepath, 
                resource_type="raw", 
                public_id=public_id
            )
            url = response.get("secure_url")
            logger.info("Cloudinary upload successful (job_id=%s, attempt=%d)", job_id, attempt + 1)
            return url
        except CloudinaryError as exc:
            if attempt >= settings.upload_max_retries:
                raise RuntimeError(
                    f"Cloudinary upload failed after {attempt + 1} attempts: {exc}"
                ) from exc
            logger.warning(
                "Cloudinary upload attempt %d failed, retrying in %.1fs: %s",
                attempt + 1, delay, exc,
            )
            time.sleep(delay)
            delay *= 2  # exponential back-off

    raise RuntimeError("Cloudinary upload exhausted retries")  # unreachable, satisfies mypy


def delete_local(filepath: str) -> None:
    """Remove the temporary local .pptx after a successful S3 upload."""
    try:
        os.remove(filepath)
    except OSError as exc:
        logger.warning("Could not delete local file %s: %s", filepath, exc)
