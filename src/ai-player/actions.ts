import { logger } from '../utils/logger.js';
import type { PersistentMemory } from './memory.js';
import type { AIPlayerBot } from './bot.js';
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
    name: 'wander',
    description: 'Walk in a random direction to explore. Good when idle.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'stay',
    description: 'Stop moving and stay in place.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // Mining
  {
    name: 'mineBlock',
    description: 'Mine the block at a specific position. Must be within 6 blocks.',
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

  // Combat
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
  {
    name: 'lookAt',
    description: 'Turn to look toward a position.',
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

  // Items
  {
    name: 'pickupItem',
    description: 'Pick up nearby items from the ground. Optionally filter by item name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        itemFilter: { type: 'string', description: 'Optional item name to filter for (e.g. "iron_ingot")' },
      },
    },
  },
  {
    name: 'dropItem',
    description: 'Drop an item from your inventory on the ground.',
    input_schema: {
      type: 'object' as const,
      properties: {
        itemName: { type: 'string', description: 'Name of the item to drop (e.g. "cobblestone")' },
      },
      required: ['itemName'],
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

// Action executor — takes Claude's tool calls and runs them via RCON
export class ActionExecutor {
  private bot: AIPlayerBot;
  private memory: PersistentMemory;
  private boundary: Boundary | null;
  private lastPosition: { x: number; y: number; z: number } | null = null;

  constructor(bot: AIPlayerBot, memory: PersistentMemory, boundary: Boundary | null) {
    this.bot = bot;
    this.memory = memory;
    this.boundary = boundary;
  }

  setPosition(x: number, y: number, z: number): void {
    this.lastPosition = { x, y, z };
  }

  private clampToBoundary(x: number, z: number): { x: number; z: number; clamped: boolean } {
    if (!this.boundary) return { x, z, clamped: false };
    const dx = x - this.boundary.centerX;
    const dz = z - this.boundary.centerZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= this.boundary.radius) return { x, z, clamped: false };
    const scale = this.boundary.radius / dist;
    return {
      x: Math.round(this.boundary.centerX + dx * scale),
      z: Math.round(this.boundary.centerZ + dz * scale),
      clamped: true,
    };
  }

  async execute(actionName: string, args: Record<string, any>): Promise<string> {
    try {
      switch (actionName) {
        case 'goToPosition': {
          const { x: cx, z: cz, clamped } = this.clampToBoundary(args.x, args.z);
          if (clamped) logger.debug(`Boundary: clamped goToPosition from (${args.x},${args.z}) to (${cx},${cz})`);
          return await this.bot.sendCommand(`goto ${cx} ${args.y} ${cz}`);
        }
        case 'goToPlayer':
          return await this.bot.sendCommand(`follow ${args.playerName}`);

        case 'wander':
          return await this.bot.sendCommand('wander');

        case 'stay':
          return await this.bot.sendCommand('stay');

        case 'mineBlock':
          return await this.bot.sendCommand(`mine ${Math.round(args.x)} ${Math.round(args.y)} ${Math.round(args.z)}`);

        case 'attackEntity':
          return await this.bot.sendCommand(`attack ${args.entityType}`);

        case 'chat': {
          const msg = (args.message as string).slice(0, 200);
          return await this.bot.sendCommand(`chat ${msg}`);
        }

        case 'lookAt':
          return await this.bot.sendCommand(`look ${args.x} ${args.y} ${args.z}`);

        case 'pickupItem': {
          const filter = args.itemFilter ? ` ${args.itemFilter}` : '';
          return await this.bot.sendCommand(`pickup${filter}`);
        }

        case 'dropItem':
          return await this.bot.sendCommand(`drop ${args.itemName}`);

        // Memory actions (local, no RCON)
        case 'setGoal':
          this.memory.setGoal(args.goal);
          return `Goal set: ${args.goal}`;

        case 'rememberThing':
          this.memory.remember(args.key, args.value);
          return `Remembered: ${args.key} = ${args.value}`;

        case 'recallMemory': {
          const results = this.memory.recall(args.query);
          return results.length > 0 ? results.join('\n') : 'Nothing found in memory.';
        }

        case 'savePlace': {
          const pos = this.lastPosition ?? { x: 0, y: 0, z: 0 };
          this.memory.savePlace(args.name, pos.x, pos.y, pos.z, args.description);
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
}
