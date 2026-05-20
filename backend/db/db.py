from __future__ import annotations

import uuid
from typing import Any, Optional

import asyncpg

from config import get_settings

settings = get_settings()

async def get_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=1,
        max_size=5,
        command_timeout=10,
    )


async def close_pool() -> None:
    return None


async def ensure_schema() -> None:
    """Idempotently create the jobs table on startup."""
    conn = await asyncpg.connect(dsn=settings.database_url)
    try:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id     TEXT NOT NULL DEFAULT 'anonymous',
                status      TEXT NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued','processing','done','failed')),
                topic       TEXT NOT NULL,
                grade       TEXT NOT NULL,
                subject     TEXT NOT NULL,
                num_slides  INTEGER NOT NULL,
                output_url  TEXT,
                error_msg   TEXT,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        """)
    finally:
        await conn.close()


async def create_job(
    user_id: str,
    topic: str,
    grade: str,
    subject: str,
    num_slides: int,
) -> str:
    job_id = str(uuid.uuid4())
    conn = await asyncpg.connect(dsn=settings.database_url)
    try:
        await conn.execute(
            """
            INSERT INTO jobs (id, user_id, topic, grade, subject, num_slides)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            job_id, user_id, topic, grade, subject, num_slides,
        )
    finally:
        await conn.close()
    return job_id


async def update_job(job_id: str, **kwargs: Any) -> None:
    if not kwargs:
        return

    set_clauses = ", ".join(
        f"{col} = ${i + 2}" for i, col in enumerate(kwargs)
    )
    values = list(kwargs.values())

    conn = await asyncpg.connect(dsn=settings.database_url)
    try:
        await conn.execute(
            f"""
            UPDATE jobs
            SET {set_clauses}, updated_at = NOW()
            WHERE id = $1
            """,
            job_id, *values,
        )
    finally:
        await conn.close()


async def get_job(job_id: str) -> Optional[dict[str, Any]]:
    conn = await asyncpg.connect(dsn=settings.database_url)
    try:
        row = await conn.fetchrow(
            "SELECT * FROM jobs WHERE id = $1", job_id
        )
    finally:
        await conn.close()
    return dict(row) if row else None
