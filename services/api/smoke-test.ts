import jwt from 'jsonwebtoken';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { app } from './src/app.js';
import type { Server } from 'node:http';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const JWT_SECRET = 'smoke-test-secret';
const DYNAMODB_ENDPOINT = 'http://localhost:4566';

// --- DynamoDB direct client for seeding ---
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ endpoint: DYNAMODB_ENDPOINT, region: 'us-east-1' }),
);

const SEED_JOB_ID = 'smoke-seed-job-001';
const SEED_NORMALIZED = 'mayo health system';

const seedJobRecord = {
  pk: `JOB#${SEED_JOB_ID}`,
  sk: 'STATUS',
  jobId: SEED_JOB_ID,
  status: 'completed',
  companyName: 'Mayo Health System',
  createdAt: '2026-03-23T10:00:00Z',
  updatedAt: '2026-03-23T10:00:30Z',
};

const seedVerificationRecord = {
  pk: `COMPANY#${SEED_NORMALIZED}`,
  sk: `JOB#${SEED_JOB_ID}`,
  jobId: SEED_JOB_ID,
  companyName: 'Mayo Health System',
  normalizedName: SEED_NORMALIZED,
  jurisdiction: 'us_mn',
  registrationNumber: '12345678',
  incorporationDate: '1919-01-01',
  legalStatus: 'Active',
  standardizedAddress: '200 First St SW, Rochester, MN 55905',
  providerType: 'Health System',
  riskLevel: 'LOW',
  riskFlags: [],
  aiSummary: 'Entity is actively registered in Minnesota with no anomalies detected.',
  confidence: 'HIGH',
  cachedResult: false,
  rawSourceData: [{ name: 'Mayo Health System', jurisdiction: 'us_mn', status: 'Active' }],
  jobStatus: 'completed',
  scope: 'internal',
  createdAt: '2026-03-23T10:00:00Z',
  validatedAt: '2026-03-23T10:00:25Z',
  ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
};

function signToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    {
      sub: 'smoke-user',
      scope: 'internal',
      org: 'smoke-org',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    },
    JWT_SECRET,
    { algorithm: 'HS256' },
  );
}

async function request(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (!condition) {
    console.error(`  FAIL: ${label}`);
    failed++;
    process.exitCode = 1;
  } else {
    console.log(`  PASS: ${label}`);
    passed++;
  }
}

async function seedData() {
  console.log('=== Seeding DynamoDB with test data ===');
  await ddb.send(new PutCommand({ TableName: 'jobs', Item: seedJobRecord }));
  console.log('  Seeded jobs table (completed job)');
  await ddb.send(new PutCommand({ TableName: 'verifications', Item: seedVerificationRecord }));
  console.log('  Seeded verifications table (LOW risk record)\n');
}

async function cleanupData() {
  await ddb.send(new DeleteCommand({
    TableName: 'jobs',
    Key: { pk: seedJobRecord.pk, sk: seedJobRecord.sk },
  }));
  await ddb.send(new DeleteCommand({
    TableName: 'verifications',
    Key: { pk: seedVerificationRecord.pk, sk: seedVerificationRecord.sk },
  }));
  console.log('  Cleaned up seed data');
}

async function main() {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.DYNAMODB_ENDPOINT = DYNAMODB_ENDPOINT;
  process.env.SQS_ENDPOINT = DYNAMODB_ENDPOINT;
  process.env.VERIFICATION_QUEUE_URL =
    'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/verification-queue.fifo';

  await seedData();

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(PORT, () => resolve(s));
  });
  console.log(`Smoke test server running on port ${PORT}\n`);

  const internalToken = signToken();
  const externalToken = signToken({ scope: 'external' });

  try {
    // --- 1. Auth ---
    console.log('=== 1. Auth: no token ===');
    const noAuth = await request('POST', '/verify', { body: { companyName: 'Test Corp' } });
    assert(noAuth.status === 401, `Expected 401, got ${noAuth.status}`);

    console.log('\n=== 2. Auth: invalid token ===');
    const badAuth = await request('POST', '/verify', {
      token: 'garbage.token.here',
      body: { companyName: 'Test Corp' },
    });
    assert(badAuth.status === 401, `Expected 401, got ${badAuth.status}`);

    // --- 2. Validation ---
    console.log('\n=== 3. Validation: empty companyName ===');
    const badBody = await request('POST', '/verify', {
      token: internalToken,
      body: { companyName: '' },
    });
    assert(badBody.status === 400, `Expected 400, got ${badBody.status}`);

    // --- 3. POST /verify ---
    console.log('\n=== 4. POST /verify (Acme Health Corp) ===');
    const post = await request('POST', '/verify', {
      token: internalToken,
      body: { companyName: 'Acme Health Corp', jurisdiction: 'us_ca' },
    });
    assert(post.status === 202, `Expected 202, got ${post.status}`);
    assert(typeof post.data.jobId === 'string', `jobId is string: ${post.data.jobId}`);
    assert(post.data.status === 'queued', `status is queued`);
    assert(post.data.pollUrl === `/verify/${post.data.jobId}/status`, `pollUrl correct`);
    const newJobId = post.data.jobId as string;

    // --- 4. Poll new job (queued) ---
    console.log(`\n=== 5. GET /verify/${newJobId}/status (queued) ===`);
    const pollNew = await request('GET', `/verify/${newJobId}/status`, { token: internalToken });
    assert(pollNew.status === 200, `Expected 200, got ${pollNew.status}`);
    assert(pollNew.data.status === 'queued', `status is queued`);

    // --- 5. Poll seeded job (completed) ---
    console.log(`\n=== 6. GET /verify/${SEED_JOB_ID}/status (completed) ===`);
    const pollSeed = await request('GET', `/verify/${SEED_JOB_ID}/status`, { token: internalToken });
    assert(pollSeed.status === 200, `Expected 200, got ${pollSeed.status}`);
    assert(pollSeed.data.status === 'completed', `status is completed: ${pollSeed.data.status}`);

    // --- 6. Poll nonexistent ---
    console.log('\n=== 7. GET /verify/nonexistent/status ===');
    const notFound = await request('GET', '/verify/00000000-0000-0000-0000-000000000000/status', {
      token: internalToken,
    });
    assert(notFound.status === 404, `Expected 404, got ${notFound.status}`);

    // --- 7. GET /records (internal — full fields) ---
    console.log('\n=== 8. GET /records (internal scope) ===');
    const records = await request('GET', '/records', { token: internalToken });
    assert(records.status === 200, `Expected 200, got ${records.status}`);
    const recList = records.data.records as Record<string, unknown>[];
    assert(Array.isArray(recList), `records is array`);
    assert(recList.length >= 1, `has at least 1 record: ${recList.length}`);
    const seedRec = recList.find((r) => r.jobId === SEED_JOB_ID) as Record<string, unknown>;
    assert(!!seedRec, `found seeded record`);
    if (seedRec) {
      assert(seedRec.companyName === 'Mayo Health System', `companyName: ${seedRec.companyName}`);
      assert(seedRec.riskLevel === 'LOW', `riskLevel: ${seedRec.riskLevel}`);
      assert(seedRec.registrationNumber === '12345678', `registrationNumber present (internal)`);
      assert(seedRec.confidence === 'HIGH', `confidence present (internal)`);
      assert(Array.isArray(seedRec.rawSourceData), `rawSourceData present (internal)`);
      console.log(`  Record: ${seedRec.companyName} | ${seedRec.riskLevel} risk | ${seedRec.legalStatus}`);
    }

    // --- 8. GET /records (external — redacted) ---
    console.log('\n=== 9. GET /records (external scope — redaction check) ===');
    const extRecords = await request('GET', '/records', { token: externalToken });
    assert(extRecords.status === 200, `Expected 200, got ${extRecords.status}`);
    const extList = (extRecords.data.records ?? []) as Record<string, unknown>[];
    assert(extList.length >= 1, `has at least 1 record`);
    const extSeedRec = extList.find((r) => r.companyName === 'Mayo Health System');
    if (extSeedRec) {
      assert(!('registrationNumber' in extSeedRec), 'registrationNumber redacted');
      assert(!('incorporationDate' in extSeedRec), 'incorporationDate redacted');
      assert(!('confidence' in extSeedRec), 'confidence redacted');
      assert(!('cachedResult' in extSeedRec), 'cachedResult redacted');
      assert(!('jobId' in extSeedRec), 'jobId redacted');
      assert(!('pk' in extSeedRec), 'pk redacted');
      assert(!('sk' in extSeedRec), 'sk redacted');
      assert(!('rawSourceData' in extSeedRec), 'rawSourceData redacted');
      assert('companyName' in extSeedRec, 'companyName visible');
      assert('riskLevel' in extSeedRec, 'riskLevel visible');
      assert('aiSummary' in extSeedRec, 'aiSummary visible');
    }

    // --- 9. GET /records with riskLevel filter ---
    console.log('\n=== 10. GET /records?riskLevel=LOW ===');
    const filtered = await request('GET', '/records?riskLevel=LOW', { token: internalToken });
    assert(filtered.status === 200, `Expected 200, got ${filtered.status}`);
    const filteredList = filtered.data.records as Record<string, unknown>[];
    assert(filteredList.length >= 1, `LOW filter returns seeded record`);

    console.log('\n=== 11. GET /records?riskLevel=HIGH ===');
    const noResults = await request('GET', '/records?riskLevel=HIGH', { token: internalToken });
    assert(noResults.status === 200, `Expected 200, got ${noResults.status}`);
    assert(
      (noResults.data.records as unknown[]).length === 0,
      `HIGH filter returns 0 records`,
    );

    console.log('\n=== 12. GET /records?riskLevel=INVALID ===');
    const badFilter = await request('GET', '/records?riskLevel=INVALID', { token: internalToken });
    assert(badFilter.status === 400, `Expected 400, got ${badFilter.status}`);

    console.log(`\n=== Smoke test complete: ${passed} passed, ${failed} failed ===`);
  } catch (err) {
    console.error('Smoke test crashed:', err);
    process.exitCode = 1;
  } finally {
    await cleanupData();
    server.close();
    process.exit(process.exitCode ?? 0);
  }
}

main();