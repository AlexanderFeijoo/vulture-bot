import { EventEmitter } from 'node:events';
import { createReadStream, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { logger } from '../utils/logger.js';

export class LogTailer extends EventEmitter {
  private filePath: string;
  private fileOffset: number = 0;
  private processing = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastInode: number = 0;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
  }

  start(): void {
    // Start at end of current file so we only get new lines
    try {
      const stats = statSync(this.filePath);
      this.fileOffset = stats.size;
      this.lastInode = stats.ino;
    } catch {
      this.fileOffset = 0;
      this.lastInode = 0;
    }

    logger.info(`Tailing log file: ${this.filePath}`);

    // Simple poll every 500ms — survives file rotation reliably
    this.pollTimer = setInterval(() => {
      this.readNewLines();
    }, 500);
  }

  private readNewLines(): void {
    if (this.processing) return;
    this.processing = true;

    let currentSize: number;
    let currentInode: number;
    try {
      const stats = statSync(this.filePath);
      currentSize = stats.size;
      currentInode = stats.ino;
    } catch {
      this.processing = false;
      return;
    }

    // File was recreated (new inode) — reset to read from start
    if (currentInode !== this.lastInode) {
      logger.info('Log file rotated (new file), reading from start');
      this.fileOffset = 0;
      this.lastInode = currentInode;
    }

    // File was truncated in place
    if (currentSize < this.fileOffset) {
      logger.info('Log file truncated, reading from start');
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
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('Log tailer stopped');
  }
}
