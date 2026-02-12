import type { Bot } from 'mineflayer';
import type { GameObservation, NearbyPlayer, NearbyEntity, NotableBlock } from './types.js';

const PLAYER_SCAN_RADIUS = 32;
const ENTITY_SCAN_RADIUS = 16;
const BLOCK_SCAN_RADIUS = 8;

const NOTABLE_BLOCKS = new Set([
  'diamond_ore', 'deepslate_diamond_ore',
  'iron_ore', 'deepslate_iron_ore',
  'gold_ore', 'deepslate_gold_ore',
  'emerald_ore', 'deepslate_emerald_ore',
  'lapis_ore', 'deepslate_lapis_ore',
  'redstone_ore', 'deepslate_redstone_ore',
  'coal_ore', 'deepslate_coal_ore',
  'copper_ore', 'deepslate_copper_ore',
  'crafting_table', 'furnace', 'blast_furnace', 'smoker',
  'anvil', 'enchanting_table', 'brewing_stand',
  'chest', 'barrel', 'ender_chest',
  'bed', 'respawn_anchor',
  'spawner', 'end_portal_frame',
]);

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
  'enderman', 'witch', 'slime', 'phantom', 'drowned',
  'husk', 'stray', 'blaze', 'ghast', 'magma_cube',
  'wither_skeleton', 'pillager', 'vindicator', 'ravager',
  'evoker', 'vex', 'guardian', 'elder_guardian', 'warden',
]);

function getTimeOfDay(timeOfDay: number): string {
  if (timeOfDay >= 0 && timeOfDay < 6000) return 'Morning';
  if (timeOfDay >= 6000 && timeOfDay < 12000) return 'Day';
  if (timeOfDay >= 12000 && timeOfDay < 13000) return 'Sunset';
  if (timeOfDay >= 13000 && timeOfDay < 23000) return 'Night';
  return 'Dawn';
}

function distanceTo(bot: Bot, pos: { x: number; y: number; z: number }): number {
  return Math.sqrt(
    (bot.entity.position.x - pos.x) ** 2 +
    (bot.entity.position.y - pos.y) ** 2 +
    (bot.entity.position.z - pos.z) ** 2,
  );
}

export function observeGameState(bot: Bot): GameObservation {
  const pos = bot.entity.position;

  // Self
  const heldItem = bot.heldItem;
  const armor: string[] = [];
  for (const slot of [5, 6, 7, 8]) {
    const item = bot.inventory.slots[slot];
    if (item) armor.push(item.name);
  }

  // Inventory
  const inventoryItems: { name: string; count: number }[] = [];
  const seen = new Map<string, number>();
  for (const item of bot.inventory.items()) {
    seen.set(item.name, (seen.get(item.name) ?? 0) + item.count);
  }
  for (const [name, count] of seen) {
    inventoryItems.push({ name, count });
  }
  inventoryItems.sort((a, b) => b.count - a.count);

  // Nearby players
  const nearbyPlayers: NearbyPlayer[] = [];
  for (const player of Object.values(bot.players)) {
    if (!player.entity || player.username === bot.username) continue;
    const dist = distanceTo(bot, player.entity.position);
    if (dist <= PLAYER_SCAN_RADIUS) {
      nearbyPlayers.push({ name: player.username, distance: Math.round(dist) });
    }
  }
  nearbyPlayers.sort((a, b) => a.distance - b.distance);

  // Nearby entities
  const nearbyEntities: NearbyEntity[] = [];
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    if (entity.type !== 'mob' && entity.type !== 'hostile') continue;
    const dist = distanceTo(bot, entity.position);
    if (dist <= ENTITY_SCAN_RADIUS) {
      const name = entity.name ?? entity.displayName ?? 'unknown';
      nearbyEntities.push({
        name,
        type: entity.type,
        distance: Math.round(dist),
        hostile: HOSTILE_MOBS.has(name),
      });
    }
  }
  nearbyEntities.sort((a, b) => a.distance - b.distance);

  // Notable blocks
  const notableBlocks: NotableBlock[] = [];
  const bPos = bot.entity.position.floored();
  for (let dx = -BLOCK_SCAN_RADIUS; dx <= BLOCK_SCAN_RADIUS; dx++) {
    for (let dy = -BLOCK_SCAN_RADIUS; dy <= BLOCK_SCAN_RADIUS; dy++) {
      for (let dz = -BLOCK_SCAN_RADIUS; dz <= BLOCK_SCAN_RADIUS; dz++) {
        const blockPos = bPos.offset(dx, dy, dz);
        const block = bot.blockAt(blockPos);
        if (block && NOTABLE_BLOCKS.has(block.name)) {
          notableBlocks.push({
            name: block.name,
            position: { x: blockPos.x, y: blockPos.y, z: blockPos.z },
            distance: Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz)),
          });
        }
      }
    }
  }
  notableBlocks.sort((a, b) => a.distance - b.distance);
  // Limit to 15 most relevant
  notableBlocks.splice(15);

  // Time and weather
  const timeOfDay = bot.time?.timeOfDay ?? 0;
  const isRaining = bot.isRaining ?? false;

  // Biome
  const biome = bot.blockAt(bPos)?.biome?.name ?? 'unknown';

  return {
    self: {
      position: {
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        z: Math.round(pos.z),
      },
      health: bot.health ?? 20,
      maxHealth: 20,
      food: bot.food ?? 20,
      saturation: bot.foodSaturation ?? 5,
      heldItem: heldItem?.name ?? null,
      armor,
      experience: {
        level: bot.experience?.level ?? 0,
        points: bot.experience?.points ?? 0,
      },
    },
    time: {
      timeOfDay: getTimeOfDay(timeOfDay),
      age: bot.time?.age ?? 0,
    },
    weather: isRaining ? 'Raining' : 'Clear',
    biome,
    inventory: inventoryItems,
    inventorySlots: {
      used: inventoryItems.length,
      total: 36,
    },
    nearbyPlayers,
    nearbyEntities,
    notableBlocks,
    recentEvents: [], // Filled by brain from event buffer
  };
}

export function formatObservation(obs: GameObservation): string {
  const lines: string[] = [];

  // Self
  lines.push('== SELF ==');
  const s = obs.self;
  lines.push(`Position: (${s.position.x}, ${s.position.y}, ${s.position.z}) | Health: ${s.health}/${s.maxHealth} | Hunger: ${s.food}/20`);
  lines.push(`Held: ${s.heldItem ?? 'empty hand'} | Armor: ${s.armor.length > 0 ? s.armor.join(', ') : 'none'}`);
  lines.push(`Time: ${obs.time.timeOfDay} | Weather: ${obs.weather} | Biome: ${obs.biome}`);
  lines.push(`XP Level: ${s.experience.level}`);

  // Inventory
  lines.push(`\n== INVENTORY (${obs.inventorySlots.used} item types) ==`);
  if (obs.inventory.length === 0) {
    lines.push('Empty');
  } else {
    const items = obs.inventory.slice(0, 20).map((i) => `${i.name} x${i.count}`);
    lines.push(items.join(', '));
  }

  // Nearby players
  if (obs.nearbyPlayers.length > 0) {
    lines.push(`\n== NEARBY PLAYERS (within ${PLAYER_SCAN_RADIUS} blocks) ==`);
    for (const p of obs.nearbyPlayers) {
      lines.push(`${p.name} (${p.distance} blocks away)`);
    }
  }

  // Nearby entities
  if (obs.nearbyEntities.length > 0) {
    lines.push(`\n== NEARBY ENTITIES (within ${ENTITY_SCAN_RADIUS} blocks) ==`);
    for (const e of obs.nearbyEntities) {
      const threat = e.hostile ? ' [HOSTILE]' : '';
      lines.push(`${e.name} (${e.distance} blocks)${threat}`);
    }
  }

  // Notable blocks
  if (obs.notableBlocks.length > 0) {
    lines.push(`\n== NOTABLE BLOCKS ==`);
    for (const b of obs.notableBlocks) {
      lines.push(`${b.name} at (${b.position.x}, ${b.position.y}, ${b.position.z}) — ${b.distance} blocks`);
    }
  }

  // Recent events
  if (obs.recentEvents.length > 0) {
    lines.push(`\n== RECENT EVENTS ==`);
    for (const e of obs.recentEvents) {
      lines.push(e);
    }
  }

  return lines.join('\n');
}
