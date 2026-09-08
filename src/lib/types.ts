export type RangeKey = "1h" | "1d" | "1w" | "1m" | "all";

export type WindowStats = {
  volume: number;
  fees: number;
  swaps: number;
  traders: number;
  sampleComplete: boolean;
};

export type RouterStats = {
  address: string;
  label: string;
  tx24h: number;
  uniqueSenders: number;
  lastTx?: string;
};

export type AnalyticsPayload = {
  generatedAt: string;
  live: boolean;
  notes: string[];
  protocolFeeBps: number;
  ethUsd: number;
  traders: {
    total: number;
    daily: number;
    walletsConnected: number;
  };
  windows: Record<RangeKey, WindowStats>;
  routers: RouterStats[];
  venueMix: { name: string; share: number }[];
  volumeSeries: { t: string; volume: number; fees: number }[];
};
