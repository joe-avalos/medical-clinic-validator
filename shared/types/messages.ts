import { z } from 'zod';

// ─── Enums & Primitives ────────────────────────────────────────────

export const RiskLevel = z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const LegalStatus = z.enum(['Active', 'Inactive', 'Dissolved', 'Unknown']);
export type LegalStatus = z.infer<typeof LegalStatus>;

export const ProviderType = z.enum([
  'Clinic',
  'Health System',
  'Hospital',
  'Urgent Care',
  'Non-profit',
  'Pharmacy',
  'Laboratory',
  'Unknown',
]);
export type ProviderType = z.infer<typeof ProviderType>;

export const Confidence = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type Confidence = z.infer<typeof Confidence>;

export const JobStatus = z.enum(['queued', 'processing', 'completed', 'failed']);
export type JobStatus = z.infer<typeof JobStatus>;

export const Scope = z.enum(['internal', 'external']);
export type Scope = z.infer<typeof Scope>;

// ─── Pipeline Telemetry ─────────────────────────────────────────────

// Accumulated across workers via SQS message payload
export const PipelineTelemetrySchema = z.object({
  scraperProvider: z.string(),
  cacheHit: z.boolean(),
  companiesFound: z.number(),
  scrapeStartedAt: z.string().datetime(),
  aiProvider: z.string().optional(),
  validationOutcomes: z.object({
    success: z.number(),
    fallback: z.number(),
    empty: z.number(),
  }).optional(),
  pipelinePath: z.string().optional(),
});
export type PipelineTelemetry = z.infer<typeof PipelineTelemetrySchema>;

// Job telemetry table record (written by storage worker)
export interface JobTelemetry {
  pk: string;              // JOB#<jobId>
  sk: string;              // TELEMETRY
  jobId: string;
  companyName: string;
  normalizedName: string;
  scraperProvider: string;
  aiProvider: string;
  cacheHit: boolean;
  companiesFound: number;
  pipelinePath: string;
  validationOutcomes: {
    success: number;
    fallback: number;
    empty: number;
  };
  errorMessage: string | null;
  durationMs: number;
  createdAt: string;
  ttl: number;
}

// ─── SQS Messages ──────────────────────────────────────────────────

// Orchestrator → Scraper (verification-queue.fifo)
export const VerificationJobMessageSchema = z.object({
  jobId: z.string(),
  companyName: z.string(),
  normalizedName: z.string(),
  jurisdiction: z.string().optional(),
  scope: Scope,
  enqueuedAt: z.string().datetime(),
});
export type VerificationJobMessage = z.infer<typeof VerificationJobMessageSchema>;

// Scraper → AI Validator (validation-queue.fifo)
export const RawCompanyRecordSchema = z.object({
  companyNumber: z.string(),
  name: z.string(),
  jurisdiction: z.string(),
  status: z.string(),
  incorporationDate: z.string().optional(),
  address: z.string().optional(),
  openCorporatesUrl: z.string(),
  rawApiSnapshot: z.record(z.unknown()),
});
export type RawCompanyRecord = z.infer<typeof RawCompanyRecordSchema>;

export const ScraperResultMessageSchema = z.object({
  jobId: z.string(),
  normalizedName: z.string(),
  scope: Scope,
  cachedResult: z.boolean(),
  companies: z.array(RawCompanyRecordSchema),
  scrapedAt: z.string().datetime(),
  telemetry: PipelineTelemetrySchema.optional(),
});
export type ScraperResultMessage = z.infer<typeof ScraperResultMessageSchema>;

// AI Validator → Storage (storage-queue.fifo)
export const ValidationResultSchema = z.object({
  companyName: z.string(),
  jurisdiction: z.string(),
  registrationNumber: z.string(),
  incorporationDate: z.string().nullable().optional(),
  legalStatus: LegalStatus,
  standardizedAddress: z.string(),
  providerType: ProviderType,
  riskLevel: RiskLevel,
  riskFlags: z.array(z.string()),
  aiSummary: z.string(),
  confidence: Confidence,
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const ValidationResultMessageSchema = z.object({
  jobId: z.string(),
  normalizedName: z.string(),
  scope: Scope,
  cachedResult: z.boolean(),
  validations: z.array(ValidationResultSchema),
  validatedAt: z.string().datetime(),
  rawSourceData: z.array(RawCompanyRecordSchema),
  telemetry: PipelineTelemetrySchema.optional(),
});
export type ValidationResultMessage = z.infer<typeof ValidationResultMessageSchema>;

// ─── DynamoDB Records ───────────────────────────────────────────────

// Jobs table — owned by Orchestrator, updated by Scraper and Storage
export const JobStatusRecordSchema = z.object({
  pk: z.string(),
  sk: z.literal('STATUS'),
  jobId: z.string(),
  status: JobStatus,
  companyName: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  errorMessage: z.string().optional(),
});
export type JobStatusRecord = z.infer<typeof JobStatusRecordSchema>;

// Verifications table — written by Storage (one row per company per job)
export const VerificationRecordSchema = z.object({
  pk: z.string(),                                // JOB#<jobId>
  sk: z.string(),                                // RESULT#<companyNumber>
  jobId: z.string(),
  companyNumber: z.string(),
  companyName: z.string(),
  normalizedName: z.string(),
  jurisdiction: z.string(),
  registrationNumber: z.string(),
  incorporationDate: z.string().optional(),
  legalStatus: z.string(),
  standardizedAddress: z.string(),
  providerType: z.string(),
  riskLevel: RiskLevel,
  riskFlags: z.array(z.string()),
  aiSummary: z.string(),
  confidence: z.string(),
  cachedResult: z.boolean(),
  cachedFromJobId: z.string().nullable(),        // original jobId if cached
  originalValidatedAt: z.string().nullable(),    // when original validation ran
  scope: Scope,
  rawSourceData: z.record(z.unknown()),          // individual company snapshot
  jobStatus: z.literal('completed'),
  createdAt: z.string().datetime(),
  validatedAt: z.string().datetime(),
  ttl: z.number(),
});
export type VerificationRecord = z.infer<typeof VerificationRecordSchema>;

// ─── API Response Types ─────────────────────────────────────────────

// GET /records — external scope gets redacted fields
export type RedactedVerificationRecord = Omit<
  VerificationRecord,
  'registrationNumber' | 'incorporationDate' | 'confidence' | 'cachedResult' | 'cachedFromJobId' | 'originalValidatedAt' | 'jobId' | 'pk' | 'sk' | 'rawSourceData'
>;

// POST /verify request
export const VerifyRequestSchema = z.object({
  companyName: z.string().min(2).max(200),
  jurisdiction: z.string().optional(),
  forceRefresh: z.boolean().optional(),
});
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

// POST /verify response
export interface VerifyResponse {
  jobId: string;
  status: 'queued';
  pollUrl: string;
}

// GET /verify/:id/status response
export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  results?: VerificationRecord[];
  errorMessage?: string;
}

// GET /records response
export interface RecordsResponse {
  records: VerificationRecord[] | RedactedVerificationRecord[];
  nextCursor?: string;
  total: number;
}

// ─── JWT Claims ─────────────────────────────────────────────────────

export interface JwtClaims {
  sub: string;
  scope: Scope;
  org: string;
  iat: number;
  exp: number;
}
