# Agent: AI Validator
> **Role:** Claude AI-powered validation, risk scoring, address standardization, and provider categorization.
> **Scope:** This agent consumes raw scraped data, calls the Claude API, and produces a structured validation result. It owns all prompt engineering and risk logic.

---

## Responsibilities

- Consume `ScraperResultMessage` from SQS `ValidationQueue`
- Send raw company records to Claude API for validation
- Parse and structure the AI response into a typed `ValidationResult`
- Assign risk level: `LOW` / `MEDIUM` / `HIGH` / `UNKNOWN`
- Standardize address format (Proper Case, Zip Code validation)
- Categorize provider type: `Clinic`, `Health System`, `Hospital`, `Non-profit`, `Unknown`
- Publish `ValidationResultMessage` to SQS `StorageQueue`
- Handle Claude API errors and retries

## Out of Scope

- Does NOT query OpenCorporates
- Does NOT read or write to DynamoDB or Redis directly
- Does NOT handle JWT or auth logic
- Does NOT know about the frontend or polling

---

## Auth Responsibility

None. Internal worker only. Receives pre-authorized payloads via SQS.

> ⚠️ *Compliance Note: This agent sends healthcare provider names and registration data to the Anthropic Claude API (external service). A future compliance pass (HIPAA / SOC2) must evaluate whether a BAA (Business Associate Agreement) with Anthropic is required, whether data must be anonymized before sending, and whether AI-generated outputs require human review before being treated as authoritative.*

---

## Communication Contract

### Inbound (SQS Message)

Consumed from `ValidationQueue`. Schema from `/shared/types/messages.ts`.

```ts
interface ScraperResultMessage {
  jobId: string;
  normalizedName: string;
  scope: 'internal' | 'external';
  cachedResult: boolean;
  companies: RawCompanyRecord[];
  scrapedAt: string;
}
```

### Outbound (SQS Message)

Published to `StorageQueue`. Schema from `/shared/types/messages.ts`.

```ts
interface ValidationResultMessage {
  jobId: string;
  normalizedName: string;
  scope: 'internal' | 'external';
  cachedResult: boolean;
  validation: ValidationResult;
  validatedAt: string;           // ISO 8601
  rawSourceData: RawCompanyRecord[];  // passed through from ScraperResultMessage — not processed, stored as audit trail
}

interface ValidationResult {
  companyName: string;           // best match from OpenCorporates
  jurisdiction: string;
  registrationNumber: string;
  incorporationDate?: string;
  legalStatus: 'Active' | 'Inactive' | 'Dissolved' | 'Unknown';
  standardizedAddress: string;   // AI-formatted address
  providerType: ProviderType;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  riskFlags: string[];           // e.g. ["Inactive registration", "Jurisdiction mismatch"]
  aiSummary: string;             // 1–2 sentence plain-English verdict
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';  // AI confidence in result
}

type ProviderType =
  | 'Clinic'
  | 'Health System'
  | 'Hospital'
  | 'Urgent Care'
  | 'Non-profit'
  | 'Pharmacy'
  | 'Laboratory'
  | 'Unknown';
```

---

## Modular AI Provider Architecture

The AI layer uses a **provider abstraction** so the underlying model can be swapped without changing the worker logic. `validator.ts` depends ONLY on the `AIProvider` interface — it never imports a specific SDK directly.

### File Layout

```
services/worker/src/clients/
├── ai-provider.ts          # AIProvider interface + createAIProvider() factory
├── anthropic-provider.ts   # Claude API implementation (default)
├── ollama-provider.ts      # Ollama/OpenAI-compatible REST implementation (future fine-tuned model)
└── prompts.ts              # Shared prompt templates (provider-agnostic)
```

### Core Interface (`ai-provider.ts`)

```ts
interface AIProvider {
  validate(companies: RawCompanyRecord[]): Promise<ValidationResult>;
}

type ProviderType = 'anthropic' | 'ollama';

function createAIProvider(type: ProviderType): AIProvider;
```

- Provider selected via `AI_PROVIDER` env var (default: `anthropic`)
- Factory function `createAIProvider()` instantiates the correct implementation
- Both providers use the same prompt templates from `prompts.ts`
- Both providers validate output with the same Zod schema

### Anthropic Provider (`anthropic-provider.ts`)

- Uses `@anthropic-ai/sdk`, model `claude-sonnet-4-6`
- Retry logic (exponential backoff, fallback to UNKNOWN) — see Retry Strategy section
- Parses JSON response, validates with Zod

### Ollama Provider (`ollama-provider.ts`)

- HTTP calls to Ollama's OpenAI-compatible endpoint (`POST /v1/chat/completions`)
- Same prompt templates, same Zod validation on output
- Also works with vLLM or any OpenAI-compatible server
- This is the path to a **LoRA fine-tuned model** (Mistral 7B, Qwen 2.5, Phi-3) served locally

### Prompt Templates (`prompts.ts`)

Prompts are provider-agnostic and shared across all implementations. Both the system prompt and user prompt builder live here. No provider-specific logic.

---

## Prompt Design

### System Prompt

```
You are a healthcare compliance analyst. You will receive raw company registration
data from OpenCorporates and must validate it for a regulated healthcare organization.

Always respond with valid JSON only. No preamble, no explanation outside the JSON.
```

### User Prompt Template

```ts
const buildUserPrompt = (companies: RawCompanyRecord[]): string => `
Analyze the following company registration records and return a JSON object with this exact shape:

{
  "companyName": string,           // best matching company name
  "jurisdiction": string,          // jurisdiction code e.g. "us_mn"
  "registrationNumber": string,
  "incorporationDate": string | null,
  "legalStatus": "Active" | "Inactive" | "Dissolved" | "Unknown",
  "standardizedAddress": string,   // Proper Case; zip must be 5-digit (e.g. "12345") or ZIP+4 (e.g. "12345-6789"); empty string if no address available
  "providerType": "Clinic" | "Health System" | "Hospital" | "Urgent Care" | "Non-profit" | "Pharmacy" | "Laboratory" | "Unknown",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN",
  "riskFlags": string[],           // list any concerns
  "aiSummary": string,             // 1-2 sentences plain English
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}

Risk level rules:
- LOW: Active registration, address valid, no anomalies
- MEDIUM: Active but incomplete data, minor discrepancies, or multiple conflicting registrations
- HIGH: Inactive, Dissolved, Suspended, or jurisdiction mismatch
- UNKNOWN: No records found or insufficient data to assess

Raw records:
${JSON.stringify(companies, null, 2)}
`;
```

---

## Processing Pipeline

```
Consume ScraperResultMessage from SQS
        │
        ▼
If companies[] is empty → set riskLevel: UNKNOWN, skip AI call
        │
        ▼
Build Claude prompt from RawCompanyRecord[]
        │
        ▼
Call Claude API (with retry)
        │
        ▼
Parse JSON response → validate with Zod
        │
        ▼
Map to ValidationResult
        │
        ▼
Attach rawSourceData (companies[] passed through unchanged from ScraperResultMessage)
        │
        ▼
Publish ValidationResultMessage to StorageQueue
```

---

## Retry Strategy

| Failure Type | Strategy |
|---|---|
| Claude API `529 Overloaded` | Exponential backoff: 2s, 4s, 8s — max 3 retries |
| Claude API `5xx` | Retry up to 3x with 2s fixed delay |
| Malformed JSON response | Retry once with stricter prompt; on second failure use fallback |
| Timeout (>30s) | Retry once; on second timeout mark job `failed` |

### Fallback Behavior

If Claude API is unavailable after all retries:
- Set `riskLevel: UNKNOWN`
- Set `aiSummary: "AI validation unavailable. Manual review required."`
- Set `confidence: LOW`
- Still publish to StorageQueue — do not silently drop the job

---

## Error Handling

| Scenario | Action |
|---|---|
| Empty `companies[]` from scraper | Return `UNKNOWN` risk, skip AI call |
| Claude returns non-JSON | Retry with stricter prompt, then use fallback |
| Claude API fully unavailable | Use fallback result, publish with `confidence: LOW` |
| Zod parse failure on AI response | Log malformed response, apply fallback |

---

## Dependencies

| Dependency | Purpose |
|---|---|
| `@anthropic-ai/sdk` | Claude API client (Anthropic provider) |
| `@aws-sdk/client-sqs` | Consume from ValidationQueue, publish to StorageQueue |
| `zod` | Validate AI JSON response shape |

> Note: The Ollama provider uses plain HTTP (`fetch`) — no additional SDK required.

---

## Environment Variables

```bash
SQS_VALIDATION_QUEUE_URL=http://localhost:4566/000000000000/validation-queue.fifo
SQS_STORAGE_QUEUE_URL=http://localhost:4566/000000000000/storage-queue.fifo

# Provider selection
AI_PROVIDER=anthropic              # "anthropic" | "ollama"

# Anthropic-specific
ANTHROPIC_API_KEY=<key>
CLAUDE_MODEL=claude-sonnet-4-6
CLAUDE_MAX_TOKENS=2048
CLAUDE_TIMEOUT_MS=30000
CLAUDE_MAX_RETRIES=3

# Ollama/local-specific
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mistral:7b-instruct
```

---

## Testing Requirements

- Unit: Prompt builder (valid companies, empty array, single record)
- Unit: Risk level assignment logic (each level + edge cases)
- Unit: JSON response parser + Zod validation (valid, malformed, partial)
- Unit: Fallback behavior when AI is unavailable
- Unit: `createAIProvider()` factory returns correct provider based on `AI_PROVIDER` env var
- Unit: Both providers produce valid `ValidationResult` from mocked responses
- Integration: Full SQS consume → Claude API call → StorageQueue publish
- Mock: Claude API responses for deterministic unit tests
- Swap test: Change `AI_PROVIDER` env var, confirm worker uses correct provider without code changes

---

## LoRA Fine-Tuning Path (Future — Not Built in v1)

The validator task is narrow (structured JSON extraction + risk classification from company registration data). A LoRA fine-tuned 7B model can handle this without a frontier model, reducing cost and latency.

### Model Candidates

| Model | Size | License | Notes |
|---|---|---|---|
| **Mistral 7B Instruct** | 7B | Apache 2.0 | Best JSON output + legal extraction F1. Top pick. |
| **Qwen 2.5 7B** | 7B | MIT | Strong reasoning, good multilingual support |
| **Phi-3.5 Mini** | 3.8B | MIT | Runs on 16GB M-series Mac. Lower accuracy but lowest resource cost |
| **Gemma 2 9B** | 9B | Apache 2.0 | Strong legal extraction F1, Google-backed |

### Fine-Tuning Workflow (When Ready)

1. **Collect training data**: 500–1000 labeled examples (company records → expected JSON output). Bootstrap by running Claude on real data and human-reviewing outputs.
2. **Framework**: Unsloth + QLoRA (2.7x faster, 74% less memory than vanilla PEFT)
3. **Train**: ~2–4 hours on a single 24GB GPU (RTX 3090/4090 or cloud)
4. **Serve**: Merge LoRA adapter → load in Ollama or vLLM
5. **Constrained decoding**: Use Outlines or xgrammar for guaranteed valid JSON
6. **Switch**: Set `AI_PROVIDER=ollama`, point `OLLAMA_MODEL` to the fine-tuned model — zero code changes in `validator.ts`

### Training Data Strategy

Generate initial training set by running the Anthropic provider on real OpenCorporates data, then:
- Human-review and correct the outputs
- Add edge cases (dissolved companies, jurisdiction mismatches, empty data)
- Target 500+ examples before first fine-tune attempt
