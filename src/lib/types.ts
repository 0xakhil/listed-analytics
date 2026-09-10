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
  feesUsd: number;
  swaps: number;
  uniqueTraders: number;
  lastTx?: string;
};

export type Holding = {
  symbol: string;
  address: string;
  amount: number;
  usd: number;
  priced: boolean;
};

export type FeeInflow = {
  ts: string;
  symbol: string;
  address: string;
  amount: number;
  usd: number;
  priced: boolean;
  trader: string;
  router: string;
  routerLabel: string;
  tx: string;
};

export type AnalyticsPayload = {
  generatedAt: string;
  /** true once at least one priced fee inflow has been observed. */
  live: boolean;
  /** true when an upstream data source failed and the numbers below are incomplete. */
  degraded: boolean;
  notes: string[];
  protocolFeeBps: number;
  blockScanned: number;
  treasuryUsd: number;
  holdings: Holding[];
  inflows: FeeInflow[];
  unpricedTokens: string[];
  traders: { total: number; daily: number };
  windows: Record<RangeKey, WindowStats>;
  routers: RouterStats[];
  feeByToken: { name: string; usd: number; share: number }[];
  volumeSeries: { t: string; volume: number; fees: number; wallets?: number }[];
};

export type DashboardRange = "1d" | "7d" | "30d" | "all";

export type DashboardWindow = {
  volume: number;
  fees: number;
  swaps: number;
  users: number;
  repeatUsers: number;
};

export type ListedDashboardPayload = {
  generatedAt: string;
  updatedAt: string | null;
  windows: Record<DashboardRange, DashboardWindow>;
  days: Array<{
    date: string;
    volume: number;
    fees: number;
    swaps: number;
    users: number;
    cumulativeVolume: number;
    cumulativeFees: number;
  }>;
};
