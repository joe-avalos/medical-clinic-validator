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
  PutCommand: class {
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
    pipelinePath: 'scrape→validate→store',
    validationOutcomes: { success: 2, fallback: 1, empty: 0 },
    errorMessage: null,
    durationMs: 4523,
  };

  it('calls DynamoDB PutCommand with correct pk/sk', async () => {
    await writeTelemetry(SAMPLE_TELEMETRY);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const putCmd = mockSend.mock.calls[0][0];
    expect(putCmd.input.Item.pk).toBe('JOB#job-001');
    expect(putCmd.input.Item.sk).toBe('TELEMETRY');
  });

  it('sets TTL to 30 days from now', async () => {
    await writeTelemetry(SAMPLE_TELEMETRY);

    const putCmd = mockSend.mock.calls[0][0];
    const now = Math.floor(Date.now() / 1000);
    const thirtyDays = 30 * 24 * 60 * 60;
    expect(putCmd.input.Item.ttl).toBeGreaterThanOrEqual(now + thirtyDays - 5);
    expect(putCmd.input.Item.ttl).toBeLessThanOrEqual(now + thirtyDays + 5);
  });

  it('includes all telemetry fields', async () => {
    await writeTelemetry(SAMPLE_TELEMETRY);

    const item = mockSend.mock.calls[0][0].input.Item;
    expect(item.jobId).toBe('job-001');
    expect(item.scraperProvider).toBe('opencorporates');
    expect(item.aiProvider).toBe('anthropic');
    expect(item.cacheHit).toBe(false);
    expect(item.companiesFound).toBe(3);
    expect(item.pipelinePath).toBe('scrape→validate→store');
    expect(item.validationOutcomes).toEqual({ success: 2, fallback: 1, empty: 0 });
    expect(item.durationMs).toBe(4523);
    expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does not throw when DynamoDB write fails', async () => {
    mockSend.mockRejectedValue(new Error('DynamoDB throttled'));
    await expect(writeTelemetry(SAMPLE_TELEMETRY)).resolves.not.toThrow();
  });
});
