import { ScraperResultMessageSchema } from '@medical-validator/shared';

export async function handleValidatorMessage(body: unknown): Promise<void> {
  const message = ScraperResultMessageSchema.parse(body);
  console.log(`[ai-validator] Received job ${message.jobId} with ${message.companies.length} companies`);

  // TODO: Implement validator pipeline
  // 1. If companies[] empty → return UNKNOWN risk
  // 2. Create AI provider (anthropic or ollama)
  // 3. Call provider.validate(companies)
  // 4. Publish ValidationResultMessage to storage queue

  throw new Error('AI Validator worker not yet implemented');
}
