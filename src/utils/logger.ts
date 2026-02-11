import winston from 'winston';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      const msg = stack ?? message;
      return `[${timestamp}] ${level.toUpperCase()}: ${msg}`;
    }),
  ),
  transports: [
    new winston.transports.Console(),
  ],
});
