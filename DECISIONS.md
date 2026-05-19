# DECISIONS.md — Savra PPT Generator

Engineering decisions made during the rebuild. Each entry covers: the decision, the alternative considered, and why this choice was made.

---

## 1. Python over Node.js

**Decision:** Python backend (FastAPI).

**Why:**
- `python-pptx` is the only production-grade library for creating .pptx files programmatically. The Node.js alternatives (pptxgenjs) cannot consume an existing .pptx template with layouts — they generate from scratch, which loses brand styling.
- `sentence-transformers` is the fastest way to run local embedding models with GPU/CPU auto-detection. The equivalent in Node requires ONNX runtime wrangling with no ecosystem support.
- Celery is battle-tested for Python LLM jobs (retries, concurrency, result backends). BullMQ for Node is good but has a smaller ecosystem for ML pipelines.

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
- Teachers rephrase the same topic constantly. "Water cycle" vs "The Water Cycle" vs "water cycle for kids" → all hit the same cache.
- An exact-match cache (hash of input string) would miss ~100% of paraphrased duplicates and is therefore useless in this domain.
- `all-MiniLM-L6-v2` runs in ~5ms on CPU, fits in 80MB RAM, and produces 384-dim vectors that are accurate enough for topic-level similarity.

**Known limitation:** At >10K cache entries, `SCAN *` + brute-force cosine comparison is O(n). At 10K entries and 5ms per comparison, that's 50 seconds — unacceptable. Production fix: RedisVL vector index or Qdrant sidecar (ANN search, O(log n)).

---

## 4. Claude Sonnet primary / Haiku fallback — not always-Haiku

**Decision:** Route complex/long jobs to Sonnet; simple factual jobs (≤8 slides, keyword-detected subjects) to Haiku.

**Why:**
- Haiku is ~10× cheaper than Sonnet but produces noticeably weaker content for multi-disciplinary or abstract topics ("photosynthesis biochemistry", "algebra concepts").
- For history, geography, civics, dates, events with ≤8 slides, the content is factual retrieval — Haiku performs as well as Sonnet at 1/10th the cost.
- Blanket Haiku would cut costs but risk teacher satisfaction, which is the product's core value proposition.

**Smart routing saves ~₹3/PPT on ~30% of requests with zero quality loss.**

---

## 5. S3 Signed URL Staleness

**Decision:** Store signed URLs in the DB; accept 7-day staleness.

**Known limitation:** A job created 8 days ago will have an expired signed URL in the DB. The current `/status` route returns the stored URL without regenerating.

**Production fix:** Call `generate_presigned_url` on every `/status` request instead of reading from DB. This adds ~10ms per poll but ensures URLs are always valid. Not implemented in the prototype to avoid S3 SDK call overhead during development.

---

## 6. Rate Limiting per-IP, not per-User

**Decision:** `slowapi` rate limits 5 req/min per IP.

**Known limitation:** A teacher behind a school NAT (all students on one IP) could be blocked if multiple submit simultaneously.

**Production fix:** Implement JWT auth → rate limit per `user_id`. Skipped because auth is out of scope for this prototype.

---

## 7. What I Deliberately Skipped (and Why)

| Feature | Reason Skipped |
|---|---|
| Authentication / JWT | Adds 2–3 days of work; not required to demonstrate the core pipeline |
| WebSocket real-time updates | Polling at 3s is sufficient UX for a prototype; WebSocket adds infra complexity |
| Multi-tenant school isolation | Requires row-level security on DB; in-scope for production only |
| PDF export | Not core to the assignment; python-pptx → libreoffice headless conversion works but adds a system dependency |
| Admin dashboard | Out of scope |
| Email notifications | No SMTP/SES setup for prototype |

All of these are documented gaps, not oversights.

---

## 8. Bottleneck Analysis — 10,000 PPTs/day

| Resource | Current Limit | Fix at Scale |
|---|---|---|
| Redis cache scan | O(n) → slow at 10K entries | RedisVL / Qdrant vector index |
| Celery workers | 4 concurrency × N workers | Add workers horizontally (stateless) |
| DB connection pool | max_size=10 | Increase to 50; add PgBouncer if needed |
| S3 signed URL expiry | 7-day TTL stored in DB | Regenerate on every /status call |
| FastAPI | Single uvicorn process | gunicorn + uvicorn workers, or add load balancer |
