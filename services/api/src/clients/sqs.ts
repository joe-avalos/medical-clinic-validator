import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { VerificationJobMessage } from '@medical-validator/shared';

const sqs = new SQSClient({
  endpoint: process.env.SQS_ENDPOINT || 'http://localhost:4566',
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
});

const VERIFICATION_QUEUE_URL =
  process.env.SQS_VERIFICATION_QUEUE_URL ||
  'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/verification-queue.fifo';

export async function sendToVerificationQueue(
  message: VerificationJobMessage,
): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: VERIFICATION_QUEUE_URL,
      MessageBody: JSON.stringify(message),
      MessageGroupId: message.normalizedName.replace(/[^a-zA-Z0-9._-]/g, '_'),
      MessageDeduplicationId: message.jobId.slice(0, 128),
    }),
  );
}