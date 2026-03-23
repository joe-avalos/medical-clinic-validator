/**
 * Normalizes a company name for cache key usage and deduplication.
 * Lowercases, trims, collapses whitespace, strips punctuation (preserves hyphens).
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ');
}
