import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import type { AppSecrets } from '@medical-validator/shared';

const SECRET_NAME = process.env.SECRETS_MANAGER_SECRET_NAME || 'medical-validator/secrets';

let cached: AppSecrets | null = null;

export async function getSecrets(): Promise<AppSecrets> {
  if (cached) return cached;

  if (process.env.SECRETS_MANAGER_ENABLED !== 'true') {
    cached = {
      JWT_SECRET: process.env.JWT_SECRET || '',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      OC_API_TOKEN: process.env.OC_API_TOKEN || '',
    };
    return cached;
  }

  const client = new SecretsManagerClient({
    endpoint: process.env.SECRETSMANAGER_ENDPOINT || 'http://localhost:4566',
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
  });

  const result = await client.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME }),
  );

  if (!result.SecretString) {
    throw new Error(`Secret ${SECRET_NAME} has no SecretString`);
  }

  cached = JSON.parse(result.SecretString) as AppSecrets;
  return cached;
}

/** Reset cached secrets (for testing). */
export function _resetSecretsCache(): void {
  cached = null;
}
