import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { RawCompanyRecord, ValidationResult } from '@medical-validator/shared';

vi.mock('../../shared/logger.js', () => {
  const noop = vi.fn();
  const childLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => childLogger };
  return { createLogger: () => childLogger };
});

const TEST_DIR = join(process.cwd(), '.test-training-data');

const SAMPLE_INPUT: RawCompanyRecord = {
  companyNumber: '0f23674b',
  name: 'MAYO HEALTH SYSTEM',
  jurisdiction: 'us_mn',
  status: 'active',
  incorporationDate: '1905-12-13',
  address: '211 S Newton, Albert Lea, MN, 56007',
  openCorporatesUrl: 'https://opencorporates.com/companies/us_mn/0f23674b',
  rawApiSnapshot: { classes: ['active'] },
};

const SAMPLE_OUTPUT: ValidationResult = {
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

describe('TrainingCollector', () => {
  beforeEach(() => {
    process.env.TRAINING_DATA_DIR = TEST_DIR;
    process.env.TRAINING_CAPTURE_ENABLED = 'true';
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    vi.resetModules();
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    delete process.env.TRAINING_DATA_DIR;
    delete process.env.TRAINING_CAPTURE_ENABLED;
  });

  it('captures a training example to JSONL file', async () => {
    const { captureTrainingExample } = await import('../training-collector.js');
    captureTrainingExample(SAMPLE_INPUT, SAMPLE_OUTPUT, 'anthropic', 'claude-haiku-4-5-20251001');

    const filePath = join(TEST_DIR, 'captures.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8').trim();
    const parsed = JSON.parse(content);
    expect(parsed.input.name).toBe('MAYO HEALTH SYSTEM');
    expect(parsed.output.riskLevel).toBe('LOW');
    expect(parsed.provider).toBe('anthropic');
    expect(parsed.model).toBe('claude-haiku-4-5-20251001');
    expect(parsed.timestamp).toBeDefined();
  });

  it('appends multiple examples', async () => {
    const { captureTrainingExample } = await import('../training-collector.js');
    captureTrainingExample(SAMPLE_INPUT, SAMPLE_OUTPUT, 'anthropic', 'claude-haiku-4-5-20251001');
    captureTrainingExample(SAMPLE_INPUT, { ...SAMPLE_OUTPUT, riskLevel: 'HIGH' }, 'anthropic', 'claude-haiku-4-5-20251001');

    const filePath = join(TEST_DIR, 'captures.jsonl');
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    expect(first.output.riskLevel).toBe('LOW');
    expect(second.output.riskLevel).toBe('HIGH');
  });

  it('skips fallback results', async () => {
    const { captureTrainingExample } = await import('../training-collector.js');
    const fallbackOutput = {
      ...SAMPLE_OUTPUT,
      riskLevel: 'UNKNOWN' as const,
      riskFlags: ['AI validation unavailable'],
    };
    captureTrainingExample(SAMPLE_INPUT, fallbackOutput, 'anthropic', 'claude-haiku-4-5-20251001');

    const filePath = join(TEST_DIR, 'captures.jsonl');
    expect(existsSync(filePath)).toBe(false);
  });

  it('does nothing when TRAINING_CAPTURE_ENABLED=false', async () => {
    process.env.TRAINING_CAPTURE_ENABLED = 'false';
    vi.resetModules();

    const { captureTrainingExample } = await import('../training-collector.js');
    captureTrainingExample(SAMPLE_INPUT, SAMPLE_OUTPUT, 'anthropic', 'claude-haiku-4-5-20251001');

    const filePath = join(TEST_DIR, 'captures.jsonl');
    expect(existsSync(filePath)).toBe(false);
  });

  it('returns stats for captured data', async () => {
    const { captureTrainingExample, getTrainingStats } = await import('../training-collector.js');
    captureTrainingExample(SAMPLE_INPUT, SAMPLE_OUTPUT, 'anthropic', 'claude-haiku-4-5-20251001');

    const stats = getTrainingStats();
    expect(stats.totalFiles).toBe(1);
    expect(stats.totalExamples).toBeGreaterThanOrEqual(1);
  });
});
