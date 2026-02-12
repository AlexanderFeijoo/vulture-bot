import { logger } from '../utils/logger.js';
import type { AIPlayerBot } from './bot.js';
import type { GameObservation } from './types.js';

/**
 * Observe game state by querying the Forge mod via RCON.
 * The mod returns compact JSON from /nuncle observe.
 */
export async function observeGameState(bot: AIPlayerBot): Promise<GameObservation> {
  const raw = await bot.sendCommand('observe');

  try {
    const data = JSON.parse(raw);

    if (!data.self) {
      // NPC not alive
      return emptyObservation();
    }

    return {
      self: {
        position: data.self.position ?? { x: 0, y: 0, z: 0 },
        health: data.self.health ?? 20,
        maxHealth: data.self.maxHealth ?? 20,
      },
      time: data.time ?? 'Unknown',
      weather: data.weather ?? 'Unknown',
      biome: data.biome ?? 'unknown',
      nearbyPlayers: (data.nearbyPlayers ?? []).map((p: any) => ({
        name: p.name,
        distance: p.distance,
      })),
      nearbyEntities: (data.nearbyEntities ?? []).map((e: any) => ({
        name: e.name,
        distance: e.distance,
        hostile: e.hostile ?? false,
      })),
      notableBlocks: (data.notableBlocks ?? []).map((b: any) => ({
        name: b.name,
        x: b.x,
        y: b.y,
        z: b.z,
        distance: b.distance,
      })),
      recentEvents: [], // Filled by brain from event buffer
    };
  } catch (err) {
    logger.warn(`Failed to parse observe response: ${raw}`);
    return emptyObservation();
  }
}

function emptyObservation(): GameObservation {
  return {
    self: { position: { x: 0, y: 0, z: 0 }, health: 0, maxHealth: 20 },
    time: 'Unknown',
    weather: 'Unknown',
    biome: 'unknown',
    nearbyPlayers: [],
    nearbyEntities: [],
    notableBlocks: [],
    recentEvents: [],
  };
}

export function formatObservation(obs: GameObservation): string {
  const lines: string[] = [];

  // Self
  lines.push('== SELF ==');
  const s = obs.self;
  lines.push(`Position: (${s.position.x}, ${s.position.y}, ${s.position.z}) | Health: ${s.health}/${s.maxHealth}`);
  lines.push(`Time: ${obs.time} | Weather: ${obs.weather} | Biome: ${obs.biome}`);

  // Nearby players
  if (obs.nearbyPlayers.length > 0) {
    lines.push('\n== NEARBY PLAYERS ==');
    for (const p of obs.nearbyPlayers) {
      lines.push(`${p.name} (${p.distance} blocks away)`);
    }
  }

  // Nearby entities
  if (obs.nearbyEntities.length > 0) {
    lines.push('\n== NEARBY ENTITIES ==');
    for (const e of obs.nearbyEntities) {
      const threat = e.hostile ? ' [HOSTILE]' : '';
      lines.push(`${e.name} (${e.distance} blocks)${threat}`);
    }
  }

  // Notable blocks
  if (obs.notableBlocks.length > 0) {
    lines.push('\n== NOTABLE BLOCKS ==');
    for (const b of obs.notableBlocks) {
      lines.push(`${b.name} at (${b.x}, ${b.y}, ${b.z}) - ${b.distance} blocks`);
    }
  }

  // Recent events
  if (obs.recentEvents.length > 0) {
    lines.push('\n== RECENT EVENTS ==');
    for (const e of obs.recentEvents) {
      lines.push(e);
    }
  }

  return lines.join('\n');
}
