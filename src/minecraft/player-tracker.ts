import { EventEmitter } from 'node:events';
import { LogTailer } from './log-tailer.js';
import { parseLogLine } from './log-parser.js';
import { MinecraftRcon } from './rcon-client.js';
import type { MinecraftEvent } from './events.js';
import { logger } from '../utils/logger.js';

export class PlayerTracker extends EventEmitter {
  private onlinePlayers = new Set<string>();
  private tailer: LogTailer;
  private rcon: MinecraftRcon;
  private reconcileInterval: ReturnType<typeof setInterval> | null = null;
  private reconcileIntervalMs: number;

  constructor(tailer: LogTailer, rcon: MinecraftRcon, reconcileIntervalMs: number) {
    super();
    this.tailer = tailer;
    this.rcon = rcon;
    this.reconcileIntervalMs = reconcileIntervalMs;
  }

  async start(): Promise<void> {
    // Wire up log tailer → parser → events
    this.tailer.on('line', (line: string) => {
      const event = parseLogLine(line);
      if (event) this.handleEvent(event);
    });

    this.tailer.start();

    // Initial RCON sync
    await this.reconcileWithRcon();

    // Periodic reconciliation
    this.reconcileInterval = setInterval(() => {
      this.reconcileWithRcon().catch((err) => {
        logger.warn('RCON reconciliation failed:', err);
      });
    }, this.reconcileIntervalMs);

    logger.info('Player tracker started');
  }

  private handleEvent(event: MinecraftEvent): void {
    switch (event.type) {
      case 'player_join':
        this.onlinePlayers.add(event.player);
        logger.info(`Player joined: ${event.player} (${this.onlinePlayers.size} online)`);
        break;
      case 'player_leave':
        this.onlinePlayers.delete(event.player);
        logger.info(`Player left: ${event.player} (${this.onlinePlayers.size} online)`);
        break;
    }

    this.emit('event', event);
  }

  private async reconcileWithRcon(): Promise<void> {
    try {
      const rconPlayers = await this.rcon.listPlayers();
      const rconSet = new Set(rconPlayers);

      // Detect players we missed joining
      for (const player of rconPlayers) {
        if (!this.onlinePlayers.has(player)) {
          logger.info(`RCON reconciliation: adding missed player ${player}`);
          this.onlinePlayers.add(player);
        }
      }

      // Detect players we missed leaving
      for (const player of this.onlinePlayers) {
        if (!rconSet.has(player)) {
          logger.info(`RCON reconciliation: removing stale player ${player}`);
          this.onlinePlayers.delete(player);
        }
      }

      logger.debug(`RCON reconciliation complete: ${this.onlinePlayers.size} players online`);
    } catch (error) {
      logger.warn('RCON reconciliation error:', error);
    }
  }

  getOnlinePlayers(): string[] {
    return [...this.onlinePlayers].sort();
  }

  getPlayerCount(): number {
    return this.onlinePlayers.size;
  }

  stop(): void {
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }
    this.tailer.stop();
    logger.info('Player tracker stopped');
  }
}
