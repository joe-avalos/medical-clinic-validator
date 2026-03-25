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

// Mock clients before importing app
const mockSendToVerificationQueue = vi.fn();
vi.mock('../../clients/sqs.js', () => ({
  sendToVerificationQueue: mockSendToVerificationQueue,
}));

const mockCreateJob = vi.fn();
const mockGetJobStatus = vi.fn();
const mockGetVerificationResults = vi.fn();
vi.mock('../../clients/dynamodb.js', () => ({
  createJob: mockCreateJob,
  getJobStatus: mockGetJobStatus,
  getVerificationResults: mockGetVerificationResults,
  queryTelemetry: vi.fn().mockResolvedValue({ records: [], total: 0 }),
}));

const mockGetCachedJobId = vi.fn();
const mockDeleteCachedJobId = vi.fn();
vi.mock('../../clients/redis.js', () => ({
  getCachedJobId: mockGetCachedJobId,
  deleteCachedJobId: mockDeleteCachedJobId,
}));

describe('POST /verify', () => {
  let app: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockSendToVerificationQueue.mockResolvedValue(undefined);
    mockCreateJob.mockResolvedValue(undefined);
    mockGetCachedJobId.mockResolvedValue(null);
    mockDeleteCachedJobId.mockResolvedValue(undefined);
    const mod = await import('../../app.js');
    app = mod.app;
  });

  // ── Auth ──────────────────────────────────────────────────────────

  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/verify')
      .send({ companyName: 'Mayo Health System' });
    expect(res.status).toBe(401);
  });

  // ── Validation ────────────────────────────────────────────────────

  it('returns 400 when companyName is empty string', async () => {
    const token = createToken();
    const res = await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when companyName is missing', async () => {
    const token = createToken();
    const res = await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when companyName is too short', async () => {
    const token = createToken();
    const res = await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: 'A' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when companyName exceeds 200 chars', async () => {
    const token = createToken();
    const res = await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: 'A'.repeat(201) });
    expect(res.status).toBe(400);
  });

  // ── Success ───────────────────────────────────────────────────────

  it('returns 202 with jobId, status, and pollUrl', async () => {
    const token = createToken();
    const res = await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: 'Mayo Health System' });

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
    expect(res.body.status).toBe('queued');
    expect(res.body.pollUrl).toMatch(/^\/verify\/.*\/status$/);
  });

  it('creates job record in DynamoDB', async () => {
    const token = createToken();
    await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: 'Mayo Health System' });

    expect(mockCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Mayo Health System',
        status: 'queued',
      }),
    );
  });

  it('enqueues SQS message with correct shape', async () => {
    const token = createToken({ scope: 'internal' });
    await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: 'Mayo Health System', jurisdiction: 'us_mn' });

    expect(mockSendToVerificationQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Mayo Health System',
        normalizedName: 'mayo health system',
        jurisdiction: 'us_mn',
        scope: 'internal',
      }),
    );
  });

  it('normalizes company name to lowercase trimmed', async () => {
    const token = createToken();
    await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: '  Mayo Health System  ' });

    expect(mockSendToVerificationQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedName: 'mayo health system',
      }),
    );
  });

  it('strips punctuation during normalization', async () => {
    const token = createToken();
    await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: "St. Luke's Hospital, Inc." });

    expect(mockSendToVerificationQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedName: 'st lukes hospital inc',
      }),
    );
  });

  it('preserves hyphens during normalization', async () => {
    const token = createToken();
    await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: "Mayo-Clinic Health System" });

    expect(mockSendToVerificationQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedName: 'mayo-clinic health system',
      }),
    );
  });

  it('passes scope from JWT claims to SQS message', async () => {
    const token = createToken({ scope: 'external' });
    await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: 'Mayo Health System' });

    expect(mockSendToVerificationQueue).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'external' }),
    );
  });

  it('accepts request without jurisdiction', async () => {
    const token = createToken();
    const res = await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: 'Mayo Health System' });

    expect(res.status).toBe(202);
  });

  // ── Error handling ────────────────────────────────────────────────

  it('returns 500 when SQS send fails', async () => {
    mockSendToVerificationQueue.mockRejectedValue(new Error('SQS unavailable'));
    const token = createToken();
    const res = await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: 'Mayo Health System' });

    expect(res.status).toBe(500);
  });

  it('returns 500 when DynamoDB createJob fails', async () => {
    mockCreateJob.mockRejectedValue(new Error('DynamoDB throttled'));
    const token = createToken();
    const res = await request(app)
      .post('/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyName: 'Mayo Health System' });

    expect(res.status).toBe(500);
  });
});

describe('GET /verify/:id/status', () => {
  let app: any;

  beforeEach(async () => {
    vi.resetAllMocks();
    const mod = await import('../../app.js');
    app = mod.app;
  });

  // ── Auth ──────────────────────────────────────────────────────────

  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/verify/job-001/status');
    expect(res.status).toBe(401);
  });

  // ── Not found ─────────────────────────────────────────────────────

  it('returns 404 when job does not exist', async () => {
    mockGetJobStatus.mockResolvedValue(null);
    const token = createToken();
    const res = await request(app)
      .get('/verify/job-nonexistent/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  // ── Status responses ──────────────────────────────────────────────

  it('returns processing status', async () => {
    mockGetJobStatus.mockResolvedValue({
      jobId: 'job-001',
      status: 'processing',
      companyName: 'Mayo Health System',
      createdAt: '2026-03-22T10:00:00Z',
      updatedAt: '2026-03-22T10:00:02Z',
    });

    const token = createToken();
    const res = await request(app)
      .get('/verify/job-001/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe('job-001');
    expect(res.body.status).toBe('processing');
  });

  it('returns queued status', async () => {
    mockGetJobStatus.mockResolvedValue({
      jobId: 'job-001',
      status: 'queued',
      companyName: 'Mayo Health System',
      createdAt: '2026-03-22T10:00:00Z',
      updatedAt: '2026-03-22T10:00:00Z',
    });

    const token = createToken();
    const res = await request(app)
      .get('/verify/job-001/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe('job-001');
    expect(res.body.status).toBe('queued');
  });

  it('returns completed status with results array', async () => {
    mockGetJobStatus.mockResolvedValue({
      jobId: 'job-001',
      status: 'completed',
      companyName: 'Mayo Health System',
      createdAt: '2026-03-22T10:00:00Z',
      updatedAt: '2026-03-22T10:00:05Z',
    });

    mockGetVerificationResults.mockResolvedValue([{
      companyName: 'MAYO HEALTH SYSTEM',
      riskLevel: 'LOW',
      aiSummary: 'Entity is actively registered.',
    }]);

    const token = createToken();
    const res = await request(app)
      .get('/verify/job-001/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.results).toBeDefined();
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].riskLevel).toBe('LOW');
  });

  it('returns failed status with errorMessage', async () => {
    mockGetJobStatus.mockResolvedValue({
      jobId: 'job-001',
      status: 'failed',
      companyName: 'Mayo Health System',
      createdAt: '2026-03-22T10:00:00Z',
      updatedAt: '2026-03-22T10:00:05Z',
      errorMessage: 'OpenCorporates rate limit exceeded',
    });

    const token = createToken();
    const res = await request(app)
      .get('/verify/job-001/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    expect(res.body.errorMessage).toContain('rate limit');
  });
});