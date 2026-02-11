export type ChannelPurpose = 'events' | 'chat' | 'logs';

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface OutboundMessage {
  channel: ChannelPurpose;
  title?: string;
  description: string;
  color?: number;
  thumbnailUrl?: string;
  imageUrl?: string;
  fields?: EmbedField[];
  footer?: string;
}

export interface InboundMessage {
  platform: string;
  author: string;
  content: string;
  channel: ChannelPurpose;
}

export interface WebhookStyleMessage {
  channel: ChannelPurpose;
  username: string;
  avatarUrl: string;
  content: string;
}

export interface SlashCommandInteraction {
  commandName: string;
  channelId: string;
  memberRoleIds: string[];
  isGuildOwner: boolean;
  reply: (message: OutboundMessage) => Promise<void>;
  ephemeralReply: (text: string) => Promise<void>;
}

export interface MessagingAdapter {
  readonly platform: string;
  connect(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  sendAsUser?(message: WebhookStyleMessage): Promise<void>;
  setStatus(text: string): void;
  onSlashCommand(handler: (interaction: SlashCommandInteraction) => void): void;
  onMessage(handler: (message: InboundMessage) => void): void;
  disconnect(): Promise<void>;
}
