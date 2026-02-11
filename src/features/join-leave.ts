import type { PlayerTracker } from '../minecraft/player-tracker.js';
import type { MessagingManager } from '../messaging/manager.js';
import type { MinecraftEvent } from '../minecraft/events.js';
import { searchGif } from '../utils/giphy.js';
import { config } from '../config.js';

const COLOR_GREEN = 0x00c853;
const COLOR_RED = 0xff1744;
const COLOR_BLOOD_RED = 0x8b0000;

function playerHeadUrl(player: string): string {
  return `https://mc-heads.net/avatar/${player}/64`;
}

export function setupJoinLeave(tracker: PlayerTracker, messaging: MessagingManager): void {
  tracker.on('event', async (event: MinecraftEvent) => {
    if (event.type === 'player_join') {
      messaging.broadcast({
        channel: 'logs',
        description: `**${event.player}** joined the game`,
        color: COLOR_GREEN,
        thumbnailUrl: playerHeadUrl(event.player),
        footer: `${tracker.getPlayerCount()} player${tracker.getPlayerCount() !== 1 ? 's' : ''} online`,
      });

      messaging.setStatus(`${tracker.getPlayerCount()} player${tracker.getPlayerCount() !== 1 ? 's' : ''} online`);
    }

    if (event.type === 'player_leave') {
      messaging.broadcast({
        channel: 'logs',
        description: `**${event.player}** left the game`,
        color: COLOR_RED,
        thumbnailUrl: playerHeadUrl(event.player),
        footer: `${tracker.getPlayerCount()} player${tracker.getPlayerCount() !== 1 ? 's' : ''} online`,
      });

      messaging.setStatus(`${tracker.getPlayerCount()} player${tracker.getPlayerCount() !== 1 ? 's' : ''} online`);
    }

    if (event.type === 'death') {
      let gifUrl: string | undefined;
      if (config.giphy) {
        const gif = await searchGif(config.giphy.apiKey, event.message);
        if (gif) gifUrl = gif;
      }

      messaging.broadcast({
        channel: 'logs',
        description: `**${event.player}** ${event.message}`,
        color: COLOR_BLOOD_RED,
        thumbnailUrl: playerHeadUrl(event.player),
        imageUrl: gifUrl,
      });
    }
  });
}
