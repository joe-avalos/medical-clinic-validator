import { ScraperResultMessageSchema } from '@medical-validator/shared';
import type { ValidationResult, ValidationResultMessage } from '@medical-validator/shared';
import { createAIProvider } from './ai-provider.js';
import { sendMessage } from '../shared/sqs.js';

const STORAGE_QUEUE_URL = process.env.STORAGE_QUEUE_URL || 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/storage-queue.fifo';

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

  let validation: ValidationResult;

  if (message.companies.length === 0) {
    validation = buildEmptyResult();
  } else {
    validation = await provider.validate(message.companies);
  }

  const outbound: ValidationResultMessage = {
    jobId: message.jobId,
    normalizedName: message.normalizedName,
    scope: message.scope,
    cachedResult: message.cachedResult,
    validation,
    rawSourceData: message.companies,
    validatedAt: new Date().toISOString(),
  };

  await sendMessage(STORAGE_QUEUE_URL, outbound, message.jobId);
  console.log(`[ai-validator] Published validation result for job ${message.jobId} (risk: ${validation.riskLevel})`);
}
