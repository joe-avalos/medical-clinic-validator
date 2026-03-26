import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawCompanyRecord, ValidationResult } from '@medical-validator/shared';

vi.mock('../../shared/logger.js', () => {
  const noop = vi.fn();
  const childLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => childLogger };
  return { createLogger: () => childLogger };
});

vi.mock('../training-collector.js', () => ({
  captureTrainingExample: vi.fn(),
}));

const SAMPLE_COMPANIES: RawCompanyRecord[] = [
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

const VALID_AI_RESPONSE: ValidationResult = {
  companyName: 'MAYO HEALTH SYSTEM',
  jurisdiction: 'us_mn',
  registrationNumber: '0f23674b',
  incorporationDate: '1905-12-13',
  legalStatus: 'Active',
  standardizedAddress: '211 S Newton, Albert Lea, MN, 56007',
  providerType: 'Health System',
  riskLevel: 'LOW',
  riskFlags: [],
  aiSummary: 'Entity is actively registered in Minnesota with no anomalies detected.',
  confidence: 'HIGH',
};

describe('QwenProvider', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns validated result on successful API call', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(VALID_AI_RESPONSE) } }],
      }),
    });

    const { QwenProvider } = await import('../qwen-provider.js');
    const provider = new QwenProvider();
    const results = await provider.validateAll(SAMPLE_COMPANIES);

    expect(results).toHaveLength(1);
    expect(results[0].companyName).toBe('MAYO HEALTH SYSTEM');
    expect(results[0].riskLevel).toBe('LOW');
  });

  it('sends correct payload to Ollama OpenAI-compatible endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(VALID_AI_RESPONSE) } }],
      }),
    });

    const { QwenProvider } = await import('../qwen-provider.js');
    const provider = new QwenProvider();
    await provider.validateAll(SAMPLE_COMPANIES);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/chat/completions'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('medical-validator'),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.temperature).toBe(0);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
  });

  it('returns fallback on API error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const { QwenProvider } = await import('../qwen-provider.js');
    const provider = new QwenProvider();
    const results = await provider.validateAll(SAMPLE_COMPANIES);

    expect(results).toHaveLength(1);
    expect(results[0].riskLevel).toBe('UNKNOWN');
    expect(results[0].confidence).toBe('LOW');
  });

  it('returns fallback on malformed JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'not json at all' } }],
      }),
    });

    const { QwenProvider } = await import('../qwen-provider.js');
    const provider = new QwenProvider();
    const results = await provider.validateAll(SAMPLE_COMPANIES);

    expect(results).toHaveLength(1);
    expect(results[0].riskLevel).toBe('UNKNOWN');
  });

  it('handles markdown-wrapped JSON from model', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```json\n' + JSON.stringify(VALID_AI_RESPONSE) + '\n```' } }],
      }),
    });

    const { QwenProvider } = await import('../qwen-provider.js');
    const provider = new QwenProvider();
    const results = await provider.validateAll(SAMPLE_COMPANIES);

    expect(results).toHaveLength(1);
    expect(results[0].riskLevel).toBe('LOW');
  });
});
