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

  private conversationHistory: ConversationEntry[] = [];
  private eventBuffer: string[] = [];
  private lastThinkTime = 0;
  private thinkCooldownMs = 5000;
  private isThinking = false;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  // Cost tracking
  private dailyInputTokens = 0;
  private dailyOutputTokens = 0;
  private dailyResetDate = new Date().toISOString().split('T')[0];

  constructor(
    config: AIPlayerConfig,
    botWrapper: AIPlayerBot,
    memory: PersistentMemory,
    personality: string,
  ) {
    this.config = config;
    this.botWrapper = botWrapper;
    this.memory = memory;
    this.personality = personality;
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.executor = new ActionExecutor(botWrapper, memory, config.boundary);
  }

  start(): void {
    this.stopped = false;

    // Wire up triggers
    this.botWrapper.on('chat', (username: string, message: string) => {
      this.addEvent(`${username}: "${message}"`);
      this.triggerThink('chat');
    });

    this.botWrapper.on('damaged', (data: string) => {
      this.addEvent(`You took damage! (${data})`);
      this.triggerThink('damage');
    });

    this.botWrapper.on('died', () => {
      this.addEvent('You died!');
      this.triggerThink('event');
    });

    this.botWrapper.on('playerJoined', (username: string) => {
      this.addEvent(`${username} joined the server.`);
      this.triggerThink('event');
    });

    this.botWrapper.on('playerLeft', (username: string) => {
      this.addEvent(`${username} left the server.`);
    });

    // Periodic idle check
    this.idleTimer = setInterval(() => {
      if (!this.isThinking && !this.stopped) {
        this.triggerThink('periodic');
      }
    }, 45000);

    logger.info('AIBrain started');
  }

  stop(): void {
    this.stopped = true;
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    this.botWrapper.removeAllListeners('chat');
    this.botWrapper.removeAllListeners('damaged');
    this.botWrapper.removeAllListeners('died');
    this.botWrapper.removeAllListeners('playerJoined');
    this.botWrapper.removeAllListeners('playerLeft');
    logger.info('AIBrain stopped');
  }

  private addEvent(event: string): void {
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    this.eventBuffer.push(`[${timeStr}] ${event}`);
    if (this.eventBuffer.length > 20) {
      this.eventBuffer.shift();
    }
  }

  private async triggerThink(trigger: ThinkTrigger): Promise<void> {
    if (this.stopped || this.isThinking) return;
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

      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          logger.debug(`AIBrain thought: ${block.text}`);
          results.push(`(thought: ${block.text})`);
        } else if (block.type === 'tool_use') {
          const actionResult = await this.executor.execute(block.name, block.input as Record<string, any>);
          logger.info(`AIBrain action: ${block.name}(${JSON.stringify(block.input)}) -> ${actionResult}`);
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
    }
  }

  private buildSystemPrompt(): string {
    const name = this.memory.memory.identity.name || this.config.username;
    const lines = [
      this.personality,
      '',
      `Your in-game name is "${name}".`,
      'You appear as a villager NPC in the world.',
      '',
      'You are on a Minecraft survival server. Observe your surroundings and decide what to do.',
      'Choose ONE action per turn. Keep chat messages short and natural (like a real player).',
      'If nothing interesting is happening, pursue your current goal or explore.',
      'If someone talks to you, respond naturally. Be friendly but simple.',
      'If you are in danger (low health, hostile mob nearby), prioritize survival.',
    ];

    if (this.config.boundary) {
      const b = this.config.boundary;
      lines.push('');
      lines.push(`IMPORTANT: You must stay within ${b.radius} blocks of your home area (center: ${b.centerX}, ${b.centerZ}).`);
      lines.push('Do not try to go beyond this boundary.');
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

    const estimatedCost = (this.dailyInputTokens / 1_000_000) * 3 + (this.dailyOutputTokens / 1_000_000) * 15;
    logger.debug(`AIBrain daily cost estimate: $${estimatedCost.toFixed(2)} (${this.dailyInputTokens} in / ${this.dailyOutputTokens} out)`);
  }

  private isOverBudget(): boolean {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.dailyResetDate) return false;
    const estimatedCost = (this.dailyInputTokens / 1_000_000) * 3 + (this.dailyOutputTokens / 1_000_000) * 15;
    return estimatedCost >= this.config.maxDailySpend;
  }
}
