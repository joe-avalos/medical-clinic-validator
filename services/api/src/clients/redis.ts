import { createClient } from 'redis';
import { createLogger } from '../shared/logger.js';

const log = createLogger('redis');
let client: ReturnType<typeof createClient> | null = null;

async function getClient() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    client.on('error', (err) => log.warn({ err: err.message }, 'Connection error'));
    await client.connect();
  }
  return client;
}

export interface CachedJobRef {
  jobId: string;
  createdAt: string;
}

export async function getCachedJobId(normalizedName: string): Promise<CachedJobRef | null> {
  const redis = await getClient();
  const raw = await redis.get(`query:job:${normalizedName}`);
  if (!raw) return null;
  return JSON.parse(raw) as CachedJobRef;
}

export async function deleteCachedJobId(normalizedName: string): Promise<void> {
  const redis = await getClient();
  await redis.del(`query:job:${normalizedName}`);
}