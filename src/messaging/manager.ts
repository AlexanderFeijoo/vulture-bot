import type { MessagingAdapter, OutboundMessage, SlashCommandInteraction, WebhookStyleMessage, InboundMessage } from './types.js';
import { logger } from '../utils/logger.js';

export class MessagingManager {
  private adapters: MessagingAdapter[] = [];
  private slashCommandHandlers: ((interaction: SlashCommandInteraction) => void)[] = [];
  private messageHandlers: ((message: InboundMessage) => void)[] = [];

  registerAdapter(adapter: MessagingAdapter): void {
    this.adapters.push(adapter);
    logger.info(`Registered messaging adapter: ${adapter.platform}`);
  }

  async connectAll(): Promise<void> {
    // Wire up multiplexed handlers before connecting
    for (const adapter of this.adapters) {
      adapter.onSlashCommand((interaction) => {
        for (const handler of this.slashCommandHandlers) {
          handler(interaction);
        }
      });
      adapter.onMessage((message) => {
        for (const handler of this.messageHandlers) {
          handler(message);
        }
      });
    }

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

  async sendAsUser(message: WebhookStyleMessage): Promise<void> {
    const results = await Promise.allSettled(
      this.adapters
        .filter((a) => a.sendAsUser)
        .map((a) => a.sendAsUser!(message)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        logger.error(`Failed to sendAsUser:`, result.reason);
      }
    }
  }

  setStatus(text: string): void {
    for (const adapter of this.adapters) {
      adapter.setStatus(text);
    }
  }

  onSlashCommand(handler: (interaction: SlashCommandInteraction) => void): void {
    this.slashCommandHandlers.push(handler);
  }

  onMessage(handler: (message: InboundMessage) => void): void {
    this.messageHandlers.push(handler);
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
