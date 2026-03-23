import Redis from 'ioredis';
import type { RawCompanyRecord } from '@medical-validator/shared';

const CACHE_TTL = 86400; // 24 hours
const KEY_PREFIX = 'scraper:company:';

let redis: Redis | null = null;

function getClient(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    redis.on('error', (err) => {
      console.warn('[redis] Connection error:', err.message);
    });
  }
  return redis;
}

export async function getCachedScraperResult(
  normalizedName: string,
): Promise<RawCompanyRecord[] | null> {
  const raw = await getClient().get(`${KEY_PREFIX}${normalizedName}`);
  if (!raw) return null;
  return JSON.parse(raw) as RawCompanyRecord[];
}

export async function setCachedScraperResult(
  normalizedName: string,
  companies: RawCompanyRecord[],
): Promise<void> {
  await getClient().set(
    `${KEY_PREFIX}${normalizedName}`,
    JSON.stringify(companies),
    'EX',
    CACHE_TTL,
  );
}
