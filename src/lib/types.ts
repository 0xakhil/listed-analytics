export type RouterStats = {
  address: string;
  label: string;
  tx24h: number;
  uniqueSenders: number;
  lastTx?: string;
};

export type PerpMarket = {
  symbol: string;
  mark: number;
  change24h: number;
  volume24h: number;
  openInterest: number;
  funding: number;
};

export type AnalyticsPayload = {
  generatedAt: string;
  live: boolean;
  notes: string[];
  routers: RouterStats[];
  feeRecipientTx24h: number;
  protocolFeeBps: number;
  perps: {
    markets: number;
    volume24h: number;
    openInterest: number;
    top: PerpMarket[];
  };
  venueMix: { name: string; share: number }[];
  volumeSeries: { t: string; volume: number; fees: number }[];
};
