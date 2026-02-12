import type { Bot } from 'mineflayer';
import 'mineflayer-pathfinder'; // type augmentation
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { goals: Goals } = require('mineflayer-pathfinder');
import { logger } from '../utils/logger.js';
import type { PersistentMemory } from './memory.js';
import type { Boundary } from './types.js';

// Tool definitions for Claude API (tool_use pattern)
export const ACTION_TOOLS = [
  // Movement
  {
    name: 'goToPosition',
    description: 'Walk to specific coordinates using pathfinding.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        z: { type: 'number', description: 'Z coordinate' },
      },
      required: ['x', 'y', 'z'],
    },
  },
  {
    name: 'goToPlayer',
    description: 'Walk toward a specific player.',
    input_schema: {
      type: 'object' as const,
      properties: {
        playerName: { type: 'string', description: 'Name of the player to approach' },
      },
      required: ['playerName'],
    },
  },
  {
    name: 'goToBlock',
    description: 'Find and walk to the nearest block of a given type.',
    input_schema: {
      type: 'object' as const,
      properties: {
        blockType: { type: 'string', description: 'Block type name (e.g. "oak_log", "iron_ore")' },
      },
      required: ['blockType'],
    },
  },
  {
    name: 'wander',
    description: 'Walk in a random direction to explore. Good when idle.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'stay',
    description: 'Do nothing. Stay in place and wait.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // Mining
  {
    name: 'mineBlock',
    description: 'Find and mine the nearest block of a type. Will walk to it and break it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        blockType: { type: 'string', description: 'Block type to mine (e.g. "oak_log", "stone")' },
        count: { type: 'number', description: 'How many to mine (default 1)' },
      },
      required: ['blockType'],
    },
  },
  {
    name: 'placeBlock',
    description: 'Place a block from inventory at a specific position.',
    input_schema: {
      type: 'object' as const,
      properties: {
        blockType: { type: 'string', description: 'Block type to place' },
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        z: { type: 'number', description: 'Z coordinate' },
      },
      required: ['blockType', 'x', 'y', 'z'],
    },
  },

  // Crafting
  {
    name: 'craft',
    description: 'Craft an item. Must be near a crafting table for 3x3 recipes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        itemName: { type: 'string', description: 'Item to craft (e.g. "oak_planks", "stick", "wooden_pickaxe")' },
        count: { type: 'number', description: 'How many to craft (default 1)' },
      },
      required: ['itemName'],
    },
  },

  // Inventory
  {
    name: 'equipItem',
    description: 'Equip an item to your hand or armor slot.',
    input_schema: {
      type: 'object' as const,
      properties: {
        itemName: { type: 'string', description: 'Item name to equip' },
        destination: {
          type: 'string',
          enum: ['hand', 'head', 'torso', 'legs', 'feet', 'off-hand'],
          description: 'Where to equip it',
        },
      },
      required: ['itemName'],
    },
  },
  {
    name: 'dropItem',
    description: 'Drop items from inventory on the ground.',
    input_schema: {
      type: 'object' as const,
      properties: {
        itemName: { type: 'string', description: 'Item to drop' },
        count: { type: 'number', description: 'How many to drop (default all)' },
      },
      required: ['itemName'],
    },
  },
  {
    name: 'giveToPlayer',
    description: 'Toss items toward a nearby player.',
    input_schema: {
      type: 'object' as const,
      properties: {
        playerName: { type: 'string', description: 'Player to give items to' },
        itemName: { type: 'string', description: 'Item to give' },
        count: { type: 'number', description: 'How many (default 1)' },
      },
      required: ['playerName', 'itemName'],
    },
  },

  // Combat / Survival
  {
    name: 'attackEntity',
    description: 'Attack the nearest entity of a given type.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entityType: { type: 'string', description: 'Entity type to attack (e.g. "zombie", "cow")' },
      },
      required: ['entityType'],
    },
  },
  {
    name: 'flee',
    description: 'Run away from the nearest threat.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'eat',
    description: 'Eat the best available food in inventory.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // Social
  {
    name: 'chat',
    description: 'Send a chat message in-game. Keep messages short and natural.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'Message to send in chat' },
      },
      required: ['message'],
    },
  },

  // Memory / Meta
  {
    name: 'setGoal',
    description: 'Update your current long-term goal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        goal: { type: 'string', description: 'New goal description' },
      },
      required: ['goal'],
    },
  },
  {
    name: 'rememberThing',
    description: 'Store something important in your long-term memory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Short label for this memory' },
        value: { type: 'string', description: 'What to remember' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'recallMemory',
    description: 'Search your long-term memory for something.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'What to search for' },
      },
      required: ['query'],
    },
  },
  {
    name: 'savePlace',
    description: 'Remember a named location for future reference.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name for this place (e.g. "home", "iron mine")' },
        description: { type: 'string', description: 'Description of this place' },
      },
      required: ['name', 'description'],
    },
  },
  {
    name: 'updateRelationship',
    description: 'Update your notes about a player.',
    input_schema: {
      type: 'object' as const,
      properties: {
        playerName: { type: 'string', description: 'Player name' },
        notes: { type: 'string', description: 'Updated notes about this player' },
        trust: { type: 'number', description: 'Trust level 0-1 (0=enemy, 0.5=neutral, 1=best friend)' },
      },
      required: ['playerName', 'notes'],
    },
  },
];

// Action executor — takes Claude's tool calls and runs them via Mineflayer
export class ActionExecutor {
  private bot: Bot;
  private memory: PersistentMemory;
  private boundary: Boundary | null;

  constructor(bot: Bot, memory: PersistentMemory, boundary: Boundary | null) {
    this.bot = bot;
    this.memory = memory;
    this.boundary = boundary;
  }

  /** Check if a position is within the allowed boundary. Returns clamped coords if outside. */
  private clampToBoundary(x: number, z: number): { x: number; z: number; clamped: boolean } {
    if (!this.boundary) return { x, z, clamped: false };
    const dx = x - this.boundary.centerX;
    const dz = z - this.boundary.centerZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= this.boundary.radius) return { x, z, clamped: false };
    // Clamp to boundary edge
    const scale = this.boundary.radius / dist;
    return {
      x: Math.round(this.boundary.centerX + dx * scale),
      z: Math.round(this.boundary.centerZ + dz * scale),
      clamped: true,
    };
  }

  private isInBoundary(x: number, z: number): boolean {
    if (!this.boundary) return true;
    const dx = x - this.boundary.centerX;
    const dz = z - this.boundary.centerZ;
    return Math.sqrt(dx * dx + dz * dz) <= this.boundary.radius;
  }

  async execute(actionName: string, args: Record<string, any>): Promise<string> {
    try {
      switch (actionName) {
        case 'goToPosition':
          return await this.goToPosition(args.x, args.y, args.z);
        case 'goToPlayer':
          return await this.goToPlayer(args.playerName);
        case 'goToBlock':
          return await this.goToBlock(args.blockType);
        case 'wander':
          return await this.wander();
        case 'stay':
          return 'Staying in place.';

        case 'mineBlock':
          return await this.mineBlock(args.blockType, args.count ?? 1);
        case 'placeBlock':
          return await this.placeBlock(args.blockType, args.x, args.y, args.z);

        case 'craft':
          return await this.craft(args.itemName, args.count ?? 1);

        case 'equipItem':
          return await this.equipItem(args.itemName, args.destination ?? 'hand');
        case 'dropItem':
          return await this.dropItem(args.itemName, args.count);
        case 'giveToPlayer':
          return await this.giveToPlayer(args.playerName, args.itemName, args.count ?? 1);

        case 'attackEntity':
          return await this.attackEntity(args.entityType);
        case 'flee':
          return await this.flee();
        case 'eat':
          return await this.eat();

        case 'chat':
          return this.chat(args.message);

        case 'setGoal':
          this.memory.setGoal(args.goal);
          return `Goal set: ${args.goal}`;
        case 'rememberThing':
          this.memory.remember(args.key, args.value);
          return `Remembered: ${args.key} = ${args.value}`;
        case 'recallMemory':
          const results = this.memory.recall(args.query);
          return results.length > 0 ? results.join('\n') : 'Nothing found in memory.';
        case 'savePlace': {
          const pos = this.bot.entity.position;
          this.memory.savePlace(args.name, Math.round(pos.x), Math.round(pos.y), Math.round(pos.z), args.description);
          return `Saved place "${args.name}" at current position.`;
        }
        case 'updateRelationship':
          this.memory.updateRelationship(args.playerName, args.notes, args.trust);
          return `Updated notes about ${args.playerName}.`;

        default:
          return `Unknown action: ${actionName}`;
      }
    } catch (err: any) {
      const msg = `Action ${actionName} failed: ${err.message}`;
      logger.warn(msg);
      return msg;
    }
  }

  // --- Movement ---

  private async goToPosition(x: number, y: number, z: number): Promise<string> {
    const { x: cx, z: cz, clamped } = this.clampToBoundary(x, z);
    if (clamped) logger.debug(`Boundary: clamped goToPosition from (${x},${z}) to (${cx},${cz})`);
    const goal = new Goals.GoalBlock(cx, y, cz);
    this.bot.pathfinder.setGoal(goal);
    await this.waitForGoal(15000);
    return `Moved toward (${cx}, ${y}, ${cz}).`;
  }

  private async goToPlayer(playerName: string): Promise<string> {
    const player = this.bot.players[playerName];
    if (!player?.entity) return `Can't see player ${playerName}.`;
    const px = player.entity.position.x;
    const pz = player.entity.position.z;
    if (!this.isInBoundary(px, pz)) return `${playerName} is outside my allowed area.`;
    const goal = new Goals.GoalNear(px, player.entity.position.y, pz, 3);
    this.bot.pathfinder.setGoal(goal);
    await this.waitForGoal(15000);
    return `Moved toward ${playerName}.`;
  }

  private async goToBlock(blockType: string): Promise<string> {
    const mcData = require('minecraft-data')(this.bot.version);
    const blockId = mcData.blocksByName[blockType];
    if (!blockId) return `Unknown block type: ${blockType}`;

    const block = this.bot.findBlock({
      matching: blockId.id,
      maxDistance: 64,
      useExtraInfo: (block: any) => this.isInBoundary(block.position.x, block.position.z),
    });
    if (!block) return `No ${blockType} found nearby (within allowed area).`;

    const goal = new Goals.GoalBlock(block.position.x, block.position.y, block.position.z);
    this.bot.pathfinder.setGoal(goal);
    await this.waitForGoal(15000);
    return `Moved toward ${blockType} at (${block.position.x}, ${block.position.y}, ${block.position.z}).`;
  }

  private async wander(): Promise<string> {
    const pos = this.bot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * 30;
    let x = Math.round(pos.x + Math.cos(angle) * dist);
    let z = Math.round(pos.z + Math.sin(angle) * dist);
    const clamped = this.clampToBoundary(x, z);
    x = clamped.x;
    z = clamped.z;
    const goal = new Goals.GoalXZ(x, z);
    this.bot.pathfinder.setGoal(goal);
    await this.waitForGoal(20000);
    return `Wandered toward (${x}, ?, ${z}).`;
  }

  private waitForGoal(timeout: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.bot.pathfinder.setGoal(null);
        resolve();
      }, timeout);

      this.bot.once('goal_reached', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // --- Mining ---

  private async mineBlock(blockType: string, count: number): Promise<string> {
    const mcData = require('minecraft-data')(this.bot.version);
    const blockId = mcData.blocksByName[blockType];
    if (!blockId) return `Unknown block type: ${blockType}`;

    let mined = 0;
    for (let i = 0; i < count; i++) {
      const block = this.bot.findBlock({
        matching: blockId.id,
        maxDistance: 32,
      });
      if (!block) break;

      // Walk to block
      const goal = new Goals.GoalBlock(block.position.x, block.position.y, block.position.z);
      this.bot.pathfinder.setGoal(goal);
      await this.waitForGoal(10000);

      // Re-find the block at position (it may have changed)
      const targetBlock = this.bot.blockAt(block.position);
      if (!targetBlock || targetBlock.name !== blockType) continue;

      try {
        await this.bot.dig(targetBlock);
        mined++;
      } catch {
        // Block may be unreachable
        break;
      }
    }

    return mined > 0 ? `Mined ${mined} ${blockType}.` : `Couldn't mine any ${blockType}.`;
  }

  private async placeBlock(blockType: string, x: number, y: number, z: number): Promise<string> {
    const item = this.bot.inventory.items().find((i) => i.name === blockType);
    if (!item) return `Don't have any ${blockType} in inventory.`;

    await this.bot.equip(item, 'hand');

    const referenceBlock = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
    if (!referenceBlock) return 'No reference block to place against.';

    try {
      await this.bot.placeBlock(referenceBlock, this.bot.entity.position.offset(0, 0, 0).minus(referenceBlock.position) as any);
      return `Placed ${blockType}.`;
    } catch (err: any) {
      return `Failed to place block: ${err.message}`;
    }
  }

  // --- Crafting ---

  private async craft(itemName: string, count: number): Promise<string> {
    const mcData = require('minecraft-data')(this.bot.version);
    const item = mcData.itemsByName[itemName];
    if (!item) return `Unknown item: ${itemName}`;

    // Try without crafting table first
    let recipes = this.bot.recipesFor(item.id, null, 1, null);

    // If no recipe, try finding a nearby crafting table
    if (recipes.length === 0) {
      const craftingTable = this.bot.findBlock({
        matching: mcData.blocksByName['crafting_table'].id,
        maxDistance: 32,
      });
      if (craftingTable) {
        // Move to crafting table
        const goal = new Goals.GoalNear(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 3);
        this.bot.pathfinder.setGoal(goal);
        await this.waitForGoal(10000);
        recipes = this.bot.recipesFor(item.id, null, 1, craftingTable);
      }
    }

    if (recipes.length === 0) return `No recipe found for ${itemName} (may need crafting table nearby).`;

    try {
      await this.bot.craft(recipes[0], count);
      return `Crafted ${count} ${itemName}.`;
    } catch (err: any) {
      return `Failed to craft ${itemName}: ${err.message}`;
    }
  }

  // --- Inventory ---

  private async equipItem(itemName: string, destination: string): Promise<string> {
    const item = this.bot.inventory.items().find((i) => i.name === itemName);
    if (!item) return `Don't have ${itemName}.`;

    await this.bot.equip(item, destination as any);
    return `Equipped ${itemName} to ${destination}.`;
  }

  private async dropItem(itemName: string, count?: number): Promise<string> {
    const item = this.bot.inventory.items().find((i) => i.name === itemName);
    if (!item) return `Don't have ${itemName}.`;

    await this.bot.tossStack(item);
    return `Dropped ${itemName}.`;
  }

  private async giveToPlayer(playerName: string, itemName: string, count: number): Promise<string> {
    const player = this.bot.players[playerName];
    if (!player?.entity) return `Can't see ${playerName}.`;

    // Walk to player first
    const goal = new Goals.GoalNear(player.entity.position.x, player.entity.position.y, player.entity.position.z, 2);
    this.bot.pathfinder.setGoal(goal);
    await this.waitForGoal(10000);

    const item = this.bot.inventory.items().find((i) => i.name === itemName);
    if (!item) return `Don't have ${itemName}.`;

    await this.bot.tossStack(item);
    return `Tossed ${itemName} toward ${playerName}.`;
  }

  // --- Combat ---

  private async attackEntity(entityType: string): Promise<string> {
    const entity = this.bot.nearestEntity((e) => e.name === entityType);
    if (!entity) return `No ${entityType} nearby.`;

    // Move toward it
    const goal = new Goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2);
    this.bot.pathfinder.setGoal(goal);
    await this.waitForGoal(5000);

    try {
      await this.bot.attack(entity);
      return `Attacked ${entityType}.`;
    } catch (err: any) {
      return `Failed to attack: ${err.message}`;
    }
  }

  private async flee(): Promise<string> {
    const hostile = this.bot.nearestEntity((e) => {
      return e.type === 'hostile' || e.type === 'mob';
    });

    if (!hostile) return 'Nothing to flee from.';

    const pos = this.bot.entity.position;
    const dx = pos.x - hostile.position.x;
    const dz = pos.z - hostile.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const fleeX = Math.round(pos.x + (dx / dist) * 30);
    const fleeZ = Math.round(pos.z + (dz / dist) * 30);

    const goal = new Goals.GoalXZ(fleeX, fleeZ);
    this.bot.pathfinder.setGoal(goal);
    await this.waitForGoal(10000);
    return 'Ran away from threat.';
  }

  private async eat(): Promise<string> {
    const foods = this.bot.inventory.items().filter((i) => {
      return i.name.includes('bread') || i.name.includes('cooked') ||
        i.name.includes('apple') || i.name.includes('carrot') ||
        i.name.includes('potato') || i.name.includes('steak') ||
        i.name.includes('porkchop') || i.name.includes('mutton') ||
        i.name.includes('chicken') || i.name.includes('cod') ||
        i.name.includes('salmon') || i.name.includes('melon') ||
        i.name.includes('cookie') || i.name.includes('pie') ||
        i.name.includes('stew') || i.name.includes('beetroot');
    });

    if (foods.length === 0) return 'No food in inventory.';

    try {
      await this.bot.equip(foods[0], 'hand');
      await this.bot.consume();
      return `Ate ${foods[0].name}.`;
    } catch (err: any) {
      return `Failed to eat: ${err.message}`;
    }
  }

  // --- Social ---

  private chat(message: string): string {
    // Truncate to prevent spam
    const msg = message.slice(0, 200);
    this.bot.chat(msg);
    return `Said: "${msg}"`;
  }
}
