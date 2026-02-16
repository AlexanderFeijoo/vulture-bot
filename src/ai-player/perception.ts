import { logger } from '../utils/logger.js';
import type { AIPlayerBot } from './bot.js';
import type { GameObservation, InventoryItem, GroundItem } from './types.js';

/** Blocks to suppress from observations even if the mod sends them (common clutter). */
const SUPPRESS_BLOCKS = new Set([
  'copper_ore', 'deepslate_copper_ore',
  'coal_ore', 'deepslate_coal_ore',
  'short_grass', 'tall_grass', 'fern', 'large_fern',
  'dead_bush', 'seagrass', 'tall_seagrass',
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
  'oxeye_daisy', 'cornflower', 'lily_of_the_valley',
]);

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
      notableBlocks: filterBlocks(data.notableBlocks ?? []),
      inventory: parseInventory(data.inventory),
      groundItems: parseGroundItems(data.groundItems),
      recentEvents: [], // Filled by brain from event buffer
    };
  } catch (err) {
    logger.warn(`Failed to parse observe response: ${raw}`);
    return emptyObservation();
  }
}

function filterBlocks(blocks: any[]): GameObservation['notableBlocks'] {
  return blocks
    .map((b: any) => ({
      name: b.name as string,
      x: b.x as number,
      y: b.y as number,
      z: b.z as number,
      distance: b.distance as number,
    }))
    .filter((b) => !SUPPRESS_BLOCKS.has(b.name))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 15);
}

function parseInventory(raw: any): InventoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: any) => ({
    name: item.name ?? item.item ?? 'unknown',
    count: item.count ?? item.quantity ?? 1,
  }));
}

function parseGroundItems(raw: any): GroundItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: any) => ({
    name: item.name ?? item.item ?? 'unknown',
    count: item.count ?? item.quantity ?? 1,
    distance: item.distance ?? 0,
  }));
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
    inventory: [],
    groundItems: [],
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
    lines.push('\n== NEARBY BLOCKS ==');
    for (const b of obs.notableBlocks) {
      lines.push(`${b.name} at (${b.x}, ${b.y}, ${b.z}) - ${b.distance} blocks`);
    }
  }

  // Inventory
  lines.push('\n== INVENTORY ==');
  if (obs.inventory.length > 0) {
    for (const item of obs.inventory) {
      lines.push(`${item.name} x${item.count}`);
    }
  } else {
    lines.push('(empty)');
  }

  // Ground items
  if (obs.groundItems.length > 0) {
    lines.push('\n== ITEMS ON GROUND ==');
    for (const item of obs.groundItems) {
      lines.push(`${item.name} x${item.count} (${item.distance} blocks)`);
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
