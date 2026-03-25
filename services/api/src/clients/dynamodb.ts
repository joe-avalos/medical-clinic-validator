import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { JobStatus } from '@medical-validator/shared';

const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:4566',
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
});

const docClient = DynamoDBDocumentClient.from(client);

const JOBS_TABLE = process.env.DYNAMODB_TABLE_JOBS || 'jobs';
const VERIFICATIONS_TABLE = process.env.DYNAMODB_TABLE_VERIFICATIONS || 'verifications';
const TELEMETRY_TABLE = process.env.DYNAMODB_TABLE_TELEMETRY || 'job_telemetry';

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

export async function getVerificationResults(jobId: string): Promise<Record<string, unknown>[]> {
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
  return (result.Items ?? []) as Record<string, unknown>[];
}

export interface QueryRecordsInput {
  riskLevel?: string;
  limit: number;
  cursor?: string;
}

export async function queryRecords(
  input: QueryRecordsInput,
): Promise<{ records: Record<string, unknown>[]; total: number; nextCursor?: string }> {
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (input.cursor) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
    } catch {
      throw new Error('Invalid cursor format');
    }
  }

  let result;
  if (input.riskLevel) {
    result = await docClient.send(
      new QueryCommand({
        TableName: VERIFICATIONS_TABLE,
        IndexName: 'riskLevel-validatedAt-index',
        KeyConditionExpression: 'riskLevel = :rl',
        ExpressionAttributeValues: { ':rl': input.riskLevel },
        Limit: input.limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
  } else {
    result = await docClient.send(
      new ScanCommand({
        TableName: VERIFICATIONS_TABLE,
        Limit: input.limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
  }

  const records = (result.Items ?? []) as Record<string, unknown>[];

  let nextCursor: string | undefined;
  if (result.LastEvaluatedKey) {
    nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url');
  }

  return { records, total: result.Count ?? records.length, nextCursor };
}

export interface QueryTelemetryInput {
  pipelinePath?: string;
  limit: number;
  cursor?: string;
}

export async function queryTelemetry(
  input: QueryTelemetryInput,
): Promise<{ records: Record<string, unknown>[]; total: number; nextCursor?: string }> {
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (input.cursor) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
    } catch {
      throw new Error('Invalid cursor format');
    }
  }

  let result;
  if (input.pipelinePath) {
    result = await docClient.send(
      new QueryCommand({
        TableName: TELEMETRY_TABLE,
        IndexName: 'pipelinePath-createdAt-index',
        KeyConditionExpression: 'pipelinePath = :pp',
        ExpressionAttributeValues: { ':pp': input.pipelinePath },
        Limit: input.limit,
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
  } else {
    result = await docClient.send(
      new ScanCommand({
        TableName: TELEMETRY_TABLE,
        Limit: input.limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
  }

  const records = (result.Items ?? []) as Record<string, unknown>[];

  let nextCursor: string | undefined;
  if (result.LastEvaluatedKey) {
    nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url');
  }

  return { records, total: result.Count ?? records.length, nextCursor };
}