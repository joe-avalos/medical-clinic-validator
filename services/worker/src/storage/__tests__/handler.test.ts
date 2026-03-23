import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  RawCompanyRecord,
  ValidationResult,
  ValidationResultMessage,
} from '@medical-validator/shared';

// Mock dependencies before importing handler
const mockUpdateJobStatus = vi.fn();
const mockPutVerificationRecord = vi.fn();
vi.mock('../../shared/dynamodb.js', () => ({
  updateJobStatus: mockUpdateJobStatus,
  putVerificationRecord: mockPutVerificationRecord,
}));

const mockSetCachedValidation = vi.fn();
vi.mock('../../shared/redis.js', () => ({
  setCachedValidation: mockSetCachedValidation,
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
  validation: VALID_RESULT,
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

  // ── DynamoDB: verification record ──────────────────────────────────

  it('writes verification record to DynamoDB', async () => {
    await handleStorageMessage(VALID_MESSAGE);

    expect(mockPutVerificationRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        pk: 'COMPANY#mayo health system',
        sk: 'JOB#job-001',
        jobId: 'job-001',
        companyName: 'MAYO HEALTH SYSTEM',
        normalizedName: 'mayo health system',
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
        cachedResult: false,
        jobStatus: 'completed',
        rawSourceData: FAKE_COMPANIES,
        validatedAt: '2026-03-22T10:00:00Z',
      }),
    );
  });

  it('sets pk to COMPANY#<normalizedName>', async () => {
    await handleStorageMessage(VALID_MESSAGE);
    const record = mockPutVerificationRecord.mock.calls[0][0];
    expect(record.pk).toBe('COMPANY#mayo health system');
  });

  it('sets sk to JOB#<jobId>', async () => {
    await handleStorageMessage(VALID_MESSAGE);
    const record = mockPutVerificationRecord.mock.calls[0][0];
    expect(record.sk).toBe('JOB#job-001');
  });

  it('sets TTL to 90 days from now', async () => {
    await handleStorageMessage(VALID_MESSAGE);
    const record = mockPutVerificationRecord.mock.calls[0][0];
    const now = Math.floor(Date.now() / 1000);
    const ninetyDays = 90 * 24 * 60 * 60;
    // TTL should be within 5 seconds of expected value
    expect(record.ttl).toBeGreaterThanOrEqual(now + ninetyDays - 5);
    expect(record.ttl).toBeLessThanOrEqual(now + ninetyDays + 5);
  });

  it('includes createdAt as ISO timestamp', async () => {
    await handleStorageMessage(VALID_MESSAGE);
    const record = mockPutVerificationRecord.mock.calls[0][0];
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // ── DynamoDB: job status update ────────────────────────────────────

  it('updates job status to completed', async () => {
    await handleStorageMessage(VALID_MESSAGE);

    expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-001', 'completed');
  });

  // ── Redis cache ────────────────────────────────────────────────────

  it('caches the validated result in Redis', async () => {
    await handleStorageMessage(VALID_MESSAGE);

    expect(mockSetCachedValidation).toHaveBeenCalledWith(
      'mayo health system',
      expect.objectContaining({
        validation: VALID_RESULT,
        validatedAt: '2026-03-22T10:00:00Z',
      }),
    );
  });

  it('skips cache write when cachedResult is true', async () => {
    const cachedMsg = { ...VALID_MESSAGE, cachedResult: true };
    await handleStorageMessage(cachedMsg);

    expect(mockSetCachedValidation).not.toHaveBeenCalled();
  });

  // ── Scope passthrough ──────────────────────────────────────────────

  it('preserves external scope in verification record', async () => {
    const externalMsg = { ...VALID_MESSAGE, scope: 'external' as const };
    await handleStorageMessage(externalMsg);

    const record = mockPutVerificationRecord.mock.calls[0][0];
    expect(record.scope).toBe('external');
  });

  // ── Error handling ─────────────────────────────────────────────────

  it('updates job status to failed when DynamoDB write fails', async () => {
    mockPutVerificationRecord.mockRejectedValue(new Error('DynamoDB throttled'));

    await expect(handleStorageMessage(VALID_MESSAGE)).rejects.toThrow();

    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      'job-001',
      'failed',
      expect.stringContaining('DynamoDB'),
    );
  });

  it('still writes to DynamoDB when Redis cache fails', async () => {
    mockSetCachedValidation.mockRejectedValue(new Error('Redis connection refused'));

    await handleStorageMessage(VALID_MESSAGE);

    expect(mockPutVerificationRecord).toHaveBeenCalled();
    expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-001', 'completed');
  });
});
