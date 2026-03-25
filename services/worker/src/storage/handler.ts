import { ValidationResultMessageSchema } from '@medical-validator/shared';
import type { VerificationRecord } from '@medical-validator/shared';
import { updateJobStatus, putVerificationRecords } from '../shared/dynamodb.js';
import { setCachedJobId } from '../shared/redis.js';
import { TTL_DAYS } from '../shared/constants.js';
import { createLogger } from '../shared/logger.js';
import { writeTelemetry } from '../shared/telemetry.js';

const logger = createLogger('storage');

export async function handleStorageMessage(body: unknown): Promise<void> {
  const message = ValidationResultMessageSchema.parse(body);
  const log = logger.child({ jobId: message.jobId });
  log.info({ validationCount: message.validations.length }, 'Received job');

  const now = new Date();
  const ttl = Math.floor(now.getTime() / 1000) + TTL_DAYS * 24 * 60 * 60;

  // Build one record per validation result, keyed by jurisdiction + registration number
  // to avoid duplicate pk+sk when the same company number appears across jurisdictions
  const seen = new Set<string>();
  const records: VerificationRecord[] = [];
  for (let i = 0; i < message.validations.length; i++) {
    const v = message.validations[i];
    const sk = `RESULT#${v.jurisdiction}#${v.registrationNumber}`;
    if (seen.has(sk)) {
      log.warn({ sk, companyName: v.companyName }, 'Skipping duplicate result');
      continue;
    }
    seen.add(sk);

    // Match validation to its source company by registration number
    const sourceCompany = message.rawSourceData.find(
      (c) => c.companyNumber === v.registrationNumber,
    ) ?? message.rawSourceData[i];

    records.push({
      pk: `JOB#${message.jobId}`,
      sk,
      jobId: message.jobId,
      companyNumber: v.registrationNumber,
      companyName: v.companyName,
      normalizedName: message.normalizedName,
      jurisdiction: v.jurisdiction,
      registrationNumber: v.registrationNumber,
      incorporationDate: v.incorporationDate ?? undefined,
      legalStatus: v.legalStatus,
      standardizedAddress: v.standardizedAddress,
      providerType: v.providerType,
      riskLevel: v.riskLevel,
      riskFlags: v.riskFlags,
      aiSummary: v.aiSummary,
      confidence: v.confidence,
      cachedResult: message.cachedResult,
      cachedFromJobId: null,
      originalValidatedAt: null,
      rawSourceData: sourceCompany?.rawApiSnapshot ?? {},
      jobStatus: 'completed' as const,
      createdAt: now.toISOString(),
      validatedAt: message.validatedAt,
      ttl,
      scope: message.scope,
    });
  }

  try {
    await putVerificationRecords(records);
  } catch (err) {
    await updateJobStatus(message.jobId, 'failed', (err as Error).message);
    throw err;
  }

  await updateJobStatus(message.jobId, 'completed');

  // Cache query→jobId mapping (only for fresh results)
  if (!message.cachedResult) {
    try {
      await setCachedJobId(message.normalizedName, message.jobId, now.toISOString());
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'Redis cache write failed');
    }
  }

  log.info({ recordCount: records.length }, 'Records persisted and job marked completed');

  // Write telemetry row (non-blocking — failure doesn't affect the job)
  if (message.telemetry) {
    const t = message.telemetry;
    const durationMs = Date.now() - new Date(t.scrapeStartedAt).getTime();
    await writeTelemetry({
      jobId: message.jobId,
      companyName: records[0]?.companyName ?? message.normalizedName,
      normalizedName: message.normalizedName,
      scraperProvider: t.scraperProvider,
      aiProvider: t.aiProvider ?? 'unknown',
      cacheHit: t.cacheHit,
      companiesFound: t.companiesFound,
      scrapeAttempts: t.scrapeAttempts ?? 1,
      scrapeErrors: t.scrapeErrors ?? [],
      pipelinePath: t.pipelinePath ?? 'unknown',
      validationOutcomes: t.validationOutcomes ?? { success: 0, fallback: 0, empty: 0 },
      errorMessage: null,
      durationMs,
    });
  }
}