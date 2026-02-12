import { logger } from '../utils/logger.js';
import type { PlayerTracker } from '../minecraft/player-tracker.js';
import type { MessagingManager } from '../messaging/manager.js';
import type { MinecraftRcon } from '../minecraft/rcon-client.js';
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
  config: AIPlayerConfig,
): Promise<AIPlayerInstance> {
  logger.info('Setting up AI Player...');

  // Load personality
  const personality = await loadPersonality(config.personalityFile);

  // Load persistent memory
  const memory = new PersistentMemory(config.memoryFile);
  await memory.load();
  memory.setName(config.username);

  // Create bot
  const bot = new AIPlayerBot(config);

  // Create brain
  const brain = new AIBrain(config, bot, memory, personality);

  // Connect to server
  try {
    await bot.connect();
  } catch (err) {
    logger.error('AI Player failed to connect:', err);
    throw err;
  }

  // Start brain after bot spawns
  bot.on('spawned', () => {
    brain.start();
    logger.info('AI Player brain activated');
  });

  // Stop brain on disconnect, restart on reconnect
  bot.on('disconnected', () => {
    brain.stop();
  });

  bot.on('kicked', () => {
    brain.stop();
  });

  logger.info(`AI Player "${config.username}" is online`);

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
