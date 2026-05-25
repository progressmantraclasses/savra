# Savra PPT Generator

Savra is an AI-powered PowerPoint generator for teachers. It takes a topic, grade, subject, and slide count, then creates a styled PPTX deck, uploads it to Cloudinary, and returns a shareable download link.

The current implementation uses a FastAPI backend, Celery workers, Redis for queueing and cache, Groq for slide content generation, python-pptx for rendering, PostgreSQL for job tracking, and a React + Vite frontend for the user flow.

## Architecture

```mermaid
sequenceDiagram
    participant U as User
    participant F as React Frontend
    participant A as FastAPI API
    participant R as Redis / Upstash
    participant W as Celery Worker
    participant L as Groq LLM
    participant P as python-pptx
    participant C as Cloudinary
    participant D as PostgreSQL

    U->>F: Fill form and submit topic
    F->>A: POST /generate
    A->>R: Check inflight request key
    A->>D: Create job row
    A->>W: Queue generate_ppt_task
    A-->>F: Return job_id immediately

    loop Poll every few seconds
        F->>A: GET /status/{job_id}
        A->>D: Read job status
        A-->>F: queued / processing / done / failed
    end

    W->>R: Check semantic cache
    alt Cache hit
        W->>D: Mark job done with cached URL
    else Cache miss
        W->>L: Generate structured JSON deck content
        L-->>W: Slide plan, theme, palette, bullets, stats, formulas
        W->>P: Render PPTX
        W->>C: Upload PPTX
        W->>R: Store cache entry
        W->>D: Save final output URL and status
    end
```

### What happens in one request

1. The frontend sends the topic details to FastAPI.
2. FastAPI deduplicates repeated in-flight requests with Redis.
3. The request is stored in PostgreSQL with status `queued`.
4. Celery picks the job up in the background.
5. The worker first checks the semantic cache.
6. If there is no cache hit, Groq generates slide-by-slide JSON content.
7. python-pptx turns that JSON into a real PPTX deck.
8. The PPT is uploaded to Cloudinary.
9. The job is marked `done` and the frontend can download the file.

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React + Vite + TypeScript | Form, queue status, job history, download link |
| API | FastAPI | Request validation, routing, CORS, health checks |
| Worker | Celery | Background PPT generation |
| Queue / Cache | Redis / Upstash | Job queue, inflight dedupe, semantic cache |
| LLM | Groq | Slide content planning and structured JSON output |
| Renderer | python-pptx | Builds the final PPTX file |
| Database | PostgreSQL + asyncpg | Job persistence and status tracking |
| Storage | Cloudinary | Stores generated PPTX files |

## Repository Layout

| Path | Purpose |
|---|---|
| [backend/](backend/) | FastAPI app, Celery worker, LLM integration, storage, and DB code |
| [fronted/](fronted/) | React frontend app |
| `architecture/design-doc.md` | Longer architecture notes and scaling discussion |
| `DECISIONS.md` | Why certain implementation choices were made |

## Key Decisions

These are the main design choices behind Savra:

| Decision | Why it was chosen |
|---|---|
| FastAPI for the API layer | Simple async request handling, easy validation, and fast startup on Windows. |
| Celery for background work | PPT generation is slow compared to request latency, so it must run asynchronously. |
| Redis / Upstash for queueing and dedupe | One shared service can act as queue, inflight lock, and cache backend. |
| Groq for LLM generation | The deck plan must be structured JSON, and the worker needs fast turnaround. |
| python-pptx for rendering | It creates real PPTX files and gives control over slide layout and styling. |
| Cloudinary for storage | It returns a downloadable file URL without building custom file hosting. |
| Semantic cache for repeated topics | Teachers often request the same concept in slightly different words. |

See [DECISIONS.md](DECISIONS.md) for the detailed version of these trade-offs.

## What We Built

- A FastAPI backend that accepts PPT requests and tracks job state.
- A Celery worker that generates slides in the background.
- A Groq-powered content planner that returns slide-by-slide JSON.
- A smart PPTX renderer that handles bullets, stats, formulas, and image hints.
- A semantic cache that can reuse prior decks for similar topics.
- A React frontend for submission, polling, and download links.

## What We Skipped And Why

| Skipped feature | Why it was skipped |
|---|---|
| Authentication / JWT | The goal was to prove the generation pipeline first; auth can be added later. |
| WebSocket live updates | Polling is enough for this workflow and keeps the stack simpler. |
| Multi-tenant school isolation | Useful for production, but not required for the current prototype. |
| PDF export | The main output is PPTX; PDF adds extra tooling and runtime dependencies. |
| Admin dashboard | Not needed for the core user journey. |
| Email notifications | The download URL is available directly in the app. |
| Advanced analytics | Out of scope for the first version. |

## Assumptions

The documentation and implementation assume the following:

1. Each request is for one teacher-generated deck at a time.
2. The user has access to a working internet connection for Groq, Cloudinary, and Upstash.
3. PostgreSQL, Redis, and Cloudinary are available before the app starts.
4. The deck generator is allowed to reuse cached output for similar topics.
5. The frontend runs locally on `http://localhost:5173` during development.
6. The backend runs locally on `http://localhost:8000` during development.
7. Windows users may need the Celery solo worker mode shown below.

## Cost Breakdown

The cost of one PPT is mainly driven by the LLM call. Everything else is low-cost infrastructure.

### Per-PPT cost components

| Component | Cost behavior | Notes |
|---|---|---|
| LLM generation | Highest variable cost | Groq GPT-OSS-120B is used in the current code. If you swap to Gemini, only this line item changes. |
| Semantic cache hit | Near zero LLM cost | Repeated or similar topics can reuse the stored PPT URL. |
| PPT rendering | Free in API terms | python-pptx runs locally on the worker machine. |
| Redis / Upstash | Very small | Used for queueing, dedupe, and cache metadata. |
| PostgreSQL | Very small | Stores job status and output URL only. |
| Cloudinary upload | Small | File storage and delivery cost. |

### Easy formula

Use this formula for any model, including Gemini or Groq:

```text
cost per PPT = LLM input cost + LLM output cost + storage/upload cost + queue/db overhead
```

If you want a token-based estimate:

```text
LLM cost = (input_tokens / 1,000,000 * input_rate) + (output_tokens / 1,000,000 * output_rate)
```

### Practical estimate

For a normal deck, the worker usually generates a structured JSON payload that is much smaller than a full essay, so the cost is mostly controlled by:

1. Number of slides requested.
2. How detailed the slide content is.
3. Whether the request hits the cache.
4. Which model is selected for the run.

In this project, the deck generator also supports richer content such as bullets, stats, formulas, and image hints. That improves quality, but it can increase output tokens a little. The cache is what keeps repeated topics inexpensive.

### Model note: Gemini vs Groq GPT-OSS-120B

This repo currently uses Groq GPT-OSS-120B in `backend/config.py` and `backend/llm/llm.py`. If you want to replace it with Gemini later, keep the same JSON schema and slide renderer, then only swap the LLM client and pricing assumptions.

For a README-friendly cost story, the simplest way to explain it is:

- Groq GPT-OSS-120B: good for structured slide planning and fast generation.
- Gemini: also suitable if you want to compare provider pricing or quality.
- The final deck cost depends on provider token pricing, cache hit rate, and storage.

## Prerequisites

Install these before running the app:

- Python 3.11 or newer
- Node.js 20 or newer
- PostgreSQL 15 or newer
- Redis or Upstash Redis
- A Cloudinary account
- A Groq API key

## Backend Setup

The backend lives in [backend/](backend/).

### 1. Create and activate a virtual environment

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, run:

```powershell
Set-ExecutionPolicy -Scope Process RemoteSigned
```

### 2. Install Python dependencies

```powershell
pip install -r requirements.txt
```

The backend requirements are:

- `fastapi`
- `uvicorn[standard]`
- `pydantic`
- `pydantic-settings`
- `groq`
- `celery`
- `redis`
- `sentence-transformers`
- `numpy`
- `python-pptx`
- `cloudinary`
- `asyncpg`
- `slowapi`
- `structlog`

### 3. Create the backend environment file

Copy `backend/.env.example` to `backend/.env` and fill in your real values.

```env
GROQ_API_KEY=gsk_your_key_here
DATABASE_URL=postgresql://postgres:password@localhost:5432/savra
REDIS_URL=rediss://default:password@your-upstash-url.upstash.io:6379
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
FRONTEND_ORIGIN=http://localhost:5173
```

### 4. Optional backend settings

You can also override these in `.env` if needed:

- `CACHE_SIMILARITY_THRESHOLD`
- `CACHE_TTL_SECONDS`
- `CACHE_MAX_PROTOTYPE_ENTRIES`
- `PRIMARY_MODEL`
- `FALLBACK_MODEL`
- `PRIMARY_MAX_TOKENS`
- `FALLBACK_MAX_TOKENS`
- `CELERY_CONCURRENCY`
- `TASK_TIME_LIMIT`
- `TASK_SOFT_TIME_LIMIT`
- `RATE_LIMIT_PER_MINUTE`
- `SIGNED_URL_EXPIRY_SECONDS`
- `UPLOAD_MAX_RETRIES`
- `UPLOAD_RETRY_BASE_DELAY`
- `PPTX_TEMPLATE_PATH`
- `FRONTEND_ORIGIN`

### 5. Start the API server

Run this from inside `backend/`:

```powershell
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### 6. Start the Celery worker

On Windows, use the solo pool:

```powershell
python -m celery -A worker.worker worker --loglevel=info --pool=solo --concurrency=1
```

If you run into import path problems, make sure the command is executed from `backend/` and not from the repository root.

## Frontend Setup

The frontend lives in [fronted/](fronted/) in this repository.

### 1. Install dependencies

```powershell
cd ..\fronted
npm install
```

### 2. Create the frontend environment file

Create `fronted/.env.local` with:

```env
VITE_BACKEND_URL=http://localhost:8000
```

### 3. Start the frontend

```powershell
npm run dev
```

Open the URL shown by Vite, usually `http://localhost:5173`.

## Full Local Run Order

1. Start PostgreSQL.
2. Start Redis or make sure Upstash is reachable.
3. Start the backend API.
4. Start the Celery worker.
5. Start the frontend.
6. Submit a PPT request from the web UI.
7. Poll the job page until the output URL appears.

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/generate` | Submit a new PPT generation job |
| `GET` | `/status/{job_id}` | Check job progress and output URL |
| `GET` | `/cache/stats` | View cache statistics |
| `GET` | `/health` | Check Redis and database health |

The API rate limit is `5 requests/minute per IP`.

## Verify the Build

You can test the system end-to-end with these steps:

```powershell
Invoke-RestMethod -Method Post http://localhost:8000/generate `
  -ContentType "application/json" `
  -Body '{"topic":"Water Cycle","grade":"Class 5","subject":"Science","num_slides":10}'
```

Then poll the returned job ID:

```powershell
Invoke-RestMethod http://localhost:8000/status/<job_id>
```

You can also check the health endpoint:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

## Notes for Windows

- Celery works best here with `--pool=solo`.
- Uvicorn `--reload` is convenient during development, but it can restart often when backend files change.
- If a command says the worker module cannot be imported, run it from `backend/`.

## More Detail

If you want the deeper design rationale, scaling notes, and trade-offs, see [`architecture/design-doc.md`](architecture/design-doc.md) and [`DECISIONS.md`](DECISIONS.md).
