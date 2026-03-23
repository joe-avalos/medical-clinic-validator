import { ValidationResultMessageSchema } from '@medical-validator/shared';

export async function handleStorageMessage(body: unknown): Promise<void> {
  const message = ValidationResultMessageSchema.parse(body);
  console.log(`[storage] Received job ${message.jobId} — risk: ${message.validation.riskLevel}`);

  // TODO: Implement storage pipeline
  // 1. Map to VerificationRecord (set TTL = now + 90 days)
  // 2. Write to DynamoDB verifications table
  // 3. Update job status → completed in DynamoDB jobs table
  // 4. Write to Redis cache

  throw new Error('Storage worker not yet implemented');
}
