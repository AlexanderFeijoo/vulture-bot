import { logger } from './logger.js';

type ShutdownHandler = () => Promise<void> | void;

const handlers: ShutdownHandler[] = [];
let shuttingDown = false;

export function onShutdown(handler: ShutdownHandler): void {
  handlers.push(handler);
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal}, shutting down gracefully...`);

  for (const handler of handlers.reverse()) {
    try {
      await handler();
    } catch (error) {
      logger.error('Shutdown handler error:', error);
    }
  }

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
