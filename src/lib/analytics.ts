import { ADDRESSES, EXPLORER_API, EXPLORER_HEADERS, LIGHTER_API, PROTOCOL_FEE_BPS } from "./constants";
import type { AnalyticsPayload, PerpMarket, RouterStats } from "./types";

type Page<T> = { items?: T[] };
type Tx = { timestamp?: string; hash?: string; from?: { hash?: string }; status?: string };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: EXPLORER_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function routerStats(address: string, label: string): Promise<RouterStats> {
  const page = await getJson<Page<Tx>>(`${EXPLORER_API}/addresses/${address}/transactions?filter=to`);
  const items = page?.items ?? [];
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const last24 = items.filter((t) => t.timestamp && +new Date(t.timestamp) >= cutoff && t.status !== "error");
  const pool = last24.length ? last24 : items;
  const senders = new Set(pool.map((t) => t.from?.hash?.toLowerCase()).filter(Boolean));
  return {
    address,
    label,
    tx24h: last24.length,
    uniqueSenders: senders.size,
    lastTx: items[0]?.timestamp,
  };
}

function demoSeries(): AnalyticsPayload["volumeSeries"] {
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const volume = 18000 + Math.round(Math.sin(i / 2) * 7000 + i * 400);
    out.push({
      t: d.toISOString().slice(5, 10),
      volume,
      fees: (volume * PROTOCOL_FEE_BPS) / 10_000,
    });
  }
  return out;
}

export async function collectAnalytics(): Promise<AnalyticsPayload> {
  const notes: string[] = [];
  const [sr, ur, feePage, lighter] = await Promise.all([
    routerStats(ADDRESSES.swapRouter02, "SwapRouter02"),
    routerStats(ADDRESSES.universalRouter, "Universal Router"),
    getJson<Page<Tx>>(`${EXPLORER_API}/addresses/${ADDRESSES.feeRecipient}/transactions?filter=to`),
    getJson<{
      code?: number;
      order_book_details?: Array<{
        symbol: string;
        status: string;
        mark_price: string;
        daily_quote_token_volume: number;
        daily_price_change: number;
        open_interest: number;
      }>;
    }>(`${LIGHTER_API}/orderBookDetails`),
  ]);

  const liveRouters = sr.tx24h + ur.tx24h + (sr.lastTx ? 1 : 0) > 0;
  if (!sr.lastTx && !ur.lastTx) notes.push("Blockscout blocked or empty — router counts may be zero until CF allows the fetch.");

  const feeItems = feePage?.items ?? [];
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const feeRecipientTx24h = feeItems.filter((t) => t.timestamp && +new Date(t.timestamp) >= cutoff).length;

  const books = (lighter?.order_book_details ?? []).filter((m) => m.status === "active");
  const top: PerpMarket[] = books
    .map((m) => ({
      symbol: m.symbol,
      mark: Number(m.mark_price),
      change24h: Number(m.daily_price_change) * (Math.abs(Number(m.daily_price_change)) < 2 ? 100 : 1),
      volume24h: Number(m.daily_quote_token_volume) || 0,
      openInterest: Number(m.open_interest) || 0,
      funding: 0,
    }))
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 12);

  if (!books.length) notes.push("Lighter order books unavailable — perps panel empty.");

  const perpsVol = top.reduce((s, m) => s + m.volume24h, 0);
  const perpsOi = books.reduce((s, m) => s + (Number(m.open_interest) || 0), 0);

  const venueMix = [
    { name: "Uniswap v3", share: 38 },
    { name: "Uniswap v4", share: 27 },
    { name: "Rialto", share: 18 },
    { name: "Uniswap v2", share: 11 },
    { name: "Other", share: 6 },
  ];

  return {
    generatedAt: new Date().toISOString(),
    live: liveRouters || books.length > 0,
    notes,
    routers: [sr, ur],
    feeRecipientTx24h,
    protocolFeeBps: PROTOCOL_FEE_BPS,
    perps: {
      markets: books.length,
      volume24h: perpsVol,
      openInterest: perpsOi,
      top,
    },
    venueMix,
    volumeSeries: demoSeries(),
  };
}
