import { pollQueue } from './shared/sqs.js';
import { getSecrets } from './shared/secrets.js';
import { createLogger } from './shared/logger.js';

const WORKER_TYPE = process.env.WORKER_TYPE;

if (!WORKER_TYPE) {
  const boot = createLogger('bootstrap');
  boot.fatal('WORKER_TYPE env var is required. Options: scraper, ai-validator, storage');
  process.exit(1);
}

const log = createLogger(WORKER_TYPE);
const ac = new AbortController();

process.on('SIGINT', () => {
  log.info('Shutting down (SIGINT)');
  ac.abort();
});
process.on('SIGTERM', () => {
  log.info('Shutting down (SIGTERM)');
  ac.abort();
});

async function main(): Promise<void> {
  // Fetch secrets before dynamic imports so module-level process.env reads pick them up
  const secrets = await getSecrets();
  process.env.ANTHROPIC_API_KEY = secrets.ANTHROPIC_API_KEY;
  process.env.OC_API_TOKEN = secrets.OC_API_TOKEN;

  log.info(
    {
      WORKER_TYPE,
      SCRAPER_PROVIDER: process.env.SCRAPER_PROVIDER ?? '(unset)',
      AI_PROVIDER: process.env.AI_PROVIDER ?? '(unset)',
      REDIS_URL: process.env.REDIS_URL ?? '(unset)',
      SQS_ENDPOINT: process.env.SQS_ENDPOINT ?? '(unset)',
      NODE_ENV: process.env.NODE_ENV ?? '(unset)',
    },
    'Starting worker',
  );

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
      log.fatal({ workerType: WORKER_TYPE }, 'Unknown WORKER_TYPE. Options: scraper, ai-validator, storage');
      process.exit(1);
  }
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal error');
  process.exit(1);
});
