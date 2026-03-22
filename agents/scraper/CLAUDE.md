# Agent: Scraper
> **Role:** OpenCorporates data retrieval, raw company record extraction, normalization, and retry handling.
> **Scope:** This agent owns all communication with OpenCorporates. It receives a job message from SQS, fetches data, and passes a structured raw result to the AI Validator via SQS.

---

## Responsibilities

- Consume `VerificationJobMessage` from SQS
- Check Redis cache before making any external call
- Query OpenCorporates API for matching company records
- Parse and normalize the top results into a structured format
- Handle rate limits, timeouts, and retries against OpenCorporates
- Publish `ScraperResultMessage` to SQS for the AI Validator to consume
- Update job status to `processing` on start, `failed` on unrecoverable error

## Out of Scope

- Does NOT perform AI validation or risk assessment
- Does NOT write final records to DynamoDB
- Does NOT handle JWT or auth logic
- Does NOT know about the frontend or polling mechanism

---

## Auth Responsibility

None. This agent is an internal worker. It receives pre-authorized job messages from SQS and never handles external requests.

> ⚠️ *Compliance Note: This service handles healthcare provider data retrieved from a third-party source. A future compliance pass (HIPAA / SOC2) should evaluate network egress controls, data-in-transit encryption, and whether raw OpenCorporates responses need to be sanitized before passing downstream.*

---

## Communication Contract

### Inbound (SQS Message)

Consumed from `VerificationQueue`. Schema from `/shared/types/messages.ts`.

```ts
interface VerificationJobMessage {
  jobId: string;
  companyName: string;
  normalizedName: string;
  jurisdiction?: string;
  scope: 'internal' | 'external';
  enqueuedAt: string;
}
```

### Outbound (SQS Message)

Published to `ValidationQueue`. Schema from `/shared/types/messages.ts`.

```ts
interface ScraperResultMessage {
  jobId: string;
  normalizedName: string;
  scope: 'internal' | 'external';
  cachedResult: boolean;
  companies: RawCompanyRecord[];   // top 5 results from OpenCorporates
  scrapedAt: string;               // ISO 8601
}

interface RawCompanyRecord {
  companyNumber: string;
  name: string;
  jurisdiction: string;
  status: string;                  // raw string from OpenCorporates e.g. "Active", "Dissolved"
  incorporationDate?: string;
  address?: string;
  openCorporatesUrl: string;
  rawApiSnapshot: Record<string, unknown>;  // full unprocessed object from OpenCorporates API — audit trail
}
```

---

## Processing Pipeline

```
Consume VerificationJobMessage from SQS
        │
        ▼
Update job status → "processing" in DynamoDB
        │
        ▼
Check Redis cache (key: normalizedName)
        │
  HIT ──▶ Publish cached ScraperResultMessage (cachedResult: true) → done
        │ MISS
        ▼
Call OpenCorporates API
  GET /v0.4/companies/search
    ?q=<normalizedName>
    &jurisdiction_code=<jurisdiction>  // if provided
    &per_page=5
        │
        ▼
Parse response → map to RawCompanyRecord[]
        │
        ▼
Write raw result to Redis cache
  Key: normalizedName
  TTL: 86400 seconds (24h)
        │
        ▼
Publish ScraperResultMessage to ValidationQueue
```

---

## OpenCorporates API

**Base URL:** `https://api.opencorporates.com/v0.4`

**Search endpoint:**
```
GET /companies/search?q=<name>&jurisdiction_code=<code>&per_page=5
```

**Response mapping:**

```ts
// OpenCorporates response → RawCompanyRecord
{
  "company": {
    "company_number"             → companyNumber
    "name"                       → name
    "jurisdiction_code"          → jurisdiction
    "current_status"             → status
    "incorporation_date"         → incorporationDate
    "registered_address_in_full" → address
    "opencorporates_url"         → openCorporatesUrl
    <full company object>        → rawApiSnapshot  // stored as-is for audit
  }
}
```

---

## Retry Strategy

| Failure Type | Strategy |
|---|---|
| `429 Too Many Requests` | Exponential backoff: 1s, 2s, 4s — max 3 retries |
| `5xx Server Error` | Retry up to 3x with 2s fixed delay |
| `Network timeout` | 10s timeout per request, retry up to 2x |
| Unrecoverable after retries | Update job status to `failed`, publish error to DLQ |

---

## Redis Cache

> This cache is distinct from the Storage agent's cache. Scraper caches **raw OpenCorporates records** to avoid redundant external API calls. Storage caches **final validated records** for fast repeat reads. Same Redis instance, different key namespaces, different purposes.

- **Client:** `ioredis`
- **Key format:** `scraper:company:<normalizedName>`
- **Value:** Serialized `RawCompanyRecord[]` (JSON string)
- **TTL:** 86400s (24 hours)
- **On cache miss:** Fetch from OpenCorporates, then write to cache
- **On cache hit:** Skip API call, set `cachedResult: true` in outbound message

---

## Error Handling

| Scenario | Action |
|---|---|
| OpenCorporates returns 0 results | Publish `ScraperResultMessage` with empty `companies: []` |
| OpenCorporates unreachable after retries | Update job `status: failed`, send to DLQ |
| Redis unavailable | Log warning, proceed without cache (degrade gracefully) |
| Malformed API response | Log and skip malformed records, continue with valid ones |

---

## Dependencies

| Dependency | Purpose |
|---|---|
| `@aws-sdk/client-sqs` | Consume from SQS, publish to ValidationQueue |
| `@aws-sdk/client-dynamodb` | Update job status |
| `ioredis` | Redis cache client |
| `axios` | HTTP client for OpenCorporates API |
| `zod` | Validate inbound SQS message shape |

---

## Environment Variables

```bash
SQS_VERIFICATION_QUEUE_URL=http://localhost:4566/000000000000/verification-queue.fifo
SQS_VALIDATION_QUEUE_URL=http://localhost:4566/000000000000/validation-queue.fifo
DYNAMODB_TABLE_JOBS=jobs
DYNAMODB_ENDPOINT=http://localhost:4566
REDIS_URL=redis://localhost:6379
OPENCORPORATES_API_BASE=https://api.opencorporates.com/v0.4
OPENCORPORATES_API_KEY=       # optional — increases rate limits
SCRAPER_REQUEST_TIMEOUT_MS=10000
SCRAPER_MAX_RETRIES=3
```

---

## Testing Requirements

- Unit: OpenCorporates response parser (valid, partial, empty responses)
- Unit: Normalization logic (casing, punctuation stripping, whitespace)
- Unit: Retry logic (mock 429, 500, timeout scenarios)
- Unit: Redis cache hit/miss branching
- Integration: Full SQS consume → OpenCorporates fetch → cache write → SQS publish
