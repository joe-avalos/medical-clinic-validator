import { ValidationResultMessageSchema } from '@medical-validator/shared';
import type { VerificationRecord } from '@medical-validator/shared';
import { updateJobStatus, putVerificationRecord } from '../shared/dynamodb.js';
import { setCachedValidation } from '../shared/redis.js';

const TTL_DAYS = 90;

export async function handleStorageMessage(body: unknown): Promise<void> {
  const message = ValidationResultMessageSchema.parse(body);
  console.log(`[storage] Received job ${message.jobId} — risk: ${message.validation.riskLevel}`);

  const now = new Date();
  const record: VerificationRecord = {
    pk: `COMPANY#${message.normalizedName}`,
    sk: `JOB#${message.jobId}`,
    jobId: message.jobId,
    companyName: message.validation.companyName,
    normalizedName: message.normalizedName,
    jurisdiction: message.validation.jurisdiction,
    registrationNumber: message.validation.registrationNumber,
    incorporationDate: message.validation.incorporationDate ?? undefined,
    legalStatus: message.validation.legalStatus,
    standardizedAddress: message.validation.standardizedAddress,
    providerType: message.validation.providerType,
    riskLevel: message.validation.riskLevel,
    riskFlags: message.validation.riskFlags,
    aiSummary: message.validation.aiSummary,
    confidence: message.validation.confidence,
    cachedResult: message.cachedResult,
    rawSourceData: message.rawSourceData,
    jobStatus: 'completed',
    createdAt: now.toISOString(),
    validatedAt: message.validatedAt,
    ttl: Math.floor(now.getTime() / 1000) + TTL_DAYS * 24 * 60 * 60,
    scope: message.scope,
  };

  try {
    await putVerificationRecord(record);
  } catch (err) {
    await updateJobStatus(message.jobId, 'failed', (err as Error).message);
    throw err;
  }

  await updateJobStatus(message.jobId, 'completed');

  // Cache validation result (skip if this was already from cache)
  if (!message.cachedResult) {
    try {
      await setCachedValidation(message.normalizedName, {
        validation: message.validation,
        validatedAt: message.validatedAt,
      });
    } catch (err) {
      console.warn('[storage] Redis cache write failed:', (err as Error).message);
    }
  }

  console.log(`[storage] Job ${message.jobId} persisted and marked completed`);
}
