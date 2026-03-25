import { VerificationJobMessageSchema } from '@medical-validator/shared';
import type { PipelineTelemetry, ScraperResultMessage, Scope, VerificationRecord } from '@medical-validator/shared';
import { updateJobStatus, getRecordsByJobId, putVerificationRecords } from '../shared/dynamodb.js';
import { getCachedJobId, deleteCachedJobId } from '../shared/redis.js';
import { TTL_DAYS } from '../shared/constants.js';
import { createScraperProvider } from './scraper-provider.js';
import { sendMessage } from '../shared/sqs.js';
import { createLogger } from '../shared/logger.js';

const logger = createLogger('scraper');

const VALIDATION_QUEUE_URL =
  process.env.SQS_VALIDATION_QUEUE_URL ||
  'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/validation-queue.fifo';

const provider = createScraperProvider();

export async function handleScraperMessage(body: unknown): Promise<void> {
  const message = VerificationJobMessageSchema.parse(body);
  const log = logger.child({ jobId: message.jobId, companyName: message.companyName });
  const scraperProvider = process.env.SCRAPER_PROVIDER || 'opencorporates-api';
  log.info({ scraperProvider }, 'Received job');

  // 1. Update job status → processing
  await updateJobStatus(message.jobId, 'processing');

  // 2. Check Redis for cached jobId
  try {
    const cached = await getCachedJobId(message.normalizedName);
    if (cached) {
      log.info({ cacheHit: true, cachedJobId: cached.jobId }, 'Cache hit — skipping scrape');
      await copyCachedResults(message.jobId, cached.jobId, cached.createdAt, message.scope);
      return;
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'Redis read failed, proceeding without cache');
  }

  // 3. Scrape (cache miss)
  log.info({ cacheHit: false, scraperProvider }, 'Cache miss — starting scrape');
  let companies;
  try {
    companies = await provider.search(message.normalizedName, message.jurisdiction);
  } catch (err) {
    const errorMsg = (err as Error).message;
    log.error({ err: errorMsg, scraperProvider }, 'Scrape failed');
    await updateJobStatus(message.jobId, 'failed', errorMsg);

    // Invalidate cache on stale cookie errors so subsequent searches
    // don't keep returning old cached results from the API layer
    if (errorMsg.includes('STALE_COOKIES')) {
      try {
        await deleteCachedJobId(message.normalizedName);
        log.info('Cache invalidated due to stale cookies');
      } catch (cacheErr) {
        log.warn({ err: (cacheErr as Error).message }, 'Failed to invalidate cache');
      }
    }

    // Return (don't throw) — job is already marked failed in DynamoDB.
    // Throwing would leave the SQS message in-flight, blocking the FIFO
    // message group and preventing new jobs for the same company name.
    return;
  }

  log.info({ companiesFound: companies.length, scraperProvider }, 'Scrape complete');

  // 4. Build telemetry snapshot
  const telemetry: PipelineTelemetry = {
    scraperProvider,
    cacheHit: false,
    companiesFound: companies.length,
    scrapeStartedAt: message.enqueuedAt,
  };

  // 5. Publish ScraperResultMessage to validation queue
  const result: ScraperResultMessage = {
    jobId: message.jobId,
    normalizedName: message.normalizedName,
    scope: message.scope,
    cachedResult: false,
    companies,
    scrapedAt: new Date().toISOString(),
    telemetry,
  };

  await sendMessage(VALIDATION_QUEUE_URL, result, message.jobId);
  log.info({ companiesFound: companies.length }, 'Published to validation queue');
}

async function copyCachedResults(
  newJobId: string,
  originalJobId: string,
  originalCreatedAt: string,
  scope: Scope,
): Promise<void> {
  const originalRecords = await getRecordsByJobId(originalJobId);

  if (originalRecords.length === 0) {
    logger.warn({ newJobId, originalJobId }, 'Cached job has no records, falling through to scrape');
    // Can't short-circuit — let the job fail gracefully
    await updateJobStatus(newJobId, 'failed', 'Cached job had no records');
    return;
  }

  const now = new Date();
  const ttl = Math.floor(now.getTime() / 1000) + TTL_DAYS * 24 * 60 * 60;

  const copies: VerificationRecord[] = originalRecords.map((r) => ({
    ...r,
    pk: `JOB#${newJobId}`,
    jobId: newJobId,
    cachedResult: true,
    cachedFromJobId: originalJobId,
    originalValidatedAt: r.validatedAt,
    scope,
    createdAt: now.toISOString(),
    ttl,
  }));

  await putVerificationRecords(copies);
  await updateJobStatus(newJobId, 'completed');
  logger.info({ newJobId, originalJobId, recordsCopied: copies.length }, 'Copied cached records');
}

export async function shutdownScraper(): Promise<void> {
  if (provider.cleanup) {
    await provider.cleanup();
  }
}