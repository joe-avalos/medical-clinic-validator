import { Router, type Request, type Response } from 'express';
import { RiskLevel } from '@medical-validator/shared';
import type { JwtClaims } from '@medical-validator/shared';
import { queryRecords } from '../clients/dynamodb.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('api');

export const recordsRouter = Router();

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

// GET /records
recordsRouter.get('/', async (req: Request, res: Response) => {
  const { riskLevel, limit: limitStr, cursor } = req.query;

  // Validate riskLevel
  if (riskLevel !== undefined) {
    const parsed = RiskLevel.safeParse(riskLevel);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid riskLevel value' });
      return;
    }
  }

  // Validate limit
  let limit = 50;
  if (limitStr !== undefined) {
    const parsed = Number(limitStr);
    if (isNaN(parsed)) {
      res.status(400).json({ error: 'limit must be a number' });
      return;
    }
    limit = parsed;
  }

  try {
    const result = await queryRecords({
      riskLevel: riskLevel as string | undefined,
      limit,
      cursor: cursor as string | undefined,
    });

    const user = req.user as JwtClaims;
    const records =
      user.scope === 'external'
        ? result.records.map(redactRecord)
        : result.records;

    const response: Record<string, unknown> = {
      records,
      total: result.total,
    };

    if (result.nextCursor) {
      response.nextCursor = result.nextCursor;
    }

    res.json(response);
  } catch (err) {
    log.error({ err: (err as Error).message }, 'GET /records failed');
    res.status(500).json({ error: 'Failed to retrieve records' });
  }
});