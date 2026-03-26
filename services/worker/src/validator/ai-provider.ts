import type { RawCompanyRecord, ValidationResult } from '@medical-validator/shared';
import { AnthropicProvider } from './anthropic-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import { QwenProvider } from './qwen-provider.js';

export interface AIProvider {
  validateAll(companies: RawCompanyRecord[]): Promise<ValidationResult[]>;
}

type ProviderType = 'anthropic' | 'ollama' | 'qwen';

export function createAIProvider(type?: ProviderType): AIProvider {
  const provider = type ?? (process.env.AI_PROVIDER as ProviderType | undefined) ?? 'anthropic';

  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'ollama':
      return new OllamaProvider();
    case 'qwen':
      return new QwenProvider();
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}