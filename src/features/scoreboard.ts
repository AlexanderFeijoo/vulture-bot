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

async function cycleLeaderboard(currentIndex: number, rcon: MinecraftRcon): Promise<{ newIndex: number; message: string }> {
  let next = currentIndex + 1;

  // Past last objective → turn off
  if (next >= OBJECTIVES.length) {
    next = -1;
    await rcon.sendCommand('scoreboard objectives setdisplay sidebar');
    return { newIndex: next, message: 'Sidebar leaderboard turned off' };
  }

  // Wrapped around from off → back to first
  if (next < 0) {
    next = 0;
  }

  const obj = OBJECTIVES[next];
  await rcon.sendCommand(`scoreboard objectives setdisplay sidebar ${obj.name}`);
  return { newIndex: next, message: `Sidebar now showing: ${obj.display}` };
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

  // Discord /leaderboard command
  messaging.onSlashCommand(async (interaction) => {
    if (interaction.commandName !== 'leaderboard') return;

    try {
      const result = await cycleLeaderboard(currentIndex, rcon);
      currentIndex = result.newIndex;
      await interaction.ephemeralReply(result.message);
    } catch (err) {
      logger.error('Failed to cycle leaderboard:', err);
      await interaction.ephemeralReply('Failed to update sidebar');
    }
  });

  // In-game !leaderboard command
  tracker.on('event', async (event: MinecraftEvent) => {
    if (event.type !== 'chat') return;
    if (event.message.trim().toLowerCase() !== '!leaderboard') return;

    try {
      const result = await cycleLeaderboard(currentIndex, rcon);
      currentIndex = result.newIndex;
      const tellraw = JSON.stringify({ text: result.message, color: 'yellow' });
      await rcon.sendCommand(`tellraw @a ${tellraw}`);
    } catch (err) {
      logger.error('Failed to cycle leaderboard from in-game:', err);
    }
  });

  logger.info('Scoreboard feature initialized');
}
