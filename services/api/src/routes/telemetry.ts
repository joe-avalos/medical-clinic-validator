import { Router, type Request, type Response } from 'express';
import { queryTelemetry } from '../clients/dynamodb.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('api');
export const telemetryRouter = Router();

const VALID_PATHS = [
  'scrape→validate→store',
  'scrape→empty→store',
  'scrape→fallback→store',
  'scrape→partial-fallback→store',
];

// GET /telemetry
telemetryRouter.get('/', async (req: Request, res: Response) => {
  const { pipelinePath, limit: limitStr, cursor } = req.query;

  if (pipelinePath !== undefined && !VALID_PATHS.includes(pipelinePath as string)) {
    res.status(400).json({ error: 'Invalid pipelinePath value' });
    return;
  }

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
    const result = await queryTelemetry({
      pipelinePath: pipelinePath as string | undefined,
      limit,
      cursor: cursor as string | undefined,
    });

    const response: Record<string, unknown> = {
      records: result.records,
      total: result.total,
    };

    if (result.nextCursor) {
      response.nextCursor = result.nextCursor;
    }

    res.json(response);
  } catch (err) {
    log.error({ err: (err as Error).message }, 'GET /telemetry failed');
    res.status(500).json({ error: 'Failed to retrieve telemetry records' });
  }
});
