import Anthropic from '@anthropic-ai/sdk';
import { ValidationResultSchema } from '@medical-validator/shared';
import type { RawCompanyRecord, ValidationResult } from '@medical-validator/shared';
import type { AIProvider } from './ai-provider.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS) || 2048;
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 30000;
const MAX_RETRIES = Number(process.env.CLAUDE_MAX_RETRIES) || 3;

function buildFallbackResult(companies: RawCompanyRecord[]): ValidationResult {
  const first = companies[0];
  return {
    companyName: first?.name ?? 'Unknown',
    jurisdiction: first?.jurisdiction ?? 'unknown',
    registrationNumber: first?.companyNumber ?? 'unknown',
    incorporationDate: first?.incorporationDate ?? null,
    legalStatus: 'Unknown',
    standardizedAddress: first?.address ?? 'unknown',
    providerType: 'Unknown',
    riskLevel: 'UNKNOWN',
    riskFlags: ['AI validation unavailable'],
    aiSummary: 'AI validation unavailable — manual review required.',
    confidence: 'LOW',
  };
}

export class AnthropicProvider implements AIProvider {
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ timeout: TIMEOUT_MS });
    }
    return this.client;
  }

  async validate(companies: RawCompanyRecord[]): Promise<ValidationResult> {
    const client = this.getClient();
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(companies);

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

        const parsed = JSON.parse(text);
        return ValidationResultSchema.parse(parsed);
      } catch (err) {
        console.warn(`[ai-validator] Attempt ${attempt}/${MAX_RETRIES} failed:`, (err as Error).message);
        if (attempt === MAX_RETRIES) {
          console.error('[ai-validator] All retries exhausted, returning fallback');
          return buildFallbackResult(companies);
        }
      }
    }

    // Unreachable — loop always returns on last attempt — but satisfies TypeScript
    return buildFallbackResult(companies);
  }
}
