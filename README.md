# ReachInbox Email Job Scheduler

A production-oriented **email scheduling system**: authenticate with Google, upload leads (CSV/TXT), compose a campaign, and let a BullMQ worker deliver emails through Ethereal SMTP with **distributed rate limiting**, **crash recovery**, **Elasticsearch search**, and **real Slack alerts** when a sender reaches its hourly limit.

- **Persistent scheduling** — BullMQ delayed jobs in Redis (no cron, no polling)
- **PostgreSQL** as the source of truth via Prisma
- **Ethereal SMTP** delivery with per-message preview links
- **Elasticsearch** as a search projection over email state
- **Google OAuth** login and **Slack OAuth** notifications
- **Atomic, multi-worker-safe rate limiting** in Redis (Lua)
- **React + Tailwind dashboard** with loading/empty/error states everywhere

---

## Features

| Area | What's implemented |
|---|---|
| Auth | Real Google OAuth (passport), DB-backed sessions with hashed tokens, HTTP-only cookies, logout |
| Compose | Subject/body, sender picker, CSV/TXT recipient upload with valid/invalid/duplicate stats, start time, delay, hourly limit |
| Scheduling | One BullMQ **delayed job per recipient**, deterministic job IDs (`email_<emailId>`), staggered start times |
| Rate limiting | Distributed **atomic Lua** checks: hourly cap + minimum inter-email delay, safe across any number of workers |
| Overflow | Emails beyond the hourly limit are **rescheduled to the next UTC hour** — never failed or dropped |
| Campaign limits | The compose form's hourly limit is enforced as `min(sender cap, campaign cap)` |
| Idempotency | Atomic `scheduled → processing` DB claim; duplicate job delivery can never double-send |
| Crash recovery | Startup reconciliation recreates only missing jobs; stale `processing` claims are auto-recovered after a worker crash |
| SMTP | Ethereal delivery, deterministic RFC Message-ID, preview URL stored per email |
| Search | Real Elasticsearch index (text + keyword mappings), multi-match search with filters and pagination |
| Slack | Real Slack OAuth, AES-256-GCM encrypted tokens, rate-limit alerts deduplicated per sender/hour, disconnect/reconnect |
| Dashboard | Scheduled/Sent tables with pagination, Elasticsearch-backed search, status badges, toasts, user header with avatar |
| Ops | `/health`, `/health/ready` (pg/redis/es), session-protected Bull Board, structured Pino logging, graceful shutdown |

---

## Architecture

```text
Browser
  ↓
React/Vite frontend (Tailwind, TanStack Query)
  ↓  HTTP-only session cookie
Express REST API ─────────────────► PostgreSQL (source of truth, Prisma)
  │                                Elasticsearch (search projection)
  ├──────────────► BullMQ delayed jobs ──► Redis (queue + rate limits)
  │                                              │
  ▼                                              ▼
Bull Board (/admin/queues, protected)        Email Worker
                                    ┌───────────┼───────────┐
                                    ▼           ▼           ▼
                                Ethereal      Slack     PostgreSQL
                                 (SMTP)    (OAuth+alerts)  (state machine)

Google OAuth ──► Google (login)      Slack OAuth ──► Slack API / incoming webhook
```

**Responsibilities**

- **Express API** — auth, validation (Zod), campaign creation: writes email rows first, then enqueues jobs.
- **BullMQ/Redis** — durable delayed-job scheduler; Redis also hosts the atomic rate limiter and Slack alert dedup keys.
- **Email worker** — claims emails atomically, acquires a rate-limit slot, sends via SMTP, updates PostgreSQL, then Elasticsearch.
- **PostgreSQL** — source of truth for users, sessions, senders, email state; drives every decision.
- **Elasticsearch** — disposable search projection; never authoritative.
- **Slack service** — OAuth + best-effort notifications, fully isolated from email processing.

---

## Project Structure

```text
apps/api                 Express API, BullMQ worker, services, tests
  src/config             env validation (Zod, fail-fast) + constants
  src/controllers|routes REST layer (thin handlers, no business logic)
  src/services
    scheduler/           campaign scheduling + startup job reconciliation
    rate-limit/          Redis Lua send-slot acquisition/release
    email/               state machine, listing, SMTP (Ethereal)
    auth/                Google strategy + DB-backed sessions
    elasticsearch/       index lifecycle, indexing, search
    slack/               OAuth, encrypted token storage, notifications
  src/queues/            BullMQ queue, worker, connections
  prisma/                schema + 2 committed migrations + seed
  scripts/               env-loading wrapper, restart-verification helper
  tests/                 unit + integration + e2e (51 tests)
apps/web                 React + Vite + Tailwind dashboard
  src/components/ui|layout|emails|compose|slack
  src/pages              LoginPage, DashboardPage, ComposePage
  src/hooks|lib          TanStack Query hooks, API client, CSV parser
packages/shared          shared Zod schemas, DTO types, key/jobId helpers
docker-compose.yml       postgres (host port 5433), redis, elasticsearch
examples/                sample-leads.csv
```

## Tech Stack

| Technology | Purpose |
|---|---|
| TypeScript | End-to-end types across API, worker, web, shared package |
| Node.js + Express | REST API, middleware, session cookies |
| BullMQ + Redis | Persistent delayed jobs, distributed rate limiting, alert dedup |
| PostgreSQL + Prisma | Source of truth, migrations, typed queries |
| Elasticsearch | Search projection (multi-match + term filters) |
| Nodemailer + Ethereal | SMTP delivery and per-message preview URLs |
| Google OAuth (passport-google-oauth20) | Login |
| Slack OAuth + Web API | Notifications (`chat:write`, `incoming-webhook`) |
| React, Vite, Tailwind, TanStack Query, React Router | Dashboard |
| Papa Parse | CSV/TXT recipient parsing (client + server side) |
| Zod | Request/env validation (shared schemas) |
| Pino | Structured logging with secret redaction |
| Docker Compose | Local infrastructure with health checks |
| Vitest + Supertest | 51 unit/integration/e2e tests |

---

## Prerequisites

- **Node.js ≥ 20** and npm ≥ 10
- **Docker Desktop** (PostgreSQL, Redis, Elasticsearch)
- **Google OAuth credentials** (free) — see [Google OAuth Setup](#google-oauth-setup)
- **Slack OAuth credentials** (optional feature) — see [Slack OAuth Setup](#slack-oauth-setup)
- **Ethereal credentials** (free test SMTP) — see [Ethereal Setup](#ethereal-setup)

## Installation

```bash
git clone https://github.com/Tanishq0211/Email-Job-Scheduler.git
cd Email-Job-Scheduler
npm install
cp .env.example .env      # fill in the values (see below)
docker compose up -d
npm run db:migrate
```

## Environment Variables

All variables live in `.env` (gitignored). Copy `.env.example` and fill in:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` / `production` |
| `PORT` | API port (default `4000`) |
| `LOG_LEVEL` | Pino level (`info` default) |
| `FRONTEND_URL` | CORS origin + OAuth redirect target (default `http://localhost:5173`) |
| `DATABASE_URL` | PostgreSQL connection string (`localhost:5433` — see [Docker](#docker)) |
| `REDIS_URL` | Redis connection string (`redis://localhost:6379`) |
| `ELASTICSEARCH_URL` | Elasticsearch node (`http://localhost:9200`) |
| `ELASTICSEARCH_INDEX` | Index name (default `emails`) |
| `SESSION_SECRET` | HMAC key for OAuth state signing (`openssl rand -hex 32`) |
| `APP_ENCRYPTION_KEY` | AES-256-GCM key for Slack tokens at rest (`openssl rand -hex 32`) |
| `COOKIE_SECURE` | Set `true` behind HTTPS |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client |
| `GOOGLE_CALLBACK_URL` | Must be `http://localhost:4000/auth/google/callback` locally |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack app credentials (optional; unset disables Slack cleanly) |
| `SLACK_REDIRECT_URI` | Must be `http://localhost:4000/auth/slack/callback` locally |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | Ethereal: `smtp.ethereal.email`, `587`, `false` |
| `SMTP_USER` / `SMTP_PASSWORD` | Ethereal credentials (also used as the demo sender address) |
| `WORKER_CONCURRENCY` | Simultaneous jobs per worker process (default `10`) |
| `MIN_SEND_DELAY_MS` | Global minimum spacing between sends **per sender** (default `2000`) |
| `MAX_EMAILS_PER_HOUR` | Default hourly cap applied to new senders (default `200`) |
| `MAX_RECIPIENTS_PER_REQUEST` | Hard cap on recipients per schedule request (default `5000`) |

Startup fails fast if any required variable is missing or malformed.

## Google OAuth Setup

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create Credentials → OAuth client ID → Web application**.
2. Authorized **redirect URI**: `http://localhost:4000/auth/google/callback` (must match `GOOGLE_CALLBACK_URL` exactly).
3. Authorized **JavaScript origin** is not required for the login redirect itself, but add your frontend origin (e.g. `http://localhost:5173`) for completeness.
4. Copy the client ID/secret into `.env`.

Flow: `GET /auth/google` (signed state cookie + query state) → Google consent → `GET /auth/google/callback` → state verified → user upserted → session created → HTTP-only cookie → redirect to the frontend.

## Slack OAuth Setup

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From scratch**.
2. **OAuth & Permissions → Redirect URLs**: `http://localhost:4000/auth/slack/callback`.
3. **Bot Token Scopes**: `chat:write` and `incoming-webhook` (both are used — the incoming-webhook scope makes Slack prompt the installer to pick a channel and gives us the channel + webhook).
4. Install the app to your workspace (**Install to Workspace**) — this is the "channel selection" step.
5. Copy the Client ID/Secret into `.env`.

Dashboard flow: **Connect Slack** → Slack consent → `GET /auth/slack/callback` → state verified → tokens encrypted (AES-256-GCM) and stored → **Disconnect** deletes the connection. When a sender hits its hourly limit, one alert per sender/hour is posted via the incoming webhook (or `chat.postMessage` fallback). No connection → notifications are silently skipped; email processing is never affected.

## Ethereal Setup

1. Create a free account at [ethereal.email](https://ethereal.email) (or POST to `https://api.nodemailer.com/user`).
2. Put the generated username/password into `SMTP_USER` / `SMTP_PASSWORD`.
3. Every sent email stores a **preview URL** (`previewUrl`) visible in the API — messages are also visible in the Ethereal inbox.

## Database Setup

```bash
npm run db:migrate      # applies the committed Prisma migrations (migrate deploy)
npm run db:generate     # regenerate the Prisma client (usually automatic)
npm run db:seed         # optional: creates a default sender for existing users
```

Two committed migrations: initial schema and `email_hourly_limit` (per-campaign rate-limit column).

## Running the Application

Infrastructure first, then everything at once — or piece by piece:

```bash
docker compose up -d    # postgres (5433), redis (6379), elasticsearch (9200)

npm run dev             # API :4000 + worker + web :5173 via concurrently
# or individually:
npm run dev:api         # API only
npm run dev:worker      # email worker only
npm run dev:web         # frontend only
```

Open **http://localhost:5173** → *Continue with Google*. If you run the frontend on another port, update `FRONTEND_URL` in `.env` (the Vite dev server proxies `/api`, `/auth`, `/admin`, `/health` to the API on port 4000).

## API / Health Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness (process up) |
| `GET /health/ready` | Readiness — checks PostgreSQL, Redis, Elasticsearch |
| `GET /auth/google` → `GET /auth/google/callback` | Google OAuth flow |
| `GET /auth/slack` → `GET /auth/slack/callback` | Slack OAuth flow (session required) |
| `POST /api/auth/logout` / `GET /api/auth/me` | Session management |
| `POST /api/emails/schedule` | Schedule a campaign (Zod-validated) |
| `GET /api/emails/scheduled` | Paginated scheduled/processing emails |
| `GET /api/emails/sent` | Paginated sent/failed emails (`?status=` filter) |
| `GET /api/emails/search?q=` | Elasticsearch search (+ `status`, `senderId`, date filters, pagination) |
| `GET /api/emails/:id` | Single email incl. Ethereal preview URL |
| `GET/POST /api/senders`, `PATCH /api/senders/:id` | Sender management |
| `GET /api/slack/status`, `POST /api/slack/disconnect` | Slack connection state |
| `GET /admin/queues` | **Bull Board** — session-protected; anonymous access returns 401 |

All protected endpoints derive the user from the session cookie — never from request parameters — and every query is ownership-scoped.

## BullMQ / Worker

- **Delayed jobs**: one BullMQ job per recipient, `delay = scheduledAt − now`, name `send-email`, payload `{ emailId }`.
- **Deterministic job IDs**: `email_<emailId>` makes re-enqueueing an idempotent no-op while a job exists, and enables safe recovery.
- **Concurrency**: `WORKER_CONCURRENCY` controls simultaneous jobs per process; actual sending is throttled by the Redis rate limiter, so concurrency and send spacing are independent controls.
- **Restart recovery**: Redis persists delayed jobs across restarts; workers just reconnect.
- **Reconciliation** (boot-time only, never a poll): emails in `scheduled` whose BullMQ job is missing are re-enqueued with the same deterministic ID; long-stuck `processing` rows with no live job are reset to `scheduled` first.
- **Stale-processing recovery**: if a worker crashes after claiming but before sending, BullMQ re-delivers the stalled job; the worker recovers the stale claim (only if older than 20s, via a conditional update) and sends.

## Rate Limiting

Both controls are enforced **per sender** in a single atomic Lua script — the check-and-increment is one Redis script execution, so any number of workers/instances agree on who may send. SMTP is **never called** when a slot is unavailable.

```lua
-- KEYS: hourly counter (email-rate:{senderId}:{YYYY-MM-DD-HH}), send gate
-- ARGV: limit, minDelayMs, now, msToNextUtcHour
if counter >= limit           then return BLOCKED_HOURLY(nextHourIn) end
if lastSend + minDelay > now  then return BLOCKED_DELAY(wait)      end
INCR counter; EXPIRE counter 7200; SET gate = now
return ACQUIRED
```

1. **Minimum delay** — the gate key stores the last send-*start* timestamp; a send may start only once `MIN_SEND_DELAY_MS` has elapsed since the previous one, globally per sender (worker concurrency does not bypass it).
2. **Hourly limit** — a counter per `(sender, UTC hour window)` with a 2h TTL; windows are pure UTC, so `18:59:59 → 19:00:00` rolls over deterministically.
3. **Campaign-specific limit** — each email stores `min(sender.hourlyLimit, campaign.hourlyLimit)`; the worker enforces that value against the shared per-sender counter, so the most restrictive active limit wins and a campaign can never raise the sender's safety cap.
4. **When the limit is reached** — the email is reverted to `scheduled` and the job is moved back to *delayed* until the next UTC-hour boundary (`job.moveToDelayed`). Nothing is failed, dropped, deleted, or counted as an SMTP attempt.
5. **Ordering** — jobs were enqueued in recipient order; blocked jobs merge into the next window in near-original order (BullMQ wakes delayed jobs in timestamp order), but concurrent workers may acquire the send gate slightly out of order — best-effort, not strict FIFO.
6. **Failed SMTP attempts** — release their hourly slot (Lua DECR, floored at 0) so failures don't consume capacity, then retry with exponential backoff (3 attempts); the final failure marks the email `failed` with a stored reason.
7. **Slack alerts** — the first blocked email per `(sender, hour)` reserves the alert via Redis `SET NX` and posts a real notification. Delivery failure releases the reservation so a later event retries; no Slack connection → no reservation is consumed. Notification errors are logged and swallowed — email processing is unaffected.

## Persistence & Crash Recovery

- **API/worker restart** — BullMQ delayed jobs live in Redis (append-only persistence enabled in compose). Restarted workers reconnect and continue; nothing is re-enqueued wholesale.
- **Process crash** — three layers: (1) deterministic job IDs prevent duplicate jobs at enqueue time; (2) the atomic `scheduled → processing` claim ensures exactly one worker sends; (3) boot-time reconciliation recreates only *missing* jobs, and stale `processing` claims are recovered when BullMQ re-delivers stalled jobs.
- **DB ↔ Redis consistency** — email rows are created first; if job enqueueing fails afterwards, rows remain `scheduled` and reconciliation recreates the jobs on next boot. No distributed transaction is pretended.

## Idempotency

Duplicate sends are prevented by two independent mechanisms:

1. **Deterministic BullMQ job ID** `email_<emailId>` — adding a job with an existing ID is a no-op, so reconciliation and retries can't create duplicates.
2. **Atomic DB claim** — the worker runs `UPDATE emails SET status='processing' WHERE id=? AND status='scheduled'`; only one worker's update matches. A job whose email is already `sent`, `claimed`, `failed`, or `cancelled` returns without sending.

Additionally, every send uses a **deterministic RFC Message-ID** (`<emailId@reachinbox.scheduler>`): if the process dies between SMTP accept and DB commit, the retry re-sends the same message identity instead of a visually duplicated new one.

## Elasticsearch

- Index + mappings are created automatically at boot (keyword: `userId`, `senderId`, `status`; text: `recipient`, `subject`, `body`; dates: `scheduledAt`, `sentAt`, `createdAt`).
- Emails are indexed after creation and re-indexed after status changes (`sent`/`failed`).
- `GET /api/emails/search` does a `multi_match` over recipient/subject/body with term filters and `from/size` pagination.
- Indexing failures are logged and **never** fail the email send; boot-time reconciliation re-indexes documents updated in the last 24h.
- PostgreSQL remains authoritative — Elasticsearch is a rebuildable projection.

## Slack Notifications

- Tokens and webhook URLs are encrypted at rest (AES-256-GCM, key from `APP_ENCRYPTION_KEY`) and never logged or exposed to the frontend.
- Delivery prefers the incoming webhook from the install flow; falls back to `chat.postMessage` with the stored bot token.
- Alert content: sender, hourly limit, UTC window, and a note that extra emails were rescheduled.
- Dedup key `slack-rate-alert:{senderId}:{window}` (Redis `SET NX`, 1h TTL): exactly one alert per sender/hour; released on delivery failure so the hour can retry; not created at all when Slack isn't connected.
- Every failure path is caught and logged — a Slack outage can never break scheduling or sending.

## Security

- HTTP-only, SameSite=Lax session cookies (`COOKIE_SECURE=true` behind HTTPS); session tokens stored **hashed** (SHA-256) in PostgreSQL; logout invalidates the server-side session.
- OAuth state: cryptographically signed, double-submitted via cookie + query, verified on every callback.
- Slack tokens encrypted at rest; secrets never logged (Pino redaction) and never sent to the frontend.
- Helmet, CORS restricted to `FRONTEND_URL` (credentials), JSON payload limits, Zod validation on bodies/queries/params, rate limiting on auth endpoints.
- Bull Board requires an authenticated session (401 otherwise).
- `.env` is gitignored; `.env.example` contains placeholders only.

## Testing

```bash
npm test        # 51 tests / 10 files — all passing
```

Categories: **scheduling API** (validation, ownership, 401s, delayed-job creation), **persistence & crash recovery** (deterministic IDs, reconciliation idempotence, stale-claim recovery), **idempotency** (20-way concurrent claim race), **rate limiting** (20 concurrent acquisitions of a 5-slot limit → exactly 5; slot release on failure), **minimum delay**, **1000-recipient campaigns** (999 rows + 999 uniquely-identified jobs), **Slack** (authorize redirect, alert dedup, retry after failure, no-op without connection), **Elasticsearch** (real send → searchable), and a full **e2e** flow with a real Ethereal SMTP delivery. Integration tests use the real Docker services and skip cleanly when they're not running.

## Docker

| Service | Image | Host port | Persistence |
|---|---|---|---|
| postgres | `postgres:16-alpine` | **5433** (avoids clashing with a local Postgres) | named volume |
| redis | `redis:7-alpine` | 6379 | AOF, named volume |
| elasticsearch | `8.15.0` single-node, security disabled | 9200 | named volume |

All three have health checks; wait for them before migrating (`docker compose ps`).

## Troubleshooting

- **Port 5432/5433 in use** — the compose file maps Postgres to host **5433**; make sure `DATABASE_URL` uses `localhost:5433`. Change the mapping if 5433 is taken too.
- **Redis/Postgres unavailable at boot** — startup fails fast with a clear error; run `docker compose up -d` and check `docker compose ps` for healthy status.
- **Elasticsearch slow to start** — it takes ~30–60s; `/health/ready` reports 503 until it's green.
- **OAuth `redirect_uri_mismatch` / callback errors** — the redirect URI in the Google/Slack console must match `GOOGLE_CALLBACK_URL` / `SLACK_REDIRECT_URI` byte-for-byte, and `FRONTEND_URL` must match where the frontend actually runs.
- **`invalid_grant` / "Bad Request" during Google login** — the authorization code is single-use; don't hit the callback twice (the app runs the OAuth strategy exactly once per callback).
- **Worker not sending** — ensure `npm run dev:worker` (or root `npm run dev`) is running; check `/admin/queues` for delayed jobs.
- **Tests failing with "locked by another worker"** — a live dev worker is consuming test jobs; stop `npm run dev` processes, run `npm test`, restart afterward.
- **Slack connect returns 503** — `SLACK_CLIENT_ID`/`SECRET`/`REDIRECT_URI` are not all set (Slack is an optional integration).

## Demo / Verification — 5-Minute Demo

For a fast, visible demo set in `.env`: `WORKER_CONCURRENCY=3`, `MIN_SEND_DELAY_MS=2000`, `MAX_EMAILS_PER_HOUR=3`.

1. `npm run dev` → open http://localhost:5173 → **Login with Google**.
2. Dashboard loads with the Scheduled/Sent tabs and your avatar/name/email.
3. **Connect Slack** (header) → authorize the workspace + channel.
4. **Compose** → upload `examples/sample-leads.csv` → stats show 7 valid / 1 invalid / 1 duplicate removed.
5. Start time ≈ now, delay 2s, hourly limit **3** → **Schedule**.
6. **Scheduled Emails** shows all 7 rows.
7. Watch the worker: Bull Board (`/admin/queues`) shows delayed → active → completed; 3 emails send, 4 defer to the next UTC hour.
8. **Slack** receives exactly one rate-limit alert for the window.
9. **Sent Emails** shows delivered rows; each has an Ethereal preview URL via the API.
10. Restart-safety: stop the dev processes, wait past the fire time, run `npm run dev:worker` — the remaining emails still deliver (automated: `npx tsx apps/api/scripts/verify-restart.ts schedule` then `check`).
11. Search a recipient/subject fragment in the dashboard (Elasticsearch).

## Trade-offs / Assumptions

- **Ordering after rate-limit overflow is best-effort**, not strict FIFO — blocked jobs merge into the next window in near-original order but concurrent workers may interleave.
- **Elasticsearch is a projection**; PostgreSQL is authoritative. A long ES outage leaves search stale until the next boot-time reconciliation; email state is never lost.
- **Slack notifications are best-effort** and fully isolated from email processing; a failed hour retries only when the next rate-limit event occurs.
- **SMTP cannot mathematically guarantee exactly-once external delivery.** The design guarantees exactly-once *processing* (atomic claim + deterministic job IDs) and narrows the crash window with deterministic Message-IDs; the residual at-least-once SMTP reality is documented rather than hidden.
- **Local OAuth requires localhost callback URLs**; production deployment needs real domains registered in the Google/Slack consoles and `COOKIE_SECURE=true`.
- **UTC hour windows** are used for rate limiting regardless of viewer timezone; the frontend renders timestamps in the user's locale.
- Elasticsearch runs with security disabled (local dev compose only); production deployments should enable it or front the cluster with proper auth.
