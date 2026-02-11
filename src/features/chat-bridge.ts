import type { PlayerTracker } from '../minecraft/player-tracker.js';
import type { MessagingManager } from '../messaging/manager.js';
import type { MinecraftRcon } from '../minecraft/rcon-client.js';
import type { MinecraftEvent } from '../minecraft/events.js';
import { logger } from '../utils/logger.js';

const CHAT_CHANNEL_ID = '1471054475753029693';
const MODERATOR_ROLE_ID = '1471056672100323496';
const COLOR_BLUE = 0x2196f3;

function playerHeadUrl(player: string): string {
  return `https://mc-heads.net/avatar/${player}/64`;
}

export function setupChatBridge(tracker: PlayerTracker, messaging: MessagingManager, rcon: MinecraftRcon): void {
  let bridgeEnabled = true;

  // MC → Discord: relay in-game chat to Discord via webhook
  tracker.on('event', async (event: MinecraftEvent) => {
    if (event.type !== 'chat') return;
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
    if (message.channel !== 'chat') return;
    if (!bridgeEnabled) return;

    // Truncate long messages for RCON safety
    let content = message.content.slice(0, 256);
    // Strip Minecraft color codes
    content = content.replace(/§/g, '');

    const tellraw = JSON.stringify([
      { text: '[Discord] ', color: 'blue' },
      { text: `<${message.author}> `, color: 'blue' },
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

    // Must be used in the chat channel
    if (interaction.channelId !== CHAT_CHANNEL_ID) {
      interaction.ephemeralReply('This command only works in <#' + CHAT_CHANNEL_ID + '>.');
      return;
    }

    // Must be owner or have Moderator role
    const hasPermission = interaction.isGuildOwner || interaction.memberRoleIds.includes(MODERATOR_ROLE_ID);
    if (!hasPermission) {
      interaction.ephemeralReply('You need the Moderator role to use this command.');
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
