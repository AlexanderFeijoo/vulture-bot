import type { PlayerTracker } from '../minecraft/player-tracker.js';
import type { MessagingManager } from '../messaging/manager.js';
import type { MinecraftEvent } from '../minecraft/events.js';
import { logger } from '../utils/logger.js';

const EMBED_TITLE = "Uncle Al's Fat Stash";
const SERVER_IP = '207.148.28.235';
const DYNMAP_URL = `http://${SERVER_IP}:8123/`;
const COLOR_GREEN = 0x4caf50;
const COLOR_RED = 0xf44336;
const DEBOUNCE_MS = 2000;

export async function setupServerStatusEmbed(tracker: PlayerTracker, messaging: MessagingManager): Promise<void> {
  let statusMessageId: string | null = null;
  let serverOnline = true;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Try to find an existing status embed
  try {
    statusMessageId = await messaging.findBotMessage('events', EMBED_TITLE);
    if (statusMessageId) {
      logger.info('Found existing server status embed, will reuse it');
    }
  } catch (err) {
    logger.warn('Failed to find existing status embed:', err);
  }

  function buildEmbed() {
    const players = tracker.getOnlinePlayers();
    const count = players.length;
    const online = serverOnline;

    const statusText = online ? '🟢 Online' : '🔴 Offline';
    const color = online ? COLOR_GREEN : COLOR_RED;
    const playerList = count > 0 ? players.join(', ') : 'No players online';

    return {
      channel: 'events' as const,
      title: EMBED_TITLE,
      description: `**Status:** ${statusText}\n**IP:** \`${SERVER_IP}\``,
      color,
      fields: [
        { name: `Players (${count})`, value: playerList, inline: false },
        { name: 'Dynmap', value: `[View live map](${DYNMAP_URL})`, inline: false },
      ],
      footer: 'Auto-updates when players join/leave',
    };
  }

  async function updateEmbed(): Promise<void> {
    const embed = buildEmbed();
    try {
      if (statusMessageId) {
        await messaging.editMessage('events', statusMessageId, embed);
      } else {
        statusMessageId = await messaging.sendToChannel('events', embed);
        if (statusMessageId) {
          logger.info('Created new server status embed');
        }
      }
    } catch (err) {
      // Message may have been deleted — try creating a new one
      logger.warn('Failed to update status embed, creating new one:', err);
      statusMessageId = null;
      try {
        statusMessageId = await messaging.sendToChannel('events', embed);
      } catch (err2) {
        logger.error('Failed to create status embed:', err2);
      }
    }
  }

  function debouncedUpdate(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updateEmbed().catch((err) => logger.error('Status embed update failed:', err));
    }, DEBOUNCE_MS);
  }

  // Listen for relevant events
  tracker.on('event', (event: MinecraftEvent) => {
    switch (event.type) {
      case 'player_join':
      case 'player_leave':
        debouncedUpdate();
        break;
      case 'server_status':
        serverOnline = event.status === 'started';
        debouncedUpdate();
        break;
    }
  });

  // Initial embed
  await updateEmbed();

  logger.info('Server status embed initialized');
}
