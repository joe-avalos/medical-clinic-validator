import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createToken, JWT_SECRET } from '../../test-utils/fixtures.js';

// Mock logger
vi.mock('../../shared/logger.js', () => {
  const noop = vi.fn();
  const childLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => childLogger };
  return { createLogger: () => childLogger };
});

process.env.JWT_SECRET = JWT_SECRET;

const mockQueryRecords = vi.fn();
vi.mock('../../clients/dynamodb.js', () => ({
  createJob: vi.fn(),
  getJobStatus: vi.fn(),
  getVerificationResults: vi.fn(),
  queryRecords: mockQueryRecords,
  queryTelemetry: vi.fn().mockResolvedValue({ records: [], total: 0 }),
}));

vi.mock('../../clients/sqs.js', () => ({
  sendToVerificationQueue: vi.fn(),
}));

const FULL_RECORD = {
  pk: 'JOB#job-001',
  sk: 'RESULT#0f23674b',
  jobId: 'job-001',
  companyNumber: '0f23674b',
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
  cachedFromJobId: null,
  originalValidatedAt: null,
  scope: 'internal',
  rawSourceData: { classes: ['active'] },
  jobStatus: 'completed' as const,
  createdAt: '2026-03-22T10:00:00Z',
  validatedAt: '2026-03-22T10:00:05Z',
  ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
};

describe('GET /records', () => {
  let app: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    const mod = await import('../../app.js');
    app = mod.app;
  });

  // ── Auth ──────────────────────────────────────────────────────────

  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/records');
    expect(res.status).toBe(401);
  });

  // ── Internal scope — full records ─────────────────────────────────

  it('returns full records for internal scope', async () => {
    mockQueryRecords.mockResolvedValue({ records: [FULL_RECORD], total: 1 });

    const token = createToken({ scope: 'internal' });
    const res = await request(app)
      .get('/records')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.records[0]).toHaveProperty('registrationNumber');
    expect(res.body.records[0]).toHaveProperty('incorporationDate');
    expect(res.body.records[0]).toHaveProperty('confidence');
    expect(res.body.records[0]).toHaveProperty('rawSourceData');
    expect(res.body.total).toBe(1);
  });

  // ── External scope — redacted records ─────────────────────────────

  it('redacts sensitive fields for external scope', async () => {
    mockQueryRecords.mockResolvedValue({ records: [FULL_RECORD], total: 1 });

    const token = createToken({ scope: 'external' });
    const res = await request(app)
      .get('/records')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const record = res.body.records[0];
    expect(record).not.toHaveProperty('registrationNumber');
    expect(record).not.toHaveProperty('incorporationDate');
    expect(record).not.toHaveProperty('confidence');
    expect(record).not.toHaveProperty('cachedResult');
    expect(record).not.toHaveProperty('jobId');
    expect(record).not.toHaveProperty('pk');
    expect(record).not.toHaveProperty('sk');
    expect(record).not.toHaveProperty('rawSourceData');
    // Should still have non-sensitive fields
    expect(record).toHaveProperty('companyName');
    expect(record).toHaveProperty('riskLevel');
    expect(record).toHaveProperty('aiSummary');
  });

  // ── Filtering ─────────────────────────────────────────────────────

  it('passes riskLevel filter to query', async () => {
    mockQueryRecords.mockResolvedValue({ records: [], total: 0 });

    const token = createToken();
    await request(app)
      .get('/records?riskLevel=HIGH')
      .set('Authorization', `Bearer ${token}`);

    expect(mockQueryRecords).toHaveBeenCalledWith(
      expect.objectContaining({ riskLevel: 'HIGH' }),
    );
  });

  it('passes limit to query', async () => {
    mockQueryRecords.mockResolvedValue({ records: [], total: 0 });

    const token = createToken();
    await request(app)
      .get('/records?limit=25')
      .set('Authorization', `Bearer ${token}`);

    expect(mockQueryRecords).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25 }),
    );
  });

  it('defaults limit to 50 when not specified', async () => {
    mockQueryRecords.mockResolvedValue({ records: [], total: 0 });

    const token = createToken();
    await request(app)
      .get('/records')
      .set('Authorization', `Bearer ${token}`);

    expect(mockQueryRecords).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('passes cursor to query', async () => {
    mockQueryRecords.mockResolvedValue({ records: [], total: 0 });

    const token = createToken();
    await request(app)
      .get('/records?cursor=abc123')
      .set('Authorization', `Bearer ${token}`);

    expect(mockQueryRecords).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'abc123' }),
    );
  });

  // ── Pagination ────────────────────────────────────────────────────

  it('returns nextCursor when more records exist', async () => {
    mockQueryRecords.mockResolvedValue({
      records: [FULL_RECORD],
      total: 100,
      nextCursor: 'cursor-token-xyz',
    });

    const token = createToken();
    const res = await request(app)
      .get('/records')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.nextCursor).toBe('cursor-token-xyz');
  });

  // ── Validation ────────────────────────────────────────────────────

  it('returns 400 for invalid riskLevel value', async () => {
    const token = createToken();
    const res = await request(app)
      .get('/records?riskLevel=INVALID')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric limit', async () => {
    const token = createToken();
    const res = await request(app)
      .get('/records?limit=abc')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});