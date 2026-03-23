import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawCompanyRecord, VerificationJobMessage } from '@medical-validator/shared';

// Mock dependencies before importing handler
const mockGetCached = vi.fn();
const mockSetCached = vi.fn();
vi.mock('../../shared/redis.js', () => ({
  getCachedScraperResult: mockGetCached,
  setCachedScraperResult: mockSetCached,
}));

const mockUpdateJobStatus = vi.fn();
vi.mock('../../shared/dynamodb.js', () => ({
  updateJobStatus: mockUpdateJobStatus,
}));

const mockScrapeOpenCorporates = vi.fn();
vi.mock('../opencorporates.js', () => ({
  scrapeOpenCorporates: mockScrapeOpenCorporates,
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

describe('handleScraperMessage', () => {
  let handleScraperMessage: (body: unknown) => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import to pick up mocks
    const mod = await import('../handler.js');
    handleScraperMessage = mod.handleScraperMessage;
  });

  it('rejects invalid message with ZodError', async () => {
    await expect(handleScraperMessage({ invalid: true })).rejects.toThrow();
  });

  it('updates job status to processing on start', async () => {
    mockGetCached.mockResolvedValue(null);
    mockScrapeOpenCorporates.mockResolvedValue(FAKE_COMPANIES);

    await handleScraperMessage(VALID_MESSAGE);

    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      VALID_MESSAGE.jobId,
      'processing',
    );
  });

  describe('cache hit', () => {
    beforeEach(() => {
      mockGetCached.mockResolvedValue(FAKE_COMPANIES);
    });

    it('skips scraping when cache hit', async () => {
      await handleScraperMessage(VALID_MESSAGE);
      expect(mockScrapeOpenCorporates).not.toHaveBeenCalled();
    });

    it('publishes result with cachedResult: true', async () => {
      await handleScraperMessage(VALID_MESSAGE);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          jobId: 'job-001',
          cachedResult: true,
          companies: FAKE_COMPANIES,
        }),
        expect.any(String),
      );
    });

    it('does not write back to cache on hit', async () => {
      await handleScraperMessage(VALID_MESSAGE);
      expect(mockSetCached).not.toHaveBeenCalled();
    });
  });

  describe('cache miss', () => {
    beforeEach(() => {
      mockGetCached.mockResolvedValue(null);
      mockScrapeOpenCorporates.mockResolvedValue(FAKE_COMPANIES);
    });

    it('calls scrapeOpenCorporates with name and jurisdiction', async () => {
      await handleScraperMessage(VALID_MESSAGE);

      expect(mockScrapeOpenCorporates).toHaveBeenCalledWith(
        'mayo health system',
        'us_mn',
      );
    });

    it('writes scrape result to cache', async () => {
      await handleScraperMessage(VALID_MESSAGE);

      expect(mockSetCached).toHaveBeenCalledWith(
        'mayo health system',
        FAKE_COMPANIES,
      );
    });

    it('publishes result with cachedResult: false', async () => {
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
    it('publishes empty companies array when scraper returns none', async () => {
      mockGetCached.mockResolvedValue(null);
      mockScrapeOpenCorporates.mockResolvedValue([]);

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
      mockGetCached.mockRejectedValue(new Error('Redis connection refused'));
      mockScrapeOpenCorporates.mockResolvedValue(FAKE_COMPANIES);

      await handleScraperMessage(VALID_MESSAGE);

      expect(mockScrapeOpenCorporates).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalled();
    });

    it('degrades gracefully when cache write fails', async () => {
      mockGetCached.mockResolvedValue(null);
      mockScrapeOpenCorporates.mockResolvedValue(FAKE_COMPANIES);
      mockSetCached.mockRejectedValue(new Error('Redis connection refused'));

      await handleScraperMessage(VALID_MESSAGE);

      expect(mockSendMessage).toHaveBeenCalled();
    });
  });

  describe('scrape failure', () => {
    it('updates job status to failed on unrecoverable error', async () => {
      mockGetCached.mockResolvedValue(null);
      mockScrapeOpenCorporates.mockRejectedValue(new Error('CAPTCHA persists'));

      await expect(handleScraperMessage(VALID_MESSAGE)).rejects.toThrow();

      expect(mockUpdateJobStatus).toHaveBeenCalledWith(
        VALID_MESSAGE.jobId,
        'failed',
        expect.stringContaining('CAPTCHA'),
      );
    });
  });

  describe('message without jurisdiction', () => {
    it('passes undefined jurisdiction to scraper', async () => {
      const noJurisdiction = { ...VALID_MESSAGE, jurisdiction: undefined };
      mockGetCached.mockResolvedValue(null);
      mockScrapeOpenCorporates.mockResolvedValue(FAKE_COMPANIES);

      await handleScraperMessage(noJurisdiction);

      expect(mockScrapeOpenCorporates).toHaveBeenCalledWith(
        'mayo health system',
        undefined,
      );
    });
  });
});
