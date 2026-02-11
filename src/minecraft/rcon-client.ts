import { Rcon } from 'rcon-client';
import { logger } from '../utils/logger.js';

export interface RconConfig {
  host: string;
  port: number;
  password: string;
}

export class MinecraftRcon {
  private rcon: Rcon | null = null;
  private config: RconConfig;
  private connecting = false;

  constructor(config: RconConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.rcon?.authenticated || this.connecting) return;
    this.connecting = true;

    try {
      this.rcon = await Rcon.connect({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
      });

      this.rcon.on('end', () => {
        logger.warn('RCON connection closed');
        this.rcon = null;
      });

      logger.info(`RCON connected to ${this.config.host}:${this.config.port}`);
    } catch (error) {
      logger.error('RCON connection failed:', error);
      this.rcon = null;
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  async sendCommand(command: string): Promise<string> {
    if (!this.rcon?.authenticated) {
      await this.connect();
    }

    try {
      const response = await this.rcon!.send(command);
      return response;
    } catch (error) {
      logger.error(`RCON command failed: ${command}`, error);
      this.rcon = null;
      throw error;
    }
  }

  async listPlayers(): Promise<string[]> {
    try {
      const response = await this.sendCommand('list');
      // Response format: "There are X of a max of Y players online: player1, player2"
      const match = response.match(/players online:(.*)/);
      if (!match) return [];

      const playerList = match[1].trim();
      if (!playerList) return [];

      return playerList.split(',').map((p) => p.trim()).filter(Boolean);
    } catch {
      logger.warn('Failed to list players via RCON');
      return [];
    }
  }

  async disconnect(): Promise<void> {
    if (this.rcon) {
      this.rcon.end();
      this.rcon = null;
      logger.info('RCON disconnected');
    }
  }
}
