import type { RawCompanyRecord } from '@medical-validator/shared';

export function buildSystemPrompt(): string {
  return `You are a healthcare entity verification specialist. Your task is to analyze company registration data from OpenCorporates and determine if the entity is a legitimate, active healthcare provider.

You MUST respond with valid JSON only — no markdown, no explanation, no wrapping. The response must match this exact schema:

{
  "companyName": "string — official registered name",
  "jurisdiction": "string — jurisdiction code (e.g. us_mn)",
  "registrationNumber": "string — company registration number",
  "incorporationDate": "string|null — ISO 8601 date or null if unknown",
  "legalStatus": "Active|Inactive|Dissolved|Unknown",
  "standardizedAddress": "string — Proper Case, full address with validated 5-digit or ZIP+4 code (e.g. '200 First St SW, Rochester, MN 55905')",
  "providerType": "Clinic|Health System|Hospital|Urgent Care|Non-profit|Pharmacy|Laboratory|Unknown",
  "riskLevel": "LOW|MEDIUM|HIGH|UNKNOWN",
  "riskFlags": ["array of string flags describing any concerns"],
  "aiSummary": "string — plain-English summary of findings",
  "confidence": "HIGH|MEDIUM|LOW"
}

Risk level rules:
- LOW: Active registration, matches jurisdiction, no anomalies
- MEDIUM: Active but incomplete data, multiple registrations, minor discrepancies
- HIGH: Dissolved, suspended, inactive, or jurisdiction mismatch
- UNKNOWN: Not found or data is inconclusive`;
}

export function buildUserPrompt(companies: RawCompanyRecord[]): string {
  return `Analyze the following company registration record and produce a validation result.

Company data:
${JSON.stringify(companies[0], null, 2)}

Respond with a single JSON object only.`;
}