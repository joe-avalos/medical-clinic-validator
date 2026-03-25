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

const mockQueryTelemetry = vi.fn();
vi.mock('../../clients/dynamodb.js', () => ({
  createJob: vi.fn(),
  getJobStatus: vi.fn(),
  getVerificationResults: vi.fn(),
  queryRecords: vi.fn().mockResolvedValue({ records: [], total: 0 }),
  queryTelemetry: mockQueryTelemetry,
}));

vi.mock('../../clients/sqs.js', () => ({
  sendToVerificationQueue: vi.fn(),
}));

vi.mock('../../clients/redis.js', () => ({
  getCachedJobId: vi.fn(),
  deleteCachedJobId: vi.fn(),
}));

const SAMPLE_TELEMETRY = {
  pk: 'JOB#job-001',
  sk: 'TELEMETRY',
  jobId: 'job-001',
  companyName: 'MAYO HEALTH SYSTEM',
  normalizedName: 'mayo health system',
  scraperProvider: 'opencorporates',
  aiProvider: 'anthropic',
  cacheHit: false,
  companiesFound: 3,
  pipelinePath: 'scrape→validate→store',
  validationOutcomes: { success: 3, fallback: 0, empty: 0 },
  errorMessage: null,
  durationMs: 4523,
  createdAt: '2026-03-24T22:00:00Z',
  ttl: 9999999999,
};

describe('GET /telemetry', () => {
  let app: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    const mod = await import('../../app.js');
    app = mod.app;
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/telemetry');
    expect(res.status).toBe(401);
  });

  it('returns telemetry records for authenticated user', async () => {
    mockQueryTelemetry.mockResolvedValue({ records: [SAMPLE_TELEMETRY], total: 1 });

    const token = createToken({ scope: 'internal' });
    const res = await request(app)
      .get('/telemetry')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].pipelinePath).toBe('scrape→validate→store');
    expect(res.body.total).toBe(1);
  });

  it('passes pipelinePath filter to query', async () => {
    mockQueryTelemetry.mockResolvedValue({ records: [], total: 0 });

    const token = createToken();
    await request(app)
      .get('/telemetry?pipelinePath=scrape→empty→store')
      .set('Authorization', `Bearer ${token}`);

    expect(mockQueryTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ pipelinePath: 'scrape→empty→store' }),
    );
  });

  it('returns 400 for invalid pipelinePath', async () => {
    const token = createToken();
    const res = await request(app)
      .get('/telemetry?pipelinePath=invalid')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('defaults limit to 50', async () => {
    mockQueryTelemetry.mockResolvedValue({ records: [], total: 0 });

    const token = createToken();
    await request(app)
      .get('/telemetry')
      .set('Authorization', `Bearer ${token}`);

    expect(mockQueryTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('passes custom limit', async () => {
    mockQueryTelemetry.mockResolvedValue({ records: [], total: 0 });

    const token = createToken();
    await request(app)
      .get('/telemetry?limit=10')
      .set('Authorization', `Bearer ${token}`);

    expect(mockQueryTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });

  it('returns 400 for non-numeric limit', async () => {
    const token = createToken();
    const res = await request(app)
      .get('/telemetry?limit=abc')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns nextCursor when more records exist', async () => {
    mockQueryTelemetry.mockResolvedValue({
      records: [SAMPLE_TELEMETRY],
      total: 100,
      nextCursor: 'cursor-xyz',
    });

    const token = createToken();
    const res = await request(app)
      .get('/telemetry')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.nextCursor).toBe('cursor-xyz');
  });

  it('passes cursor to query', async () => {
    mockQueryTelemetry.mockResolvedValue({ records: [], total: 0 });

    const token = createToken();
    await request(app)
      .get('/telemetry?cursor=abc123')
      .set('Authorization', `Bearer ${token}`);

    expect(mockQueryTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'abc123' }),
    );
  });
});
