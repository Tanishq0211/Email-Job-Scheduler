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

Set these in `.env` for a fast, visible demo:

```env
WORKER_CONCURRENCY=3
MIN_SEND_DELAY_MS=2000
MAX_EMAILS_PER_HOUR=3
```

### 5-Minute Demo

1. `docker compose up -d && npm run dev` → open http://localhost:5173
2. **Login with Google** → land on the dashboard.
3. **Compose** → upload `examples/sample-leads.csv` → show the detected
   valid/invalid/duplicate stats.
4. Pick a sender, set start time ~1 minute out, delay 2s, hourly limit 3
   → **Schedule**.
5. Open **Bull Board** (http://localhost:5173/admin/queues) → show the
   9 delayed jobs (9 valid addresses in the sample CSV, 2 removed).
6. Back on the dashboard → **Scheduled Emails** shows all 9.
7. Watch the first 3 send, then the rest defer to the next UTC hour
   (visible in Bull Board as delayed jobs ~1h out).
8. **Restart-safety**: `Ctrl+C` the dev processes, wait past the start
   time, then `npm run dev:worker` — the delayed job fires and the email
   is delivered. (Or run `npx tsx scripts/verify-restart.ts schedule`
   then `check` to automate it.)
9. **Sent Emails** shows delivery states; click through to Ethereal's
   preview link for the actual message.
10. **Search** in the dashboard (Elasticsearch) for a recipient or
    subject fragment.
11. With Slack connected, the hourly-limit block posts **one**
    notification for the window — even though 6 emails were blocked.

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

**Scope**: both controls are **per sender**. Two campaigns from the same
sender share the same hourly counter and send gate — mirroring how a real
mailbox/provider limit works.

**Which hourly limit applies**: the compose request's `hourlyLimit` is
stored per email, and the worker enforces
`min(sender.hourlyLimit, campaign.hourlyLimit)`. A campaign can tighten the
sender's safety cap but never raise it; because the counter is shared per
sender, the most restrictive active limit naturally wins.

Worker concurrency (`WORKER_CONCURRENCY`) controls how many jobs are
*processed* simultaneously; the Redis controls throttle actual *sends*.
Ten concurrent workers with a 2s min delay still produce one send per 2s.

Failed SMTP attempts release their hourly slot (Lua DECR, floored at 0) and
are retried with exponential backoff (3 attempts); permanent failures are
marked `failed` with a stored `lastError`.

### Attempt counting semantics
`Email.attempts` counts **SMTP delivery attempts only**. Rate-limit
deferrals and min-delay waits are reschedules, not attempts, and never
increment the counter or consume a BullMQ retry. A transient SMTP error
reverts the email to `scheduled` so the next BullMQ retry can re-claim it;
the final attempt marks it `failed`.

### The SMTP crash window (honest exactly-once note)
No email system can guarantee mathematically exactly-once SMTP delivery: if
the process dies after the SMTP server accepted the message but before the
DB commit, the job will be retried. This system narrows that window to the
strongest practical design:

1. deterministic BullMQ job id → no duplicate jobs;
2. atomic `scheduled → processing` DB claim → no duplicate *processing*;
3. **deterministic RFC Message-ID** (`<emailId@reachinbox.scheduler>`) → a
   retried send produces the *same* message identity, which receiving
   servers and clients collapse instead of showing two copies.

So the practical guarantee is exactly-once *processing* and
effectively-once *delivery*, with the classic at-least-once SMTP caveat
documented rather than hidden.

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
npm test        # 47 tests: unit + integration + e2e
```

Integration tests use the real Docker services (PostgreSQL, Redis,
Elasticsearch) and skip cleanly if those aren't running. The e2e test
performs a **real Ethereal SMTP send** and verifies the Elasticsearch
projection (requires `SMTP_USER`/`SMTP_PASSWORD` in `.env`).

Covered explicitly: atomic claim/idempotency (including a 20-way concurrent
claim race), duplicate-job safety, hourly-limit rescheduling (limit 1 → 2nd
slot blocked), concurrency safety (20 concurrent acquisitions of a 5-slot
limit → exactly 5 win), 1000-recipient campaigns (999 rows + 999 uniquely
identified delayed jobs), slot release on failure, startup reconciliation
idempotence, CSV parsing (headers, duplicates, invalid rows), schedule-time
math, OAuth state signing, Slack alert deduplication (20 blocks → one alert
key; next window gets a fresh key) and clean refusal when Slack is not
configured, schedule API authorization (ownership + 401s), and the full
schedule → worker → SMTP → DB → Elasticsearch flow with a real Ethereal
delivery.

---

## Trade-offs & honest notes

- **Ordering after rate-limit overflow**: blocked jobs are all re-delayed
  to the same next-window boundary, so within that window the min-delay
  gate is acquired in near-original order (BullMQ wakes delayed jobs in
  timestamp order), but concurrent workers may acquire the gate slightly
  out of order. Strict per-recipient FIFO across windows is **not**
  guaranteed and we don't claim it.
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
