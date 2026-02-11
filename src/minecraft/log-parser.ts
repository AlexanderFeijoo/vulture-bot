import type { MinecraftEvent } from './events.js';

// Forge 1.20.1 log format (actual):
// [11Feb2026 05:35:14.246] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: Pulpstar44 joined the game
const LOG_PREFIX = /^\[\d+\w+\d+ (\d{2}:\d{2}:\d{2})\.\d+\] \[Server thread\/INFO\]/;
const MC_SERVER = /\[net\.minecraft\.server\.MinecraftServer\/\]:/;
const DEDICATED_SERVER = /\[minecraft\/DedicatedServer\]:/;

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

// Server messages that look like deaths but aren't (first word matches \w+ pattern)
const NON_DEATH_PREFIXES = /^(Saving|Loading|Preparing|ThreadedAnvilChunkStorage|Generating|Starting|Stopping|Found|Loaded|Time|UUID|Successfully|Changing|Can't|Could|Failed|Flushing|Reloading|Unloading) /;

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

  // Server start/stop come from DedicatedServer, not MinecraftServer
  if (DEDICATED_SERVER.test(line)) {
    const dsIndex = line.indexOf('DedicatedServer]:');
    if (dsIndex === -1) return null;
    const dsMessage = line.slice(dsIndex + 'DedicatedServer]:'.length).trim();

    if (SERVER_STARTED_PATTERN.test(dsMessage)) {
      return { type: 'server_status', status: 'started', timestamp };
    }
    if (SERVER_STOPPING_PATTERN.test(dsMessage)) {
      return { type: 'server_status', status: 'stopped', timestamp };
    }
    return null;
  }

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

  // Death — remaining MinecraftServer messages starting with a valid player name
  // e.g. "DiamondMiner423 fell from a high place", "DiamondMiner423 burned to death"
  // MC usernames: 3-16 chars, letters/digits/underscores, must start with a letter
  const deathMatch = message.match(/^([A-Za-z]\w{2,15}) (.+)$/);
  if (deathMatch && !NON_DEATH_PREFIXES.test(message)) {
    return { type: 'death', player: deathMatch[1], message: deathMatch[2], timestamp };
  }

  return null;
}
