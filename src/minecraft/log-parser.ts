import type { MinecraftEvent } from './events.js';

// Forge 1.20.1 log format (actual):
// [11Feb2026 05:35:14.246] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: Pulpstar44 joined the game
const LOG_PREFIX = /^\[\d+\w+\d+ (\d{2}:\d{2}:\d{2})\.\d+\] \[Server thread\/INFO\]/;
const MC_SERVER = /\[net\.minecraft\.server\.MinecraftServer\/\]:/;

// Player join/leave
const JOIN_PATTERN = /^(\w+) joined the game$/;
const LEAVE_PATTERN = /^(\w+) left the game$/;

// Chat: <PlayerName> message
const CHAT_PATTERN = /^<(\w+)> (.+)$/;

// Advancement: PlayerName has made the advancement [Advancement Name]
const ADVANCEMENT_PATTERN = /^(\w+) has made the advancement \[(.+)\]$/;

// Server start/stop
const SERVER_STARTED_PATTERN = /^Done \(\d+\.\d+s\)! For help, type "help"/;
const SERVER_STOPPING_PATTERN = /^Stopping the server$/;

function parseTimestamp(timeStr: string): Date {
  const now = new Date();
  const [hours, minutes, seconds] = timeStr.split(':').map(Number);
  now.setHours(hours, minutes, seconds, 0);
  return now;
}

export function parseLogLine(line: string): MinecraftEvent | null {
  const prefixMatch = line.match(LOG_PREFIX);
  if (!prefixMatch) return null;

  const timestamp = parseTimestamp(prefixMatch[1]);

  if (!MC_SERVER.test(line)) return null;

  // Extract the message after the MinecraftServer prefix
  const msgIndex = line.indexOf('MinecraftServer/]:');
  if (msgIndex === -1) return null;
  const message = line.slice(msgIndex + 'MinecraftServer/]:'.length).trim();

  // Player join
  const joinMatch = message.match(JOIN_PATTERN);
  if (joinMatch) {
    return { type: 'player_join', player: joinMatch[1], timestamp };
  }

  // Player leave
  const leaveMatch = message.match(LEAVE_PATTERN);
  if (leaveMatch) {
    return { type: 'player_leave', player: leaveMatch[1], timestamp };
  }

  // Chat
  const chatMatch = message.match(CHAT_PATTERN);
  if (chatMatch) {
    return { type: 'chat', player: chatMatch[1], message: chatMatch[2], timestamp };
  }

  // Advancement
  const advMatch = message.match(ADVANCEMENT_PATTERN);
  if (advMatch) {
    return { type: 'advancement', player: advMatch[1], advancement: advMatch[2], timestamp };
  }

  // Server started
  if (SERVER_STARTED_PATTERN.test(message)) {
    return { type: 'server_status', status: 'started', timestamp };
  }

  // Server stopping
  if (SERVER_STOPPING_PATTERN.test(message)) {
    return { type: 'server_status', status: 'stopped', timestamp };
  }

  // Death — any remaining MinecraftServer message starting with a player name
  // e.g. "DiamondMiner423 fell from a high place", "DiamondMiner423 burned to death"
  const deathMatch = message.match(/^(\w+) (.+)$/);
  if (deathMatch) {
    return { type: 'death', player: deathMatch[1], message: deathMatch[2], timestamp };
  }

  return null;
}
