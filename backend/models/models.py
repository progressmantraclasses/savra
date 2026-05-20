from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=300)
    grade: str = Field(..., description="e.g. 'Class 5' or '5'")
    subject: str = Field(..., min_length=1, max_length=100)
    num_slides: int = Field(10, ge=5, le=20)
    user_id: str = Field("anonymous", description="Caller identity — no auth in prototype")


class GenerateResponse(BaseModel):
    job_id: str
    status: str
    message: str


class StatusResponse(BaseModel):
    job_id: str
    status: str  # queued | processing | done | failed
    output_url: Optional[str] = None
    error: Optional[str] = None


class StatItem(BaseModel):
    label: str = Field(..., min_length=1, max_length=40)
    value: str = Field(..., min_length=1, max_length=60)


class SlideContent(BaseModel):
    slide_num: int
    heading: str
    slide_type: Literal["bullets", "stats", "formula", "mixed", "image_focus"] = "bullets"
    bullets: list[str] = Field(default_factory=list, max_length=8)
    stats: list[StatItem] = Field(default_factory=list, max_length=4)
    formula: Optional[str] = None
    image_hint: Optional[str] = None
    accent_color: Optional[str] = Field(
        default=None,
        description="Optional hex color like #4ADE80",
    )
    speaker_note: Optional[str] = None


class PresentationContent(BaseModel):
    title: str
    color_theme: Optional[str] = None
    palette: list[str] = Field(
        default_factory=list,
        description="Optional list of 3-5 hex colors chosen by LLM",
    )
    slides: list[SlideContent]
