import { VerificationJobMessageSchema } from '@medical-validator/shared';

export async function handleScraperMessage(body: unknown): Promise<void> {
  const message = VerificationJobMessageSchema.parse(body);
  console.log(`[scraper] Received job ${message.jobId} for "${message.companyName}"`);

  // TODO: Implement scraper pipeline
  // 1. Update job status → processing
  // 2. Check Redis cache
  // 3. Scrape OpenCorporates (Puppeteer + Cheerio)
  // 4. Write to Redis cache
  // 5. Publish ScraperResultMessage to validation queue

  throw new Error('Scraper worker not yet implemented');
}
