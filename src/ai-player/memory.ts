import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../utils/logger.js';
import type { AIMemory } from './types.js';

const DEFAULT_MEMORY: AIMemory = {
  identity: { name: '' },
  relationships: {},
  places: {},
  knowledge: {
    server_name: "Uncle Al's Fat Stash",
  },
  goals: {
    current: 'Survive: find or build shelter, gather basic tools and food',
    subTasks: [],
    completed: [],
  },
  sessionLog: [],
};

export class PersistentMemory {
  private data: AIMemory;
  private filePath: string;
  private dirty = false;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = structuredClone(DEFAULT_MEMORY);
  }

  async load(): Promise<void> {
    if (existsSync(this.filePath)) {
      try {
        const raw = await readFile(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<AIMemory>;
        this.data = { ...structuredClone(DEFAULT_MEMORY), ...parsed };
        logger.info(`Loaded AI memory from ${this.filePath}`);
      } catch (err) {
        logger.warn(`Failed to load AI memory, starting fresh:`, err);
        this.data = structuredClone(DEFAULT_MEMORY);
      }
    } else {
      logger.info('No existing AI memory file, starting fresh');
    }

    // Auto-save every 5 minutes
    this.saveTimer = setInterval(() => {
      if (this.dirty) {
        this.save().catch((err) => logger.warn('Auto-save memory failed:', err));
      }
    }, 5 * 60 * 1000);
  }

  async save(): Promise<void> {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
      this.dirty = false;
      logger.debug('AI memory saved');
    } catch (err) {
      logger.error('Failed to save AI memory:', err);
    }
  }

  get memory(): AIMemory {
    return this.data;
  }

  setName(name: string): void {
    this.data.identity.name = name;
    this.dirty = true;
  }

  remember(key: string, value: unknown): void {
    this.data.knowledge[key] = value;
    this.dirty = true;
  }

  recall(query: string): string[] {
    const results: string[] = [];
    const q = query.toLowerCase();

    // Search relationships
    for (const [name, rel] of Object.entries(this.data.relationships)) {
      if (name.toLowerCase().includes(q) || rel.notes.toLowerCase().includes(q)) {
        results.push(`Player ${name}: ${rel.notes} (trust: ${rel.trust})`);
      }
    }

    // Search places
    for (const [name, place] of Object.entries(this.data.places)) {
      if (name.toLowerCase().includes(q) || place.description.toLowerCase().includes(q)) {
        results.push(`Place "${name}": ${place.description} at (${place.x}, ${place.y}, ${place.z})`);
      }
    }

    // Search knowledge
    for (const [key, value] of Object.entries(this.data.knowledge)) {
      const valStr = String(value);
      if (key.toLowerCase().includes(q) || valStr.toLowerCase().includes(q)) {
        results.push(`Knowledge "${key}": ${valStr}`);
      }
    }

    // Search goals
    if (this.data.goals.current.toLowerCase().includes(q)) {
      results.push(`Current goal: ${this.data.goals.current}`);
    }

    return results;
  }

  updateRelationship(name: string, notes: string, trust?: number): void {
    const existing = this.data.relationships[name];
    this.data.relationships[name] = {
      notes,
      trust: trust ?? existing?.trust ?? 0.5,
      lastSeen: new Date().toISOString(),
    };
    this.dirty = true;
  }

  savePlace(name: string, x: number, y: number, z: number, description: string): void {
    this.data.places[name] = { x, y, z, description };
    this.dirty = true;
  }

  setGoal(goal: string, subTasks?: string[]): void {
    if (this.data.goals.current && this.data.goals.current !== goal) {
      this.data.goals.completed.push(this.data.goals.current);
    }
    this.data.goals.current = goal;
    this.data.goals.subTasks = (subTasks ?? []).map((task) => ({ task, done: false }));
    this.dirty = true;
  }

  completeSubTask(index: number): string {
    const st = this.data.goals.subTasks;
    if (!st || index < 0 || index >= st.length) {
      return 'Invalid sub-task index.';
    }
    st[index].done = true;
    this.dirty = true;
    return `Completed: ${st[index].task}`;
  }

  addSessionLog(summary: string): void {
    this.data.sessionLog.push({
      date: new Date().toISOString().split('T')[0],
      summary,
    });
    // Keep only last 50 session logs
    if (this.data.sessionLog.length > 50) {
      this.data.sessionLog = this.data.sessionLog.slice(-50);
    }
    this.dirty = true;
  }

  getMemorySummary(): string {
    const lines: string[] = [];

    if (this.data.goals.current) {
      lines.push(`Current goal: ${this.data.goals.current}`);
      const st = this.data.goals.subTasks;
      if (st && st.length > 0) {
        for (let i = 0; i < st.length; i++) {
          const marker = st[i].done ? '[DONE]' : '[ ]';
          lines.push(`  ${i}. ${marker} ${st[i].task}`);
        }
      }
    }

    const relEntries = Object.entries(this.data.relationships);
    if (relEntries.length > 0) {
      lines.push('\nRelationships:');
      for (const [name, rel] of relEntries.slice(-10)) {
        lines.push(`  ${name}: ${rel.notes} (trust: ${rel.trust})`);
      }
    }

    const placeEntries = Object.entries(this.data.places);
    if (placeEntries.length > 0) {
      lines.push('\nKnown places:');
      for (const [name, p] of placeEntries.slice(-10)) {
        lines.push(`  ${name}: ${p.description} at (${p.x}, ${p.y}, ${p.z})`);
      }
    }

    const recentLogs = this.data.sessionLog.slice(-3);
    if (recentLogs.length > 0) {
      lines.push('\nRecent sessions:');
      for (const log of recentLogs) {
        lines.push(`  [${log.date}] ${log.summary}`);
      }
    }

    return lines.join('\n');
  }

  async shutdown(): Promise<void> {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      await this.save();
    }
  }
}
