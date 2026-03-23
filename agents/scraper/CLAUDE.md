# Agent: Scraper
> **Role:** OpenCorporates data retrieval via authenticated web scraping, raw company record extraction, normalization, and retry handling.
> **Scope:** This agent owns all communication with OpenCorporates. It receives a job message from SQS, fetches data, and passes a structured raw result to the AI Validator via SQS.

---

## Responsibilities

- Consume `VerificationJobMessage` from SQS
- Check Redis cache before making any external call
- Scrape OpenCorporates `/companies` search page for matching company records
- Maintain an authenticated browser session (login once, reuse cookies)
- Parse HTML results with Cheerio into structured `RawCompanyRecord[]`
- Handle session expiry, timeouts, and retries
- Publish `ScraperResultMessage` to SQS for the AI Validator to consume
- Update job status to `processing` on start, `failed` on unrecoverable error

## Out of Scope

- Does NOT perform AI validation or risk assessment
- Does NOT write final records to DynamoDB
- Does NOT handle JWT or auth logic
- Does NOT know about the frontend or polling mechanism

---

## Auth Responsibility

None at the application level. This agent is an internal worker. It receives pre-authorized job messages from SQS and never handles external requests.

Manages its own OpenCorporates session (login with `OC_EMAIL` / `OC_PASSWORD` env vars) to avoid CAPTCHA challenges.

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
  rawApiSnapshot: Record<string, unknown>;  // raw HTML attributes + text — audit trail
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
Ensure authenticated browser session (login if needed)
        │
        ▼
Navigate to OpenCorporates search page
  https://opencorporates.com/companies
    ?q=<normalizedName>
    &jurisdiction_code=<jurisdiction>   // if provided
    &type=companies
    &utf8=✓
        │
        ▼
Extract HTML from results page
        │
        ▼
Parse with Cheerio → map to RawCompanyRecord[] (top 5)
        │
        ▼
Write raw result to Redis cache
  Key: scraper:company:<normalizedName>
  TTL: 86400 seconds (24h)
        │
        ▼
Publish ScraperResultMessage to ValidationQueue
```

---

## OpenCorporates Web Scraping

### URL Pattern

```
https://opencorporates.com/companies?q=<name>&jurisdiction_code=<code>&type=companies&utf8=✓
```

> Note: `/companies` is NOT in OpenCorporates' `robots.txt` disallow list. Only `/search` is disallowed.

### Authentication

- Login via Puppeteer at `https://opencorporates.com/users/sign_in`
- Credentials from env vars: `OC_EMAIL`, `OC_PASSWORD`
- Session cookies stored and reused across requests
- Re-login only when session expires (detected by CAPTCHA page or redirect to login)

### HTML Selectors

Results are in `ul#companies > li.search-result`. Each `li` contains:

| Field | Selector | Extraction |
|---|---|---|
| Company name | `a.company_search_result` | `.textContent` |
| Company number | `a.company_search_result[href]` | Last path segment from href |
| Jurisdiction | `a.company_search_result[href]` | Second path segment from href (e.g. `us_mn`) |
| Status | `li` class names + `span.status.label` | Classes like `active`, `inactive`, `terminated`, `merged`; label text for `branch`, `nonprofit` |
| Start date | `span.start_date` | `.textContent`, parse to ISO 8601 |
| End date | `span.end_date` (optional) | `.textContent`, parse to ISO 8601 |
| Address | `span.address` | Text content excluding the `<a>` map link |
| Previous names | `span.slight_highlight` (optional) | `.textContent` |
| OpenCorporates URL | `a.company_search_result[href]` | Prepend `https://opencorporates.com` |

### Response Mapping

```ts
// Per li.search-result → RawCompanyRecord
{
  href="/companies/us_mn/0f23674b..."
    → companyNumber: "0f23674b..."
    → jurisdiction: "us_mn"
    → openCorporatesUrl: "https://opencorporates.com/companies/us_mn/0f23674b..."

  a.company_search_result text
    → name: "ALBERT LEA MEDICAL CENTER - MAYO HEALTH SYSTEM"

  li classes + span.status.label
    → status: "inactive"  // primary status from li class

  span.start_date text
    → incorporationDate: "1905-12-13"  // parsed from "13 Dec 1905"

  span.address text
    → address: "211 S Newton, Albert Lea, MN, 56007"

  // rawApiSnapshot stores all extracted HTML attributes for audit
  rawApiSnapshot: {
    classes: ["search-result", "company", "inactive"],
    statusLabels: ["inactive", "nonprofit"],
    startDate: "13 Dec 1905",
    endDate: null,
    previousNames: null,
    rawHtml: "<li>...</li>"  // full outer HTML of the result element
  }
}
```

### Pagination

- Selector: `div.pagination > ul > li > a[rel="next"]`
- Default: only scrape page 1 (top 30 results, take first 5)
- If fewer than 5 results on page 1 and more pages exist, do NOT paginate — 5 results is the max we need

---

## Session Management

```
On worker start:
  Launch Puppeteer browser (headless)
        │
        ▼
On first scrape request:
  Navigate to login page
  Fill OC_EMAIL + OC_PASSWORD
  Submit → wait for redirect to dashboard
  Store session cookies
        │
        ▼
On subsequent requests:
  Reuse stored cookies
  If CAPTCHA detected or login redirect → re-authenticate
        │
        ▼
On worker shutdown:
  Close browser
```

### Browser Configuration

- Headless mode (`headless: 'new'`)
- Single browser instance, reused across all scrape requests
- Page timeout: 15s
- User-Agent: default Puppeteer Chrome UA
- Viewport: 1280x720

---

## Retry Strategy

| Failure Type | Strategy |
|---|---|
| CAPTCHA detected | Re-login once; if CAPTCHA persists after login, mark job `failed` |
| Session expired | Re-login, retry the scrape request once |
| Page load timeout (>15s) | Retry up to 3x with 2s delay |
| Empty results page | Not an error — publish `ScraperResultMessage` with `companies: []` |
| Puppeteer crash | Relaunch browser, retry once |
| Unrecoverable after retries | Update job status to `failed`, publish error to DLQ |

---

## Redis Cache

> This cache is distinct from the Storage agent's cache. Scraper caches **raw OpenCorporates records** to avoid redundant web scraping. Storage caches **final validated records** for fast repeat reads. Same Redis instance, different key namespaces, different purposes.

- **Client:** `ioredis`
- **Key format:** `scraper:company:<normalizedName>`
- **Value:** Serialized `RawCompanyRecord[]` (JSON string)
- **TTL:** 86400s (24 hours)
- **On cache miss:** Scrape OpenCorporates, then write to cache
- **On cache hit:** Skip scraping, set `cachedResult: true` in outbound message

---

## Error Handling

| Scenario | Action |
|---|---|
| OpenCorporates returns 0 results | Publish `ScraperResultMessage` with empty `companies: []` |
| OpenCorporates unreachable after retries | Update job `status: failed`, send to DLQ |
| Redis unavailable | Log warning, proceed without cache (degrade gracefully) |
| Malformed HTML / missing selectors | Log and skip malformed records, continue with valid ones |
| Login failure (bad credentials) | Log error, mark job `failed` — do not retry with bad creds |

---

## Dependencies

| Dependency | Purpose |
|---|---|
| `@aws-sdk/client-sqs` | Consume from SQS, publish to ValidationQueue |
| `@aws-sdk/client-dynamodb` | Update job status |
| `ioredis` | Redis cache client |
| `puppeteer` | Headless browser for authenticated session |
| `cheerio` | HTML parsing of search results |
| `zod` | Validate inbound SQS message shape |

---

## Environment Variables

```bash
SQS_VERIFICATION_QUEUE_URL=http://localhost:4566/000000000000/verification-queue.fifo
SQS_VALIDATION_QUEUE_URL=http://localhost:4566/000000000000/validation-queue.fifo
DYNAMODB_TABLE_JOBS=jobs
DYNAMODB_ENDPOINT=http://localhost:4566
REDIS_URL=redis://localhost:6379
OC_EMAIL=<opencorporates login email>
OC_PASSWORD=<opencorporates login password>
OC_BASE_URL=https://opencorporates.com
SCRAPER_PAGE_TIMEOUT_MS=15000
SCRAPER_MAX_RETRIES=3
```

---

## Testing Requirements

- Unit: Cheerio HTML parser (valid results page, empty results, partial data)
- Unit: Selector extraction (company number from href, jurisdiction from href, date parsing)
- Unit: Status extraction from `li` classes and `span.status.label`
- Unit: Normalization logic (casing, punctuation stripping, whitespace)
- Unit: Retry logic (session expiry, timeout, CAPTCHA detection)
- Unit: Redis cache hit/miss branching
- Integration: Full SQS consume → Puppeteer scrape → Cheerio parse → cache write → SQS publish
- Mock: Static HTML fixtures for deterministic unit tests
