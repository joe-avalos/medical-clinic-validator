import { ValidationResultSchema } from '@medical-validator/shared';
import type { RawCompanyRecord, ValidationResult } from '@medical-validator/shared';
import type { AIProvider } from './ai-provider.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';
import { buildFallbackResult } from '../shared/constants.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('ai-validator');

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral:7b-instruct';
const MAX_RETRIES = Number(process.env.OLLAMA_MAX_RETRIES) || 3;

export class OllamaProvider implements AIProvider {
  async validateAll(companies: RawCompanyRecord[]): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    for (const company of companies) {
      results.push(await this.validateOne(company));
    }
    return results;
  }

  private async validateOne(company: RawCompanyRecord): Promise<ValidationResult> {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt([company]);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0,
            stream: false,
          }),
        });

        if (!response.ok) {
          throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { choices: Array<{ message: { content: string } }> };
        const text = data.choices[0]?.message?.content ?? '';
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
        const parsed = JSON.parse(cleaned);
        return ValidationResultSchema.parse(parsed);
      } catch (err) {
        log.warn({ company: company.name, attempt, maxRetries: MAX_RETRIES, err: (err as Error).message }, 'Ollama validation attempt failed');
        if (attempt === MAX_RETRIES) {
          log.error({ company: company.name, outcome: 'fallback' }, 'Ollama all retries exhausted — returning fallback');
          return buildFallbackResult(company);
        }
      }
    }

    return buildFallbackResult(company);
  }
}