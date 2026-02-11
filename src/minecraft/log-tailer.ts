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
  private initialAdd = true;

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

    // New file created (after rotation) — read from start
    // Skip the first add event (chokidar fires it for the existing file on startup)
    this.watcher.on('add', () => {
      if (this.initialAdd) {
        this.initialAdd = false;
        return;
      }
      this.fileOffset = 0;
      this.readNewLines();
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
      try {
        this.fileOffset = statSync(this.filePath).size;
      } catch {
        this.fileOffset = currentSize;
      }
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
