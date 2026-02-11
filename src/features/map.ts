import type { MessagingManager } from '../messaging/manager.js';
import { logger } from '../utils/logger.js';

const COLOR_GREEN = 0x4caf50;

export function setupMap(messaging: MessagingManager): void {
  messaging.onSlashCommand((interaction) => {
    if (interaction.commandName !== 'map') return;

    interaction.reply({
      channel: 'events',
      title: 'Dynmap',
      description: '[View the live map](http://207.148.28.235:8123/)',
      color: COLOR_GREEN,
    });
  });

  logger.info('Map command initialized');
}
