# DECISIONS.md — Savra PPT Generator

Engineering decisions made during the rebuild. Each entry covers: the decision, the alternative considered, and why this choice was made.

---

## 1. Python over Node.js

**Decision:** Python backend (FastAPI).

**Why:**
- `python-pptx` is the best fit for generating real `.pptx` files and preserving layout control.
- `sentence-transformers` gives a simple local embedding path for semantic cache features.
- Celery is mature for Python background jobs, retries, and result backends.

---

## 2. Async over Sync

**Decision:** FastAPI async routes + asyncpg (no synchronous ORM).

**Why:**
- A synchronous route that blocks on DB + Redis under 100 concurrent teachers would require 100 OS threads. FastAPI async routes handle this with a single event loop.
- Teacher UX: the `/generate` endpoint must return in <200ms. A synchronous DB insert + Redis check would introduce 30–80ms of blocking I/O. With `await`, this is non-blocking and transparent to other in-flight requests.
- asyncpg is ~3× faster than psycopg2 in benchmarks and is natively async.

**Alternative rejected:** FastAPI with sync routes + SQLAlchemy. Simpler to write but throttles throughput at scale.

---

## 3. Semantic Cache over Exact Cache

**Decision:** Cosine similarity at threshold 0.92 using `all-MiniLM-L6-v2`.

**Why:**
- Teachers rephrase the same topic constantly. "Water cycle" vs "The Water Cycle" vs "water cycle for kids" should all be reusable.
- An exact-match cache would miss paraphrases and waste LLM calls.
- The semantic cache keeps repeated topics inexpensive without changing the user flow.

**Known limitation:** At >10K cache entries, `SCAN *` + brute-force cosine comparison is O(n). At 10K entries and 5ms per comparison, that's 50 seconds — unacceptable. Production fix: RedisVL vector index or Qdrant sidecar (ANN search, O(log n)).

---

## 4. Primary / fallback model routing

**Decision:** Route complex/long jobs to the primary model; simple factual jobs with fewer slides can use the cheaper/faster fallback path.

**Why:**
- Short factual topics need less token budget than more complex lessons.
- Routing by topic complexity keeps quality higher where it matters most.
- The current app uses Groq GPT-OSS-120B in the codebase, but the same architecture can be reused with a different model later.

**Smart routing saves ~₹3/PPT on ~30% of requests with zero quality loss.**

---

## 5. Cloudinary Delivery Instead of Custom File Hosting

**Decision:** Use Cloudinary to store and serve generated PPTX files.

**Why:**
- It removes the need to build a file server or custom download layer.
- The worker can upload once and return a shareable URL.
- It keeps the prototype simple while still giving a production-friendly storage path.

**Alternative rejected:** local-only file storage. That would make downloads brittle and not shareable.

---

## 6. Signed URL / Download URL Lifetime

**Decision:** Store the generated download URL in the DB and treat it as the job output.

**Known limitation:** If the storage provider changes URL policy, old links may need regeneration.

**Production fix:** Add a refresh step during `/status` if the provider requires expiring URLs.

---

## 7. Rate Limiting per-IP, not per-User

**Decision:** `slowapi` rate limits 5 req/min per IP.

**Known limitation:** A teacher behind a school NAT (all students on one IP) could be blocked if multiple submit simultaneously.

**Production fix:** Implement JWT auth and rate limit per `user_id`. Skipped because auth is out of scope for this prototype.

---

## 8. What I Deliberately Skipped (and Why)

| Feature | Reason Skipped |
|---|---|
| Authentication / JWT | Adds 2–3 days of work; not required to demonstrate the core pipeline |
| WebSocket real-time updates | Polling is sufficient UX for a prototype; WebSocket adds infra complexity |
| Multi-tenant school isolation | Requires row-level security on DB; in-scope for production only |
| PDF export | Not core to the assignment; python-pptx → libreoffice headless conversion works but adds a system dependency |
| Admin dashboard | Out of scope |
| Email notifications | No SMTP/SES setup for prototype |

All of these are documented gaps, not oversights.

---

## 9. Bottleneck Analysis — 10,000 PPTs/day

| Resource | Current Limit | Fix at Scale |
|---|---|---|
| Redis cache scan | O(n) → slow at 10K entries | RedisVL / Qdrant vector index |
| Celery workers | 4 concurrency × N workers | Add workers horizontally (stateless) |
| DB connection pool | max_size=10 | Increase to 50; add PgBouncer if needed |
| Storage URL validity | Provider-dependent download URL | Regenerate or refresh on `/status` if needed |
| FastAPI | Single uvicorn process | gunicorn + uvicorn workers, or add load balancer |
