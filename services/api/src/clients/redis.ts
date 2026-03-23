import { createClient } from 'redis';

let client: ReturnType<typeof createClient> | null = null;

async function getClient() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    client.on('error', (err) => console.warn('[redis] Connection error:', err.message));
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