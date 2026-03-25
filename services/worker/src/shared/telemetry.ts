import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { JobTelemetry } from '@medical-validator/shared';
import { createLogger } from './logger.js';

const log = createLogger('telemetry');

const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:4566',
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
});

const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE = process.env.DYNAMODB_TABLE_TELEMETRY || 'job_telemetry';

export async function writeTelemetry(
  params: Omit<JobTelemetry, 'pk' | 'sk' | 'ttl' | 'createdAt'>,
): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: `JOB#${params.jobId}`, sk: 'TELEMETRY' },
        UpdateExpression: `SET
          scraperProvider = :sp,
          aiProvider = :ai,
          cacheHit = :ch,
          companiesFound = :cf,
          scrapeAttempts = :sa,
          scrapeErrors = :se,
          pipelinePath = :pp,
          validationOutcomes = :vo,
          errorMessage = :err,
          durationMs = :dur,
          updatedAt = :now`,
        ExpressionAttributeValues: {
          ':sp': params.scraperProvider,
          ':ai': params.aiProvider,
          ':ch': params.cacheHit,
          ':cf': params.companiesFound,
          ':sa': params.scrapeAttempts,
          ':se': params.scrapeErrors,
          ':pp': params.pipelinePath,
          ':vo': params.validationOutcomes,
          ':err': params.errorMessage,
          ':dur': params.durationMs,
          ':now': new Date().toISOString(),
        },
      }),
    );
    log.info({ jobId: params.jobId, pipelinePath: params.pipelinePath }, 'Telemetry updated');
  } catch (err) {
    // Telemetry write failure should never fail the job
    log.error({ jobId: params.jobId, err: (err as Error).message }, 'Telemetry update failed');
  }
}
