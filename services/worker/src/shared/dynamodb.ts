import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { JobStatus, VerificationRecord } from '@medical-validator/shared';

const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:4566',
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
});

const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const JOBS_TABLE = process.env.DYNAMODB_TABLE_JOBS || 'jobs';
const VERIFICATIONS_TABLE = process.env.DYNAMODB_TABLE_VERIFICATIONS || 'verifications';

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

export async function putVerificationRecords(
  records: VerificationRecord[],
): Promise<void> {
  // DynamoDB BatchWriteItem supports max 25 items per call
  const chunks: VerificationRecord[][] = [];
  for (let i = 0; i < records.length; i += 25) {
    chunks.push(records.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [VERIFICATIONS_TABLE]: chunk.map((record) => ({
            PutRequest: { Item: record },
          })),
        },
      }),
    );
  }
}

export async function getRecordsByJobId(
  jobId: string,
): Promise<VerificationRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: VERIFICATIONS_TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `JOB#${jobId}`,
        ':prefix': 'RESULT#',
      },
    }),
  );
  return (result.Items ?? []) as VerificationRecord[];
}