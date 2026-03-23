import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { VerifyRequestSchema } from '@medical-validator/shared';
import type { JwtClaims } from '@medical-validator/shared';
import { createJob } from '../clients/dynamodb.js';
import { sendToVerificationQueue } from '../clients/sqs.js';
import { getJobStatus, getVerificationResults } from '../clients/dynamodb.js';

export const verifyRouter = Router();

const REDACTED_FIELDS = [
  'registrationNumber',
  'incorporationDate',
  'confidence',
  'cachedResult',
  'cachedFromJobId',
  'originalValidatedAt',
  'jobId',
  'pk',
  'sk',
  'rawSourceData',
];

function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...record };
  for (const field of REDACTED_FIELDS) {
    delete redacted[field];
  }
  return redacted;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ');
}

// POST /verify
verifyRouter.post('/', async (req: Request, res: Response) => {
  const parsed = VerifyRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }

  const { companyName, jurisdiction } = parsed.data;
  const user = req.user as JwtClaims;
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const normalizedName = normalizeName(companyName);

  try {
    await createJob({
      jobId,
      companyName,
      status: 'queued',
      createdAt: now,
    });

    await sendToVerificationQueue({
      jobId,
      companyName,
      normalizedName,
      jurisdiction,
      scope: user.scope,
      enqueuedAt: now,
    });

    res.status(202).json({
      jobId,
      status: 'queued',
      pollUrl: `/verify/${jobId}/status`,
    });
  } catch (err) {
    console.error('[API] POST /verify failed:', (err as Error).message);
    res.status(500).json({ error: 'Failed to enqueue verification job' });
  }
});

// GET /verify/:id/status
verifyRouter.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const job = await getJobStatus(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const response: Record<string, unknown> = {
      jobId: job.jobId,
      status: job.status,
    };

    if (job.status === 'completed') {
      const results = await getVerificationResults(req.params.id as string);
      if (results.length > 0) {
        const user = req.user as JwtClaims;
        response.results = user.scope === 'external'
          ? results.map(redactRecord)
          : results;
      }
    }

    if (job.status === 'failed' && job.errorMessage) {
      response.errorMessage = job.errorMessage;
    }

    res.json(response);
  } catch (err) {
    console.error('[API] GET /verify/:id/status failed:', (err as Error).message);
    res.status(500).json({ error: 'Failed to retrieve job status' });
  }
});