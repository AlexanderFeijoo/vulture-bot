export interface Boundary {
  centerX: number;
  centerZ: number;
  radius: number;
}

export interface AIPlayerConfig {
  enabled: true;
  username: string;
  anthropicApiKey: string;
  modelId: string;
  maxDailySpend: number;
  personalityFile: string;
  memoryFile: string;
  boundary: Boundary | null;
}

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface NearbyPlayer {
  name: string;
  distance: number;
}

export interface NearbyEntity {
  name: string;
  distance: number;
  hostile: boolean;
}

export interface NotableBlock {
  name: string;
  x: number;
  y: number;
  z: number;
  distance: number;
}

export interface GameObservation {
  self: {
    position: Position;
    health: number;
    maxHealth: number;
  };
  time: string;
  weather: string;
  biome: string;
  nearbyPlayers: NearbyPlayer[];
  nearbyEntities: NearbyEntity[];
  notableBlocks: NotableBlock[];
  recentEvents: string[];
}

export interface AIMemory {
  identity: {
    name: string;
  };
  relationships: Record<string, {
    notes: string;
    trust: number;
    lastSeen: string;
  }>;
  places: Record<string, {
    x: number;
    y: number;
    z: number;
    description: string;
  }>;
  knowledge: Record<string, unknown>;
  goals: {
    current: string;
    completed: string[];
  };
  sessionLog: {
    date: string;
    summary: string;
  }[];
}

export interface ThinkCycleResult {
  action: string;
  args: Record<string, unknown>;
  thought?: string;
}

export type ThinkTrigger = 'chat' | 'event' | 'periodic' | 'damage';
