// E2E Mock Seed Data
//
// Provides deterministic API responses for Playwright route mocking.
// Each export matches the shape of an actual API response so tests
// can call page.route() and return these directly.

// ─── Shared Identifiers ─────────────────────────────────────────────

export const JOB_IDS = {
  fresh: 'job_01JFRESH00000000000000001',
  cached: 'job_01JCACHE00000000000000002',
  failed: 'job_01JFAIL000000000000000003',
  multiResult: 'job_01JMULTI00000000000000004',
} as const;

export const COMPANY_NUMBERS = {
  mayo: '5372901',
  kaiser: '0422598',
  dissolved: '1199003',
  unknown: '8800071',
} as const;

// ─── POST /verify ────────────────────────────────────────────────────

export const VERIFY_FRESH = {
  jobId: JOB_IDS.fresh,
  status: 'queued' as const,
  pollUrl: `/verify/${JOB_IDS.fresh}/status`,
};

export const VERIFY_CACHED = {
  jobId: JOB_IDS.cached,
  status: 'completed' as const,
  pollUrl: `/verify/${JOB_IDS.cached}/status`,
  cached: true,
  cachedAt: '2026-03-23T08:00:00Z',
};

// ─── GET /health ─────────────────────────────────────────────────────

export const HEALTH_OK = { status: 'ok' };

// ─── Verification Records (reused across status + records) ───────────

const RECORD_MAYO = {
  pk: `JOB#${JOB_IDS.fresh}`,
  sk: `RESULT#${COMPANY_NUMBERS.mayo}`,
  jobId: JOB_IDS.fresh,
  companyNumber: COMPANY_NUMBERS.mayo,
  companyName: 'Mayo Health System',
  normalizedName: 'mayo health system',
  jurisdiction: 'us_mn',
  registrationNumber: '5372901',
  incorporationDate: '1919-07-22',
  legalStatus: 'Active',
  standardizedAddress: '200 First St SW, Rochester, MN 55905',
  providerType: 'Health System',
  riskLevel: 'LOW' as const,
  riskFlags: [],
  aiSummary:
    'Entity is actively registered in Minnesota since 1919. No anomalies detected. Registration matches the OpenCorporates record with high confidence.',
  confidence: 'HIGH',
  cachedResult: false,
  cachedFromJobId: null,
  originalValidatedAt: null,
  scope: 'internal' as const,
  rawSourceData: {
    openCorporatesUrl: 'https://opencorporates.com/companies/us_mn/5372901',
    status: 'Active',
    retrievedAt: '2026-03-23T10:00:00Z',
    rawHtml: '<li class="search-result company active"><a class="jurisdiction_filter us" href="/companies/us_mn" title="Minnesota (US)"></a><span class="status label">nonprofit</span><a class="company_search_result active" href="/companies/us_mn/5372901" title="MAYO HEALTH SYSTEM">MAYO HEALTH SYSTEM</a> (Minnesota (US), <span class="start_date">22 Jul 1919</span>- )</li>',
  },
  jobStatus: 'completed' as const,
  createdAt: '2026-03-23T10:00:00Z',
  validatedAt: '2026-03-23T10:00:12Z',
  ttl: 1750694412,
};

const RECORD_KAISER = {
  pk: `JOB#${JOB_IDS.multiResult}`,
  sk: `RESULT#${COMPANY_NUMBERS.kaiser}`,
  jobId: JOB_IDS.multiResult,
  companyNumber: COMPANY_NUMBERS.kaiser,
  companyName: 'Kaiser Permanente',
  normalizedName: 'kaiser permanente',
  jurisdiction: 'us_ca',
  registrationNumber: '0422598',
  incorporationDate: '1945-08-10',
  legalStatus: 'Active',
  standardizedAddress: '1 Kaiser Plaza, Oakland, CA 94612',
  providerType: 'Health System',
  riskLevel: 'MEDIUM' as const,
  riskFlags: ['Multiple active registrations across jurisdictions'],
  aiSummary:
    'Entity is actively registered in California. Minor discrepancy: multiple registrations found in CA and OR. Flagged for review.',
  confidence: 'MEDIUM',
  cachedResult: false,
  cachedFromJobId: null,
  originalValidatedAt: null,
  scope: 'internal' as const,
  rawSourceData: {
    openCorporatesUrl: 'https://opencorporates.com/companies/us_ca/0422598',
    status: 'Active',
    retrievedAt: '2026-03-23T10:05:00Z',
  },
  jobStatus: 'completed' as const,
  createdAt: '2026-03-23T10:05:00Z',
  validatedAt: '2026-03-23T10:05:18Z',
  ttl: 1750694718,
};

const RECORD_DISSOLVED = {
  pk: `JOB#${JOB_IDS.multiResult}`,
  sk: `RESULT#${COMPANY_NUMBERS.dissolved}`,
  jobId: JOB_IDS.multiResult,
  companyNumber: COMPANY_NUMBERS.dissolved,
  companyName: 'Sunrise Medical Clinic LLC',
  normalizedName: 'sunrise medical clinic llc',
  jurisdiction: 'us_fl',
  registrationNumber: '1199003',
  incorporationDate: '2008-03-01',
  legalStatus: 'Dissolved',
  standardizedAddress: '400 S Orange Ave, Orlando, FL 32801',
  providerType: 'Clinic',
  riskLevel: 'HIGH' as const,
  riskFlags: [
    'Entity dissolved in 2022',
    'No active officers on record',
    'Address associated with multiple dissolved entities',
  ],
  aiSummary:
    'Entity was dissolved in Florida in 2022. No active officers found. The registered address is shared with two other dissolved entities, suggesting a possible shell or forwarding address.',
  confidence: 'HIGH',
  cachedResult: false,
  cachedFromJobId: null,
  originalValidatedAt: null,
  scope: 'internal' as const,
  rawSourceData: {
    openCorporatesUrl: 'https://opencorporates.com/companies/us_fl/1199003',
    status: 'Dissolved',
    retrievedAt: '2026-03-23T10:05:00Z',
  },
  jobStatus: 'completed' as const,
  createdAt: '2026-03-23T10:05:00Z',
  validatedAt: '2026-03-23T10:05:18Z',
  ttl: 1750694718,
};

const RECORD_UNKNOWN = {
  pk: `JOB#${JOB_IDS.multiResult}`,
  sk: `RESULT#${COMPANY_NUMBERS.unknown}`,
  jobId: JOB_IDS.multiResult,
  companyNumber: COMPANY_NUMBERS.unknown,
  companyName: 'Northside Wellness Partners',
  normalizedName: 'northside wellness partners',
  jurisdiction: 'us_ga',
  registrationNumber: '8800071',
  incorporationDate: undefined,
  legalStatus: 'Unknown',
  standardizedAddress: '',
  providerType: 'Unknown',
  riskLevel: 'UNKNOWN' as const,
  riskFlags: ['No public registration data found'],
  aiSummary:
    'Unable to verify entity. No matching records in the OpenCorporates registry for the given name and jurisdiction. This may indicate an unregistered entity or a name mismatch.',
  confidence: 'LOW',
  cachedResult: false,
  cachedFromJobId: null,
  originalValidatedAt: null,
  scope: 'internal' as const,
  rawSourceData: {},
  jobStatus: 'completed' as const,
  createdAt: '2026-03-23T10:06:00Z',
  validatedAt: '2026-03-23T10:06:08Z',
  ttl: 1750694768,
};

const RECORD_CACHED_MAYO = {
  ...RECORD_MAYO,
  pk: `JOB#${JOB_IDS.cached}`,
  jobId: JOB_IDS.cached,
  cachedResult: true,
  cachedFromJobId: JOB_IDS.fresh,
  originalValidatedAt: '2026-03-23T10:00:12Z',
  validatedAt: '2026-03-23T14:00:00Z',
};

// ─── Export individual records for targeted tests ────────────────────

export const RECORDS = {
  mayo: RECORD_MAYO,
  kaiser: RECORD_KAISER,
  dissolved: RECORD_DISSOLVED,
  unknown: RECORD_UNKNOWN,
  cachedMayo: RECORD_CACHED_MAYO,
} as const;

// ─── GET /verify/:id/status ──────────────────────────────────────────

export const JOB_STATUS_QUEUED = {
  jobId: JOB_IDS.fresh,
  status: 'queued' as const,
};

export const JOB_STATUS_PROCESSING = {
  jobId: JOB_IDS.fresh,
  status: 'processing' as const,
};

export const JOB_STATUS_COMPLETED = {
  jobId: JOB_IDS.fresh,
  status: 'completed' as const,
  results: [RECORD_MAYO],
};

export const JOB_STATUS_CACHED = {
  jobId: JOB_IDS.cached,
  status: 'completed' as const,
  results: [RECORD_CACHED_MAYO],
};

export const JOB_STATUS_FAILED = {
  jobId: JOB_IDS.failed,
  status: 'failed' as const,
  errorMessage: 'OpenCorporates API returned 429 Too Many Requests after 3 retries',
};

export const JOB_STATUS_MULTI_RESULT = {
  jobId: JOB_IDS.multiResult,
  status: 'completed' as const,
  results: [RECORD_KAISER, RECORD_DISSOLVED, RECORD_UNKNOWN],
};

// ─── GET /records ────────────────────────────────────────────────────

export const RECORDS_PAGE_1 = {
  records: [RECORD_DISSOLVED, RECORD_KAISER, RECORD_MAYO, RECORD_UNKNOWN],
  total: 6,
  nextCursor: 'eyJsYXN0S2V5IjoiUkVDT1JEIzQifQ==',
};

export const RECORDS_PAGE_2 = {
  records: [RECORD_CACHED_MAYO],
  total: 6,
  nextCursor: undefined,
};

export const RECORDS_FILTERED_HIGH = {
  records: [RECORD_DISSOLVED],
  total: 1,
};

export const RECORDS_FILTERED_LOW = {
  records: [RECORD_MAYO, RECORD_CACHED_MAYO],
  total: 2,
};

export const RECORDS_EMPTY = {
  records: [],
  total: 0,
};

// ─── Sequence helpers ────────────────────────────────────────────────

// Simulates the polling lifecycle: queued → processing → completed.
// Returns the next response each time it's called.
export function createPollingSequence(jobId = JOB_IDS.fresh) {
  const responses = [
    { jobId, status: 'queued' as const },
    { jobId, status: 'processing' as const },
    { jobId, status: 'processing' as const },
    {
      jobId,
      status: 'completed' as const,
      results: [RECORD_MAYO],
    },
  ];
  let index = 0;
  return () => responses[Math.min(index++, responses.length - 1)];
}

// Simulates a job that fails after processing.
export function createFailingSequence(jobId = JOB_IDS.failed) {
  const responses = [
    { jobId, status: 'queued' as const },
    { jobId, status: 'processing' as const },
    {
      jobId,
      status: 'failed' as const,
      errorMessage: 'OpenCorporates API returned 429 Too Many Requests after 3 retries',
    },
  ];
  let index = 0;
  return () => responses[Math.min(index++, responses.length - 1)];
}