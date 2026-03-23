import { VerificationJobMessageSchema } from '@medical-validator/shared';
import type { ScraperResultMessage } from '@medical-validator/shared';
import { updateJobStatus } from '../shared/dynamodb.js';
import { getCachedScraperResult, setCachedScraperResult } from '../shared/redis.js';
import { scrapeOpenCorporates } from './opencorporates.js';
import { sendMessage } from '../shared/sqs.js';

const VALIDATION_QUEUE_URL =
  process.env.SQS_VALIDATION_QUEUE_URL ||
  'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/validation-queue.fifo';

export async function handleScraperMessage(body: unknown): Promise<void> {
  const message = VerificationJobMessageSchema.parse(body);
  console.log(`[scraper] Received job ${message.jobId} for "${message.companyName}"`);

  // 1. Update job status → processing
  await updateJobStatus(message.jobId, 'processing');

  // 2. Check Redis cache
  let companies;
  let cachedResult = false;

  try {
    const cached = await getCachedScraperResult(message.normalizedName);
    if (cached) {
      companies = cached;
      cachedResult = true;
      console.log(`[scraper] Cache hit for "${message.normalizedName}"`);
    }
  } catch (err) {
    console.warn('[scraper] Redis read failed, proceeding without cache:', (err as Error).message);
  }

  // 3. Scrape OpenCorporates if cache miss
  if (!companies) {
    try {
      companies = await scrapeOpenCorporates(message.normalizedName, message.jurisdiction);
    } catch (err) {
      await updateJobStatus(message.jobId, 'failed', (err as Error).message);
      throw err;
    }

    // 4. Write to Redis cache
    try {
      await setCachedScraperResult(message.normalizedName, companies);
    } catch (err) {
      console.warn('[scraper] Redis write failed:', (err as Error).message);
    }
  }

  // 5. Publish ScraperResultMessage to validation queue
  const result: ScraperResultMessage = {
    jobId: message.jobId,
    normalizedName: message.normalizedName,
    scope: message.scope,
    cachedResult,
    companies,
    scrapedAt: new Date().toISOString(),
  };

  await sendMessage(VALIDATION_QUEUE_URL, result, message.jobId);
  console.log(`[scraper] Published result for job ${message.jobId} (${companies.length} companies, cached: ${cachedResult})`);
}
