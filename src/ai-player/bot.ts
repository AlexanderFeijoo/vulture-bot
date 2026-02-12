import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';
import type { MinecraftRcon } from '../minecraft/rcon-client.js';
import type { AIPlayerConfig } from './types.js';

/**
 * RCON-based NPC controller. The NPC lives as a server-side Forge mod entity.
 * This class sends /nuncle commands via RCON and receives events from the log tailer.
 */
export class AIPlayerBot extends EventEmitter {
  private rcon: MinecraftRcon;
  private config: AIPlayerConfig;
  private spawned = false;

  constructor(config: AIPlayerConfig, rcon: MinecraftRcon) {
    super();
    this.config = config;
    this.rcon = rcon;
  }

  get isConnected(): boolean {
    return this.spawned;
  }

  get username(): string {
    return this.config.username;
  }

  async connect(): Promise<void> {
    logger.info(`Spawning NPC ${this.config.username} via RCON...`);

    try {
      const response = await this.rcon.sendCommand('nuncle spawn');
      logger.info(`NPC spawn response: ${response}`);
      this.spawned = true;
      // Emit spawned on next tick to allow event listeners to be set up
      process.nextTick(() => this.emit('spawned'));
    } catch (err) {
      logger.error('Failed to spawn NPC:', err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.spawned) {
      try {
        await this.rcon.sendCommand('nuncle despawn');
      } catch {
        logger.warn('Failed to despawn NPC (server may be down)');
      }
      this.spawned = false;
    }
    logger.info('NPC disconnected');
  }

  /** Send a /nuncle command and return the response text */
  async sendCommand(subcommand: string): Promise<string> {
    try {
      const response = await this.rcon.sendCommand(`nuncle ${subcommand}`);
      return response;
    } catch (err: any) {
      logger.warn(`RCON command failed (nuncle ${subcommand}): ${err.message}`);
      return `Error: ${err.message}`;
    }
  }

  // --- Events injected from log tailer (called by index.ts) ---

  handleNuncleEvent(event: string, data: string): void {
    switch (event) {
      case 'DAMAGED':
        this.emit('damaged', data);
        break;
      case 'DIED':
        this.spawned = false;
        this.emit('died');
        break;
      case 'SAID':
        // Our own chat, ignore
        break;
      default:
        logger.debug(`Unknown NUNCLE event: ${event} ${data}`);
    }
  }

  handleChat(player: string, message: string): void {
    if (player === this.config.username) return;
    this.emit('chat', player, message);
  }

  handlePlayerJoined(player: string): void {
    if (player === this.config.username) return;
    this.emit('playerJoined', player);
  }

  handlePlayerLeft(player: string): void {
    if (player === this.config.username) return;
    this.emit('playerLeft', player);
  }
}
