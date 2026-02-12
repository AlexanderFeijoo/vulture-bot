import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import mineflayer, { type Bot } from 'mineflayer';
import 'mineflayer-pathfinder'; // type augmentation only
import { logger } from '../utils/logger.js';
import type { AIPlayerConfig } from './types.js';

const require = createRequire(import.meta.url);
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { plugin: collectBlock } = require('mineflayer-collectblock');
const { loader: autoEat } = require('mineflayer-auto-eat');

export class AIPlayerBot extends EventEmitter {
  private bot: Bot | null = null;
  private config: AIPlayerConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;

  constructor(config: AIPlayerConfig) {
    super();
    this.config = config;
  }

  get mcBot(): Bot | null {
    return this.bot;
  }

  get isConnected(): boolean {
    return this.bot !== null;
  }

  get username(): string {
    return this.config.username;
  }

  async connect(): Promise<void> {
    this.intentionalDisconnect = false;

    logger.info(`AI Player connecting as ${this.config.username} to ${this.config.host}:${this.config.port}`);

    return new Promise((resolve, reject) => {
      try {
        this.bot = mineflayer.createBot({
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          auth: this.config.auth,
          version: '1.20.1',
          hideErrors: false,
          // FML3 marker tells Forge server we speak Forge protocol
          fakeHost: `${this.config.host}\0FML3\0`,
        });

        this.bot.loadPlugin(pathfinder);
        this.bot.loadPlugin(collectBlock);
        this.bot.loadPlugin(autoEat);

        this.bot.once('spawn', () => {
          logger.info(`AI Player spawned as ${this.config.username}`);
          this.reconnectAttempts = 0;
          this.setupMovements();
          this.setupAutoEat();
          this.emit('spawned');
          resolve();
        });

        this.bot.on('death', () => {
          logger.info('AI Player died');
          this.emit('died');
        });

        this.bot.on('kicked', (reason: string) => {
          logger.warn(`AI Player kicked: ${reason}`);
          this.bot = null;
          this.emit('kicked', reason);
          this.scheduleReconnect();
        });

        this.bot.on('end', (reason: string) => {
          logger.info(`AI Player disconnected: ${reason}`);
          this.bot = null;
          this.emit('disconnected', reason);
          if (!this.intentionalDisconnect) {
            this.scheduleReconnect();
          }
        });

        this.bot.on('error', (err: Error) => {
          logger.error('AI Player bot error:', err);
          // Don't reject after initial spawn — errors during gameplay are non-fatal
        });

        // Forward chat events
        this.bot.on('chat', (username: string, message: string) => {
          if (username === this.config.username) return; // Ignore own messages
          this.emit('chat', username, message);
        });

        // Forward damage events
        this.bot.on('health', () => {
          this.emit('health');
        });

        // Forward entity events
        this.bot.on('entityHurt', (entity: any) => {
          if (entity === this.bot?.entity) {
            this.emit('damaged');
          }
        });

        this.bot.on('playerJoined', (player: any) => {
          if (player.username !== this.config.username) {
            this.emit('playerJoined', player.username);
          }
        });

        this.bot.on('playerLeft', (player: any) => {
          if (player.username !== this.config.username) {
            this.emit('playerLeft', player.username);
          }
        });

      } catch (err) {
        reject(err);
      }
    });
  }

  private setupMovements(): void {
    if (!this.bot) return;
    const mcData = require('minecraft-data')(this.bot.version);
    const movements = new Movements(this.bot);
    movements.scafoldingBlocks = [];
    movements.canDig = true;
    this.bot.pathfinder.setMovements(movements);
  }

  private setupAutoEat(): void {
    if (!this.bot) return;
    (this.bot as any).autoEat.options = {
      priority: 'foodPoints',
      startAt: 14,
      bannedFood: [],
    };
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`AI Player: Max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`);
      return;
    }

    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts++;
    logger.info(`AI Player: Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        logger.error('AI Player reconnection failed:', err);
      });
    }, delay);
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.bot) {
      this.bot.quit();
      this.bot = null;
    }
    logger.info('AI Player disconnected gracefully');
  }
}

// Re-export pathfinder goals for use in actions
export { goals as PathfinderGoals };
