# Savra PPT Generator

AI-powered PowerPoint generation pipeline for school teachers. Handles 100,000 users/day at ₹2–3/PPT (down from ₹15).

---

## Architecture

Teacher → FastAPI → Upstash Redis (cache + queue) → Celery Worker → Groq API → python-pptx → Cloudinary

See [`architecture/design-doc.md`](architecture/design-doc.md) for the full system design, cost math, and scaling plan.

---

## Setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- Upstash Redis (or local)
- PostgreSQL 15+
- Cloudinary account

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

Create a `.env` file in `backend/`:

```env
GROQ_API_KEY=gsk_...
DATABASE_URL=postgresql+asyncpg://user:pass@localhost/savra
REDIS_URL=rediss://default:password@your-upstash-url.upstash.io:6379
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
FRONTEND_ORIGIN=http://localhost:5173
```

Start the API:

```bash
uvicorn main:app --reload --port 8000
```

Start the Celery worker (separate terminal):

```bash
celery -A worker.worker worker --loglevel=info
```


### Frontend

```bash
cd fronted
npm install
```

Create `.env.local`:

```env
VITE_BACKEND_URL=http://localhost:8000
```

Start dev server:

```bash
npm run dev
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| POST | `/generate` | Submit a PPT generation job |
| GET | `/status/{job_id}` | Poll job status + download URL |
| GET | `/cache/stats` | Cache hit rate + cost saved |
| GET | `/health` | Redis + DB health check |

Rate limit: **5 requests/minute per IP**.

---

## What I Skipped and Why

| Feature | Decision |
|---|---|
| Auth / JWT | No auth in prototype — rate limit is per-IP only |
| WebSocket | Polling at 3s is sufficient; WebSocket adds infra complexity |
| Multi-tenant isolation | Production-only feature; out of scope |
| PDF export | Not core; requires libreoffice headless system dependency |
| Admin dashboard | Out of scope |
| Email notifications | Out of scope |

See [`DECISIONS.md`](DECISIONS.md) for full rationale on every architectural choice.

---

## Verify the Build

```bash
# 1. POST /generate — should return job_id in <200ms
curl -X POST http://localhost:8000/generate \
  -H "Content-Type: application/json" \
  -d '{"topic":"Water Cycle","grade":"Class 5","subject":"Science","num_slides":10}'

# 2. Poll status
curl http://localhost:8000/status/<job_id>

# 3. Cache stats
curl http://localhost:8000/cache/stats

# 4. Health (returns 503 if Redis/DB down)
curl http://localhost:8000/health

# 5. Test fallback — set wrong Groq key, watch fallback take over
GROQ_API_KEY=wrong uvicorn main:app
```
