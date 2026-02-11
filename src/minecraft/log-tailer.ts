import { EventEmitter } from 'node:events';
import { createReadStream, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { watch } from 'chokidar';
import { logger } from '../utils/logger.js';

export class LogTailer extends EventEmitter {
  private watcher: ReturnType<typeof watch> | null = null;
  private filePath: string;
  private fileOffset: number = 0;
  private processing = false;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
  }

  start(): void {
    // Start at end of current file so we only get new lines
    try {
      const stats = statSync(this.filePath);
      this.fileOffset = stats.size;
    } catch {
      // File doesn't exist yet — start from 0
      this.fileOffset = 0;
    }

    logger.info(`Tailing log file: ${this.filePath}`);

    this.watcher = watch(this.filePath, {
      persistent: true,
      usePolling: true,
      interval: 500,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', () => {
      this.readNewLines();
    });

    // When MC server restarts, latest.log gets truncated before we can read
    // the shutdown line. Detect this and emit a synthetic "Stopping the server" line.
    this.watcher.on('unlink', () => {
      logger.info('Log file removed/truncated — server likely restarting');
      this.fileOffset = 0;
      this.emit('line', '[00Jan0000 00:00:00.000] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: Stopping the server');
    });

    this.watcher.on('error', (error) => {
      logger.error('Log tailer watcher error:', error);
    });
  }

  private readNewLines(): void {
    if (this.processing) return;
    this.processing = true;

    let currentSize: number;
    try {
      currentSize = statSync(this.filePath).size;
    } catch {
      this.processing = false;
      return;
    }

    // Log file was rotated/truncated
    if (currentSize < this.fileOffset) {
      logger.info('Log file rotated, reading from start');
      this.fileOffset = 0;
    }

    if (currentSize === this.fileOffset) {
      this.processing = false;
      return;
    }

    const stream = createReadStream(this.filePath, {
      start: this.fileOffset,
      encoding: 'utf-8',
    });

    const rl = createInterface({ input: stream });

    rl.on('line', (line) => {
      if (line.trim()) {
        this.emit('line', line);
      }
    });

    rl.on('close', () => {
      this.fileOffset = currentSize;
      this.processing = false;
    });

    rl.on('error', (error) => {
      logger.error('Error reading log lines:', error);
      this.processing = false;
    });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    logger.info('Log tailer stopped');
  }
}
