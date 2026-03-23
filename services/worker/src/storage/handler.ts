import { ValidationResultMessageSchema } from '@medical-validator/shared';
import type { VerificationRecord } from '@medical-validator/shared';
import { updateJobStatus, putVerificationRecords } from '../shared/dynamodb.js';
import { setCachedJobId } from '../shared/redis.js';
import { TTL_DAYS } from '../shared/constants.js';

export async function handleStorageMessage(body: unknown): Promise<void> {
  const message = ValidationResultMessageSchema.parse(body);
  console.log(`[storage] Received job ${message.jobId} — ${message.validations.length} validations`);

  const now = new Date();
  const ttl = Math.floor(now.getTime() / 1000) + TTL_DAYS * 24 * 60 * 60;

  // Build one record per validation result
  const records: VerificationRecord[] = message.validations.map((v, i) => {
    // Match validation to its source company by registration number
    const sourceCompany = message.rawSourceData.find(
      (c) => c.companyNumber === v.registrationNumber,
    ) ?? message.rawSourceData[i];

    return {
      pk: `JOB#${message.jobId}`,
      sk: `RESULT#${v.registrationNumber}`,
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
    };
  });

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
      console.warn('[storage] Redis cache write failed:', (err as Error).message);
    }
  }

  console.log(`[storage] Job ${message.jobId}: ${records.length} records persisted and marked completed`);
}