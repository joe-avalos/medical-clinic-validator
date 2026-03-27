# Architecture Deep Dive — Medical Clinic Legal Validator

> This document captures the architectural decisions made during the build of this system — what was chosen, what was considered, and why each choice made sense for this version.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [SQS FIFO Over Other Queue Options](#2-sqs-fifo-over-other-queue-options)
3. [Three Worker Types, Not a Monolith](#3-three-worker-types-not-a-monolith)
4. [Dual Scraper Providers](#4-dual-scraper-providers)
5. [Redis Caching Strategy](#5-redis-caching-strategy)
6. [DynamoDB as the Primary Store](#6-dynamodb-as-the-primary-store)
7. [Sort Key Design: Jurisdiction + Registration Number](#7-sort-key-design-jurisdiction--registration-number)
8. [LocalStack for Local Development](#8-localstack-for-local-development)
9. [JWT Auth with Scope Claims](#9-jwt-auth-with-scope-claims)
10. [Telemetry Pipeline](#10-telemetry-pipeline)
11. [Error Handling: Return vs Throw in FIFO Queues](#11-error-handling-return-vs-throw-in-fifo-queues)
12. [Logging with Pino](#12-logging-with-pino)
13. [Cursor-Based Pagination](#13-cursor-based-pagination)
14. [Frontend: React Query, No State Library](#14-frontend-react-query-no-state-library)
15. [Multi-Agent Communication Contracts](#15-multi-agent-communication-contracts)
16. [Known Gaps and Future Work](#16-known-gaps-and-future-work)
17. [AI Provider Architecture](#17-ai-provider-architecture)

---

## 1. System Overview

A user submits a medical clinic name. The system looks up its legal registration via OpenCorporates, validates the result using Claude AI, assigns a risk level, and stores the outcome. All infrastructure runs locally via LocalStack + Docker Compose.

```
POST /verify
     │
     ▼
[API] ──SQS──▶ [Scraper] ──SQS──▶ [Validator] ──SQS──▶ [Storage]
                                                            │
                                                      DynamoDB + Redis
                                                            │
                                                            ▼
GET /verify/:id/status ◀── [API reads DynamoDB directly]
```

Three SQS FIFO queues connect four stages. Each stage is a separate worker process. The API seeds telemetry at submission, and workers update it as they progress.

---

## 2. SQS FIFO Over Other Queue Options

**Chosen:** Amazon SQS FIFO (emulated via LocalStack)

**Why FIFO, not standard SQS:**
- Three workers must execute in sequence per job (scrape → validate → store). FIFO guarantees messages within a message group are processed in order.
- `MessageGroupId` is set to the normalized company name. This serializes all jobs for the same company through the pipeline, preventing concurrent scrapes of the same name from both missing the cache and double-calling OpenCorporates.
- `ContentBasedDeduplication` prevents duplicate processing on network retries.

**Why not BullMQ (Redis-backed):**
- Three independent worker processes need to run in separate containers in production. SQS is truly distributed. BullMQ requires shared Redis state — a single point of failure and a scaling bottleneck.

**Why not SNS fan-out:**
- SNS loses ordering guarantees. This is a pipeline, not a fan-out.

**Why not Kafka:**
- Operational overhead for a 3-stage pipeline with low-to-moderate throughput. Kafka's partition model is designed for much higher scale than 10k req/hr.

**Queue configuration per stage:**

| Queue | Visibility Timeout | Rationale |
|---|---|---|
| `verification-queue.fifo` | 30s | Scraping + cache check is fast |
| `validation-queue.fifo` | 60s | Claude API calls can take 2–5s per company, batched in groups of 3 |
| `storage-queue.fifo` | 30s | DynamoDB batch writes are fast |

Each queue has a dead-letter queue with `maxReceiveCount: 3`. Poisoned messages are captured, not retried indefinitely.

---

## 3. Three Worker Types, Not a Monolith

**Chosen:** One worker codebase, three runtime configurations via `WORKER_TYPE` env var.

```typescript
// services/worker/src/index.ts
switch (WORKER_TYPE) {
  case 'scraper':      await import('./scraper/handler.js');
  case 'ai-validator':  await import('./validator/handler.js');
  case 'storage':       await import('./storage/handler.js');
}
```

**Why separate processes:**

| Concern | Scraper | Validator | Storage |
|---|---|---|---|
| **Dependencies** | Puppeteer (Chrome, ~200MB RAM) + Cheerio | Anthropic SDK (lightweight HTTP) | DynamoDB + Redis clients only |
| **Bottleneck** | I/O-bound (5–10s page loads) | Latency-bound (2–5s per Claude call) | Fast (~100ms batch writes) |
| **Secrets needed** | OC credentials | Anthropic API key | Neither |
| **Failure mode** | CAPTCHA, stale cookies, site down | Claude unavailable, malformed response | DynamoDB throttle |

A monolith would load Puppeteer even in the storage process. It would force 1:1:1 scaling ratios when production wants 2x scrapers, 3x validators, 1x storage. And a crash in one handler would take down all three.

**Shared code:** The `shared/sqs.ts` long-poll loop is generic — each handler plugs in its own message type and business logic. Shared DynamoDB, Redis, logging, and telemetry modules live in `shared/`.

---

## 4. Dual Scraper Providers

**Chosen:** Provider pattern with runtime selection via `SCRAPER_PROVIDER` env var.

| Provider | Source | Auth | Speed | Cost |
|---|---|---|---|---|
| `opencorporates-api` | REST API (`api.opencorporates.com`) | API token | Fast (structured JSON) | Paid tier has limits |
| `opencorporates` | Web scraping (Puppeteer + Cheerio) | Account cookies | Slower (full page render) | Free |
| `mock` | In-memory fixtures | None | Instant | Free (testing only) |

**Why both real providers:**
- **Cost arbitrage.** Free-tier API has hard rate limits. Web scraping is less throttled but more fragile. Starting with free, switching by changing one env var if traffic scales.
- **Resilience.** If OpenCorporates changes their API response format, switch to scraping (or vice versa) with zero code changes.
- **Data freshness.** The API and website update at different cadences. For critical lookups, you could call both and compare.

**Puppeteer stealth specifics:**
- Uses `puppeteer-extra` with the stealth plugin to avoid bot detection.
- Randomized user agents, viewport sizes, and inter-request delays.
- Session cookies loaded from `.oc-cookies.json` and re-injected on every retry attempt. Cookies with empty or whitespace-only values are filtered (Puppeteer's `Network.setCookies` rejects them).
- On CAPTCHA or 403 detection, `cookiesLoaded` flag resets so the next retry re-reads cookies from disk — allowing a manual `cookie:refresh` between attempts.

**Scrape stats tracking:** Each provider populates `lastScrapeStats` (attempts count + error messages array) after `search()` completes. The handler reads this and includes it in the telemetry payload.

---

## 5. Redis Caching Strategy

**Chosen:** Redis with 24-hour TTL on query results.

**What's cached:**

| Layer | Key | Value | Written By | Read By |
|---|---|---|---|---|
| Query → Job mapping | `query:job:<normalizedName>` | `{ jobId, createdAt }` | Storage worker | API (POST /verify), Scraper |

**Cache flow:**
1. User submits "Mayo Health System" → API normalizes to `mayo health system`.
2. API checks Redis for `query:job:mayo health system`.
3. **Hit:** Return `200` with the cached jobId + `cached: true`. Frontend shows cached result banner with option to re-verify.
4. **Miss:** Create job, enqueue to SQS, return `202`. Pipeline runs.
5. Storage worker writes results to DynamoDB, then writes `query:job:mayo health system → { jobId }` to Redis.

**Why 24-hour TTL:**
- Corporate registration data changes slowly (annual filings at most).
- 24 hours is short enough to catch major changes within a business day, long enough to avoid redundant OpenCorporates calls during a verification sprint.
- DynamoDB TTL is 90 days (regulatory record-keeping). Redis TTL is shorter — it's a performance cache, not a store of record.

**Why not cache the validated result directly:**
- Scope-based field redaction (`internal` vs `external`) happens at the API layer. Caching the final result would require separate entries per scope. Caching the query-to-jobId mapping avoids this complexity — the API fetches fresh from DynamoDB and applies redaction at read time.

**Graceful degradation:** Redis failures are caught and logged. The pipeline proceeds without caching — it just calls OpenCorporates again.

---

## 6. DynamoDB as the Primary Store

**Chosen:** DynamoDB with PAY_PER_REQUEST billing, emulated via LocalStack.

**Why DynamoDB:**

1. **Serverless billing.** No capacity planning. Medical clinics verify providers sporadically — traffic is spiky, not steady. Pay-per-request handles bursts to 10k req/hr without provisioning.

2. **Access pattern fit.** The data model is simple key-value with one GSI:
   - "Get all results for job X" → `pk = JOB#<jobId>`, `sk begins_with RESULT#`
   - "Get all HIGH-risk records sorted by date" → GSI on `(riskLevel, validatedAt)`
   - "Get job status" → `pk = JOB#<jobId>`, `sk = STATUS`

3. **Built-in TTL.** Records auto-delete after 90 days. No cron job needed.

4. **LocalStack parity.** `docker-compose up` gives a fully functional DynamoDB. No separate database to install or configure.

**Why not PostgreSQL:**
- Requires connection pooling and "always-on" capacity. DynamoDB scales to zero cost when idle.
- Schema is simple enough that relational joins add no value.

**Why not MongoDB:**
- Similar document model, but requires replica set management. DynamoDB replication is fully managed.

**Tables:**

| Table | PK | SK | Purpose |
|---|---|---|---|
| `jobs` | `JOB#<jobId>` | `STATUS` | Job state machine (queued → processing → completed/failed) |
| `verifications` | `JOB#<jobId>` | `RESULT#<jurisdiction>#<regNum>` | Individual company validation records |
| `job_telemetry` | `JOB#<jobId>` | `TELEMETRY` | Pipeline metrics per job |

---

## 7. Sort Key Design: Jurisdiction + Registration Number

**Changed from:** `RESULT#<registrationNumber>`
**Changed to:** `RESULT#<jurisdiction>#<registrationNumber>`

**Why:**

The same registration number can exist in multiple jurisdictions. A search for "Mayo Health" can return company `0f23674b` in both `us_mn` and `us_wi`. The old key `RESULT#0f23674b` would collide in the same `BatchWriteItem` call — DynamoDB rejects duplicate keys in a batch.

The fix adds jurisdiction to the sort key, making each result unique per jurisdiction. A `seen` set also deduplicates within a single batch, logging a warning when it drops a duplicate:

```typescript
const seen = new Set<string>();
for (const v of validations) {
  const sk = `RESULT#${v.jurisdiction}#${v.registrationNumber}`;
  if (seen.has(sk)) {
    log.warn({ sk, companyName: v.companyName }, 'Skipping duplicate result');
    continue;
  }
  seen.add(sk);
  records.push({ pk: `JOB#${jobId}`, sk, ... });
}
```

Query patterns are unaffected — `begins_with(sk, 'RESULT#')` matches both the old and new format.

---

## 8. LocalStack for Local Development

**Chosen:** LocalStack (Docker) emulating SQS, DynamoDB, Secrets Manager, IAM, CloudFormation.

**Why not mock the AWS SDK directly:**
- SDK mocks don't simulate SQS FIFO ordering behavior (message group blocking on unacknowledged messages).
- SDK mocks don't simulate DynamoDB `BatchWriteItem` rejecting duplicate keys.
- SDK mocks don't simulate Secrets Manager retrieval failures.
- LocalStack catches these edge cases because it implements the actual AWS API contracts.

**Bootstrap flow:**
```
docker-compose up
  → LocalStack starts (healthcheck: curl localhost:4566/_localstack/health)
  → bootstrap.sh runs CloudFormation against LocalStack
  → Tables, queues, DLQs, and roles are created
  → Redis starts
  → API + Workers start
```

One command, deterministic setup. Identical state every time.

**Known LocalStack limitations:**
- Nested CloudFormation stacks don't work reliably. Workaround: `bootstrap.sh` deploys each sub-stack individually.
- API Gateway and ElastiCache are stubs (not fully functional). Not critical for local testing — the API service runs as a direct Express server, not behind API Gateway locally.

---

## 9. JWT Auth with Scope Claims

**Chosen:** HS256 JWT with `scope` claim controlling field-level visibility.

```json
{
  "sub": "user_abc123",
  "scope": "internal",
  "org": "acme-health",
  "iat": 1711000000,
  "exp": 1711003600
}
```

**Why JWT over API keys:**
- API keys are binary (allowed or denied). JWT encodes `scope` (internal vs external) and `org` — context that changes field visibility without code changes.
- Tokens expire. API keys require out-of-band rotation.
- Stateless verification — no database lookup to validate a request.

**Scope behavior:**

| Scope | `GET /records` & `GET /verify/:id/status` |
|---|---|
| `internal` | All fields visible |
| `external` | Redacts: `registrationNumber`, `incorporationDate`, `confidence`, `cachedResult`, `cachedFromJobId`, `originalValidatedAt`, `jobId`, `pk`, `sk`, `rawSourceData` |

External partners see risk levels and AI summaries but not raw OpenCorporates data or internal audit fields.

**Compliance note:** This is coarse-grained auth for v1. A HIPAA/SOC2 production deployment would need field-level encryption, immutable access logging, row-level access control per organization, and separate BAA agreements for any service handling PHI.

---

## 10. Telemetry Pipeline

**Core design principle:** Telemetry is written at submission time and updated by workers — not written at the end of a pipeline that might never finish.

**Flow:**

```
POST /verify (API)
  → Creates telemetry row: pipelinePath = "submitted"
  → All fields initialized to zero/pending

Scraper worker
  → Updates row: scrapeAttempts, scrapeErrors, companiesFound, scraperProvider
  → On failure: pipelinePath = "scrape→failed", errorMessage set

Validator worker
  → Passes telemetry forward in SQS message (accumulates)

Storage worker
  → Updates row: aiProvider, validationOutcomes, durationMs, pipelinePath = "scrape→validate→store"
```

**Why write at submission, not at completion:**
- If the scraper crashes, the job still appears in telemetry with `pipelinePath: "submitted"`.
- If storage crashes, the scraper and validator data are already recorded.
- Previous design only wrote telemetry in the storage handler. A `BatchWriteItem` failure (like duplicate keys) meant the job was invisible to the telemetry dashboard entirely.

**Workers use `UpdateCommand`, not `PutCommand`:** Workers merge their fields into the existing row created by the API. This preserves `createdAt` and any fields already written by upstream workers.

**Telemetry fields:**

| Field | Written By | Purpose |
|---|---|---|
| `scraperProvider` | API (seed), Scraper (confirmed) | Which data source was used |
| `aiProvider` | Validator | `anthropic`, `ollama`, or `none` |
| `cacheHit` | Scraper | Was Redis cache used |
| `companiesFound` | Scraper | How many OC results returned |
| `scrapeAttempts` | Scraper | How many retries needed |
| `scrapeErrors` | Scraper | Array of error messages from each failed attempt |
| `validationOutcomes` | Storage | `{ success, fallback, empty }` counts |
| `pipelinePath` | Each stage | `submitted` → `scrape→validate→store` (or `scrape→failed`, etc.) |
| `durationMs` | Storage | Total pipeline duration from enqueue to storage write |
| `errorMessage` | Scraper (on failure) | Terminal error message |

---

## 11. Error Handling: Return vs Throw in FIFO Queues

**Rule:** In SQS FIFO consumers, **return for business logic failures, throw only for infrastructure failures.**

**Why this matters:** In a FIFO queue, an unacknowledged message blocks the entire message group until visibility timeout expires. If the scraper throws on a CAPTCHA error, the message retries 3x (blocking all subsequent jobs for that company for ~90 seconds), then goes to DLQ. The job is stuck and other jobs pile up.

**Pattern in the scraper:**
```typescript
try {
  companies = await provider.search(name, jurisdiction);
} catch (err) {
  await updateJobStatus(jobId, 'failed', err.message);
  await writeTelemetry({ ... errorMessage: err.message });
  return;  // ← Message is acknowledged, group unblocked
}
```

**Pattern in the storage handler:**
```typescript
try {
  await putVerificationRecords(records);
} catch (err) {
  await updateJobStatus(jobId, 'failed', err.message);
  throw err;  // ← Infrastructure failure, should retry via SQS
}
```

**The distinction:**
- OpenCorporates returning 0 results, CAPTCHA, stale cookies → **business logic failure.** The job is done (failed). Mark it, write telemetry, return.
- DynamoDB throttling, network partition → **infrastructure failure.** Transient. Throw, let SQS retry.
- Claude API unavailable → **handled gracefully.** Return fallback result (`riskLevel: UNKNOWN`, `confidence: LOW`), don't throw.

---

## 12. Logging with Pino

**Chosen:** Pino with `pino-pretty` for development, raw JSON for production.

```typescript
export function createLogger(service: string) {
  return baseLogger.child({ service });
}
```

**Why Pino over Winston:**
- Pino is significantly faster (benchmarked at ~5x throughput of Winston).
- Simpler API — `log.info({ jobId, companyName }, 'Received job')` produces structured JSON without configuration.
- Native `.child()` support for contextual logging — every log line from the scraper automatically includes `{ service: "scraper" }`.

**Structured logging everywhere:** Every log includes machine-parseable context. In development, `pino-pretty` renders this as colorized readable output. In production, raw JSON goes to stdout for aggregation by CloudWatch/Datadog.

**Worker startup diagnostics:** On boot, each worker logs its full environment configuration (`SCRAPER_PROVIDER`, `AI_PROVIDER`, `REDIS_URL`, `SQS_ENDPOINT`, `NODE_ENV`). This was added after debugging a provider mismatch — the env var said one thing, the runtime loaded another. Now the first log line tells you exactly what the process is running with.

---

## 13. Cursor-Based Pagination

**Chosen:** Base64-encoded DynamoDB `ExclusiveStartKey` as cursor.

```typescript
// Encode
nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url');

// Decode
exclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64url').toString());
```

**Why cursor over offset:**
- DynamoDB has no native offset/limit. Offset would require scanning and discarding N items — expensive and slow.
- Cursor maintains position even if records are inserted or deleted between pages.
- `ExclusiveStartKey` is DynamoDB's native pagination mechanism. Wrapping it in base64 makes it opaque to the client.

**Frontend integration:** The `useRecords` hook uses React Query's `useInfiniteQuery` with an `IntersectionObserver` on a sentinel element — infinite scroll that fetches the next page when the user scrolls to the bottom.

---

## 14. Frontend: React Query, No State Library

**Chosen:** React + React Query + React Router. No Redux, Zustand, or Recoil.

**Why no global state library:**
- The app has three data-fetching concerns: submit a job, poll its status, list records.
- React Query handles all of these with built-in caching, background refetching, retry, and request deduplication.
- UI state (form inputs, risk filter dropdown, toggle states) is local `useState`. There's no cross-page state to synchronize.

**Key hook — `useJobStatus`:**
```typescript
refetchInterval: (query) => {
  const status = query.state.data?.status;
  if (status === 'completed' || status === 'failed') return false;
  return 2000;  // Poll every 2s while in-flight
}
```

Auto-polls every 2 seconds, stops when the job resolves. No manual setInterval/clearInterval management.

**Why Vite over webpack/CRA:**
- Fast HMR (~100ms hot reload vs webpack's 1–3s).
- Native ESM support — no bundling during development.
- Simpler configuration (zero-config for React + TypeScript + Tailwind).

**Why Tailwind:**
- Utility-first CSS eliminates the need for CSS modules or styled-components.
- Design consistency without a component library — all styling is inline and colocated with markup.

---

## 15. Multi-Agent Communication Contracts

**All inter-agent communication goes through SQS messages.** Workers never call each other directly via HTTP.

**Message schemas** (defined in `shared/types/messages.ts`):

| Message | From → To | Key Fields |
|---|---|---|
| `VerificationJobMessage` | API → Scraper | `jobId`, `companyName`, `normalizedName`, `jurisdiction`, `scope`, `enqueuedAt` |
| `ScraperResultMessage` | Scraper → Validator | `jobId`, `companies[]`, `cachedResult`, `telemetry` |
| `ValidationResultMessage` | Validator → Storage | `jobId`, `validations[]`, `rawSourceData[]`, `telemetry` |

**Contract enforcement:** All schemas are Zod objects in a single shared package (`@medical-validator/shared`). Every worker parses incoming messages with `.parse()` — invalid messages throw immediately.

**Telemetry accumulation:** The `telemetry` field in each SQS message carries accumulated pipeline metrics. Scraper adds scrape stats, Validator adds AI outcomes, Storage writes the final record.

**Why SQS between agents (not direct HTTP):**
- **Asynchronous.** The scraper doesn't wait for the validator to finish.
- **Resilient.** Failed messages retry automatically with backoff. DLQs capture poison pills.
- **Observable.** Queue depth and DLQ length are operational metrics.
- **Independently scalable.** Run more validator instances without changing the scraper.

---

## 16. Known Gaps and Future Work

### Deferred for v1

| Area | Decision | Notes |
|---|---|---|
| WebSocket support | Polling only | 2s poll interval is acceptable for v1 UX |
| Multi-jurisdiction batch requests | Single query per submission | Multi-queue feature planned (see memory) |
| OpenCorporates paid tier | Using free tier + scraping | Monitor rate limits in production |
| CI/CD deployment | GitHub Actions for tests only | No automated deploy pipeline yet |
| Alerting / CloudWatch | Not implemented | DLQ growth and error rates need alerts |

### Compliance gaps for production

| Requirement | Current State | Production Need |
|---|---|---|
| Field-level encryption | None | Encrypt addresses and registration numbers at rest |
| Immutable audit trail | Log-based only | Append-only audit table for all data access |
| BAA for AI provider | Not in place | Required if Claude processes PHI |
| VPC isolation | Runs locally | Private VPC with TLS enforcement |
| Access logging | Pino structured logs | CloudTrail + DynamoDB access logs |
| Data retention | 90-day TTL | Medical records may require 6–7 year retention |
| Worker auth boundaries | Internal SQS only | mTLS or IAM-based auth between workers |

### Planned features

- **Multi-queue submit:** Concurrent search queue table on SearchPage with batch polling endpoint (`POST /verify/status/batch`). Designed, not yet implemented.

---

## 17. AI Provider Architecture

**Chosen:** Factory pattern with three providers behind a common `AIProvider` interface.

```typescript
interface AIProvider {
  validateAll(companies: RawCompanyRecord[]): Promise<ValidationResult[]>;
}

type ProviderType = 'anthropic' | 'ollama' | 'qwen';
```

All three providers use the same system/user prompts and return the same `ValidationResult` schema. Swapping between them requires only changing `AI_PROVIDER` env var or passing `aiProvider` per-request.

### Per-Request Provider Selection

The `aiProvider` field threads through the full SQS pipeline:

```
Frontend dropdown → POST /verify (API) → VerificationJobMessage (SQS)
  → Scraper (passthrough) → ScraperResultMessage (SQS)
  → Validator handler (creates provider per-message)
```

The API scope-gates provider selection — only `internal` users can choose a provider. External users always get the default (`anthropic`). The validator falls back through: `message.aiProvider → process.env.AI_PROVIDER → 'anthropic'`.

### Provider Implementations

| Provider | Backend | Concurrency | Timeout | Notes |
|---|---|---|---|---|
| `AnthropicProvider` | Anthropic API (`claude-haiku-4-5`) | 3 (batched, 1s delay) | 30s | Training data capture on success |
| `OllamaProvider` | Ollama `/v1/chat/completions` | Sequential | 30s | Generic Ollama models (e.g., `mistral:7b-instruct`) |
| `QwenProvider` | Ollama-compatible `/v1/chat/completions` | 1–5 (configurable) | 15–180s | Fine-tuned GGUF, supports local Ollama or remote Modal |

### Fine-Tuned Qwen Model

A LoRA fine-tuned **Qwen 2.5 3B** model, quantized to Q4_K_M GGUF (~1.8GB). Trained on validation examples captured by `AnthropicProvider` during normal operation.

**Training pipeline:**
1. `AnthropicProvider` captures input/output pairs to `training-data/captures.jsonl` (auto-rotating at 10MB)
2. `training/export-training-data.ts` converts captures to ChatML format for fine-tuning
3. `training/finetune_qwen_colab.ipynb` (Colab GPU) or `training/finetune_local.py` (CPU) trains the LoRA adapter
4. Model exported as GGUF via 2-step conversion (f16 → Q4_K_M quantize)

### Deployment Options

The `QwenProvider` speaks the OpenAI-compatible `/v1/chat/completions` protocol. The only configuration knob is `QWEN_OLLAMA_URL`:

| Option | URL | Performance | Cost |
|---|---|---|---|
| **Local Ollama** | `http://localhost:11434` | ~30s–2min/request (CPU) | Free |
| **Docker Ollama** | `docker compose --profile gpu up ollama` | Fast with GPU, slow without | Free |
| **Modal (serverless T4)** | `https://<app>--medical-validator-inference.modal.run` | ~900ms/request | ~$0.59/hr GPU, scale-to-zero |

**Modal deployment** (`training/modal_serve.py`):
- CUDA 12.4 runtime image with `llama-cpp-python[server]`
- GGUF stored on a Modal Volume (persistent across deploys)
- `scaledown_window=300` — GPU stays warm for 5 min after last request, then scales to zero
- `modal serve` for temporary dev testing, `modal deploy` for persistent endpoint
- No auth on the endpoint (acceptable for dev/testing with low credits; add bearer token middleware for production)

---

*Last updated: 2026-03-27*