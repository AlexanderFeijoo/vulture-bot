import { logger } from '../utils/logger.js';
import type { AIPlayerBot } from './bot.js';
import type { GameObservation, InventoryItem, GroundItem } from './types.js';

/** Priority map for notable blocks — higher = more interesting. Unlisted = 0 (filtered out). */
const BLOCK_PRIORITY: Record<string, number> = {
  // Extremely rare
  ancient_debris: 10,
  spawner: 10,
  // Very rare ores
  diamond_ore: 9,
  deepslate_diamond_ore: 9,
  emerald_ore: 9,
  deepslate_emerald_ore: 9,
  // Rare ores
  gold_ore: 7,
  deepslate_gold_ore: 7,
  lapis_ore: 7,
  deepslate_lapis_ore: 7,
  redstone_ore: 6,
  deepslate_redstone_ore: 6,
  // Useful ores
  iron_ore: 5,
  deepslate_iron_ore: 5,
  // Common ores — filtered out (priority 0) to prevent fixation
  // copper_ore, deepslate_copper_ore, coal_ore, deepslate_coal_ore: omitted
  // Structures / interesting
  chest: 8,
  barrel: 6,
  crafting_table: 4,
  furnace: 4,
  blast_furnace: 4,
  smoker: 4,
  anvil: 5,
  enchanting_table: 6,
  brewing_stand: 5,
  bed: 3,
};

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
      notableBlocks: prioritizeBlocks(data.notableBlocks ?? []),
      inventory: parseInventory(data.inventory),
      groundItems: parseGroundItems(data.groundItems),
      recentEvents: [], // Filled by brain from event buffer
    };
  } catch (err) {
    logger.warn(`Failed to parse observe response: ${raw}`);
    return emptyObservation();
  }
}

function prioritizeBlocks(blocks: any[]): GameObservation['notableBlocks'] {
  return blocks
    .map((b: any) => ({
      name: b.name as string,
      x: b.x as number,
      y: b.y as number,
      z: b.z as number,
      distance: b.distance as number,
      priority: BLOCK_PRIORITY[b.name] ?? 0,
    }))
    .filter((b) => b.priority > 0)
    .sort((a, b) => b.priority - a.priority || a.distance - b.distance)
    .slice(0, 5)
    .map(({ priority: _, ...rest }) => rest);
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
    lines.push('\n== NOTABLE BLOCKS ==');
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
