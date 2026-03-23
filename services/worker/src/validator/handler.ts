import { ScraperResultMessageSchema } from '@medical-validator/shared';
import type { ValidationResult, ValidationResultMessage } from '@medical-validator/shared';
import { createAIProvider } from './ai-provider.js';
import { sendMessage } from '../shared/sqs.js';

const STORAGE_QUEUE_URL = process.env.SQS_STORAGE_QUEUE_URL || 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/storage-queue.fifo';

const provider = createAIProvider();

function buildEmptyResult(): ValidationResult {
  return {
    companyName: 'Unknown',
    jurisdiction: 'unknown',
    registrationNumber: 'unknown',
    incorporationDate: null,
    legalStatus: 'Unknown',
    standardizedAddress: 'unknown',
    providerType: 'Unknown',
    riskLevel: 'UNKNOWN',
    riskFlags: [],
    aiSummary: 'No company records found in OpenCorporates — unable to validate.',
    confidence: 'LOW',
  };
}

export async function handleValidatorMessage(body: unknown): Promise<void> {
  const message = ScraperResultMessageSchema.parse(body);
  console.log(`[ai-validator] Received job ${message.jobId} with ${message.companies.length} companies`);

  let validations: ValidationResult[];

  if (message.companies.length === 0) {
    validations = [buildEmptyResult()];
  } else {
    validations = await provider.validateAll(message.companies);
  }

  const outbound: ValidationResultMessage = {
    jobId: message.jobId,
    normalizedName: message.normalizedName,
    scope: message.scope,
    cachedResult: message.cachedResult,
    validations,
    rawSourceData: message.companies,
    validatedAt: new Date().toISOString(),
  };

  await sendMessage(STORAGE_QUEUE_URL, outbound, message.jobId);
  console.log(`[ai-validator] Published ${validations.length} validation results for job ${message.jobId}`);
}