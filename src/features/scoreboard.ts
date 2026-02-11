import type { PlayerTracker } from '../minecraft/player-tracker.js';
import type { MessagingManager } from '../messaging/manager.js';
import type { MinecraftRcon } from '../minecraft/rcon-client.js';
import type { MinecraftEvent } from '../minecraft/events.js';
import { logger } from '../utils/logger.js';

const OBJECTIVES = [
  { name: 'deaths', criteria: 'minecraft.custom:minecraft.deaths', display: 'Deaths' },
  { name: 'mob_kills', criteria: 'minecraft.custom:minecraft.mob_kills', display: 'Mob Kills' },
  { name: 'play_time', criteria: 'minecraft.custom:minecraft.play_time', display: 'Play Time' },
  { name: 'distance', criteria: 'minecraft.custom:minecraft.walk_one_cm', display: 'Distance Walked' },
  { name: 'jumps', criteria: 'minecraft.custom:minecraft.jump', display: 'Jumps' },
];

async function createObjectives(rcon: MinecraftRcon): Promise<void> {
  for (const obj of OBJECTIVES) {
    try {
      await rcon.sendCommand(`scoreboard objectives add ${obj.name} ${obj.criteria} "${obj.display}"`);
    } catch {
      // Silently ignore — objective may already exist
    }
  }
  try {
    await rcon.sendCommand('scoreboard objectives setdisplay sidebar deaths');
  } catch (err) {
    logger.warn('Failed to set default sidebar display:', err);
  }
  logger.info('Scoreboard objectives created');
}

export function setupScoreboard(tracker: PlayerTracker, messaging: MessagingManager, rcon: MinecraftRcon): void {
  // Index into OBJECTIVES, or -1 for "off"
  let currentIndex = 0;

  // Create objectives on server start
  tracker.on('event', (event: MinecraftEvent) => {
    if (event.type !== 'server_status' || event.status !== 'started') return;
    createObjectives(rcon).catch((err) => {
      logger.error('Failed to create scoreboard objectives on server start:', err);
    });
  });

  // Also run on bot startup (server may already be running)
  createObjectives(rcon).catch((err) => {
    logger.warn('Failed to create scoreboard objectives on bot start:', err);
  });

  // /leaderboard command cycles through objectives
  messaging.onSlashCommand(async (interaction) => {
    if (interaction.commandName !== 'leaderboard') return;

    // Advance to next
    currentIndex++;

    // Past last objective → turn off
    if (currentIndex >= OBJECTIVES.length) {
      currentIndex = -1;
      try {
        await rcon.sendCommand('scoreboard objectives setdisplay sidebar');
        await interaction.ephemeralReply('Sidebar leaderboard turned off');
      } catch (err) {
        logger.error('Failed to clear sidebar:', err);
        await interaction.ephemeralReply('Failed to update sidebar');
      }
      return;
    }

    // Wrapped around from off → back to first
    if (currentIndex < 0) {
      currentIndex = 0;
    }

    const obj = OBJECTIVES[currentIndex];
    try {
      await rcon.sendCommand(`scoreboard objectives setdisplay sidebar ${obj.name}`);
      await interaction.ephemeralReply(`Sidebar now showing: **${obj.display}**`);
    } catch (err) {
      logger.error('Failed to set sidebar display:', err);
      await interaction.ephemeralReply('Failed to update sidebar');
    }
  });

  logger.info('Scoreboard feature initialized');
}
