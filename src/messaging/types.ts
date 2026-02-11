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
  fields?: EmbedField[];
  footer?: string;
}

export interface InboundMessage {
  platform: string;
  author: string;
  content: string;
  channel: ChannelPurpose;
}

export interface SlashCommandInteraction {
  commandName: string;
  reply: (message: OutboundMessage) => Promise<void>;
}

export interface MessagingAdapter {
  readonly platform: string;
  connect(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  setStatus(text: string): void;
  onSlashCommand(handler: (interaction: SlashCommandInteraction) => void): void;
  disconnect(): Promise<void>;
}
