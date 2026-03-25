import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../logger.js', () => {
  const noop = vi.fn();
  const childLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => childLogger };
  return { createLogger: () => childLogger };
});

// Mock DynamoDB
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class { constructor() {} },
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  UpdateCommand: class {
    constructor(public input: unknown) {}
  },
}));

describe('writeTelemetry', () => {
  let writeTelemetry: typeof import('../telemetry.js')['writeTelemetry'];

  beforeEach(async () => {
    vi.resetModules();
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    const mod = await import('../telemetry.js');
    writeTelemetry = mod.writeTelemetry;
  });

  const SAMPLE_TELEMETRY = {
    jobId: 'job-001',
    companyName: 'MAYO HEALTH SYSTEM',
    normalizedName: 'mayo health system',
    scraperProvider: 'opencorporates',
    aiProvider: 'anthropic',
    cacheHit: false,
    companiesFound: 3,
    scrapeAttempts: 2,
    scrapeErrors: ['STALE_COOKIES: CAPTCHA detected — refresh cookies by running: npm run cookie:refresh'],
    pipelinePath: 'scrape→validate→store',
    validationOutcomes: { success: 2, fallback: 1, empty: 0 },
    errorMessage: null,
    durationMs: 4523,
  };

  it('calls DynamoDB UpdateCommand with correct key', async () => {
    await writeTelemetry(SAMPLE_TELEMETRY);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.Key).toEqual({ pk: 'JOB#job-001', sk: 'TELEMETRY' });
  });

  it('sets all telemetry fields in ExpressionAttributeValues', async () => {
    await writeTelemetry(SAMPLE_TELEMETRY);

    const values = mockSend.mock.calls[0][0].input.ExpressionAttributeValues;
    expect(values[':sp']).toBe('opencorporates');
    expect(values[':ai']).toBe('anthropic');
    expect(values[':ch']).toBe(false);
    expect(values[':cf']).toBe(3);
    expect(values[':sa']).toBe(2);
    expect(values[':se']).toEqual(['STALE_COOKIES: CAPTCHA detected — refresh cookies by running: npm run cookie:refresh']);
    expect(values[':pp']).toBe('scrape→validate→store');
    expect(values[':vo']).toEqual({ success: 2, fallback: 1, empty: 0 });
    expect(values[':dur']).toBe(4523);
    expect(values[':now']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does not throw when DynamoDB write fails', async () => {
    mockSend.mockRejectedValue(new Error('DynamoDB throttled'));
    await expect(writeTelemetry(SAMPLE_TELEMETRY)).resolves.not.toThrow();
  });
});