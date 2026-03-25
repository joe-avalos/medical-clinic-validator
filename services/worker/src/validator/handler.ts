import { ScraperResultMessageSchema } from '@medical-validator/shared';
import type { PipelineTelemetry, ValidationResult, ValidationResultMessage } from '@medical-validator/shared';
import { createAIProvider } from './ai-provider.js';
import { sendMessage } from '../shared/sqs.js';
import { createLogger } from '../shared/logger.js';

const logger = createLogger('ai-validator');

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
  const log = logger.child({ jobId: message.jobId });
  const aiProvider = process.env.AI_PROVIDER || 'anthropic';
  log.info({ companiesReceived: message.companies.length, aiProvider }, 'Validation starting');

  let validations: ValidationResult[];
  let pipelinePath: string;

  if (message.companies.length === 0) {
    log.info({ emptyResult: true }, 'No companies found — returning empty result');
    validations = [buildEmptyResult()];
    pipelinePath = 'scrape→empty→store';
  } else {
    validations = await provider.validateAll(message.companies);
    const fallbackCount = validations.filter((v) => v.riskFlags.includes('AI validation unavailable')).length;
    pipelinePath = fallbackCount === validations.length
      ? 'scrape→fallback→store'
      : fallbackCount > 0
        ? 'scrape→partial-fallback→store'
        : 'scrape→validate→store';
  }

  // Accumulate telemetry from scraper + add validator metrics
  const successCount = validations.filter((v) => !v.riskFlags.includes('AI validation unavailable') && v.companyName !== 'Unknown').length;
  const fallbackCount = validations.filter((v) => v.riskFlags.includes('AI validation unavailable')).length;
  const emptyCount = validations.filter((v) => v.companyName === 'Unknown' && !v.riskFlags.includes('AI validation unavailable')).length;

  const telemetry: PipelineTelemetry | undefined = message.telemetry
    ? {
        ...message.telemetry,
        aiProvider,
        pipelinePath,
        validationOutcomes: { success: successCount, fallback: fallbackCount, empty: emptyCount },
      }
    : undefined;

  const outbound: ValidationResultMessage = {
    jobId: message.jobId,
    normalizedName: message.normalizedName,
    scope: message.scope,
    cachedResult: message.cachedResult,
    validations,
    rawSourceData: message.companies,
    validatedAt: new Date().toISOString(),
    telemetry,
  };

  await sendMessage(STORAGE_QUEUE_URL, outbound, message.jobId);
  log.info({ validationCount: validations.length }, 'Published to storage queue');
}