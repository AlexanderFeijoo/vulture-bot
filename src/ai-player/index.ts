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
      const event = nuncleMatch[1];
      const data = nuncleMatch[2] ?? '';

      // HEARD = proximity-filtered chat (player is within 32 blocks)
      if (event === 'HEARD') {
        const spaceIdx = data.indexOf(' ');
        if (spaceIdx > 0) {
          const player = data.substring(0, spaceIdx);
          const message = data.substring(spaceIdx + 1);
          bot.handleChat(player, message);
        }
      } else {
        // All other NUNCLE events (DAMAGED, DIED, SPAWNED, etc.)
        bot.handleNuncleEvent(event, data);
      }
      return;
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

  // Sync boundary config to Forge mod on every spawn
  bot.on('spawned', async () => {
    if (config.boundary) {
      const { centerX, centerZ, radius } = config.boundary;
      await bot.sendCommand(`boundary set ${centerX} ${centerZ} ${radius}`);
      logger.info(`Boundary synced to mod: center=(${centerX},${centerZ}) radius=${radius}`);
    }
  });

  // Handle respawn after death (wire before first connect so it's ready)
  let brainEnabled = true;
  bot.on('died', () => {
    logger.info('NPC died, will respawn in 10s');
    if (!brainEnabled) return; // Don't respawn if brain was toggled off
    setTimeout(async () => {
      if (!brainEnabled) return;
      try {
        await bot.connect();
      } catch {
        logger.warn('Failed to respawn NPC after death');
      }
    }, 10000);
  });

  // Brain toggle: /nuncle brain off → despawn NPC + stop brain
  bot.on('brainOff', async () => {
    if (!brainEnabled) {
      logger.info('Brain toggle: already off');
      return;
    }
    brainEnabled = false;
    logger.info('Brain toggle: turning OFF');
    brain.stop();
    await bot.disconnect();
    logger.info('Brain toggle: NuncleNelson is now offline');
  });

  // Brain toggle: /nuncle brain on → spawn NPC + start brain
  bot.on('brainOn', async () => {
    if (brainEnabled) {
      logger.info('Brain toggle: already on');
      return;
    }
    brainEnabled = true;
    logger.info('Brain toggle: turning ON');
    try {
      await bot.connect();
    } catch (err) {
      logger.error('Brain toggle: failed to spawn NPC:', err);
      return;
    }
    brain.start();
    logger.info('Brain toggle: NuncleNelson is now online');
  });

  // Reconcile alive state before starting brain (handles bot restart while NPC is alive)
  await bot.reconcileAliveState();

  // Start brain once — it handles spawned/died events internally
  brain.start();

  // Spawn the NPC (if not already alive from reconciliation)
  if (!bot.isConnected) {
    try {
      await bot.connect();
    } catch (err) {
      logger.error('AI Player failed to spawn NPC:', err);
      throw err;
    }
  } else {
    logger.info('NPC already alive (reconciled), skipping spawn');
  }

  // Periodic alive-state reconciliation as safety net (every 60s)
  const reconcileTimer = setInterval(async () => {
    await bot.reconcileAliveState();
  }, 60_000);

  logger.info(`AI Player "${config.username}" is online (RCON mode)`);

  return {
    shutdown: async () => {
      logger.info('Shutting down AI Player...');
      clearInterval(reconcileTimer);
      brain.stop();
      await bot.disconnect();
      await memory.shutdown();
      logger.info('AI Player shut down');
    },
  };
}
