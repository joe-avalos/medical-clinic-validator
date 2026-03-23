import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { JobStatus } from '@medical-validator/shared';

const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:4566',
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
});

const docClient = DynamoDBDocumentClient.from(client);

const JOBS_TABLE = process.env.DYNAMODB_TABLE_JOBS || 'jobs';

export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  errorMessage?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: JOBS_TABLE,
      Key: { pk: `JOB#${jobId}`, sk: 'STATUS' },
      UpdateExpression: errorMessage
        ? 'SET #status = :status, updatedAt = :now, errorMessage = :err'
        : 'SET #status = :status, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': status,
        ':now': now,
        ...(errorMessage ? { ':err': errorMessage } : {}),
      },
    }),
  );
}
