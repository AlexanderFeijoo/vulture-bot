import 'dotenv/config';

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function envOptional(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() !== '' ? value : undefined;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Invalid integer for ${key}: ${raw}`);
  return parsed;
}

export const config = {
  minecraft: {
    logPath: env('MC_LOG_PATH', './dev/mc-logs/latest.log'),
    rcon: {
      host: env('MC_RCON_HOST', '127.0.0.1'),
      port: envInt('MC_RCON_PORT', 25575),
      password: env('MC_RCON_PASSWORD'),
    },
  },

  discord: envOptional('DISCORD_TOKEN')
    ? {
        token: env('DISCORD_TOKEN'),
        guildId: env('DISCORD_GUILD_ID'),
        eventsChannelId: env('DISCORD_EVENTS_CHANNEL_ID'),
        chatChannelId: envOptional('DISCORD_CHAT_CHANNEL_ID'),
      }
    : null,

  slack: envOptional('SLACK_BOT_TOKEN')
    ? {
        token: env('SLACK_BOT_TOKEN'),
        eventsChannelId: env('SLACK_EVENTS_CHANNEL_ID'),
        chatChannelId: envOptional('SLACK_CHAT_CHANNEL_ID'),
      }
    : null,

  bot: {
    logLevel: env('LOG_LEVEL', 'info'),
    rconReconcileIntervalMs: envInt('RCON_RECONCILE_INTERVAL_MS', 60000),
  },
} as const;
