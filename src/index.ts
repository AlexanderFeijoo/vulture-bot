import { config } from './config.js';
import { logger } from './utils/logger.js';
import './utils/graceful-shutdown.js';
import { onShutdown } from './utils/graceful-shutdown.js';
import { LogTailer } from './minecraft/log-tailer.js';
import { MinecraftRcon } from './minecraft/rcon-client.js';
import { PlayerTracker } from './minecraft/player-tracker.js';
import { MessagingManager } from './messaging/manager.js';
import { DiscordAdapter } from './messaging/adapter-discord.js';
import { setupJoinLeave } from './features/join-leave.js';
import { setupOnlineStatus } from './features/online-status.js';
import { setupChatBridge } from './features/chat-bridge.js';
import { setupMap } from './features/map.js';
import { setupScoreboard } from './features/scoreboard.js';
import { setupServerStatusEmbed } from './features/server-status-embed.js';

async function main(): Promise<void> {
  logger.info('Starting Vulture Bot...');

  // --- Minecraft layer ---
  const tailer = new LogTailer(config.minecraft.logPath);
  const rcon = new MinecraftRcon(config.minecraft.rcon);
  const tracker = new PlayerTracker(tailer, rcon, config.bot.rconReconcileIntervalMs);

  // Connect RCON
  try {
    await rcon.connect();
  } catch {
    logger.warn('RCON not available at startup — will retry on reconciliation');
  }

  // --- Messaging layer ---
  const messaging = new MessagingManager();

  if (config.discord) {
    messaging.registerAdapter(new DiscordAdapter(config.discord));
  } else {
    logger.warn('Discord not configured — skipping');
  }

  if (config.slack) {
    logger.info('Slack configured but adapter not yet implemented (Phase 2)');
  }

  await messaging.connectAll();

  // --- Features ---
  setupJoinLeave(tracker, messaging);
  setupOnlineStatus(tracker, messaging);
  setupChatBridge(tracker, messaging, rcon);
  setupMap(messaging);
  setupScoreboard(tracker, messaging, rcon);

  // --- Start tracking ---
  await tracker.start();

  // --- Post-start features (need tracker running) ---
  await setupServerStatusEmbed(tracker, messaging);

  // --- Graceful shutdown ---
  onShutdown(async () => {
    tracker.stop();
    await rcon.disconnect();
    await messaging.disconnectAll();
  });

  logger.info('Vulture Bot is running');
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
