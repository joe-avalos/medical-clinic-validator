import { VerificationJobMessageSchema } from '@medical-validator/shared';
import type { ScraperResultMessage, Scope, VerificationRecord } from '@medical-validator/shared';
import { updateJobStatus, getRecordsByJobId, putVerificationRecords } from '../shared/dynamodb.js';
import { getCachedJobId, deleteCachedJobId } from '../shared/redis.js';
import { TTL_DAYS } from '../shared/constants.js';
import { createScraperProvider } from './scraper-provider.js';
import { sendMessage } from '../shared/sqs.js';

const VALIDATION_QUEUE_URL =
  process.env.SQS_VALIDATION_QUEUE_URL ||
  'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/validation-queue.fifo';

const provider = createScraperProvider();

export async function handleScraperMessage(body: unknown): Promise<void> {
  const message = VerificationJobMessageSchema.parse(body);
  console.log(`[scraper] Received job ${message.jobId} for "${message.companyName}"`);

  // 1. Update job status → processing
  await updateJobStatus(message.jobId, 'processing');

  // 2. Check Redis for cached jobId
  try {
    const cached = await getCachedJobId(message.normalizedName);
    if (cached) {
      console.log(`[scraper] Cache hit for "${message.normalizedName}" → job ${cached.jobId}`);
      await copyCachedResults(message.jobId, cached.jobId, cached.createdAt, message.scope);
      return;
    }
  } catch (err) {
    console.warn('[scraper] Redis read failed, proceeding without cache:', (err as Error).message);
  }

  // 3. Scrape (cache miss)
  let companies;
  try {
    companies = await provider.search(message.normalizedName, message.jurisdiction);
  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error(`[scraper] Job ${message.jobId} failed:`, errorMsg);
    await updateJobStatus(message.jobId, 'failed', errorMsg);

    // Invalidate cache on stale cookie errors so subsequent searches
    // don't keep returning old cached results from the API layer
    if (errorMsg.includes('STALE_COOKIES')) {
      try {
        await deleteCachedJobId(message.normalizedName);
        console.log(`[scraper] Cache invalidated for "${message.normalizedName}" due to stale cookies`);
      } catch (cacheErr) {
        console.warn('[scraper] Failed to invalidate cache:', (cacheErr as Error).message);
      }
    }

    // Return (don't throw) — job is already marked failed in DynamoDB.
    // Throwing would leave the SQS message in-flight, blocking the FIFO
    // message group and preventing new jobs for the same company name.
    return;
  }

  // 4. Publish ScraperResultMessage to validation queue
  const result: ScraperResultMessage = {
    jobId: message.jobId,
    normalizedName: message.normalizedName,
    scope: message.scope,
    cachedResult: false,
    companies,
    scrapedAt: new Date().toISOString(),
  };

  await sendMessage(VALIDATION_QUEUE_URL, result, message.jobId);
  console.log(`[scraper] Published result for job ${message.jobId} (${companies.length} companies)`);
}

async function copyCachedResults(
  newJobId: string,
  originalJobId: string,
  originalCreatedAt: string,
  scope: Scope,
): Promise<void> {
  const originalRecords = await getRecordsByJobId(originalJobId);

  if (originalRecords.length === 0) {
    console.warn(`[scraper] Cached job ${originalJobId} has no records, falling through to scrape`);
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
  console.log(`[scraper] Copied ${copies.length} cached records from job ${originalJobId} → ${newJobId}`);
}

export async function shutdownScraper(): Promise<void> {
  if (provider.cleanup) {
    await provider.cleanup();
  }
}