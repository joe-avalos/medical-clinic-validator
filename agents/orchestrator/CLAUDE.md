# Agent: Orchestrator
> **Role:** Job lifecycle manager, API entry point, SQS producer, polling endpoint handler, and records read API.
> **Scope:** This agent owns the entire public-facing API surface. It is the single HTTP entry point for all clients. It does not perform scraping, AI validation, or write final validated records to DynamoDB.

---

## Responsibilities

- Expose `POST /verify` — validate request, create job, enqueue to SQS, return `202 + jobId`
- Expose `GET /verify/{jobId}/status` — poll DynamoDB job record and return current state
- Expose `GET /records` — paginated, filtered list of validated records from DynamoDB `verifications` table
- Validate and decode JWT on all incoming requests
- Enforce scope-based field visibility on `GET /records` (`internal` vs `external`)
- Attach decoded scope claims (`internal` / `external`) to the SQS message payload
- Handle request validation via Zod schemas
- Enforce rate limiting at the API boundary (10k/hr target)

## Out of Scope

- Does NOT call OpenCorporates
- Does NOT call Claude AI
- Does NOT write final validated records to DynamoDB (only job status records)
- Does NOT implement Redis cache logic

---

## Auth Responsibility

This agent is the **primary auth boundary**. All JWT validation happens here.

- Validate Bearer token on every request
- Decode and verify claims: `sub`, `scope`, `org`, `exp`
- Reject expired or malformed tokens with `401`
- Attach `scope` claim to outbound SQS message so downstream agents can act accordingly

> ⚠️ *Compliance Note: This service handles healthcare provider data. A future compliance pass (HIPAA / SOC2) should evaluate whether additional auth controls, request audit logging, and PII redaction are required at this boundary.*

---

## Communication Contract

### Inbound (HTTP)

```ts
// POST /verify
interface VerifyRequest {
  companyName: string;          // required, 2–200 chars
  jurisdiction?: string;        // optional, ISO format e.g. "us_mn"
}

// Validated by: VerifyRequestSchema (Zod)
```

### Outbound (SQS Message)

Published to `VerificationQueue` (FIFO). Schema defined in `/shared/types/messages.ts`.

```ts
interface VerificationJobMessage {
  jobId: string;                // UUID v7
  companyName: string;          // original input
  normalizedName: string;       // lowercase, trimmed, punctuation stripped
  jurisdiction?: string;
  scope: 'internal' | 'external';  // from JWT claim
  enqueuedAt: string;           // ISO 8601
}
```

### Job Status Record (DynamoDB `jobs` table)

The Orchestrator writes and owns the job status record. Shape:

```ts
interface JobStatusRecord {
  pk: string;                   // JOB#<jobId>
  sk: string;                   // STATUS
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  companyName: string;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;        // populated on failure
}
```

---

## API Routes

### `POST /verify`

1. Parse and validate request body with Zod
2. Validate JWT — reject if invalid/expired
3. Generate `jobId` (UUID v7)
4. Normalize `companyName`
5. Write job status record to DynamoDB (`status: queued`)
6. Publish `VerificationJobMessage` to SQS FIFO queue
7. Return `202 Accepted`

```ts
// 202 Response
{
  jobId: string;
  status: 'queued';
  pollUrl: string;   // "/verify/{jobId}/status"
}
```

### `GET /verify/{jobId}/status`

1. Validate JWT
2. Read job status record from DynamoDB by `jobId`
3. If `completed`, include result summary
4. If `failed`, include `errorMessage`

```ts
// 200 Response (completed)
{
  jobId: string;
  status: 'completed';
  result: VerificationSummary;  // defined in /shared/types
}
```

### `GET /records`

Returns all validated records sorted by risk level descending (`HIGH → MEDIUM → LOW → UNKNOWN`).

**Auth:** Bearer JWT required — scope claim determines field visibility

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `riskLevel` | string | — | Filter by `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN` |
| `limit` | number | 50 | Max records per page |
| `cursor` | string | — | Pagination cursor (base64 encoded last key) |

1. Validate JWT, read `scope` claim
2. Query DynamoDB `verifications` table via GSI `riskLevel-validatedAt-index`
3. Apply scope-based field filter (`internal` → full record, `external` → redacted)
4. Return paginated response

```ts
// 200 Response
{
  records: VerificationRecord[] | RedactedVerificationRecord[];
  nextCursor?: string;
  total: number;
}
```

**Field visibility by scope:**

| Field | Internal | External |
|---|---|---|
| `companyName`, `jurisdiction`, `legalStatus`, `riskLevel`, `aiSummary`, `providerType`, `standardizedAddress`, `riskFlags` | ✅ | ✅ |
| `registrationNumber`, `incorporationDate`, `confidence`, `cachedResult`, `jobId` | ✅ | ❌ redacted |

---

## Rate Limiting Strategy

- Target: 10,000 requests/hour = ~167 req/sec sustained
- Use token bucket middleware (e.g. `express-rate-limit` backed by Redis)
- Keyed by JWT `sub` claim for per-consumer limits
- Return `429 Too Many Requests` with `Retry-After` header on breach

---

## Error Handling

| Scenario | Response |
|---|---|
| Invalid JWT | `401 Unauthorized` |
| Zod validation failure | `400 Bad Request` with field errors |
| SQS enqueue failure | `503 Service Unavailable` — retry up to 3x with exponential backoff |
| Job not found | `404 Not Found` |
| Rate limit exceeded | `429 Too Many Requests` |

---

## Dependencies

| Dependency | Purpose |
|---|---|
| `express` | HTTP server |
| `zod` | Request validation |
| `jsonwebtoken` | JWT decode + verify |
| `@aws-sdk/client-sqs` | Publish to SQS |
| `@aws-sdk/client-dynamodb` | Write/read job status; query verifications table for `GET /records` |
| `@aws-sdk/lib-dynamodb` | Document client for cleaner DynamoDB access |
| `express-rate-limit` | Rate limiting |
| `uuid` | UUID v7 job ID generation |

---

## Environment Variables

```bash
PORT=3000
JWT_SECRET=<secret>
SQS_QUEUE_URL=http://localhost:4566/000000000000/verification-queue.fifo
DYNAMODB_TABLE_JOBS=jobs
DYNAMODB_TABLE_VERIFICATIONS=verifications
DYNAMODB_ENDPOINT=http://localhost:4566
RATE_LIMIT_WINDOW_MS=3600000
RATE_LIMIT_MAX=10000
```

---

## Testing Requirements

- Unit: Zod schema validation (valid + invalid inputs)
- Unit: JWT validation middleware (expired, malformed, missing)
- Unit: Job status state machine transitions
- Integration: `POST /verify` → SQS message published → DynamoDB record created
- Integration: `GET /verify/{jobId}/status` returns correct state per DynamoDB record
- Integration: `GET /records` returns sorted + filtered results from verifications GSI
- Unit: Scope field filter (`internal` vs `external` — no redacted field leaks)
