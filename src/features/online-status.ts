import type { PlayerTracker } from '../minecraft/player-tracker.js';
import type { MessagingManager } from '../messaging/manager.js';

const COLOR_BLUE = 0x2196f3;

function playerHeadUrl(player: string): string {
  return `https://mc-heads.net/avatar/${player}/64`;
}

export function setupOnlineStatus(tracker: PlayerTracker, messaging: MessagingManager): void {
  messaging.onSlashCommand((interaction) => {
    if (interaction.commandName !== 'online') return;

    const players = tracker.getOnlinePlayers();
    const count = players.length;

    if (count === 0) {
      interaction.reply({
        channel: 'events',
        title: 'Server Status',
        description: 'No players are currently online.',
        color: COLOR_BLUE,
      });
      return;
    }

    const playerList = players.map((p) => `• **${p}**`).join('\n');

    interaction.reply({
      channel: 'events',
      title: 'Server Status',
      description: playerList,
      color: COLOR_BLUE,
      thumbnailUrl: playerHeadUrl(players[0]),
      footer: `${count} player${count !== 1 ? 's' : ''} online`,
    });
  });

  // Set initial status
  const count = tracker.getPlayerCount();
  messaging.setStatus(`${count} player${count !== 1 ? 's' : ''} online`);
}
