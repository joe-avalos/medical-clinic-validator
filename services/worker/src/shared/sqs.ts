import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { createLogger } from './logger.js';

const log = createLogger('sqs');

const sqs = new SQSClient({
  endpoint: process.env.SQS_ENDPOINT || 'http://localhost:4566',
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
});

export interface SqsHandler {
  (body: unknown): Promise<void>;
}

/**
 * Long-polls an SQS FIFO queue and invokes the handler for each message.
 * Deletes the message after successful processing.
 * On handler error, the message returns to the queue after the visibility timeout.
 */
export async function pollQueue(
  queueUrl: string,
  handler: SqsHandler,
  signal?: AbortSignal,
): Promise<void> {
  log.info({ queueUrl }, 'Polling started');

  while (!signal?.aborted) {
    try {
      const result = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20,
        }),
      );

      if (!result.Messages || result.Messages.length === 0) {
        continue;
      }

      for (const message of result.Messages) {
        if (!message.Body || !message.ReceiptHandle) {
          log.warn('Received message with missing Body or ReceiptHandle, skipping');
          continue;
        }

        try {
          const body = JSON.parse(message.Body);
          await handler(body);

          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: queueUrl,
              ReceiptHandle: message.ReceiptHandle,
            }),
          );
        } catch (err) {
          log.error({ err }, 'Handler error, message will return to queue');
        }
      }
    } catch (err) {
      if (signal?.aborted) break;
      log.error({ err }, 'Poll error, retrying in 5s');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  log.info('Polling stopped');
}

/**
 * Sends a message to an SQS FIFO queue.
 */
export async function sendMessage(
  queueUrl: string,
  body: unknown,
  messageGroupId: string,
): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(body),
      MessageGroupId: messageGroupId,
    }),
  );
}
