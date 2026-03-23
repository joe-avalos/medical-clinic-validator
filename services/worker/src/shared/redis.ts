import Redis from 'ioredis';

const CACHE_TTL = 86400; // 24 hours
const QUERY_KEY_PREFIX = 'query:job:';

let redis: Redis | null = null;

function getClient(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    redis.on('error', (err: Error) => {
      console.warn('[redis] Connection error:', err.message);
    });
  }
  return redis;
}

export interface CachedJobRef {
  jobId: string;
  createdAt: string;
}

export async function getCachedJobId(
  normalizedName: string,
): Promise<CachedJobRef | null> {
  const raw = await getClient().get(`${QUERY_KEY_PREFIX}${normalizedName}`);
  if (!raw) return null;
  return JSON.parse(raw) as CachedJobRef;
}

export async function setCachedJobId(
  normalizedName: string,
  jobId: string,
  createdAt: string,
): Promise<void> {
  await getClient().set(
    `${QUERY_KEY_PREFIX}${normalizedName}`,
    JSON.stringify({ jobId, createdAt }),
    'EX',
    CACHE_TTL,
  );
}