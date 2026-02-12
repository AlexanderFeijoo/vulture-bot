import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import type { AIPlayerConfig, ThinkTrigger } from './types.js';
import type { PersistentMemory } from './memory.js';
import { ACTION_TOOLS, ActionExecutor } from './actions.js';
import { observeGameState, formatObservation } from './perception.js';
import type { AIPlayerBot } from './bot.js';

interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export class AIBrain {
  private client: Anthropic;
  private config: AIPlayerConfig;
  private botWrapper: AIPlayerBot;
  private memory: PersistentMemory;
  private personality: string;
  private executor: ActionExecutor;
  private getPlayerCount: () => number;

  private conversationHistory: ConversationEntry[] = [];
  private eventBuffer: string[] = [];
  private lastThinkTime = 0;
  private thinkCooldownMs = 5000;
  private isThinking = false;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private sleeping = false;

  // Cost tracking
  private dailyInputTokens = 0;
  private dailyOutputTokens = 0;
  private dailyResetDate = new Date().toISOString().split('T')[0];

  constructor(
    config: AIPlayerConfig,
    botWrapper: AIPlayerBot,
    memory: PersistentMemory,
    personality: string,
    getPlayerCount: () => number,
  ) {
    this.config = config;
    this.botWrapper = botWrapper;
    this.memory = memory;
    this.personality = personality;
    this.getPlayerCount = getPlayerCount;
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.executor = new ActionExecutor(botWrapper, memory, config.boundary);
  }

  start(): void {
    this.stopped = false;

    // Wire up triggers
    this.botWrapper.on('chat', (username: string, message: string) => {
      this.addEvent(`${username}: "${message}"`);
      if (this.sleeping) this.wake('chat from ' + username);
      this.triggerThink('chat');
    });

    this.botWrapper.on('damaged', (data: string) => {
      this.addEvent(`You took damage! (${data})`);
      if (this.sleeping) this.wake('took damage');
      this.triggerThink('damage');
    });

    this.botWrapper.on('died', () => {
      this.addEvent('You died!');
      // Dead NPC = no reason to think
      this.sleep();
    });

    this.botWrapper.on('spawned', () => {
      // Only wake if there are players to interact with
      if (this.getPlayerCount() > 0) {
        this.wake('respawned with players online');
        this.triggerThink('event');
      }
    });

    this.botWrapper.on('playerJoined', (username: string) => {
      this.addEvent(`${username} joined the server.`);
      if (this.sleeping) this.wake(username + ' joined');
      this.triggerThink('event');
    });

    this.botWrapper.on('playerLeft', (username: string) => {
      this.addEvent(`${username} left the server.`);
      // Check if server is now empty → sleep
      if (!this.sleeping && this.getPlayerCount() === 0) {
        this.sleep();
      }
    });

    // Start in sleep mode if nobody is online
    if (this.getPlayerCount() === 0) {
      this.sleep();
    } else {
      this.startIdleTimer();
    }

    logger.info('AIBrain started');
  }

  stop(): void {
    this.stopped = true;
    this.stopIdleTimer();
    this.botWrapper.removeAllListeners('chat');
    this.botWrapper.removeAllListeners('damaged');
    this.botWrapper.removeAllListeners('died');
    this.botWrapper.removeAllListeners('spawned');
    this.botWrapper.removeAllListeners('playerJoined');
    this.botWrapper.removeAllListeners('playerLeft');
    logger.info('AIBrain stopped');
  }

  private sleep(): void {
    if (this.sleeping) return;
    this.sleeping = true;
    this.stopIdleTimer();
    logger.info('AIBrain entering sleep mode (no players online or NPC dead)');
    // Announce in-game (fire-and-forget)
    if (this.botWrapper.isConnected) {
      this.botWrapper.sendCommand('chat *yawns and curls up for a nap*').catch(() => {});
    }
  }

  private wake(reason: string): void {
    if (!this.sleeping) return;
    // Don't wake if NPC is dead
    if (!this.botWrapper.isConnected) {
      logger.debug(`AIBrain wake blocked — NPC not alive (reason: ${reason})`);
      return;
    }
    this.sleeping = false;
    this.startIdleTimer();
    logger.info(`AIBrain waking up: ${reason}`);
    // Announce in-game (fire-and-forget)
    this.botWrapper.sendCommand('chat *wakes up and stretches*').catch(() => {});
  }

  private startIdleTimer(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      if (!this.isThinking && !this.stopped && !this.sleeping) {
        this.triggerThink('periodic');
      }
    }, 45000);
  }

  private stopIdleTimer(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private addEvent(event: string): void {
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    this.eventBuffer.push(`[${timeStr}] ${event}`);
    if (this.eventBuffer.length > 20) {
      this.eventBuffer.shift();
    }
  }

  private async triggerThink(trigger: ThinkTrigger): Promise<void> {
    if (this.stopped || this.isThinking || this.sleeping) return;
    if (!this.botWrapper.isConnected) return;

    const now = Date.now();
    if (now - this.lastThinkTime < this.thinkCooldownMs) return;

    if (this.isOverBudget()) {
      logger.warn('AIBrain: Daily budget exceeded, skipping think cycle');
      return;
    }

    this.isThinking = true;
    this.lastThinkTime = now;

    try {
      await this.thinkCycle(trigger);
    } catch (err) {
      logger.error('AIBrain think cycle error:', err);
    } finally {
      this.isThinking = false;
    }
  }

  private async thinkCycle(trigger: ThinkTrigger): Promise<void> {
    // Gather observations via RCON
    const observation = await observeGameState(this.botWrapper);
    observation.recentEvents = [...this.eventBuffer];

    // Update executor's position knowledge
    this.executor.setPosition(
      observation.self.position.x,
      observation.self.position.y,
      observation.self.position.z,
    );

    const observationText = formatObservation(observation);
    const memorySummary = this.memory.getMemorySummary();

    const userMessage = [
      `[Trigger: ${trigger}]`,
      '',
      observationText,
      '',
      '== MEMORY ==',
      memorySummary || '(No memories yet)',
    ].join('\n');

    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    const messages = this.conversationHistory.map((entry) => ({
      role: entry.role as 'user' | 'assistant',
      content: entry.content,
    }));

    // Show thinking indicator in-game
    try {
      await this.botWrapper.sendCommand('thinking start');
    } catch (e) {
      logger.debug('Failed to send thinking start', e);
    }

    try {
      const response = await this.client.messages.create({
        model: this.config.modelId,
        max_tokens: 1024,
        system: this.buildSystemPrompt(),
        messages,
        tools: ACTION_TOOLS as any,
      });

      this.trackCosts(response.usage.input_tokens, response.usage.output_tokens);

      const results: string[] = [];

      let lastThought = '';
      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          lastThought = block.text;
          logger.info(`AIBrain reason: ${block.text}`);
          results.push(`(thought: ${block.text})`);
        } else if (block.type === 'tool_use') {
          const actionResult = await this.executor.execute(block.name, block.input as Record<string, any>);
          const reason = lastThought ? ` (reason: ${lastThought})` : '';
          logger.info(`AIBrain action: ${block.name}(${JSON.stringify(block.input)}) -> ${actionResult}${reason}`);
          results.push(actionResult);
          this.addEvent(`[You] ${actionResult}`);
        }
      }

      this.conversationHistory.push({
        role: 'assistant',
        content: results.join('\n') || '(idle)',
        timestamp: Date.now(),
      });

    } catch (err: any) {
      if (err.status === 429) {
        logger.warn('AIBrain: Rate limited, backing off');
        this.thinkCooldownMs = Math.min(this.thinkCooldownMs * 2, 60000);
      } else {
        throw err;
      }
    } finally {
      try {
        await this.botWrapper.sendCommand('thinking stop');
      } catch (e) {
        logger.debug('Failed to send thinking stop', e);
      }
    }
  }

  private buildSystemPrompt(): string {
    const name = this.memory.memory.identity.name || this.config.username;
    const currentGoal = this.memory.memory.goals?.current || 'Find shelter away from monsters and dig a cave to live in';
    const lines = [
      this.personality,
      '',
      `Your in-game name is "${name}".`,
      'You appear as a villager NPC in the world.',
      '',
      'You are on a Minecraft survival server. Observe your surroundings and decide what to do.',
      'ALWAYS output a short text thought (1 sentence) explaining WHY you chose your action before using a tool.',
      'Choose ONE action per turn. Keep chat messages short and natural (like a real player).',
      'If someone talks to you, respond naturally. Be friendly but simple.',
      'If you are in danger (low health, hostile mob nearby), prioritize survival.',
      '',
      `YOUR CURRENT GOAL: ${currentGoal}`,
      'When nothing else is happening, work toward this goal. Break it into small steps.',
      'You can mine blocks, place blocks, pick up items, and use containers to work toward your goal.',
    ];

    if (this.config.boundary) {
      const b = this.config.boundary;
      lines.push('');
      lines.push(`BOUNDARY: You must stay within ${b.radius} blocks of center (${b.centerX}, ${b.centerZ}). The server enforces this.`);
    }

    return lines.join('\n');
  }

  private trackCosts(inputTokens: number, outputTokens: number): void {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.dailyResetDate) {
      this.dailyInputTokens = 0;
      this.dailyOutputTokens = 0;
      this.dailyResetDate = today;
    }
    this.dailyInputTokens += inputTokens;
    this.dailyOutputTokens += outputTokens;

    const estimatedCost = (this.dailyInputTokens / 1_000_000) * 1 + (this.dailyOutputTokens / 1_000_000) * 5;
    logger.debug(`AIBrain daily cost estimate: $${estimatedCost.toFixed(2)} (${this.dailyInputTokens} in / ${this.dailyOutputTokens} out)`);
  }

  private isOverBudget(): boolean {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.dailyResetDate) return false;
    const estimatedCost = (this.dailyInputTokens / 1_000_000) * 1 + (this.dailyOutputTokens / 1_000_000) * 5;
    return estimatedCost >= this.config.maxDailySpend;
  }
}
