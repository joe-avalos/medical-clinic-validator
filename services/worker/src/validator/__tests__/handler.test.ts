import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  RawCompanyRecord,
  ScraperResultMessage,
  ValidationResult,
} from '@medical-validator/shared';

// Mock dependencies
const mockValidateAll = vi.fn();
vi.mock('../ai-provider.js', () => ({
  createAIProvider: () => ({ validateAll: mockValidateAll }),
}));

const mockSendMessage = vi.fn();
vi.mock('../../shared/sqs.js', () => ({
  sendMessage: mockSendMessage,
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

const VALID_MESSAGE: ScraperResultMessage = {
  jobId: 'job-001',
  normalizedName: 'mayo health system',
  scope: 'internal',
  cachedResult: false,
  companies: FAKE_COMPANIES,
  scrapedAt: '2026-03-22T10:00:00Z',
};

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

describe('handleValidatorMessage', () => {
  let handleValidatorMessage: (body: unknown) => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../handler.js');
    handleValidatorMessage = mod.handleValidatorMessage;
  });

  it('rejects invalid message with ZodError', async () => {
    await expect(handleValidatorMessage({ invalid: true })).rejects.toThrow();
  });

  it('calls AI provider with companies', async () => {
    mockValidateAll.mockResolvedValue([VALID_RESULT]);
    await handleValidatorMessage(VALID_MESSAGE);

    expect(mockValidateAll).toHaveBeenCalledWith(FAKE_COMPANIES);
  });

  it('publishes ValidationResultMessage with validations array', async () => {
    mockValidateAll.mockResolvedValue([VALID_RESULT]);
    await handleValidatorMessage(VALID_MESSAGE);

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        jobId: 'job-001',
        normalizedName: 'mayo health system',
        scope: 'internal',
        cachedResult: false,
        validations: [VALID_RESULT],
        rawSourceData: FAKE_COMPANIES,
        validatedAt: expect.any(String),
      }),
      expect.any(String),
    );
  });

  describe('empty companies', () => {
    const emptyMessage: ScraperResultMessage = {
      ...VALID_MESSAGE,
      companies: [],
    };

    it('skips AI call when companies array is empty', async () => {
      await handleValidatorMessage(emptyMessage);
      expect(mockValidateAll).not.toHaveBeenCalled();
    });

    it('publishes UNKNOWN risk result for empty companies', async () => {
      await handleValidatorMessage(emptyMessage);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          validations: [
            expect.objectContaining({
              riskLevel: 'UNKNOWN',
              confidence: 'LOW',
              aiSummary: expect.stringContaining('No'),
            }),
          ],
        }),
        expect.any(String),
      );
    });
  });

  it('passes through rawSourceData unchanged', async () => {
    mockValidateAll.mockResolvedValue([VALID_RESULT]);
    await handleValidatorMessage(VALID_MESSAGE);

    const published = mockSendMessage.mock.calls[0][1];
    expect(published.rawSourceData).toEqual(FAKE_COMPANIES);
  });

  it('preserves scope from inbound message', async () => {
    const externalMsg = { ...VALID_MESSAGE, scope: 'external' as const };
    mockValidateAll.mockResolvedValue([VALID_RESULT]);
    await handleValidatorMessage(externalMsg);

    const published = mockSendMessage.mock.calls[0][1];
    expect(published.scope).toBe('external');
  });

  it('preserves cachedResult flag', async () => {
    const cachedMsg = { ...VALID_MESSAGE, cachedResult: true };
    mockValidateAll.mockResolvedValue([VALID_RESULT]);
    await handleValidatorMessage(cachedMsg);

    const published = mockSendMessage.mock.calls[0][1];
    expect(published.cachedResult).toBe(true);
  });
});