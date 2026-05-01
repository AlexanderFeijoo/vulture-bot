import type { PlayerTracker } from '../minecraft/player-tracker.js';
import type { MessagingManager } from '../messaging/manager.js';
import type { MinecraftRcon } from '../minecraft/rcon-client.js';
import type { MinecraftEvent } from '../minecraft/events.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const COLOR_BLUE = 0x2196f3;

// Minecraft tellraw colors that are readable in chat
const MC_COLORS = [
  'green', 'aqua', 'red', 'light_purple', 'yellow',
  'gold', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple',
];

function hashUsername(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function colorForUser(name: string): string {
  return MC_COLORS[hashUsername(name) % MC_COLORS.length];
}

function playerHeadUrl(player: string): string {
  return `https://mc-heads.net/avatar/${player}/64`;
}

export function setupChatBridge(tracker: PlayerTracker, messaging: MessagingManager, rcon: MinecraftRcon): void {
  let bridgeEnabled = true;

  // MC → Discord: relay in-game chat to Discord via webhook
  tracker.on('event', async (event: MinecraftEvent) => {
    if (event.type !== 'chat') {
      logger.debug(`chat-bridge MC event ignored (type=${event.type})`);
      return;
    }
    logger.debug(`chat-bridge MC→Discord: player=${event.player} message="${event.message}" enabled=${bridgeEnabled}`);
    if (!bridgeEnabled) return;

    try {
      await messaging.sendAsUser({
        channel: 'chat',
        username: event.player,
        avatarUrl: playerHeadUrl(event.player),
        content: event.message,
      });
    } catch (err) {
      logger.error('Failed to relay MC chat to Discord:', err);
    }
  });

  // Discord → MC: relay Discord messages to in-game chat via RCON tellraw
  messaging.onMessage(async (message) => {
    logger.debug(`chat-bridge Discord→MC: channel=${message.channel} author=${message.author} content="${message.content}" enabled=${bridgeEnabled}`);
    if (message.channel !== 'chat') return;
    if (!bridgeEnabled) return;

    // Truncate long messages for RCON safety
    let content = message.content.slice(0, 256);
    // Strip Minecraft color codes
    content = content.replace(/§/g, '');

    const userColor = colorForUser(message.author);
    const tellraw = JSON.stringify([
      { text: '[Discord] ', color: 'blue' },
      { text: `<${message.author}> `, color: userColor },
      { text: content, color: 'white' },
    ]);

    try {
      await rcon.sendCommand(`tellraw @a ${tellraw}`);
    } catch (err) {
      logger.error('Failed to relay Discord chat to MC:', err);
    }
  });

  // /livechat slash command
  messaging.onSlashCommand((interaction) => {
    if (interaction.commandName !== 'livechat') return;

    const chatChannelId = config.discord?.chatChannelId;
    const moderatorRoleId = config.discord?.moderatorRoleId;

    // If a chat channel is configured, gate the command to it. If unconfigured, allow from anywhere.
    if (chatChannelId && interaction.channelId !== chatChannelId) {
      interaction.ephemeralReply('This command only works in <#' + chatChannelId + '>.');
      return;
    }

    // If a moderator role is configured, require it (or guild owner). If unconfigured, only guild owner can use it.
    const hasPermission = interaction.isGuildOwner ||
      (!!moderatorRoleId && interaction.memberRoleIds.includes(moderatorRoleId));
    if (!hasPermission) {
      interaction.ephemeralReply(
        moderatorRoleId
          ? 'You need the Moderator role to use this command.'
          : 'Only the guild owner can use this command.',
      );
      return;
    }

    bridgeEnabled = !bridgeEnabled;
    const status = bridgeEnabled ? 'enabled' : 'disabled';

    interaction.reply({
      channel: 'chat',
      description: `Live chat bridge **${status}**`,
      color: COLOR_BLUE,
    });

    logger.info(`Chat bridge ${status} via /livechat command`);
  });

  logger.info('Chat bridge feature initialized');
}
