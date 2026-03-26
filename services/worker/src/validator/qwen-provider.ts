import { ValidationResultSchema } from '@medical-validator/shared';
import type { RawCompanyRecord, ValidationResult } from '@medical-validator/shared';
import type { AIProvider } from './ai-provider.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';
import { buildFallbackResult } from '../shared/constants.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('ai-validator:qwen');

const OLLAMA_BASE_URL = process.env.QWEN_OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const MODEL = process.env.QWEN_MODEL || 'medical-validator';
const MAX_RETRIES = Math.max(1, parseInt(process.env.QWEN_MAX_RETRIES ?? '', 10) || 3);
const TIMEOUT_MS = Math.max(1000, parseInt(process.env.QWEN_TIMEOUT_MS ?? '', 10) || 15000);
const CONCURRENCY = Math.max(1, parseInt(process.env.QWEN_CONCURRENCY ?? '', 10) || 5);

if (!process.env.QWEN_OLLAMA_URL && !process.env.OLLAMA_BASE_URL) {
  log.warn({ url: OLLAMA_BASE_URL }, 'No QWEN_OLLAMA_URL or OLLAMA_BASE_URL set — using default');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export class QwenProvider implements AIProvider {
  async validateAll(companies: RawCompanyRecord[]): Promise<ValidationResult[]> {
    if (companies.length === 1) {
      return [await this.validateOne(companies[0])];
    }

    log.info({ companyCount: companies.length, concurrency: CONCURRENCY }, 'Qwen batch validation starting');

    // Higher concurrency than Anthropic — local model, no rate limits
    const batches = chunk(companies, CONCURRENCY);
    const results: ValidationResult[] = [];

    for (const batch of batches) {
      const batchResults = await Promise.all(batch.map((c) => this.validateOne(c)));
      results.push(...batchResults);
    }

    log.info({ completedCount: results.length }, 'Qwen batch validation complete');
    return results;
  }

  private async validateOne(company: RawCompanyRecord): Promise<ValidationResult> {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt([company]);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0,
            stream: false,
          }),
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`Qwen/Ollama API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { choices: Array<{ message: { content: string } }> };
        const text = data.choices[0]?.message?.content ?? '';
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
        const parsed = JSON.parse(cleaned);
        return ValidationResultSchema.parse(parsed);
      } catch (err) {
        log.warn(
          { company: company.name, attempt, maxRetries: MAX_RETRIES, err: (err as Error).message },
          'Qwen validation attempt failed',
        );
        if (attempt === MAX_RETRIES) {
          log.error({ company: company.name, outcome: 'fallback' }, 'Qwen all retries exhausted — returning fallback');
          return buildFallbackResult(company);
        }
      }
    }

    return buildFallbackResult(company);
  }
}
