import type { PlayerTracker } from '../minecraft/player-tracker.js';
import type { MessagingManager } from '../messaging/manager.js';
import type { MinecraftRcon } from '../minecraft/rcon-client.js';
import type { MinecraftEvent } from '../minecraft/events.js';
import { logger } from '../utils/logger.js';

const COLOR_GREEN = 0x4caf50;
const DYNMAP_URL = 'http://207.148.28.235:8123/';

export function setupMap(tracker: PlayerTracker, messaging: MessagingManager, rcon: MinecraftRcon): void {
  // Discord /map command
  messaging.onSlashCommand((interaction) => {
    if (interaction.commandName !== 'map') return;

    interaction.reply({
      channel: 'events',
      title: 'Dynmap',
      description: `[View the live map](${DYNMAP_URL})`,
      color: COLOR_GREEN,
    });
  });

  // In-game !map command
  tracker.on('event', async (event: MinecraftEvent) => {
    if (event.type !== 'chat') return;
    if (event.message.trim().toLowerCase() !== '!map') return;

    try {
      const tellraw = JSON.stringify([
        { text: 'Dynmap: ', color: 'green' },
        { text: DYNMAP_URL, color: 'aqua', underlined: true, clickEvent: { action: 'open_url', value: DYNMAP_URL } },
      ]);
      await rcon.sendCommand(`tellraw @a ${tellraw}`);
    } catch (err) {
      logger.error('Failed to send map link in-game:', err);
    }
  });

  logger.info('Map command initialized');
}
