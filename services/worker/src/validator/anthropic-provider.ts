import Anthropic from '@anthropic-ai/sdk';
import { ValidationResultSchema } from '@medical-validator/shared';
import type { RawCompanyRecord, ValidationResult } from '@medical-validator/shared';
import type { AIProvider } from './ai-provider.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';
import { buildFallbackResult } from '../shared/constants.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS) || 1536;
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 30000;
const MAX_RETRIES = Number(process.env.CLAUDE_MAX_RETRIES) || 3;
const CONCURRENCY = Number(process.env.VALIDATOR_CONCURRENCY) || 3;
const BATCH_DELAY_MS = Number(process.env.VALIDATOR_BATCH_DELAY_MS) || 1000;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export class AnthropicProvider implements AIProvider {
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ timeout: TIMEOUT_MS });
    }
    return this.client;
  }

  async validateAll(companies: RawCompanyRecord[]): Promise<ValidationResult[]> {
    if (companies.length === 1) {
      return [await this.validateOne(companies[0])];
    }

    console.log(`[ai-validator] Validating ${companies.length} companies (concurrency: ${CONCURRENCY})`);

    const batches = chunk(companies, CONCURRENCY);
    const results: ValidationResult[] = [];

    for (let i = 0; i < batches.length; i++) {
      console.log(`[ai-validator] Batch ${i + 1}/${batches.length} (${batches[i].length} concurrent calls)`);
      const batchResults = await Promise.all(batches[i].map((c) => this.validateOne(c)));
      results.push(...batchResults);

      if (i < batches.length - 1) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    console.log(`[ai-validator] Completed ${results.length} individual validations`);
    return results;
  }

  private async validateOne(company: RawCompanyRecord): Promise<ValidationResult> {
    const client = this.getClient();
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt([company]);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });

        const text = response.content
          .filter((block) => block.type === 'text')
          .map((block) => 'text' in block ? block.text : '')
          .join('');

        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
        const parsed = JSON.parse(cleaned);

        if (Array.isArray(parsed)) {
          return ValidationResultSchema.parse(parsed[0]);
        }
        return ValidationResultSchema.parse(parsed);
      } catch (err) {
        console.warn(`[ai-validator] ${company.name} attempt ${attempt}/${MAX_RETRIES} failed:`, (err as Error).message);
        if (attempt === MAX_RETRIES) {
          console.error(`[ai-validator] ${company.name}: all retries exhausted, returning fallback`);
          return buildFallbackResult(company);
        }
      }
    }

    // Unreachable: loop always returns inside or via fallback on MAX_RETRIES
    return buildFallbackResult(company);
  }
}