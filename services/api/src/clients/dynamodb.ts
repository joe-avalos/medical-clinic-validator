import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { JobStatus } from '@medical-validator/shared';

const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:4566',
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
});

const docClient = DynamoDBDocumentClient.from(client);

const JOBS_TABLE = process.env.DYNAMODB_TABLE_JOBS || 'jobs';
const VERIFICATIONS_TABLE = process.env.DYNAMODB_TABLE_VERIFICATIONS || 'verifications';

export interface CreateJobInput {
  jobId: string;
  companyName: string;
  status: JobStatus;
  createdAt: string;
}

export async function createJob(input: CreateJobInput): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: JOBS_TABLE,
      Item: {
        pk: `JOB#${input.jobId}`,
        sk: 'STATUS',
        jobId: input.jobId,
        status: input.status,
        companyName: input.companyName,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      },
    }),
  );
}

export async function getJobStatus(jobId: string): Promise<Record<string, unknown> | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: JOBS_TABLE,
      Key: { pk: `JOB#${jobId}`, sk: 'STATUS' },
    }),
  );
  return (result.Item as Record<string, unknown>) ?? null;
}

export async function getVerificationResult(jobId: string): Promise<Record<string, unknown> | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: VERIFICATIONS_TABLE,
      IndexName: 'jobId-index',
      KeyConditionExpression: 'jobId = :jid',
      ExpressionAttributeValues: { ':jid': jobId },
      Limit: 1,
    }),
  );
  return (result.Items?.[0] as Record<string, unknown>) ?? null;
}

export interface QueryRecordsInput {
  riskLevel?: string;
  limit: number;
  cursor?: string;
}

export async function queryRecords(
  input: QueryRecordsInput,
): Promise<{ records: Record<string, unknown>[]; total: number; nextCursor?: string }> {
  const params: Record<string, unknown> = {
    TableName: VERIFICATIONS_TABLE,
    Limit: input.limit,
  };

  if (input.cursor) {
    (params as any).ExclusiveStartKey = JSON.parse(
      Buffer.from(input.cursor, 'base64url').toString(),
    );
  }

  if (input.riskLevel) {
    (params as any).IndexName = 'riskLevel-validatedAt-index';
    (params as any).KeyConditionExpression = 'riskLevel = :rl';
    (params as any).ExpressionAttributeValues = { ':rl': input.riskLevel };
  }

  const command = input.riskLevel
    ? new QueryCommand(params as any)
    : new QueryCommand({ ...params, TableName: VERIFICATIONS_TABLE } as any);

  const result = await docClient.send(command);
  const records = (result.Items ?? []) as Record<string, unknown>[];

  let nextCursor: string | undefined;
  if (result.LastEvaluatedKey) {
    nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url');
  }

  return { records, total: result.Count ?? records.length, nextCursor };
}