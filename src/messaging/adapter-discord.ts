import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ActivityType,
  MessageFlags,
  type TextChannel,
  type ChatInputCommandInteraction,
  type Webhook,
} from 'discord.js';
import type { MessagingAdapter, OutboundMessage, SlashCommandInteraction, WebhookStyleMessage, InboundMessage } from './types.js';
import { logger } from '../utils/logger.js';

export interface DiscordConfig {
  token: string;
  guildId: string;
  eventsChannelId: string;
  chatChannelId?: string;
  logsChannelId?: string;
}

export class DiscordAdapter implements MessagingAdapter {
  readonly platform = 'discord';
  private client: Client;
  private config: DiscordConfig;
  private eventsChannel: TextChannel | null = null;
  private chatChannel: TextChannel | null = null;
  private logsChannel: TextChannel | null = null;
  private slashCommandHandler: ((interaction: SlashCommandInteraction) => void) | null = null;
  private messageHandler: ((message: InboundMessage) => void) | null = null;
  private chatWebhook: Webhook | null = null;

  constructor(config: DiscordConfig) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async connect(): Promise<void> {
    // Set up interaction handler
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      if (!this.slashCommandHandler) return;

      const cmdInteraction = interaction as ChatInputCommandInteraction;
      const guild = cmdInteraction.guild;
      this.slashCommandHandler({
        commandName: cmdInteraction.commandName,
        channelId: cmdInteraction.channelId,
        memberRoleIds: cmdInteraction.member?.roles
          ? [...(cmdInteraction.member.roles as any).cache.keys()]
          : [],
        isGuildOwner: guild?.ownerId === cmdInteraction.user.id,
        reply: async (message: OutboundMessage) => {
          const embed = this.buildEmbed(message);
          await cmdInteraction.reply({ embeds: [embed] });
        },
        ephemeralReply: async (text: string) => {
          await cmdInteraction.reply({ content: text, flags: MessageFlags.Ephemeral });
        },
      });
    });

    // Login and wait for ready
    await this.client.login(this.config.token);

    await new Promise<void>((resolve) => {
      this.client.once('ready', () => {
        logger.info(`Discord bot logged in as ${this.client.user?.tag}`);
        resolve();
      });
    });

    // Register slash commands (after login so application.id is available)
    await this.registerSlashCommands();

    // Resolve channels
    this.eventsChannel = await this.client.channels.fetch(this.config.eventsChannelId) as TextChannel;
    if (this.config.chatChannelId) {
      this.chatChannel = await this.client.channels.fetch(this.config.chatChannelId) as TextChannel;
    }
    if (this.config.logsChannelId) {
      this.logsChannel = await this.client.channels.fetch(this.config.logsChannelId) as TextChannel;
    }

    // Set up webhook on chat channel for sendAsUser
    if (this.chatChannel) {
      this.chatWebhook = await this.getOrCreateWebhook(this.chatChannel);
    }

    // Listen for messages in chat channel (Discord → MC)
    this.client.on('messageCreate', (message) => {
      if (message.author.bot) return;
      if (!this.config.chatChannelId || message.channelId !== this.config.chatChannelId) return;
      if (!this.messageHandler) return;

      this.messageHandler({
        platform: 'discord',
        author: message.author.displayName,
        content: message.cleanContent,
        channel: 'chat',
      });
    });

    logger.info('Discord adapter connected');
  }

  private async getOrCreateWebhook(channel: TextChannel): Promise<Webhook> {
    const webhooks = await channel.fetchWebhooks();
    const existing = webhooks.find((wh) => wh.name === 'Vulture MC Chat');
    if (existing) return existing;
    return channel.createWebhook({ name: 'Vulture MC Chat' });
  }

  private async registerSlashCommands(): Promise<void> {
    const appId = this.client.application?.id;
    if (!appId) throw new Error('Discord application ID not available — is the client logged in?');

    const commands = [
      new SlashCommandBuilder()
        .setName('online')
        .setDescription('Check who is online (only you can see the response)'),
      new SlashCommandBuilder()
        .setName('online-all')
        .setDescription('Show who is online (visible to everyone)'),
      new SlashCommandBuilder()
        .setName('livechat')
        .setDescription('Toggle the MC ↔ Discord live chat bridge'),
    ];

    const rest = new REST({ version: '10' }).setToken(this.config.token);
    await rest.put(
      Routes.applicationGuildCommands(appId, this.config.guildId),
      { body: commands.map((c) => c.toJSON()) },
    );

    logger.info('Discord slash commands registered');
  }

  async send(message: OutboundMessage): Promise<void> {
    const channelMap = { events: this.eventsChannel, chat: this.chatChannel, logs: this.logsChannel };
    const channel = channelMap[message.channel];
    if (!channel) {
      logger.warn(`No Discord channel configured for purpose: ${message.channel}`);
      return;
    }

    const embed = this.buildEmbed(message);
    await channel.send({ embeds: [embed] });
  }

  setStatus(text: string): void {
    this.client.user?.setActivity(text, { type: ActivityType.Custom });
  }

  onSlashCommand(handler: (interaction: SlashCommandInteraction) => void): void {
    this.slashCommandHandler = handler;
  }

  async sendAsUser(message: WebhookStyleMessage): Promise<void> {
    if (!this.chatWebhook) {
      logger.warn('No chat webhook available — cannot send as user');
      return;
    }
    const content = await this.resolveMentions(message.content);
    await this.chatWebhook.send({
      content,
      username: message.username,
      avatarURL: message.avatarUrl,
    });
  }

  private async resolveMentions(content: string): Promise<string> {
    const guild = this.client.guilds.cache.get(this.config.guildId);
    if (!guild) return content;

    const matches = [...content.matchAll(/@(\w+)/g)];
    if (matches.length === 0) return content;

    let result = content;
    for (const match of matches) {
      const name = match[1];
      try {
        const members = await guild.members.search({ query: name, limit: 1 });
        const member = members.first();
        if (member && (
          member.displayName.toLowerCase() === name.toLowerCase() ||
          member.user.username.toLowerCase() === name.toLowerCase()
        )) {
          result = result.replace(`@${name}`, `<@${member.id}>`);
        }
      } catch {
        // If search fails, leave as plain text
      }
    }
    return result;
  }

  onMessage(handler: (message: InboundMessage) => void): void {
    this.messageHandler = handler;
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
    logger.info('Discord adapter disconnected');
  }

  private buildEmbed(message: OutboundMessage): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setDescription(message.description);

    if (message.title) embed.setTitle(message.title);
    if (message.color !== undefined) embed.setColor(message.color);
    if (message.thumbnailUrl) embed.setThumbnail(message.thumbnailUrl);
    if (message.imageUrl) embed.setImage(message.imageUrl);
    if (message.footer) embed.setFooter({ text: message.footer });
    if (message.fields) {
      for (const field of message.fields) {
        embed.addFields({ name: field.name, value: field.value, inline: field.inline });
      }
    }

    embed.setTimestamp();

    return embed;
  }
}
