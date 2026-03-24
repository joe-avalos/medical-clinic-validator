# CLAUDE.md — Medical Clinic Legal Validator
> Project scoping document. This file is the authoritative reference for architecture, conventions, and implementation decisions.

---

## 1. Project Overview

A system that accepts a medical clinic or health system name, looks up its legal registration via OpenCorporates, validates the result using AI, and stores the outcome for internal and external consumers.

All infrastructure runs locally via **LocalStack + Docker Compose**, mirroring a production AWS environment. The CloudFormation IaC layer provisions all AWS-compatible resources against LocalStack.

---

## 2. Functional Requirements

| # | Requirement |
|---|---|
| FR-1 | Accept a company name via `POST /verify` and return `202 Accepted` with a `jobId` |
| FR-2 | Scrape legal registration data from OpenCorporates Search API |
| FR-3 | Validate scraped data using Claude AI and assign a risk level |
| FR-4 | Allow clients to poll job status via `GET /verify/{jobId}/status` |
| FR-5 | Persist validated records in DynamoDB |
| FR-6 | Cache results in Redis to avoid redundant lookups (cache key: normalized company name) |
| FR-7 | Expose validated data to both internal ops and external partners |
| FR-8 | Support 10,000 verification requests per hour |

---

## 3. Non-Functional Requirements

| # | Requirement |
|---|---|
| NFR-1 | `POST /verify` must respond in < 100ms (async, no blocking) |
| NFR-2 | Worker processing SLA: job completed within 30 seconds of enqueue |
| NFR-3 | Redis cache TTL: 24 hours per record |
| NFR-4 | All API endpoints protected by JWT / OAuth2 |
| NFR-5 | External partner access requires scoped JWT claims |
| NFR-6 | Full audit trail: every job state transition logged |
| NFR-7 | Type-safe Node.js throughout (TypeScript strict mode) |

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Clients                              │
│         Internal Dashboard        External Partners         │
└───────────────────┬─────────────────────┬───────────────────┘
                    │                     │
                    ▼                     ▼
         ┌──────────────────────────────────────┐
         │         API Gateway (LocalStack)      │
         │         JWT / OAuth2 Auth Layer       │
         └────────────────┬─────────────────────┘
                          │
                          ▼
         ┌──────────────────────────────────────┐
         │       Node.js / TypeScript API        │
         │           (Express + Zod)             │
         │                                      │
         │  POST /verify        → enqueue job   │
         │  GET  /verify/:id/status → poll      │
         │  GET  /records       → list results  │
         └──────┬───────────────┬───────────────┘
                │               │
         ┌──────▼──────┐ ┌──────▼──────┐
         │    SQS      │ │    Redis     │
         │  (LocalStack│ │  Cache Layer │
         │   Queue)    │ │  (ElastiCache│
         └──────┬──────┘ │   via Local) │
                │        └─────────────┘
                ▼
   ┌────────────────────────┐
   │   Worker Service       │
   │   (Node.js / SQS poll) │
   │                        │
   │ 1. Check Redis cache   │
   │ 2. Call OpenCorporates │
   │ 3. Call Claude AI      │
   │ 4. Write to DynamoDB   │
   │ 5. Update job status   │
   └────────────┬───────────┘
                │
                ▼
   ┌────────────────────────┐
   │   DynamoDB (LocalStack)│
   │   Table: verifications │
   └────────────────────────┘
```

---

## 5. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Language | TypeScript (strict) | `"strict": true` in tsconfig, no `any` |
| API Framework | Express.js | With `zod` for request validation |
| Queue | Amazon SQS (LocalStack) | FIFO queue for ordered processing |
| Worker | Node.js + `@aws-sdk/client-sqs` | Long-polls SQS directly — no BullMQ |
| Cache | Redis (ElastiCache-local) | `ioredis` client |
| Database | DynamoDB (LocalStack) | `@aws-sdk/client-dynamodb` |
| Auth | JWT / OAuth2 | `jsonwebtoken`, scoped claims per consumer type |
| IaC | AWS CloudFormation | Deployed against LocalStack via `awslocal` |
| Local Infra | LocalStack + Docker Compose | Emulates SQS, DynamoDB, API Gateway |
| Data Source | OpenCorporates API | `GET /v0.4/companies/search?q=` |
| AI Validation | Anthropic Claude API | `claude-sonnet-4-6` |

---

## 6. API Contract

### `POST /verify`
Enqueue a new verification job.

**Auth:** Bearer JWT required

**Request:**
```json
{
  "companyName": "Mayo Health System",
  "jurisdiction": "us_mn"   // optional ISO jurisdiction hint
}
```

**Response `202 Accepted`:**
```json
{
  "jobId": "job_01J...",
  "status": "queued",
  "pollUrl": "/verify/job_01J.../status"
}
```

---

### `GET /verify/{jobId}/status`
Poll for job result.

**Auth:** Bearer JWT required

**Response states:**

| `status` | Meaning |
|---|---|
| `queued` | Job waiting in SQS |
| `processing` | Worker actively running |
| `completed` | Validation finished |
| `failed` | Unrecoverable error |

**Response `200` (completed):**
```json
{
  "jobId": "job_01J...",
  "status": "completed",
  "results": [
    {
      "companyName": "Mayo Health System",
      "jurisdiction": "us_mn",
      "registrationNumber": "12345678",
      "incorporationDate": "1919-01-01",
      "legalStatus": "Active",
      "riskLevel": "LOW",
      "riskFlags": [],
      "aiSummary": "Entity is actively registered in Minnesota with no anomalies detected.",
      "cachedResult": false,
      "validatedAt": "2026-03-20T10:00:00Z"
    }
  ]
}
```

> Note: `results` is an array — all OC matches are validated individually and returned. The frontend auto-redirects to the first result after completion.

---

### `GET /records`
List all validated records, sorted by risk level descending.

**Auth:** Bearer JWT (internal scope) or API key (external partners)

**Query params:** `?riskLevel=HIGH&limit=50&cursor=<token>`

---

## 7. Worker Processing Pipeline

```
Job dequeued from SQS
        │
        ▼
Normalize company name (lowercase, trim, strip punctuation)
        │
        ▼
Check Redis cache  ──HIT──▶  Skip to step 5
        │ MISS
        ▼
Call OpenCorporates API
  GET /v0.4/companies/search?q=<name>&jurisdiction_code=<j>
        │
        ▼
Parse all results (company number, status, jurisdiction, dates)
        │
        ▼
Send each result to Claude API for validation
  - Batched in groups of 3 (configurable via VALIDATOR_CONCURRENCY)
  - 1s delay between batches (configurable via VALIDATOR_BATCH_DELAY_MS)
  - Each company validated individually with retries (CLAUDE_MAX_RETRIES)
  - Fallback to UNKNOWN risk if all retries exhausted
  - Assess active/inactive status
  - Detect dissolved, suspended, or non-medical entities
  - Assign risk level: LOW / MEDIUM / HIGH / UNKNOWN
  - Generate plain-English summary
        │
        ▼
Write all validated records to DynamoDB
        │
        ▼
Write to Redis cache (TTL: 24h, key: normalized name)
        │
        ▼
Update job status to `completed`
```

### Risk Level Definitions

| Level | Criteria |
|---|---|
| `LOW` | Active registration, matches jurisdiction, no anomalies |
| `MEDIUM` | Active but incomplete data, multiple registrations, minor discrepancies |
| `HIGH` | Dissolved, suspended, inactive, or jurisdiction mismatch |
| `UNKNOWN` | Not found in OpenCorporates or AI inconclusive |

---

## 8. Data Model

### DynamoDB Table: `verifications`

| Attribute | Type | Notes |
|---|---|---|
| `pk` | String (PK) | `COMPANY#<normalizedName>` |
| `sk` | String (SK) | `JOB#<jobId>` |
| `jobId` | String | UUID v7 |
| `companyName` | String | Original input |
| `normalizedName` | String | Cache key |
| `jurisdiction` | String | e.g. `us_mn` |
| `registrationNumber` | String | From OpenCorporates |
| `incorporationDate` | String | ISO 8601 |
| `legalStatus` | String | `Active` / `Inactive` / `Dissolved` |
| `riskLevel` | String | `LOW` / `MEDIUM` / `HIGH` / `UNKNOWN` |
| `riskFlags` | List | Array of flag strings |
| `aiSummary` | String | Claude's plain-English verdict |
| `cachedResult` | Boolean | Whether Redis cache was used |
| `jobStatus` | String | `queued` / `processing` / `completed` / `failed` |
| `createdAt` | String | ISO 8601 |
| `validatedAt` | String | ISO 8601 |
| `ttl` | Number | Unix epoch, 90-day retention |

### GSI: `riskLevel-validatedAt-index`
Supports `GET /records` sorted by risk level.

---

## 9. IaC — CloudFormation Stack

Deployed via `awslocal cloudformation deploy` against LocalStack.

### Resources to Provision

```
medical-validator/
└── infra/
    └── cloudformation/
        ├── template.yaml          # Root stack
        ├── stacks/
        │   ├── dynamodb.yaml      # verifications table + GSI
        │   ├── sqs.yaml           # FIFO verification queue + DLQ
        │   ├── elasticache.yaml   # Redis cluster (local stub)
        │   ├── api-gateway.yaml   # REST API + JWT authorizer
        │   └── iam.yaml           # Roles & policies
        └── parameters/
            ├── local.json         # LocalStack overrides
            └── prod.json          # Production values (future)
```

### Key CloudFormation Resources

| Resource | Type | Notes |
|---|---|---|
| `VerificationsTable` | `AWS::DynamoDB::Table` | PAY_PER_REQUEST billing |
| `VerificationQueue` | `AWS::SQS::Queue` | FIFO, 30s visibility timeout |
| `VerificationDLQ` | `AWS::SQS::Queue` | maxReceiveCount: 3 |
| `RedisCluster` | `AWS::ElastiCache::CacheCluster` | Local stub via Docker |
| `ApiGateway` | `AWS::ApiGateway::RestApi` | JWT authorizer attached |
| `WorkerRole` | `AWS::IAM::Role` | SQS + DynamoDB least-privilege |

---

## 10. Project Structure

```
medical-validator/
├── CLAUDE.md
├── docker-compose.yml
├── infra/
│   └── cloudformation/
│       ├── template.yaml
│       ├── stacks/
│       └── parameters/
├── services/
│   ├── api/                        # Express REST API
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── verify.ts       # POST /verify, GET /verify/:id/status
│   │   │   │   └── records.ts      # GET /records (scope-filtered)
│   │   │   ├── middleware/
│   │   │   │   └── auth.ts         # JWT validation
│   │   │   ├── schemas/            # Zod schemas
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── frontend/                   # React dashboard
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   ├── api/
│   │   │   ├── hooks/
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── worker/                     # SQS long-poll worker (WORKER_TYPE dispatch)
│       ├── src/
│       │   ├── workers/
│       │   │   ├── scraper.ts      # consumes verification-queue.fifo
│       │   │   ├── validator.ts    # consumes validation-queue.fifo
│       │   │   └── storage.ts      # consumes storage-queue.fifo + GET /records
│       │   ├── clients/
│       │   │   ├── opencorporates.ts
│       │   │   ├── claude.ts
│       │   │   ├── dynamodb.ts
│       │   │   └── redis.ts
│       │   ├── lib/
│       │   │   └── sqs.ts          # shared SQS long-poll loop
│       │   └── index.ts            # reads WORKER_TYPE, starts correct worker
│       ├── tsconfig.json
│       └── package.json
└── shared/
    └── types/
        ├── messages.ts             # SQS inter-agent message schemas (source of truth)
        └── index.ts                # Shared TypeScript interfaces
```

---

## 11. Docker Compose Services

```yaml
services:
  localstack:       # Emulates SQS, DynamoDB, API Gateway, IAM
  redis:            # Cache layer
  api:              # Express API service
  worker:           # SQS long-poll worker service (WORKER_TYPE dispatch)
  frontend:         # React dashboard (Vite dev server)
```

Startup order: `localstack` → `redis` → CloudFormation deploy → `api` + `worker`

---

## 12. Auth Design

### JWT Claims Structure

```json
{
  "sub": "user_abc123",
  "scope": "internal",         // "internal" | "external"
  "org": "acme-health",
  "iat": 1711000000,
  "exp": 1711003600
}
```

- **Internal scope**: Full access to `GET /records`, all fields returned
- **External scope**: `GET /records` returns redacted fields (no raw OpenCorporates data), paginated

---

## 13. Multi-Agent Context Map

This project uses 5 specialized agents. Each has its own `CLAUDE.md` defining its exact scope, contracts, and boundaries.

| Agent | Location | Owns | Auth Boundary |
|---|---|---|---|
| **Orchestrator** | `/agents/orchestrator/CLAUDE.md` | `POST /verify`, `GET /verify/{jobId}/status`, SQS producer, job state machine | ✅ Primary — validates JWT |
| **Scraper** | `/agents/scraper/CLAUDE.md` | OpenCorporates API, raw data extraction, Redis cache read, retry logic | ❌ Internal worker only |
| **AI Validator** | `/agents/ai-validator/CLAUDE.md` | Claude API calls, prompt engineering, risk scoring, provider categorization | ❌ Internal worker only |
| **Storage** | `/agents/storage/CLAUDE.md` | DynamoDB persistence, Redis cache write — pure SQS consumer, no HTTP | ❌ Internal worker only |
| **IaC** | `/agents/iac/CLAUDE.md` | CloudFormation templates, Docker Compose, LocalStack bootstrap, IAM roles | ❌ Infrastructure only |
| **Frontend** | `/agents/frontend/CLAUDE.md` | React dashboard, search, progress tracking, results table, detail view | ❌ Forwards JWT only |

### Agent Communication Flow

```
POST /verify
     │
     ▼
[Orchestrator] ──SQS: VerificationJobMessage──▶ [Scraper]
                                                     │
                                          SQS: ScraperResultMessage
                                                     │
                                                     ▼
                                             [AI Validator]
                                                     │
                                          SQS: ValidationResultMessage
                                                     │
                                                     ▼
                                               [Storage]
                                                     │
                                          DynamoDB: job status → completed
                                                     │
                                                     ▼
GET /verify/{jobId}/status ◀── [Orchestrator polls DynamoDB]
```

### Shared Types

All SQS message schemas and shared interfaces live in `/shared/types/messages.ts`. This is the single source of truth for inter-agent contracts. Each agent imports from here — it never redefines its own message shapes.

### Auth Design (Orchestrator + Storage)

- **Orchestrator** validates JWT on all inbound HTTP requests, attaches `scope` claim to SQS messages
- **Storage** reads `scope` claim to enforce field-level visibility on `GET /records`
- **Scraper** and **AI Validator** are internal workers — they never handle external requests
- **IaC** defines IAM roles with least-privilege per agent

> ⚠️ *Compliance Note: This architecture defers full zero-trust enforcement. A HIPAA/SOC2 compliance pass should evaluate whether Scraper and AI Validator agents require independent auth boundaries, given that they handle provider data in transit.*

---

## 14. Open Questions / Out of Scope (v1)

| Topic | Decision |
|---|---|
| WebSocket support | Out of scope v1 — polling only |
| Multi-jurisdiction batch requests | Out of scope v1 |
| Frontend dashboard | ✅ In scope — React dashboard (`services/frontend/`) |
| OpenCorporates paid tier | To be determined based on rate limits hit |
| Secret management | AWS Secrets Manager stub via LocalStack (future) |
| CI/CD pipeline | Out of scope v1 |
| Alerting / CloudWatch | Out of scope v1 |

---

## 14. Development Setup

```bash
# Start all local infrastructure
docker-compose up -d

# Deploy CloudFormation stacks to LocalStack
awslocal cloudformation deploy \
  --template-file infra/cloudformation/template.yaml \
  --stack-name medical-validator \
  --parameter-overrides file://infra/cloudformation/parameters/local.json

# Start API (dev mode)
cd services/api && npm run dev

# Start Worker (dev mode)
cd services/worker && npm run dev
```

---

*Last updated: 2026-03-20 | Status: Scoping Complete — Ready for Implementation*
