

## ROLE & MINDSET

You are a senior backend engineer with production experience in Python, async systems, and LLM-powered applications. You write clean, minimal code — no boilerplate, no over-engineering. Every decision must justify itself against three constraints: **cost**, **reliability**, and **scale**. When in doubt, do less and do it right.

---

## PROJECT CONTEXT

**Savra** is an EdTech platform. Teachers generate 100+ PowerPoint presentations/day via an AI pipeline. The current system is synchronous, expensive (₹15/PPT), and crashes under load (Gemini 503s). We are rebuilding it from scratch.

**Target:** Handle 1 lakh (100,000) users/day. Cost target: ₹2–3/PPT.

---

## SYSTEM OVERVIEW

```
Teacher fills form
      ↓
FastAPI receives request (<200ms response)
      ↓
Check semantic cache (Redis + embeddings)
  ├─ HIT  → return cached PPTX URL instantly
  └─ MISS → push job to Celery queue → return job_id
                    ↓
             Celery worker picks up job
                    ↓
             Call Claude API (structured JSON)
                    ↓
             python-pptx generates .pptx file
                    ↓
             Upload to S3 → update job status
                    ↓
Teacher polls /status/:job_id → gets download URL
```

---

## TECH STACK (non-negotiable, justify if you deviate)

| Layer | Choice | Why |
|---|---|---|
| API | FastAPI + uvicorn | Async, fast, auto-docs |
| Queue | Celery + Redis | Battle-tested for AI jobs |
| Cache | Redis + sentence-transformers | Local embeddings, zero API cost |
| LLM | Anthropic Claude (claude-sonnet-4-20250514 primary, claude-haiku-4-5-20251001 fallback) | Quality + reliability |
| PPTX | python-pptx | Native Python, full template control |
| Storage | AWS S3 (or Cloudflare R2) | Cheap, reliable, signed URLs |
| DB | PostgreSQL (asyncpg) | Job records, user data |
| Frontend | Next.js 14 App Router + Tailwind | React server components, fast |

---

## DIRECTORY STRUCTURE TO CREATE

```
savra-ppt/
├── backend/
│   ├── main.py              # FastAPI app, routes
│   ├── worker.py            # Celery task definition
│   ├── cache.py             # Semantic cache logic
│   ├── llm.py               # Claude API calls + fallback
│   ├── pptx_gen.py          # python-pptx generation
│   ├── storage.py           # S3 upload + signed URLs
│   ├── db.py                # Async DB (asyncpg)
│   ├── models.py            # Pydantic request/response models
│   ├── config.py            # Settings from env vars
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── page.tsx         # Submit form
│   │   ├── status/[jobId]/page.tsx  # Polling + download
│   │   └── api/status/[jobId]/route.ts  # Proxy to backend
│   ├── components/
│   │   ├── PptForm.tsx
│   │   └── StatusPoller.tsx
│   └── package.json
├── templates/
│   └── savra_base.pptx      # Pre-built slide template
├── architecture/
│   ├── design-doc.md
│   └── diagram.png
├── DECISIONS.md
└── README.md
```

---

## BUILD INSTRUCTIONS — FOLLOW THIS EXACT ORDER

### PHASE 1 — Config & Models

Build `config.py` first. All secrets come from environment variables. No hardcoded values anywhere.

```
Required env vars:
ANTHROPIC_API_KEY
DATABASE_URL          # postgresql+asyncpg://...
REDIS_URL             # redis://localhost:6379
S3_BUCKET_NAME
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
```

Build `models.py` — Pydantic schemas only:
- `GenerateRequest`: topic (str), grade (str), subject (str), num_slides (int 5–20)
- `GenerateResponse`: job_id (str), status (str), message (str)
- `StatusResponse`: job_id (str), status (str), output_url (str | None), error (str | None)
- `SlideContent`: heading (str), bullets (list[str]), speaker_note (str | None)
- `PresentationContent`: title (str), slides (list[SlideContent])

---

### PHASE 2 — Database Layer

Build `db.py`:
- Async connection pool using asyncpg
- Single table: `jobs` with columns: id (uuid), user_id (str), status (enum: queued/processing/done/failed), topic, grade, subject, num_slides, output_url, error_msg, created_at, updated_at
- Two functions only: `create_job(data) → job_id` and `update_job(job_id, **kwargs)`
- `get_job(job_id) → dict`

Keep it minimal. No ORM — raw asyncpg is fast enough and simpler.

---

### PHASE 3 — LLM Layer

Build `llm.py` with these exact requirements:

**Primary model:** `claude-sonnet-4-20250514`
**Fallback model:** `claude-haiku-4-5-20251001`

**System prompt** (put it in a constant — it gets cached by Anthropic's prompt caching):
```
You are a slide content generator for school teachers in India.
Return ONLY valid JSON matching this exact schema — no markdown, no explanation:
{
  "title": "string",
  "slides": [
    {
      "slide_num": 1,
      "heading": "string",
      "bullets": ["string", "string", "string"],
      "speaker_note": "string or null"
    }
  ]
}
Each slide must have exactly 3–5 bullets. Bullets must be concise (max 12 words each).
Content must be appropriate for the specified grade level.
```

**Implementation rules:**
- Use Anthropic's `prompt_caching` beta — cache the system prompt with `cache_control: {"type": "ephemeral"}`. This cuts costs ~10% immediately.
- Wrap the API call in a try/except. On `anthropic.APIStatusError` (503) or timeout, retry once with Haiku. Log which model was used.
- Strip any accidental markdown fences from response before JSON parsing.
- Return a `PresentationContent` Pydantic object, not raw JSON.
- Max tokens: 3000 for Sonnet, 2000 for Haiku.

**Smart model routing** — use Haiku (cheaper) when:
- `num_slides <= 8` AND topic is a simple factual subject (detect via keyword list: ["history", "geography", "civics", "dates", "events"])
- Haiku costs ~10× less. Route ~30% of requests there with no quality loss.

---

### PHASE 4 — Semantic Cache

Build `cache.py`. This is the highest-impact cost optimization.

**How it works:**
1. Concatenate request fields: `f"{topic} {grade} {subject} {num_slides} slides"`
2. Embed using `sentence-transformers/all-MiniLM-L6-v2` (load model once at startup)
3. Compare cosine similarity against all cached embeddings stored in Redis
4. Threshold: **0.92** — above this, requests are semantically identical
5. Cache TTL: **30 days** (edu content doesn't change)

**Redis key structure:**
- `ppt_cache:{uuid}` → JSON: `{text, embedding (list[float]), pptx_url, hit_count, created_at}`
- `cache:hits` → integer counter
- `cache:misses` → integer counter  
- `cache:cost_saved` → float (rupees)

**Performance constraint:** At scale, iterating all keys is O(n). For the prototype, this is fine up to ~10K cached entries. Document in DECISIONS.md that production needs Redis vector similarity (RedisVL or Qdrant) above 50K entries.

**Functions to implement:**
- `check_cache(topic, grade, subject, num_slides) → str | None` (returns pptx_url or None)
- `store_cache(topic, grade, subject, num_slides, pptx_url) → None`
- `get_cache_stats() → dict`

---

### PHASE 5 — PPTX Generation

Build `pptx_gen.py`:

**Template approach:** Load `templates/savra_base.pptx` (a pre-built PowerPoint with layouts). Never design from scratch — only fill placeholders.

**Slide layouts to use:**
- Layout index 0: Title slide (slide 1 only)
- Layout index 1: Title + Content (all other slides)

**Implementation:**
- `generate_pptx(content: PresentationContent, job_id: str) → str` (returns local filepath)
- Save to `/tmp/{job_id}.pptx`
- For each slide: set `placeholders[0].text = heading`, fill `placeholders[1]` with bullets
- Set font size 24pt for headings, 18pt for bullets
- Return filepath — caller handles S3 upload

**Also create a fallback template creator** — if `savra_base.pptx` doesn't exist, generate a blank one programmatically so the prototype works without the template file.

---

### PHASE 6 — Storage Layer

Build `storage.py`:
- `upload_pptx(job_id: str, filepath: str) → str` — uploads to S3, returns 7-day signed URL
- `delete_local(filepath: str)` — cleanup after upload
- Use `boto3` with the env vars from config

---

### PHASE 7 — Celery Worker

Build `worker.py`:

```python
# The complete job lifecycle in one task
@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def generate_ppt_task(self, job_id, topic, grade, subject, num_slides):
    # 1. Update status → processing
    # 2. Check semantic cache (in worker, not API — avoids network hop)
    # 3. Cache HIT → update job with cached URL → return
    # 4. Cache MISS → call llm.generate()
    # 5. Generate PPTX → upload to S3
    # 6. Store in cache
    # 7. Update job status → done
    # On any exception → update status → failed, store error_msg
    # Use self.retry() for transient LLM errors
```

**Celery configuration:**
- `worker_concurrency = 4` (4 parallel PPT jobs per worker instance)
- `task_time_limit = 120` (kill task if it runs >2 min)
- `task_soft_time_limit = 90` (soft warning at 90s)
- `result_backend = Redis`
- `task_serializer = "json"`

---

### PHASE 8 — FastAPI Routes

Build `main.py` with these routes only:

**POST `/generate`**
- Validate `GenerateRequest`
- Rate limit: max 5 requests/minute per IP (use `slowapi`)
- Deduplication: check if same user has identical in-flight job (Redis key: `inflight:{hash_of_params}`) — return existing job_id if yes
- Create DB job record → push to Celery → return `GenerateResponse` with job_id
- Response time must be <200ms

**GET `/status/{job_id}`**
- Query DB for job
- Return `StatusResponse`
- If status is `done`, output_url is the S3 signed URL

**GET `/cache/stats`**
- Return cache hit rate, total cost saved (for your DECISIONS.md)

**GET `/health`**
- Check Redis connection, DB connection, Celery worker availability
- Return 200 if all healthy, 503 if any critical service is down

**Middleware to add:**
- CORS (allow Next.js origin)
- Request ID header (add `X-Request-ID` to every response for tracing)
- Structured logging (use `structlog` — log every request with job_id, duration, model used, cache_hit)

---

### PHASE 9 — Frontend

Build the Next.js frontend. **Keep it minimal and functional — this is not a design exercise.**

**`PptForm.tsx`:**
- Fields: Topic (text), Grade (select: Class 1–12), Subject (text), Number of Slides (number: 5–20, default 10)
- On submit: POST to `/api/generate` → navigate to `/status/{job_id}`
- Disable submit button while submitting
- Show inline error if API call fails

**`StatusPoller.tsx`:**
- Poll `/api/status/{job_id}` every 3 seconds using `useEffect` + `setInterval`
- States to show: `queued` (waiting in queue), `processing` (generating), `done` (download ready), `failed` (show error)
- Show a simple progress indicator (not a fake progress bar — just status text + spinner)
- When `done`: show download button linking to `output_url`
- Clear interval on done/failed/unmount

**API proxy routes** (avoids CORS, hides backend URL):
- `POST /api/generate` → proxy to `BACKEND_URL/generate`
- `GET /api/status/[jobId]` → proxy to `BACKEND_URL/status/{jobId}`

---

### PHASE 10 — Documentation

**`DECISIONS.md`** — Write this yourself, covering:
1. Why Python over Node (python-pptx, sentence-transformers, Celery ecosystem)
2. Why async over sync (teacher UX, server resource efficiency)
3. Why semantic cache over exact cache (handles paraphrased requests — the whole point)
4. Why Sonnet primary / Haiku fallback over always-Haiku (quality for complex topics, cost for simple ones)
5. What you skipped: auth, multi-tenancy, WebSocket notifications (too complex for prototype), real-time collaboration — and why that's fine
6. Bottleneck analysis: at 10K PPTs/day, what breaks first and how to fix it

**`architecture/design-doc.md`** — Four sections matching the assignment:
- System design (with the request flow diagram in Mermaid)
- Cost reduction strategy (with the rupee math)
- Reliability plan (503 handling, fallback, retry logic)
- Scaling plan (what changes at 500/day, 2000/day, 10K/day)

**Bonus question answer** (put at end of design-doc.md):
```
10,000 users × 50% teachers = 5,000 teachers
5,000 × 2 PPTs/week × 4.3 weeks = 43,000 PPTs/month

Current system:  43,000 × ₹15  = ₹6,45,000/month
New system:
  - 35% cache hits    → 27,950 actual LLM calls
  - 30% routed Haiku  → ~8,385 Haiku calls @ ₹2   = ₹16,770
  - 70% Sonnet        → ~19,565 Sonnet calls @ ₹5  = ₹97,825
  - Total:            ~₹1,14,595/month
  - Savings:          ~82% reduction
```

---

## CODE QUALITY RULES (enforce these throughout)

1. **No commented-out code.** If it's not running, delete it.
2. **Comments only on non-obvious logic** — the "why", never the "what". A function named `check_cache` doesn't need a comment saying "# check the cache".
3. **Functions do one thing.** If you find yourself writing "# Part 1... # Part 2..." inside a function, split it.
4. **No magic numbers.** Every threshold (0.92, 120, 30 days) goes in `config.py` with an env var override.
5. **Typed everywhere.** Python: use type hints on all function signatures. TypeScript: no `any`.
6. **Error messages must be actionable.** `"LLM timeout after 90s, retrying with fallback model"` not `"Error"`.
7. **Imports grouped:** stdlib → third-party → local. One blank line between groups.
8. **Max function length: 40 lines.** If it's longer, split it.

---

## SCALABILITY CONSTRAINTS TO RESPECT

- FastAPI routes must never do blocking I/O. All DB and Redis calls must be `await`-ed.
- The semantic cache embedding model (`SentenceTransformer`) must be loaded **once at startup**, not per-request. Store as a module-level singleton.
- Celery workers are stateless. No in-memory state between tasks.
- S3 signed URLs expire in 7 days. The DB `output_url` field may be stale — regenerate on request if needed (document this in DECISIONS.md).
- Rate limiting is per-IP at the API layer, not per-user (no auth in prototype). Document the limitation.
- Never log API keys, user data, or file contents. Log job_id, status, duration, model, cache_hit only.

---

## FAILURE MODES TO HANDLE EXPLICITLY

| Failure | How to handle |
|---|---|
| Claude 503 / timeout | Retry once with Haiku. If Haiku also fails, mark job `failed` with clear error message. |
| Redis down | Bypass cache (log warning), continue to LLM. Never fail the job because cache is down. |
| S3 upload fails | Retry twice with exponential backoff. If all fail, mark job `failed`. |
| DB connection lost | asyncpg connection pool auto-reconnects. Log and surface if pool exhausted. |
| python-pptx template missing | Fall back to programmatically generated blank template. Never crash. |
| Malformed LLM JSON | Retry the LLM call once. If still malformed, mark job `failed` with `error_msg = "LLM returned invalid JSON"`. |

---

## WHAT NOT TO BUILD (save time)

- No authentication / JWT (document the gap)
- No WebSocket real-time updates (polling is fine for prototype)
- No multi-tenant school isolation (document needed for production)
- No PDF export (the assignment mentions it but it's not core)
- No admin dashboard
- No email notifications
- No rate limiting per-user (only per-IP)

These are explicitly acknowledged omissions, not oversights. They go in README.md under "What I skipped and why".

---

## FINAL CHECKLIST BEFORE SUBMITTING

- [ ] `POST /generate` returns job_id in <200ms (test with curl)
- [ ] Celery worker generates actual .pptx (not mocked)
- [ ] Semantic cache correctly returns cached URL for similar requests
- [ ] `/health` returns 503 if Redis is down
- [ ] `/cache/stats` shows hit rate and cost saved
- [ ] Model fallback works — test by temporarily killing Sonnet (wrong API key)
- [ ] Frontend polls correctly and shows download link when done
- [ ] `DECISIONS.md` has cost math with actual numbers
- [ ] `design-doc.md` has Mermaid architecture diagram
- [ ] No secrets in code — everything from env vars
- [ ] `README.md` has setup instructions + what was skipped

---

## FIRST RESPONSE EXPECTED FROM AI

When you receive this prompt, do NOT start writing code immediately.

First, output:
1. The complete directory structure you will create
2. The order you will build files in (should match the phases above)
3. Any clarifying assumptions you are making

Then build phase by phase, one file at a time. After each file, briefly state what the next file will do and why it depends on the previous one.

Start now.
