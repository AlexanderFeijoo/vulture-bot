import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ActivityType,
  type TextChannel,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { MessagingAdapter, OutboundMessage, SlashCommandInteraction } from './types.js';
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
      this.slashCommandHandler({
        commandName: cmdInteraction.commandName,
        reply: async (message: OutboundMessage) => {
          const embed = this.buildEmbed(message);
          await cmdInteraction.reply({ embeds: [embed] });
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

    logger.info('Discord adapter connected');
  }

  private async registerSlashCommands(): Promise<void> {
    const appId = this.client.application?.id;
    if (!appId) throw new Error('Discord application ID not available — is the client logged in?');

    const commands = [
      new SlashCommandBuilder()
        .setName('online')
        .setDescription('Show who is currently online on the Minecraft server'),
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
