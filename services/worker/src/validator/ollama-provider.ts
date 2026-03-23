import { ValidationResultSchema } from '@medical-validator/shared';
import type { RawCompanyRecord, ValidationResult } from '@medical-validator/shared';
import type { AIProvider } from './ai-provider.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral:7b-instruct';

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

export class OllamaProvider implements AIProvider {
  async validate(companies: RawCompanyRecord[]): Promise<ValidationResult> {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(companies);

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
      const parsed = JSON.parse(text);
      return ValidationResultSchema.parse(parsed);
    } catch (err) {
      console.error('[ai-validator] Ollama provider failed:', (err as Error).message);
      return buildFallbackResult(companies);
    }
  }
}
