import { describe, it, expect } from 'vitest';
import { createLogger } from '../logger.js';

describe('createLogger', () => {
  it('returns a logger with expected methods', () => {
    const log = createLogger('test-service');
    expect(log.info).toBeTypeOf('function');
    expect(log.warn).toBeTypeOf('function');
    expect(log.error).toBeTypeOf('function');
    expect(log.debug).toBeTypeOf('function');
    expect(log.fatal).toBeTypeOf('function');
  });

  it('supports child loggers', () => {
    const log = createLogger('test-service');
    const child = log.child({ jobId: 'job-123' });
    expect(child.info).toBeTypeOf('function');
    expect(child.warn).toBeTypeOf('function');
    expect(child.error).toBeTypeOf('function');
  });
});
