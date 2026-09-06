# ReachInbox — Email Job Scheduler & Dashboard

A production-ready, full-stack email scheduling system: authenticate with
Google, upload leads (CSV/TXT), compose a campaign, and let a BullMQ worker
deliver emails through Ethereal SMTP with **distributed rate limiting**,
**restart-safe scheduling**, **Elasticsearch search**, and **real Slack
notifications** when a sender hits its hourly limit.

```text
React (Vite + Tailwind + TanStack Query)
  │  HTTP-only session cookie
  ▼
Express API ──────────────► PostgreSQL (source of truth, Prisma)
  │                        Elasticsearch (search projection)
  ├───────────────► BullMQ delayed jobs ──► Redis (queue + rate limits)
  │                                              │
  ▼                                              ▼
Bull Board (/admin/queues)                   Email Worker
                                    ┌───────────┼───────────┐
                                    ▼           ▼           ▼
                                Ethereal      Slack     PostgreSQL
                                 (SMTP)    (alerts)   (state machine)
```

---

## Feature checklist

| Area | Highlights |
|---|---|
| Auth | Real Google OAuth (passport), DB-backed sessions, HTTP-only cookies, logout |
| Scheduling | One BullMQ **delayed job per recipient**, deterministic job ids (`email_<emailId>`) |
| Idempotency | Atomic `scheduled → processing` claim; duplicate job delivery can never double-send |
| Rate limiting | Redis **Lua** atomic slot acquisition: hourly cap + min send delay, safe across N workers |
| Overflow | Emails past the hourly limit are **rescheduled to the next UTC hour** — never dropped |
| Slack | Real Slack OAuth, encrypted token at rest (AES-256-GCM), deduplicated rate-limit alerts |
| Search | Real Elasticsearch index, multi-match over recipient/subject/body, filters + pagination |
| Ops | `/health`, `/health/ready` (pg/redis/es), Bull Board (session-protected), structured Pino logs |
| Frontend | Login, dashboard (scheduled/sent tabs), compose, CSV/TXT parsing, loading/empty/error states, toasts |

---

## Quick start

### Prerequisites

- **Node.js ≥ 20** and npm ≥ 10
- **Docker Desktop** (for PostgreSQL, Redis, Elasticsearch)
- **Google OAuth credentials** (free) — [console.cloud.google.com](https://console.cloud.google.com/apis/credentials)
- **Slack OAuth credentials** (optional feature) — [api.slack.com/apps](https://api.slack.com/apps)
- **Ethereal credentials** (free test SMTP) — [ethereal.email](https://ethereal.email) ("Create Ethereal Account")

### 1. Install & start infrastructure

```bash
git clone <repo>
cd reachinbox-email-scheduler
cp .env.example .env        # then fill in the values (see below)
docker compose up -d        # postgres (host port 5433), redis, elasticsearch
```

### 2. Fill in `.env`

| Variable | Notes |
|---|---|
| `SESSION_SECRET`, `APP_ENCRYPTION_KEY` | `openssl rand -hex 32` each |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credentials → OAuth client (Web). Authorized redirect URI: `http://localhost:4000/auth/google/callback` |
| `SMTP_USER` / `SMTP_PASSWORD` | From ethereal.email (also used as the demo sender address) |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Optional. Redirect URI: `http://localhost:4000/auth/slack/callback`. Request bot scopes `chat:write,incoming-webhook` |
| `DATABASE_URL` | Points at `localhost:5433` to avoid clashing with a local Postgres |
| `WORKER_CONCURRENCY`, `MIN_SEND_DELAY_MS`, `MAX_EMAILS_PER_HOUR` | Demo values: `3`, `2000`, `3` make throttling visible quickly |

### 3. Migrate & run

```bash
npm install
npm run db:migrate          # applies committed Prisma migrations
npm run dev                 # API :4000 + worker + web :5173 (concurrently)
```

Open **http://localhost:5173** → *Continue with Google* → dashboard.

Useful extras:

```bash
npm run dev:api             # API only
npm run dev:worker          # worker only
npm run db:seed             # creates a default sender for existing users
npm run build && npm test   # typecheck-free production build + all tests
```

### 4. Bull Board

Open **http://localhost:5173/admin/queues** (the Vite proxy forwards it)
while logged in — it is **session-protected**, anonymous access returns 401.
You will see the `email-queue` with waiting/delayed/active/completed/failed jobs.

### 5. Elasticsearch search

The `emails` index is created automatically at boot with keyword fields
(`userId`, `senderId`, `status`) and text fields (`recipient`, `subject`,
`body`). The dashboard search box calls `GET /api/emails/search?q=…`, which
queries Elasticsearch with pagination:

```bash
curl "http://localhost:4000/api/emails/search?q=hello&page=1" --cookie "..."
```

---

## Demo script

```bash
# .env for a fast demo:
WORKER_CONCURRENCY=3
MIN_SEND_DELAY_MS=2000
MAX_EMAILS_PER_HOUR=3
```

1. **Schedule** — Compose → upload `examples/sample-leads.csv` (you'll see
   valid/invalid/duplicate stats) → start time now → Schedule.
2. **Watch throttling** — with `MAX_EMAILS_PER_HOUR=3`, the first 3 emails
   send, the rest are rescheduled to the next UTC hour, and (if Slack is
   connected) **one** Slack alert fires for the window.
3. **Search** — use the dashboard search (Elasticsearch, server-side).
4. **Restart safety** —
   ```bash
   # schedule an email ~1 min in the future, then:
   # stop the dev processes (Ctrl+C), wait past the fire time, then:
   npm run dev:worker
   ```
   The delayed job lives in Redis; the restarted worker picks it up and
   sends it. `apps/api/scripts/verify-restart.ts` automates this check.
5. **Bull Board** — observe delayed → active → completed transitions live.

---

## How the hard parts work

### Restart-safe scheduling
The scheduler (BullMQ delayed jobs + Redis persistence) is the only
scheduling mechanism — no cron, no polling. Redis holds the delayed jobs
across restarts; workers simply reconnect. On boot the API and worker run a
**one-shot reconciliation**: emails in `scheduled` whose BullMQ job is
missing (e.g. Redis was flushed between DB insert and job insert) are
re-created using the deterministic id `email_<emailId>` — existing jobs are
never duplicated. Long-stuck `processing` rows with no live job are reset to
`scheduled` and recovered the same way.

### Idempotency
`jobId = email_<emailId>` prevents duplicate jobs at enqueue time. As a
second line of defense, the worker claims the email with a conditional
update (`UPDATE … WHERE status = 'scheduled'`); only one worker's claim
succeeds, and a job whose email is already `sent` returns without sending.

### Distributed rate limiting
A single Lua script atomically checks **both** limits per send:

- hourly counter `email-rate:{senderId}:{YYYY-MM-DD-HH}` (UTC window, TTL 2h)
- min-delay gate `email-send-gate:{senderId}` (last send-start timestamp)

Because check-and-increment is one Redis script, any number of workers/API
instances agree on who may send. Blocked jobs are moved back to *delayed*
(`job.moveToDelayed`): to the next UTC hour for the hourly cap, to the
remaining wait for the min-delay gate — no attempt is consumed, no email is
lost, and order is preserved as much as practical (jobs keep their original
delay order within the next window).

Worker concurrency (`WORKER_CONCURRENCY`) controls how many jobs are
*processed* simultaneously; the Redis controls throttle actual *sends*.
Ten concurrent workers with a 2s min delay still produce one send per 2s.

Failed SMTP attempts release their hourly slot (Lua DECR, floored at 0) and
are retried with exponential backoff (3 attempts); permanent failures are
marked `failed` with a stored `lastError`.

### PostgreSQL vs Elasticsearch
PostgreSQL is the source of truth; Elasticsearch is a projection. Email
sends never fail because indexing failed — indexing errors are logged and
repaired by the boot-time reconciliation (re-indexing docs updated in the
last 24h).

### Slack notifications
Rate-limit blocks set `slack-rate-alert:{senderId}:{window}` via `SET NX`;
only the first blocked email per sender/window triggers the real Slack API
call (`chat.postMessage` with the stored bot token, or the incoming webhook
when available). Tokens are encrypted with AES-256-GCM and never logged.

---

## Testing

```bash
npm test        # 43 tests: unit + integration + e2e
```

Integration tests use the real Docker services (PostgreSQL, Redis,
Elasticsearch) and skip cleanly if those aren't running. The e2e test
performs a **real Ethereal SMTP send** and verifies the Elasticsearch
projection (requires `SMTP_USER`/`SMTP_PASSWORD` in `.env`).

Covered explicitly: atomic claim/idempotency, duplicate-job safety,
hourly-limit rescheduling (limit 1 → 2nd slot blocked), concurrency safety
(20 concurrent acquisitions of a 5-slot limit → exactly 5 win), slot release
on failure, startup reconciliation idempotence, CSV parsing (headers,
duplicates, invalid rows), schedule-time math, OAuth state signing, schedule
API authorization (ownership + 401s), and the full
schedule → worker → SMTP → DB → Elasticsearch flow.

---

## Trade-offs & honest notes

- **Ordering after rate-limit overflow** is preserved within a rescheduled
  window, but if multiple windows are missed, jobs merge into the next
  window in their original relative order — absolute per-email timestamps
  are no longer guaranteed after a block.
- **Elasticsearch reconciliation** is boot-time, not continuous; a long ES
  outage while the process stays up leaves the projection stale until
  restart (documented; DB stays correct).
- **OAuth CSRF** uses a signed double-submit state cookie rather than
  server-side state storage.
- **Slack channel selection** relies on the `incoming-webhook` scope during
  install (Slack prompts the installer to pick a channel). If the app is
  installed without it, notifications fall back to `chat.postMessage` with
  the bot token to the stored channel id.
- The **session cookie is not `__Host-` prefixed** in development
  (`COOKIE_SECURE=false`); set it to `true` behind HTTPS in production.
- **Sends are counted at slot acquisition**, so a send that ultimately fails
  after retries consumes nothing (slot released on each failure), but an
  in-flight send blocks a slot briefly — correct and intentional.

## Repository layout

```text
apps/api        Express API, BullMQ worker, Prisma, services, tests
apps/web        React + Vite + Tailwind dashboard
packages/shared Shared zod schemas, types, queue/rate-limit key helpers
docker-compose  postgres (5433), redis, elasticsearch
examples        sample-leads.csv
```
