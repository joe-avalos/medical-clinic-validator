# Agent: Storage
> **Role:** Persist validated provider records to DynamoDB and manage Redis cache writes.
> **Scope:** This agent is a pure SQS consumer and writer. It owns final data persistence only. It has no HTTP server. `GET /records` and scope-based field filtering are handled by the Orchestrator (API service).

---

## Responsibilities

- Consume `ValidationResultMessage` from SQS `StorageQueue`
- Write final validated record to DynamoDB `verifications` table
- Update job status to `completed` in DynamoDB `jobs` table
- Write validated result to Redis cache (key: `normalizedName`)

## Out of Scope

- Does NOT expose any HTTP routes (`GET /records` is owned by the Orchestrator)
- Does NOT enforce scope-based field visibility (Orchestrator handles this)
- Does NOT perform scraping or AI validation
- Does NOT enqueue new jobs
- Does NOT handle `POST /verify` or job polling
- Does NOT validate JWTs

---

## Auth Responsibility

None. This agent is a pure internal worker. It receives pre-authorized payloads via SQS and never handles external requests.

> ⚠️ *Compliance Note: This agent is the final persistence layer for healthcare provider registration data. A future compliance pass (HIPAA / SOC2) must evaluate: encryption at rest for DynamoDB, field-level encryption for address data, access logging for all reads, data retention policies (currently 90-day TTL), and whether external partner access requires a formal DUA (Data Use Agreement).*

---

## Communication Contract

### Inbound (SQS Message)

Consumed from `StorageQueue`. Schema from `/shared/types/messages.ts`.

```ts
interface ValidationResultMessage {
  jobId: string;
  normalizedName: string;
  scope: 'internal' | 'external';
  cachedResult: boolean;
  validation: ValidationResult;
  validatedAt: string;
}
```

### Written to DynamoDB (`verifications` table)

```ts
interface VerificationRecord {
  pk: string;               // COMPANY#<normalizedName>
  sk: string;               // JOB#<jobId>
  jobId: string;
  companyName: string;
  normalizedName: string;
  jurisdiction: string;
  registrationNumber: string;
  incorporationDate?: string;
  legalStatus: string;
  standardizedAddress: string;
  providerType: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  riskFlags: string[];
  aiSummary: string;
  confidence: string;
  cachedResult: boolean;
  rawSourceData: RawCompanyRecord[];  // raw OpenCorporates API responses — audit trail for Detail View
  jobStatus: 'completed';
  createdAt: string;
  validatedAt: string;
  ttl: number;              // Unix epoch — 90 days from validatedAt
}
```

### Field Visibility by Scope

| Field | Internal | External |
|---|---|---|
| `companyName` | ✅ | ✅ |
| `jurisdiction` | ✅ | ✅ |
| `legalStatus` | ✅ | ✅ |
| `riskLevel` | ✅ | ✅ |
| `aiSummary` | ✅ | ✅ |
| `providerType` | ✅ | ✅ |
| `standardizedAddress` | ✅ | ✅ |
| `riskFlags` | ✅ | ✅ |
| `registrationNumber` | ✅ | ❌ redacted |
| `incorporationDate` | ✅ | ❌ redacted |
| `confidence` | ✅ | ❌ redacted |
| `cachedResult` | ✅ | ❌ redacted |
| `jobId` | ✅ | ❌ redacted |

---

## Processing Pipeline (SQS Consumer)

```
Consume ValidationResultMessage from StorageQueue
        │
        ▼
Map to VerificationRecord (set TTL = now + 90 days)
        │
        ▼
Write to DynamoDB verifications table
        │
        ▼
Update job status record → "completed" in DynamoDB jobs table
        │
        ▼
Write to Redis cache
  Key: storage:company:<normalizedName>
  Value: VerificationRecord (JSON)
  TTL: 86400s (24h)
        │
        ▼
Done — Orchestrator polling will now return "completed"
```

---

## DynamoDB Tables

### `verifications` table

| Key | Type | Value |
|---|---|---|
| `pk` (PK) | String | `COMPANY#<normalizedName>` |
| `sk` (SK) | String | `JOB#<jobId>` |

**GSI:** `riskLevel-validatedAt-index`
- PK: `riskLevel`
- SK: `validatedAt`
- Projection: ALL

### `jobs` table (owned by Orchestrator — Storage only updates `status`)

| Key | Type | Value |
|---|---|---|
| `pk` (PK) | String | `JOB#<jobId>` |
| `sk` (SK) | String | `STATUS` |

Storage Agent updates: `status → completed`, `updatedAt → now`

---

## Redis Cache

> This cache is distinct from the Scraper agent's cache. Storage caches **final validated records** (post-AI, post-DynamoDB write) for fast repeat reads. Scraper caches **raw OpenCorporates records** to avoid redundant external API calls. Same Redis instance, different key namespaces, different purposes.

- **Key format:** `storage:company:<normalizedName>`
- **Value:** Serialized `VerificationRecord` (JSON)
- **TTL:** 86400s (24 hours)
- **Purpose:** Serve fast repeat lookups — if Scraper cache misses but Storage cache hits, the job can be short-circuited at the Orchestrator level in a future optimization

---

## Error Handling

| Scenario | Action |
|---|---|
| DynamoDB write failure | Retry up to 3x with exponential backoff; send to DLQ on failure |
| Redis write failure | Log warning, continue — cache is non-critical |
| Malformed `ValidationResultMessage` | Log and send to DLQ — do not silently discard |
| GSI query returns no results | Return empty `records: []` with `200` |

---

## Dependencies

| Dependency | Purpose |
|---|---|
| `@aws-sdk/client-dynamodb` | Read/write verifications + update jobs |
| `@aws-sdk/lib-dynamodb` | Document client for cleaner DynamoDB access |
| `@aws-sdk/client-sqs` | Consume from StorageQueue |
| `ioredis` | Redis cache writes |
| `zod` | Validate inbound SQS message shape |

---

## Environment Variables

```bash
SQS_STORAGE_QUEUE_URL=http://localhost:4566/000000000000/storage-queue.fifo
DYNAMODB_TABLE_VERIFICATIONS=verifications
DYNAMODB_TABLE_JOBS=jobs
DYNAMODB_ENDPOINT=http://localhost:4566
REDIS_URL=redis://localhost:6379
```

---

## Testing Requirements

- Unit: Field visibility filter (`internal` vs `external` scope — ensure no redacted field leaks)
- Unit: TTL calculation (90 days from `validatedAt`)
- Unit: Pagination cursor encode/decode
- Unit: DynamoDB write mapper (all fields correctly mapped)
- Integration: SQS consume → DynamoDB write → job status updated → Redis write
