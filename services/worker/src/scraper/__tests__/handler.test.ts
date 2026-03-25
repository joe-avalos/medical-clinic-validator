import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawCompanyRecord, VerificationJobMessage, VerificationRecord } from '@medical-validator/shared';

// Mock dependencies before importing handler
const mockGetCachedJobId = vi.fn();
vi.mock('../../shared/redis.js', () => ({
  getCachedJobId: mockGetCachedJobId,
}));

const mockUpdateJobStatus = vi.fn();
const mockGetRecordsByJobId = vi.fn();
const mockPutVerificationRecords = vi.fn();
vi.mock('../../shared/dynamodb.js', () => ({
  updateJobStatus: mockUpdateJobStatus,
  getRecordsByJobId: mockGetRecordsByJobId,
  putVerificationRecords: mockPutVerificationRecords,
}));

const mockSearch = vi.fn();
vi.mock('../scraper-provider.js', () => ({
  createScraperProvider: () => ({ search: mockSearch }),
}));

const mockSendMessage = vi.fn();
vi.mock('../../shared/sqs.js', () => ({
  sendMessage: mockSendMessage,
}));

const VALID_MESSAGE: VerificationJobMessage = {
  jobId: 'job-001',
  companyName: 'Mayo Health System',
  normalizedName: 'mayo health system',
  jurisdiction: 'us_mn',
  scope: 'internal',
  enqueuedAt: '2026-03-22T10:00:00Z',
};

const FAKE_COMPANIES: RawCompanyRecord[] = [
  {
    companyNumber: '0f23674b',
    name: 'MAYO HEALTH SYSTEM',
    jurisdiction: 'us_mn',
    status: 'active',
    incorporationDate: '1905-12-13',
    address: '211 S Newton, Albert Lea, MN, 56007',
    openCorporatesUrl: 'https://opencorporates.com/companies/us_mn/0f23674b',
    rawApiSnapshot: { classes: ['active'], rawHtml: '<li>...</li>' },
  },
];

const FAKE_CACHED_RECORDS: VerificationRecord[] = [
  {
    pk: 'JOB#job-original',
    sk: 'RESULT#0f23674b',
    jobId: 'job-original',
    companyNumber: '0f23674b',
    companyName: 'MAYO HEALTH SYSTEM',
    normalizedName: 'mayo health system',
    jurisdiction: 'us_mn',
    registrationNumber: '0f23674b',
    incorporationDate: '1905-12-13',
    legalStatus: 'Active',
    standardizedAddress: '211 S Newton, Albert Lea, MN 56007',
    providerType: 'Health System',
    riskLevel: 'LOW',
    riskFlags: [],
    aiSummary: 'Entity is actively registered in Minnesota.',
    confidence: 'HIGH',
    cachedResult: false,
    cachedFromJobId: null,
    originalValidatedAt: null,
    rawSourceData: { classes: ['active'] },
    jobStatus: 'completed',
    createdAt: '2026-03-22T08:00:00Z',
    validatedAt: '2026-03-22T08:00:00Z',
    ttl: 9999999999,
    scope: 'internal',
  },
];

describe('handleScraperMessage', () => {
  let handleScraperMessage: (body: unknown) => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../handler.js');
    handleScraperMessage = mod.handleScraperMessage;
  });

  it('rejects invalid message with ZodError', async () => {
    await expect(handleScraperMessage({ invalid: true })).rejects.toThrow();
  });

  it('updates job status to processing on start', async () => {
    mockGetCachedJobId.mockResolvedValue(null);
    mockSearch.mockResolvedValue(FAKE_COMPANIES);

    await handleScraperMessage(VALID_MESSAGE);

    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      VALID_MESSAGE.jobId,
      'processing',
    );
  });

  describe('cache hit (query→jobId)', () => {
    beforeEach(() => {
      mockGetCachedJobId.mockResolvedValue({ jobId: 'job-original', createdAt: '2026-03-22T08:00:00Z' });
      mockGetRecordsByJobId.mockResolvedValue(FAKE_CACHED_RECORDS);
    });

    it('skips scraping when cache hit', async () => {
      await handleScraperMessage(VALID_MESSAGE);
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('does not send message to validation queue', async () => {
      await handleScraperMessage(VALID_MESSAGE);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('copies records from original job with cachedResult: true', async () => {
      await handleScraperMessage(VALID_MESSAGE);

      expect(mockPutVerificationRecords).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            pk: 'JOB#job-001',
            jobId: 'job-001',
            cachedResult: true,
            cachedFromJobId: 'job-original',
            originalValidatedAt: '2026-03-22T08:00:00Z',
          }),
        ]),
      );
    });

    it('updates job status to completed', async () => {
      await handleScraperMessage(VALID_MESSAGE);
      expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-001', 'completed');
    });
  });

  describe('cache miss', () => {
    beforeEach(() => {
      mockGetCachedJobId.mockResolvedValue(null);
      mockSearch.mockResolvedValue(FAKE_COMPANIES);
    });

    it('calls provider.search with name and jurisdiction', async () => {
      await handleScraperMessage(VALID_MESSAGE);

      expect(mockSearch).toHaveBeenCalledWith(
        'mayo health system',
        'us_mn',
      );
    });

    it('publishes ScraperResultMessage to validation queue', async () => {
      await handleScraperMessage(VALID_MESSAGE);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          jobId: 'job-001',
          cachedResult: false,
          companies: FAKE_COMPANIES,
        }),
        expect.any(String),
      );
    });

    it('publishes ScraperResultMessage with correct shape', async () => {
      await handleScraperMessage(VALID_MESSAGE);

      const published = mockSendMessage.mock.calls[0][1];
      expect(published).toHaveProperty('jobId', 'job-001');
      expect(published).toHaveProperty('normalizedName', 'mayo health system');
      expect(published).toHaveProperty('scope', 'internal');
      expect(published).toHaveProperty('scrapedAt');
      expect(published.companies).toEqual(FAKE_COMPANIES);
    });
  });

  describe('empty results', () => {
    it('publishes empty companies array when provider returns none', async () => {
      mockGetCachedJobId.mockResolvedValue(null);
      mockSearch.mockResolvedValue([]);

      await handleScraperMessage(VALID_MESSAGE);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          companies: [],
          cachedResult: false,
        }),
        expect.any(String),
      );
    });
  });

  describe('redis unavailable', () => {
    it('degrades gracefully when cache read fails', async () => {
      mockGetCachedJobId.mockRejectedValue(new Error('Redis connection refused'));
      mockSearch.mockResolvedValue(FAKE_COMPANIES);

      await handleScraperMessage(VALID_MESSAGE);

      expect(mockSearch).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalled();
    });
  });

  describe('scrape failure', () => {
    it('updates job status to failed on unrecoverable error', async () => {
      mockGetCachedJobId.mockResolvedValue(null);
      mockSearch.mockRejectedValue(new Error('CAPTCHA persists'));

      await handleScraperMessage(VALID_MESSAGE);

      expect(mockUpdateJobStatus).toHaveBeenCalledWith(
        VALID_MESSAGE.jobId,
        'failed',
        expect.stringContaining('CAPTCHA'),
      );
    });
  });

  describe('message without jurisdiction', () => {
    it('passes undefined jurisdiction to provider', async () => {
      const noJurisdiction = { ...VALID_MESSAGE, jurisdiction: undefined };
      mockGetCachedJobId.mockResolvedValue(null);
      mockSearch.mockResolvedValue(FAKE_COMPANIES);

      await handleScraperMessage(noJurisdiction);

      expect(mockSearch).toHaveBeenCalledWith(
        'mayo health system',
        undefined,
      );
    });
  });
});