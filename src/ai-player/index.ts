import { logger } from '../utils/logger.js';
import type { PlayerTracker } from '../minecraft/player-tracker.js';
import type { MessagingManager } from '../messaging/manager.js';
import type { MinecraftRcon } from '../minecraft/rcon-client.js';
import type { LogTailer } from '../minecraft/log-tailer.js';
import type { AIPlayerConfig } from './types.js';
import { AIPlayerBot } from './bot.js';
import { AIBrain } from './brain.js';
import { PersistentMemory } from './memory.js';
import { loadPersonality } from './personality.js';

export interface AIPlayerInstance {
  shutdown: () => Promise<void>;
}

export async function setupAIPlayer(
  tracker: PlayerTracker,
  messaging: MessagingManager,
  rcon: MinecraftRcon,
  tailer: LogTailer,
  config: AIPlayerConfig,
): Promise<AIPlayerInstance> {
  logger.info('Setting up AI Player (RCON mode)...');

  // Load personality
  const personality = await loadPersonality(config.personalityFile);

  // Load persistent memory
  const memory = new PersistentMemory(config.memoryFile);
  await memory.load();
  memory.setName(config.username);

  // Create RCON-based bot
  const bot = new AIPlayerBot(config, rcon);

  // Create brain (pass player count so it can sleep when server is empty)
  const brain = new AIBrain(config, bot, memory, personality, () => tracker.getPlayerCount());

  // Wire log tailer events to bot
  tailer.on('line', (line: string) => {
    // Check for [NUNCLE] events from the Forge mod
    const nuncleMatch = line.match(/\[NUNCLE\] (\w+)(?: (.*))?$/);
    if (nuncleMatch) {
      bot.handleNuncleEvent(nuncleMatch[1], nuncleMatch[2] ?? '');
      return;
    }

    // Forward chat events to bot
    const chatMatch = line.match(/\[net\.minecraft\.server\.MinecraftServer\/\]:\s*<(\w+)> (.+)$/);
    if (chatMatch) {
      bot.handleChat(chatMatch[1], chatMatch[2]);
    }
  });

  // Forward player join/leave from tracker to bot
  tracker.on('event', (event: { type: string; player?: string }) => {
    if (event.type === 'player_join' && event.player) {
      bot.handlePlayerJoined(event.player);
    } else if (event.type === 'player_leave' && event.player) {
      bot.handlePlayerLeft(event.player);
    }
  });

  // Handle respawn after death (wire before first connect so it's ready)
  bot.on('died', () => {
    logger.info('NPC died, will respawn in 10s');
    setTimeout(async () => {
      try {
        await bot.connect();
      } catch {
        logger.warn('Failed to respawn NPC after death');
      }
    }, 10000);
  });

  // Start brain once — it handles spawned/died events internally
  brain.start();

  // Spawn the NPC
  try {
    await bot.connect();
  } catch (err) {
    logger.error('AI Player failed to spawn NPC:', err);
    throw err;
  }

  logger.info(`AI Player "${config.username}" is online (RCON mode)`);

  return {
    shutdown: async () => {
      logger.info('Shutting down AI Player...');
      brain.stop();
      await bot.disconnect();
      await memory.shutdown();
      logger.info('AI Player shut down');
    },
  };
}
