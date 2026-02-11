export interface PlayerJoinEvent {
  type: 'player_join';
  player: string;
  timestamp: Date;
}

export interface PlayerLeaveEvent {
  type: 'player_leave';
  player: string;
  timestamp: Date;
}

export interface ChatMessageEvent {
  type: 'chat';
  player: string;
  message: string;
  timestamp: Date;
}

export interface DeathEvent {
  type: 'death';
  player: string;
  message: string;
  timestamp: Date;
}

export interface AdvancementEvent {
  type: 'advancement';
  player: string;
  advancement: string;
  timestamp: Date;
}

export interface ServerStatusEvent {
  type: 'server_status';
  status: 'started' | 'stopped';
  timestamp: Date;
}

export type MinecraftEvent =
  | PlayerJoinEvent
  | PlayerLeaveEvent
  | ChatMessageEvent
  | DeathEvent
  | AdvancementEvent
  | ServerStatusEvent;
