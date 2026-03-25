import pino from 'pino';

const transport =
  process.env.NODE_ENV === 'production'
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      };

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport,
});

export function createLogger(service: string) {
  return baseLogger.child({ service });
}