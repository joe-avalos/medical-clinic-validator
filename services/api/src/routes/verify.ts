import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { VerifyRequestSchema } from '@medical-validator/shared';
import type { JwtClaims } from '@medical-validator/shared';
import { createJob, createTelemetryRecord, getJobStatus, getVerificationResults } from '../clients/dynamodb.js';
import { sendToVerificationQueue } from '../clients/sqs.js';
import { getCachedJobId, deleteCachedJobId } from '../clients/redis.js';
import { createLogger } from '../shared/logger.js';

const logger = createLogger('api');
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

  const { companyName, jurisdiction, forceRefresh } = parsed.data;
  const user = req.user as JwtClaims;
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const normalizedName = normalizeName(companyName);

  try {
    // Check Redis cache — return existing jobId immediately if available
    if (!forceRefresh) {
      try {
        const cached = await getCachedJobId(normalizedName);
        if (cached) {
          logger.info({ normalizedName, cachedJobId: cached.jobId }, 'Cache hit');
          res.status(200).json({
            jobId: cached.jobId,
            status: 'completed',
            pollUrl: `/verify/${cached.jobId}/status`,
            cached: true,
            cachedAt: cached.createdAt,
          });
          return;
        }
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'Redis cache check failed, proceeding');
      }
    } else {
      // Force refresh — invalidate existing cache
      try {
        await deleteCachedJobId(normalizedName);
        logger.info({ normalizedName }, 'Cache invalidated (forceRefresh)');
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'Redis cache delete failed, proceeding');
      }
    }

    await createJob({
      jobId,
      companyName,
      status: 'queued',
      createdAt: now,
    });

    // Write telemetry at submission — workers update this row as the pipeline progresses
    const scraperProvider = process.env.SCRAPER_PROVIDER || 'opencorporates-api';
    try {
      await createTelemetryRecord({ jobId, companyName, normalizedName, scraperProvider });
    } catch (err) {
      logger.warn({ err: (err as Error).message, jobId }, 'Telemetry seed write failed');
    }

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
    logger.error({ err: (err as Error).message }, 'POST /verify failed');
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
    logger.error({ err: (err as Error).message }, 'GET /verify/:id/status failed');
    res.status(500).json({ error: 'Failed to retrieve job status' });
  }
});