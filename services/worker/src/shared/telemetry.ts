import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { JobTelemetry } from '@medical-validator/shared';
import { createLogger } from './logger.js';

const log = createLogger('telemetry');

const TELEMETRY_TTL_DAYS = 30;

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
  const now = new Date();
  const ttl = Math.floor(now.getTime() / 1000) + TELEMETRY_TTL_DAYS * 24 * 60 * 60;

  const item: JobTelemetry = {
    pk: `JOB#${params.jobId}`,
    sk: 'TELEMETRY',
    createdAt: now.toISOString(),
    ttl,
    ...params,
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: item,
      }),
    );
    log.info({ jobId: params.jobId, pipelinePath: params.pipelinePath }, 'Telemetry written');
  } catch (err) {
    // Telemetry write failure should never fail the job
    log.error({ jobId: params.jobId, err: (err as Error).message }, 'Telemetry write failed');
  }
}
