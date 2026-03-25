import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('@aws-sdk/client-secrets-manager', () => {
  return {
    SecretsManagerClient: class { send = mockSend; },
    GetSecretValueCommand: class { constructor(public input: unknown) {} },
  };
});

import { getSecrets, _resetSecretsCache } from '../secrets.js';

describe('getSecrets', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetSecretsCache();
    mockSend.mockReset();
    process.env = { ...originalEnv };
    delete process.env.SECRETS_MANAGER_ENABLED;
  });

  it('returns values from process.env when SECRETS_MANAGER_ENABLED is not set', async () => {
    process.env.JWT_SECRET = 'env-jwt';
    process.env.ANTHROPIC_API_KEY = 'env-anthropic';
    process.env.OC_API_TOKEN = 'env-oc';

    const secrets = await getSecrets();

    expect(secrets).toEqual({
      JWT_SECRET: 'env-jwt',
      ANTHROPIC_API_KEY: 'env-anthropic',
      OC_API_TOKEN: 'env-oc',
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('fetches from Secrets Manager when SECRETS_MANAGER_ENABLED=true', async () => {
    process.env.SECRETS_MANAGER_ENABLED = 'true';
    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({
        JWT_SECRET: 'sm-jwt',
        ANTHROPIC_API_KEY: 'sm-anthropic',
        OC_API_TOKEN: 'sm-oc',
      }),
    });

    const secrets = await getSecrets();

    expect(secrets).toEqual({
      JWT_SECRET: 'sm-jwt',
      ANTHROPIC_API_KEY: 'sm-anthropic',
      OC_API_TOKEN: 'sm-oc',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('caches result on subsequent calls', async () => {
    process.env.SECRETS_MANAGER_ENABLED = 'true';
    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({
        JWT_SECRET: 'cached',
        ANTHROPIC_API_KEY: 'cached',
        OC_API_TOKEN: 'cached',
      }),
    });

    await getSecrets();
    await getSecrets();

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('throws when SecretString is empty', async () => {
    process.env.SECRETS_MANAGER_ENABLED = 'true';
    mockSend.mockResolvedValue({ SecretString: undefined });

    await expect(getSecrets()).rejects.toThrow('has no SecretString');
  });

  it('defaults missing env vars to empty string in fallback mode', async () => {
    delete process.env.JWT_SECRET;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OC_API_TOKEN;

    const secrets = await getSecrets();

    expect(secrets.JWT_SECRET).toBe('');
    expect(secrets.ANTHROPIC_API_KEY).toBe('');
    expect(secrets.OC_API_TOKEN).toBe('');
  });
});
