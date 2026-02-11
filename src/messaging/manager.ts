import type { MessagingAdapter, OutboundMessage, SlashCommandInteraction } from './types.js';
import { logger } from '../utils/logger.js';

export class MessagingManager {
  private adapters: MessagingAdapter[] = [];

  registerAdapter(adapter: MessagingAdapter): void {
    this.adapters.push(adapter);
    logger.info(`Registered messaging adapter: ${adapter.platform}`);
  }

  async connectAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.adapters.map((a) => a.connect()),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        logger.error(`Failed to connect ${this.adapters[i].platform}:`, result.reason);
      }
    }
  }

  async broadcast(message: OutboundMessage): Promise<void> {
    const results = await Promise.allSettled(
      this.adapters.map((a) => a.send(message)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        logger.error(`Failed to send to ${this.adapters[i].platform}:`, result.reason);
      }
    }
  }

  setStatus(text: string): void {
    for (const adapter of this.adapters) {
      adapter.setStatus(text);
    }
  }

  onSlashCommand(handler: (interaction: SlashCommandInteraction) => void): void {
    for (const adapter of this.adapters) {
      adapter.onSlashCommand(handler);
    }
  }

  async disconnectAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.adapters.map((a) => a.disconnect()),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        logger.error(`Failed to disconnect ${this.adapters[i].platform}:`, result.reason);
      }
    }
  }
}
