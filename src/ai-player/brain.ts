import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlockParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages.js';
import { logger } from '../utils/logger.js';
import type { AIPlayerConfig, ThinkTrigger } from './types.js';
import type { PersistentMemory } from './memory.js';
import { ACTION_TOOLS, ActionExecutor } from './actions.js';
import { observeGameState, formatObservation } from './perception.js';
import type { AIPlayerBot } from './bot.js';

const MAX_CONTINUATION_ROUNDS = 3;
const MAX_HISTORY_LENGTH = 16;
const COMPRESS_COUNT = 8;

/** Rotating idle prompts — replaces static "periodic" trigger */
const IDLE_PROMPTS = [
  'Check your goal progress and work on the next step.',
  'Look around — explore somewhere new or check what\'s nearby.',
  'See if any players are around to talk to.',
  'Check your inventory and think about what you need.',
  'Look for useful resources or blocks nearby.',
];

export class AIBrain {
  private client: Anthropic;
  private config: AIPlayerConfig;
  private botWrapper: AIPlayerBot;
  private memory: PersistentMemory;
  private personality: string;
  private executor: ActionExecutor;
  private getPlayerCount: () => number;

  private conversationHistory: MessageParam[] = [];
  private eventBuffer: string[] = [];
  private lastThinkTime = 0;
  private thinkCooldownMs = 5000;
  private isThinking = false;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private sleeping = false;
  private idlePromptIndex = 0;

  // Anti-repetition tracking
  private recentActions: string[] = [];

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
    this.generateSessionSummary('shutdown');
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
    this.generateSessionSummary('sleep');
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

  private getIdlePrompt(): string {
    const prompt = IDLE_PROMPTS[this.idlePromptIndex % IDLE_PROMPTS.length];
    this.idlePromptIndex++;
    return prompt;
  }

  /** Check if the same action has been repeated 3+ times recently */
  private getRepetitionNudge(): string | null {
    if (this.recentActions.length < 3) return null;
    const last3 = this.recentActions.slice(-3);
    // Check if all 3 are the same action name
    if (last3[0] === last3[1] && last3[1] === last3[2]) {
      return `You've repeated "${last3[0]}" 3 times in a row. Try something different — explore, check your goal, or interact with the world in a new way.`;
    }
    return null;
  }

  private trackAction(actionName: string): void {
    this.recentActions.push(actionName);
    if (this.recentActions.length > 5) {
      this.recentActions.shift();
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

    // Build the trigger line
    const triggerLine = trigger === 'periodic'
      ? `[Idle] ${this.getIdlePrompt()}`
      : `[Trigger: ${trigger}]`;

    // Relationship context for nearby players
    const relationshipContext = this.getRelationshipContext(
      observation.nearbyPlayers.map((p) => p.name),
    );

    // Repetition nudge
    const repetitionNudge = this.getRepetitionNudge();

    const userParts = [
      triggerLine,
      '',
      observationText,
      '',
      '== MEMORY ==',
      memorySummary || '(No memories yet)',
    ];

    if (relationshipContext) {
      userParts.push('', '== RELATIONSHIP NOTES ==', relationshipContext);
    }

    if (repetitionNudge) {
      userParts.push('', `== NOTICE == ${repetitionNudge}`);
    }

    const userMessage = userParts.join('\n');

    // Compress history if needed before adding new message
    this.compactHistory();

    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    // Show thinking indicator in-game
    try {
      await this.botWrapper.sendCommand('thinking start');
    } catch (e) {
      logger.debug('Failed to send thinking start', e);
    }

    try {
      // Continuation loop — up to MAX_CONTINUATION_ROUNDS
      for (let round = 0; round < MAX_CONTINUATION_ROUNDS; round++) {
        const response = await this.client.messages.create({
          model: this.config.modelId,
          max_tokens: 1024,
          system: this.buildSystemPrompt(),
          messages: this.conversationHistory,
          tools: ACTION_TOOLS as any,
        });

        this.trackCosts(response.usage.input_tokens, response.usage.output_tokens);

        // Add assistant response to history
        this.conversationHistory.push({
          role: 'assistant',
          content: response.content as ContentBlockParam[],
        });

        // Log thoughts and collect tool calls
        const toolResults: ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === 'text' && block.text) {
            logger.info(`AIBrain reason: ${block.text}`);
          } else if (block.type === 'tool_use') {
            this.trackAction(block.name);
            const actionResult = await this.executor.execute(block.name, block.input as Record<string, any>);
            logger.info(`AIBrain action: ${block.name}(${JSON.stringify(block.input)}) -> ${actionResult}`);
            this.addEvent(`[You] ${actionResult}`);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: actionResult,
            });
          }
        }

        // If there were tool calls, send results back
        if (toolResults.length > 0) {
          this.conversationHistory.push({
            role: 'user',
            content: toolResults,
          });
        }

        // Stop if Claude didn't request more tool use
        if (response.stop_reason !== 'tool_use') {
          break;
        }

        // Check budget between rounds
        if (this.isOverBudget()) {
          logger.warn('AIBrain: Budget exceeded mid-cycle, stopping continuation');
          break;
        }
      }
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

  /** Compress oldest messages when history exceeds limit */
  private compactHistory(): void {
    if (this.conversationHistory.length <= MAX_HISTORY_LENGTH) return;

    const toCompress = this.conversationHistory.slice(0, COMPRESS_COUNT);
    const remaining = this.conversationHistory.slice(COMPRESS_COUNT);

    // Summarize compressed messages
    const summaryParts: string[] = [];
    for (const msg of toCompress) {
      if (typeof msg.content === 'string') {
        // Extract key info from text messages
        const lines = msg.content.split('\n');
        for (const line of lines) {
          if (line.startsWith('[You]') || line.includes('joined') || line.includes('left') || line.includes(': "')) {
            summaryParts.push(line.trim().slice(0, 100));
          }
        }
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ('text' in block && block.text) {
            summaryParts.push(`(thought: ${block.text.slice(0, 80)})`);
          } else if ('type' in block && block.type === 'tool_result' && typeof block.content === 'string') {
            summaryParts.push(`(result: ${block.content.slice(0, 80)})`);
          }
        }
      }
    }

    const summary = summaryParts.slice(0, 10).join(' | ') || '(earlier actions and observations)';

    // Replace compressed portion with a single summary message
    this.conversationHistory = [
      { role: 'user', content: `[Earlier context summary] ${summary}` },
      // Ensure alternating roles — if remaining starts with user, add a placeholder assistant
      ...(remaining[0]?.role === 'user'
        ? [{ role: 'assistant' as const, content: '(acknowledged earlier context)' }]
        : []),
      ...remaining,
    ];

    logger.debug(`Compacted history: ${toCompress.length} messages → summary, ${this.conversationHistory.length} total`);
  }

  /** Generate and save a session summary from recent events */
  private generateSessionSummary(reason: string): void {
    if (this.eventBuffer.length === 0) return;

    const recentEvents = this.eventBuffer.slice(-10);
    const summary = `${reason}: ${recentEvents.join('; ').slice(0, 300)}`;
    this.memory.addSessionLog(summary);
    logger.debug(`Session summary saved (${reason})`);
  }

  /** Get relationship notes for nearby players from memory */
  private getRelationshipContext(nearbyPlayerNames: string[]): string | null {
    if (nearbyPlayerNames.length === 0) return null;

    const lines: string[] = [];
    for (const name of nearbyPlayerNames) {
      const rel = this.memory.memory.relationships[name];
      if (rel) {
        lines.push(`${name}: ${rel.notes} (trust: ${rel.trust})`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }

  private buildSystemPrompt(): string {
    const name = this.memory.memory.identity.name || this.config.username;
    const goals = this.memory.memory.goals;
    const currentGoal = goals?.current || 'Find shelter away from monsters and dig a cave to live in';

    const lines = [
      this.personality,
      '',
      `Your in-game name is "${name}".`,
      'You appear as a villager NPC in the world.',
      '',
      'You are on a Minecraft survival server. Observe your surroundings and decide what to do.',
      'ALWAYS output a short text thought (1 sentence) explaining WHY you chose your action before using a tool.',
      'You can take up to 3 actions per turn. After each action you\'ll see the result before deciding your next move.',
      'Keep chat messages short and natural (like a real player).',
      'If someone talks to you, respond naturally. Be friendly but simple.',
      '',
      '== SURVIVAL RULES ==',
      'If you are in danger (low health, hostile mob nearby), prioritize survival.',
      'If it\'s Sunset or Night, seek shelter. Monsters spawn in darkness.',
      'Don\'t fixate on common ores like copper or coal. Prioritize rare finds (diamond, emerald, gold) or your current goal.',
      'If an action fails, read the error and try a different approach. Do NOT repeat failed actions.',
      '',
      `== CURRENT GOAL ==`,
      currentGoal,
    ];

    // Show sub-task checklist
    const subTasks = goals?.subTasks;
    if (subTasks && subTasks.length > 0) {
      for (let i = 0; i < subTasks.length; i++) {
        const marker = subTasks[i].done ? '[DONE]' : '[ ]';
        lines.push(`  ${i}. ${marker} ${subTasks[i].task}`);
      }
      lines.push('Work on the next incomplete sub-task. Use completeSubTask when you finish one.');
    } else {
      lines.push('Break your goal into sub-tasks using setGoal with subTasks when you have a plan.');
    }

    lines.push('You can mine blocks, place blocks, pick up items, and use containers to work toward your goal.');

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
