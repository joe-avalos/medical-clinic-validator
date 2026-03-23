import { pollQueue } from './shared/sqs.js';

const WORKER_TYPE = process.env.WORKER_TYPE;

if (!WORKER_TYPE) {
  console.error('WORKER_TYPE env var is required. Options: scraper, ai-validator, storage');
  process.exit(1);
}

const ac = new AbortController();

process.on('SIGINT', () => {
  console.log(`[${WORKER_TYPE}] Shutting down...`);
  ac.abort();
});
process.on('SIGTERM', () => {
  console.log(`[${WORKER_TYPE}] Shutting down...`);
  ac.abort();
});

async function main(): Promise<void> {
  console.log(`[${WORKER_TYPE}] Starting worker`);

  switch (WORKER_TYPE) {
    case 'scraper': {
      const queueUrl = process.env.SQS_VERIFICATION_QUEUE_URL;
      if (!queueUrl) throw new Error('SQS_VERIFICATION_QUEUE_URL is required');
      const { handleScraperMessage, shutdownScraper } = await import('./scraper/handler.js');
      await pollQueue(queueUrl, handleScraperMessage, ac.signal);
      await shutdownScraper();
      break;
    }
    case 'ai-validator': {
      const queueUrl = process.env.SQS_VALIDATION_QUEUE_URL;
      if (!queueUrl) throw new Error('SQS_VALIDATION_QUEUE_URL is required');
      const { handleValidatorMessage } = await import('./validator/handler.js');
      await pollQueue(queueUrl, handleValidatorMessage, ac.signal);
      break;
    }
    case 'storage': {
      const queueUrl = process.env.SQS_STORAGE_QUEUE_URL;
      if (!queueUrl) throw new Error('SQS_STORAGE_QUEUE_URL is required');
      const { handleStorageMessage } = await import('./storage/handler.js');
      await pollQueue(queueUrl, handleStorageMessage, ac.signal);
      break;
    }
    default:
      console.error(`Unknown WORKER_TYPE: ${WORKER_TYPE}. Options: scraper, ai-validator, storage`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[${WORKER_TYPE}] Fatal error:`, err);
  process.exit(1);
});
