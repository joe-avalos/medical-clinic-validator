# Agent: Frontend
> **Role:** React dashboard for medical provider verification — search, real-time progress tracking, results table, and detail view.
> **Scope:** This agent owns the entire frontend. It communicates with the backend exclusively via the API service (`POST /verify`, `GET /verify/{jobId}/status`, `GET /records`). It has no direct knowledge of SQS, DynamoDB, or Redis.

---

## Responsibilities

- Provide a search bar to submit company name verification requests
- Display a real-time step-by-step progress tracker while a job is processing
- List all verified providers in a sortable results table with risk badges
- Show a full detail view per provider including raw audit data
- Store and attach JWT on all API requests

## Out of Scope

- Does NOT call OpenCorporates, Claude API, DynamoDB, Redis, or SQS directly
- Does NOT validate JWTs (receives one from the auth flow, stores and forwards it)
- Does NOT implement any business logic — purely a consumer of the API contract

---

## Auth Responsibility

None beyond token storage and forwarding.

- On load: reads JWT from `localStorage` (or env-injected dev token)
- Attaches `Authorization: Bearer <token>` to all API requests
- On `401` response: clears token and prompts re-auth (out of scope v1 — show error state)

---

## Pages & Components

### `SearchPage` (default view)

- **SearchBar** — text input for company name + optional jurisdiction dropdown + "Verify" button
- On submit: `POST /verify` → receives `jobId` → navigates to `ProgressPage`

### `ProgressPage` (`/verify/:jobId`)

Real-time step tracker. Polls `GET /verify/{jobId}/status` every 2 seconds until `completed` or `failed`.

```
[ ✓ ] Queued
[ ⟳ ] Searching OpenCorporates...
[   ] Analyzing with AI...
[   ] Saving to database...
```

Steps map to job status transitions:
| Status | Steps shown active |
|---|---|
| `queued` | Step 1 complete |
| `processing` | Steps 1–2 active |
| `completed` | All steps complete → redirect to ResultsPage |
| `failed` | Error state shown inline |

On `completed`: auto-navigates to `ResultsPage` with the new record highlighted.

### `ResultsPage` (`/records`)

Table of all verified providers. Fetches `GET /records`.

| Column | Notes |
|---|---|
| Company Name | Clickable → DetailPage |
| Jurisdiction | — |
| Status | `Active` / `Inactive` / `Dissolved` |
| Provider Type | `Clinic`, `Health System`, etc. |
| Risk Level | Badge: `HIGH` (red) / `MEDIUM` (amber) / `LOW` (green) / `UNKNOWN` (grey) |

- Filter by risk level (dropdown)
- Pagination via cursor (`nextCursor` from API)

### `DetailPage` (`/records/:jobId`)

Full record view for a single provider. Data sourced from the already-fetched records list (no extra API call needed if cached by React Query).

Sections:
- **Summary** — name, jurisdiction, risk badge, AI summary
- **Registration Details** — registration number, incorporation date, legal status, standardized address
- **Raw Audit Data** — raw OpenCorporates fields displayed as JSON for audit purposes (internal scope only)
- **Risk Flags** — list of flag strings from AI validator

> Note: `registrationNumber`, `incorporationDate`, `confidence`, `cachedResult`, `jobId`, and raw audit data are only visible to `internal` scope users. The API handles field redaction — the frontend simply renders what it receives.

---

## API Contract (consumed)

All calls go to the API service base URL (`VITE_API_BASE_URL`).

```ts
// POST /verify
POST /verify
Body: { companyName: string; jurisdiction?: string }
Response 202: { jobId: string; status: 'queued'; pollUrl: string }

// GET /verify/:jobId/status
GET /verify/:jobId/status
Response 200: { jobId: string; status: JobStatus; result?: VerificationSummary }

// GET /records
GET /records?riskLevel=HIGH&limit=50&cursor=<token>
Response 200: { records: VerificationRecord[]; nextCursor?: string; total: number }
```

All types imported from `/shared/types/index.ts`.

---

## Polling Strategy

Uses `@tanstack/react-query` with `refetchInterval`:

```ts
const { data } = useQuery({
  queryKey: ['jobStatus', jobId],
  queryFn: () => fetchJobStatus(jobId),
  refetchInterval: (data) =>
    data?.status === 'completed' || data?.status === 'failed' ? false : 2000,
});
```

Stops polling automatically on terminal state. No manual interval management.

---

## Tech Stack

| Concern | Technology |
|---|---|
| Framework | React 18 + TypeScript strict |
| Build | Vite |
| Routing | React Router v6 |
| Data fetching + polling | `@tanstack/react-query` |
| HTTP client | `axios` |
| Styling | Tailwind CSS |
| Types | Shared from `/shared/types/` |

---

## Project Structure

```
services/frontend/
├── src/
│   ├── pages/
│   │   ├── SearchPage.tsx
│   │   ├── ProgressPage.tsx
│   │   ├── ResultsPage.tsx
│   │   └── DetailPage.tsx
│   ├── components/
│   │   ├── SearchBar.tsx
│   │   ├── ProgressTracker.tsx
│   │   ├── RecordsTable.tsx
│   │   ├── RiskBadge.tsx
│   │   └── DetailView.tsx
│   ├── api/
│   │   └── client.ts           # axios instance + all API calls
│   ├── hooks/
│   │   ├── useJobStatus.ts     # polling hook
│   │   └── useRecords.ts       # records list + filter hook
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Environment Variables

```bash
VITE_API_BASE_URL=http://localhost:3000   # API service
VITE_DEV_JWT=<dev-token>                  # local dev only — injected JWT
```

---

## Error Handling

| Scenario | UI Behavior |
|---|---|
| `POST /verify` fails | Inline error under search bar |
| Job status `failed` | Progress tracker shows error state with message |
| `GET /records` fails | Error banner with retry button |
| `401 Unauthorized` | Toast: "Session expired" — clear token |
| Network offline | React Query retries 3x with backoff automatically |

---

## Dependencies

| Dependency | Purpose |
|---|---|
| `react`, `react-dom` | UI framework |
| `react-router-dom` | Client-side routing |
| `@tanstack/react-query` | Data fetching, polling, caching |
| `axios` | HTTP client |
| `tailwindcss` | Styling |

---

## Testing Requirements

- Unit: `RiskBadge` renders correct color per risk level
- Unit: `ProgressTracker` shows correct step state per job status
- Unit: `useJobStatus` hook stops polling on `completed` / `failed`
- Unit: `client.ts` attaches Authorization header on all requests
- Integration: Search → submit → progress page renders and polls
- Integration: Results table renders records with correct risk badges