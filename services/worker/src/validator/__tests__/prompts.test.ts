import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserPrompt } from '../prompts.js';
import type { RawCompanyRecord } from '@medical-validator/shared';

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

describe('buildSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
  });

  it('mentions JSON response format', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('JSON');
  });

  it('mentions healthcare context', () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toContain('healthcare');
  });
});

describe('buildUserPrompt', () => {
  it('includes company data as JSON', () => {
    const prompt = buildUserPrompt(SAMPLE_COMPANIES);
    expect(prompt).toContain('MAYO HEALTH SYSTEM');
    expect(prompt).toContain('0f23674b');
    expect(prompt).toContain('us_mn');
  });

  it('includes risk level rules', () => {
    const prompt = buildUserPrompt(SAMPLE_COMPANIES);
    expect(prompt).toContain('LOW');
    expect(prompt).toContain('MEDIUM');
    expect(prompt).toContain('HIGH');
    expect(prompt).toContain('UNKNOWN');
  });

  it('includes expected response shape fields', () => {
    const prompt = buildUserPrompt(SAMPLE_COMPANIES);
    expect(prompt).toContain('companyName');
    expect(prompt).toContain('riskLevel');
    expect(prompt).toContain('riskFlags');
    expect(prompt).toContain('aiSummary');
    expect(prompt).toContain('confidence');
    expect(prompt).toContain('standardizedAddress');
    expect(prompt).toContain('providerType');
  });

  it('handles empty companies array', () => {
    const prompt = buildUserPrompt([]);
    expect(prompt).toContain('[]');
  });

  it('handles multiple companies', () => {
    const multi: RawCompanyRecord[] = [
      ...SAMPLE_COMPANIES,
      {
        companyNumber: 'xyz-7890',
        name: 'MAYO CLINIC JACKSONVILLE',
        jurisdiction: 'us_fl',
        status: 'active',
        openCorporatesUrl: 'https://opencorporates.com/companies/us_fl/xyz-7890',
        rawApiSnapshot: {},
      },
    ];
    const prompt = buildUserPrompt(multi);
    expect(prompt).toContain('MAYO HEALTH SYSTEM');
    expect(prompt).toContain('MAYO CLINIC JACKSONVILLE');
  });
});
