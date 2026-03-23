import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawCompanyRecord, ValidationResult } from '@medical-validator/shared';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
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

describe('createAIProvider', () => {
  const originalEnv = process.env.AI_PROVIDER;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AI_PROVIDER = originalEnv;
    } else {
      delete process.env.AI_PROVIDER;
    }
    vi.resetModules();
  });

  it('defaults to anthropic provider', async () => {
    delete process.env.AI_PROVIDER;
    const { createAIProvider } = await import('../ai-provider.js');
    const provider = createAIProvider();
    expect(provider).toBeDefined();
    expect(provider.validateAll).toBeTypeOf('function');
  });

  it('creates anthropic provider when AI_PROVIDER=anthropic', async () => {
    process.env.AI_PROVIDER = 'anthropic';
    const { createAIProvider } = await import('../ai-provider.js');
    const provider = createAIProvider();
    expect(provider).toBeDefined();
  });

  it('creates ollama provider when AI_PROVIDER=ollama', async () => {
    process.env.AI_PROVIDER = 'ollama';
    const { createAIProvider } = await import('../ai-provider.js');
    const provider = createAIProvider();
    expect(provider).toBeDefined();
  });

  it('throws on unknown provider type', async () => {
    process.env.AI_PROVIDER = 'gpt-4';
    const { createAIProvider } = await import('../ai-provider.js');
    expect(() => createAIProvider()).toThrow();
  });
});

describe('AnthropicProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreate.mockReset();
  });

  it('returns array of ValidationResults on successful API call', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(VALID_AI_RESPONSE) }],
    });

    const { AnthropicProvider } = await import('../anthropic-provider.js');
    const provider = new AnthropicProvider();
    const results = await provider.validateAll(SAMPLE_COMPANIES);

    expect(results).toHaveLength(1);
    expect(results[0].companyName).toBe('MAYO HEALTH SYSTEM');
    expect(results[0].riskLevel).toBe('LOW');
    expect(results[0].confidence).toBe('HIGH');
  });

  it('passes system and user prompts to Claude', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(VALID_AI_RESPONSE) }],
    });

    const { AnthropicProvider } = await import('../anthropic-provider.js');
    const provider = new AnthropicProvider();
    await provider.validateAll(SAMPLE_COMPANIES);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('healthcare'),
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('MAYO HEALTH SYSTEM'),
          }),
        ]),
      }),
    );
  });

  it('validates response with Zod and returns fallback for invalid shape', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ invalid: true }) }],
    });

    const { AnthropicProvider } = await import('../anthropic-provider.js');
    const provider = new AnthropicProvider();
    const results = await provider.validateAll(SAMPLE_COMPANIES);

    expect(results).toHaveLength(1);
    expect(results[0].riskLevel).toBe('UNKNOWN');
    expect(results[0].confidence).toBe('LOW');
  });

  it('returns fallback on malformed JSON response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'This is not JSON at all' }],
    });

    const { AnthropicProvider } = await import('../anthropic-provider.js');
    const provider = new AnthropicProvider();
    const results = await provider.validateAll(SAMPLE_COMPANIES);

    expect(results).toHaveLength(1);
    expect(results[0].riskLevel).toBe('UNKNOWN');
    expect(results[0].aiSummary).toContain('unavailable');
    expect(results[0].confidence).toBe('LOW');
  });

  it('returns fallback when API throws', async () => {
    mockCreate.mockRejectedValue(new Error('API overloaded'));

    const { AnthropicProvider } = await import('../anthropic-provider.js');
    const provider = new AnthropicProvider();
    const results = await provider.validateAll(SAMPLE_COMPANIES);

    expect(results).toHaveLength(1);
    expect(results[0].riskLevel).toBe('UNKNOWN');
    expect(results[0].confidence).toBe('LOW');
  });
});
