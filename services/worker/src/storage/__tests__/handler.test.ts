import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  RawCompanyRecord,
  ValidationResult,
  ValidationResultMessage,
} from '@medical-validator/shared';

// Mock logger (must be before handler import)
vi.mock('../../shared/logger.js', () => {
  const noop = vi.fn();
  const childLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => childLogger };
  return { createLogger: () => childLogger };
});

// Mock telemetry (must be before handler import)
vi.mock('../../shared/telemetry.js', () => ({
  writeTelemetry: vi.fn(),
}));

// Mock dependencies before importing handler
const mockUpdateJobStatus = vi.fn();
const mockPutVerificationRecords = vi.fn();
vi.mock('../../shared/dynamodb.js', () => ({
  updateJobStatus: mockUpdateJobStatus,
  putVerificationRecords: mockPutVerificationRecords,
}));

const mockSetCachedJobId = vi.fn();
vi.mock('../../shared/redis.js', () => ({
  setCachedJobId: mockSetCachedJobId,
}));

const FAKE_COMPANIES: RawCompanyRecord[] = [
  {
    companyNumber: '0f23674b',
    name: 'MAYO HEALTH SYSTEM',
    jurisdiction: 'us_mn',
    status: 'active',
    incorporationDate: '1905-12-13',
    address: '211 S Newton, Albert Lea, MN, 56007',
    openCorporatesUrl: 'https://opencorporates.com/companies/us_mn/0f23674b',
    rawApiSnapshot: { classes: ['active'] },
  },
];

const VALID_RESULT: ValidationResult = {
  companyName: 'MAYO HEALTH SYSTEM',
  jurisdiction: 'us_mn',
  registrationNumber: '0f23674b',
  incorporationDate: '1905-12-13',
  legalStatus: 'Active',
  standardizedAddress: '211 S Newton, Albert Lea, MN, 56007',
  providerType: 'Health System',
  riskLevel: 'LOW',
  riskFlags: [],
  aiSummary: 'Entity is actively registered in Minnesota.',
  confidence: 'HIGH',
};

const VALID_MESSAGE: ValidationResultMessage = {
  jobId: 'job-001',
  normalizedName: 'mayo health system',
  scope: 'internal',
  cachedResult: false,
  validations: [VALID_RESULT],
  rawSourceData: FAKE_COMPANIES,
  validatedAt: '2026-03-22T10:00:00Z',
};

describe('handleStorageMessage', () => {
  let handleStorageMessage: (body: unknown) => Promise<void>;

  beforeEach(async () => {
    vi.resetAllMocks();
    const mod = await import('../handler.js');
    handleStorageMessage = mod.handleStorageMessage;
  });

  it('rejects invalid message with ZodError', async () => {
    await expect(handleStorageMessage({ invalid: true })).rejects.toThrow();
  });

  // ── DynamoDB: verification records ──────────────────────────────────

  it('writes individual verification records to DynamoDB', async () => {
    await handleStorageMessage(VALID_MESSAGE);

    expect(mockPutVerificationRecords).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          pk: 'JOB#job-001',
          sk: 'RESULT#us_mn#0f23674b',
          jobId: 'job-001',
          companyNumber: '0f23674b',
          companyName: 'MAYO HEALTH SYSTEM',
          normalizedName: 'mayo health system',
          jurisdiction: 'us_mn',
          registrationNumber: '0f23674b',
          legalStatus: 'Active',
          riskLevel: 'LOW',
          cachedResult: false,
          cachedFromJobId: null,
          originalValidatedAt: null,
          jobStatus: 'completed',
          validatedAt: '2026-03-22T10:00:00Z',
        }),
      ]),
    );
  });

  it('writes one record per validation result', async () => {
    const secondResult: ValidationResult = {
      ...VALID_RESULT,
      companyName: 'MAYO CLINIC JACKSONVILLE',
      registrationNumber: 'xyz-7890',
      jurisdiction: 'us_fl',
    };
    const multiMessage: ValidationResultMessage = {
      ...VALID_MESSAGE,
      validations: [VALID_RESULT, secondResult],
      rawSourceData: [
        ...FAKE_COMPANIES,
        { ...FAKE_COMPANIES[0], companyNumber: 'xyz-7890', name: 'MAYO CLINIC JACKSONVILLE' },
      ],
    };

    await handleStorageMessage(multiMessage);

    const records = mockPutVerificationRecords.mock.calls[0][0];
    expect(records).toHaveLength(2);
    expect(records[0].sk).toBe('RESULT#us_mn#0f23674b');
    expect(records[1].sk).toBe('RESULT#us_fl#xyz-7890');
  });

  it('stores individual company rawApiSnapshot (not array)', async () => {
    await handleStorageMessage(VALID_MESSAGE);

    const records = mockPutVerificationRecords.mock.calls[0][0];
    expect(records[0].rawSourceData).toEqual({ classes: ['active'] });
  });

  it('sets TTL to 90 days from now', async () => {
    await handleStorageMessage(VALID_MESSAGE);
    const records = mockPutVerificationRecords.mock.calls[0][0];
    const now = Math.floor(Date.now() / 1000);
    const ninetyDays = 90 * 24 * 60 * 60;
    expect(records[0].ttl).toBeGreaterThanOrEqual(now + ninetyDays - 5);
    expect(records[0].ttl).toBeLessThanOrEqual(now + ninetyDays + 5);
  });

  it('includes createdAt as ISO timestamp', async () => {
    await handleStorageMessage(VALID_MESSAGE);
    const records = mockPutVerificationRecords.mock.calls[0][0];
    expect(records[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // ── DynamoDB: job status update ────────────────────────────────────

  it('updates job status to completed', async () => {
    await handleStorageMessage(VALID_MESSAGE);

    expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-001', 'completed');
  });

  // ── Redis cache ────────────────────────────────────────────────────

  it('caches query→jobId mapping in Redis', async () => {
    await handleStorageMessage(VALID_MESSAGE);

    expect(mockSetCachedJobId).toHaveBeenCalledWith(
      'mayo health system',
      'job-001',
      expect.any(String),
    );
  });

  it('skips cache write when cachedResult is true', async () => {
    const cachedMsg = { ...VALID_MESSAGE, cachedResult: true };
    await handleStorageMessage(cachedMsg);

    expect(mockSetCachedJobId).not.toHaveBeenCalled();
  });

  // ── Scope passthrough ──────────────────────────────────────────────

  it('preserves external scope in verification records', async () => {
    const externalMsg = { ...VALID_MESSAGE, scope: 'external' as const };
    await handleStorageMessage(externalMsg);

    const records = mockPutVerificationRecords.mock.calls[0][0];
    expect(records[0].scope).toBe('external');
  });

  // ── Error handling ─────────────────────────────────────────────────

  it('updates job status to failed when DynamoDB write fails', async () => {
    mockPutVerificationRecords.mockRejectedValue(new Error('DynamoDB throttled'));

    await expect(handleStorageMessage(VALID_MESSAGE)).rejects.toThrow();

    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      'job-001',
      'failed',
      expect.stringContaining('DynamoDB'),
    );
  });

  it('still writes to DynamoDB when Redis cache fails', async () => {
    mockSetCachedJobId.mockRejectedValue(new Error('Redis connection refused'));

    await handleStorageMessage(VALID_MESSAGE);

    expect(mockPutVerificationRecords).toHaveBeenCalled();
    expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-001', 'completed');
  });
});