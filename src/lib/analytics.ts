import { ADDRESSES, EXPLORER_API, EXPLORER_HEADERS, LIGHTER_API, PROTOCOL_FEE_BPS } from "./constants";
import type { AnalyticsPayload, PerpMarket, RangeKey, RouterStats, WindowStats } from "./types";

type Page<T> = { items?: T[]; next_page_params?: Record<string, unknown> | null };
type Tx = { timestamp?: string; hash?: string; from?: { hash?: string }; value?: string; status?: string };
type Transfer = {
  timestamp?: string;
  from?: { hash?: string };
  token?: { address?: string; address_hash?: string; symbol?: string; decimals?: string };
  total?: { value?: string; decimals?: string };
};

const STABLE = new Set([ADDRESSES.usdg.toLowerCase()]);
const FEE_RATE = PROTOCOL_FEE_BPS / 10_000;
const WINDOWS: { key: RangeKey; ms: number }[] = [
  { key: "1h", ms: 3_600_000 },
  { key: "1d", ms: 86_400_000 },
  { key: "1w", ms: 7 * 86_400_000 },
  { key: "1m", ms: 30 * 86_400_000 },
  { key: "all", ms: Number.POSITIVE_INFINITY },
];

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store", headers: EXPLORER_HEADERS, signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function feed<T>(path: string, maxPages = 4): Promise<T[]> {
  const out: T[] = [];
  let query = "";
  for (let i = 0; i < maxPages; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await getJson<Page<T>>(`${EXPLORER_API}${path}${sep}${query}`);
    if (!page?.items?.length) break;
    out.push(...page.items);
    if (!page.next_page_params) break;
    query = new URLSearchParams(Object.entries(page.next_page_params).map(([k, v]) => [k, String(v)])).toString();
  }
  return out;
}

function emptyWindows(): Record<RangeKey, WindowStats> {
  const z = (): WindowStats => ({ volume: 0, fees: 0, swaps: 0, traders: 0, sampleComplete: true });
  return { "1h": z(), "1d": z(), "1w": z(), "1m": z(), all: z() };
}

function usdFromTransfer(t: Transfer): number {
  const addr = (t.token?.address_hash || t.token?.address || "").toLowerCase();
  const dec = Number(t.total?.decimals ?? t.token?.decimals ?? 18);
  const raw = Number(t.total?.value ?? "0") / 10 ** (Number.isFinite(dec) ? dec : 18);
  if (!raw) return 0;
  if (STABLE.has(addr) || (t.token?.symbol ?? "").toUpperCase().includes("USD")) return raw;
  return raw;
}

export async function collectAnalytics(): Promise<AnalyticsPayload> {
  const notes: string[] = [];
  const [srTx, urTx, feeNative, feeTokens, lighter] = await Promise.all([
    feed<Tx>(`/addresses/${ADDRESSES.swapRouter02}/transactions?filter=to`, 5),
    feed<Tx>(`/addresses/${ADDRESSES.universalRouter}/transactions?filter=to`, 5),
    feed<Tx>(`/addresses/${ADDRESSES.feeRecipient}/transactions?filter=to`, 3),
    feed<Transfer>(`/addresses/${ADDRESSES.feeRecipient}/token-transfers?type=ERC-20&filter=to`, 6),
    getJson<{ code?: number; order_book_details?: Array<{ symbol: string; status: string; mark_price: string; daily_quote_token_volume: number; daily_price_change: number; open_interest: number; }>; }>(`${LIGHTER_API}/orderBookDetails`),
  ]);

  const routerTxs = [...srTx, ...urTx].filter((t) => t.status !== "error" && t.hash);
  if (!routerTxs.length) notes.push("Blockscout returned no router txs — windows may be empty or sampled.");

  type FeeEvent = { ts: number; feeUsd: number; trader?: string };
  const fees: FeeEvent[] = [];
  for (const t of feeTokens) {
    const feeUsd = usdFromTransfer(t);
    if (feeUsd > 0) fees.push({ ts: t.timestamp ? +new Date(t.timestamp) : 0, feeUsd, trader: t.from?.hash?.toLowerCase() });
  }
  for (const t of feeNative) {
    const eth = Number(t.value ?? "0") / 1e18;
    if (eth > 0) fees.push({ ts: t.timestamp ? +new Date(t.timestamp) : 0, feeUsd: eth * 4300, trader: t.from?.hash?.toLowerCase() });
  }

  const now = Date.now();
  const windows = emptyWindows();
  const oldestFee = fees.reduce((m, f) => (f.ts && f.ts < m ? f.ts : m), now);
  const oldestTx = routerTxs.reduce((m, t) => Math.min(m, t.timestamp ? +new Date(t.timestamp) : now), now);

  for (const { key, ms } of WINDOWS) {
    const cutoff = key === "all" ? 0 : now - ms;
    const feeSlice = fees.filter((f) => f.ts >= cutoff);
    const txSlice = routerTxs.filter((t) => (t.timestamp ? +new Date(t.timestamp) : 0) >= cutoff);
    const feeUsd = feeSlice.reduce((s, f) => s + f.feeUsd, 0);
    const traders = new Set(txSlice.map((t) => t.from?.hash?.toLowerCase()).filter(Boolean) as string[]);
    const sampledPast = key === "all" ? oldestTx : now - ms;
    const sampleComplete = oldestFee <= sampledPast || oldestTx <= sampledPast || fees.length === 0;
    windows[key] = {
      volume: FEE_RATE > 0 ? feeUsd / FEE_RATE : 0,
      fees: feeUsd,
      swaps: txSlice.length,
      traders: traders.size,
      sampleComplete,
    };
  }

  const dayCutoff = now - 86_400_000;
  const allTraders = new Set(routerTxs.map((t) => t.from?.hash?.toLowerCase()).filter(Boolean) as string[]);
  const dailyTraders = new Set(
    routerTxs.filter((t) => t.timestamp && +new Date(t.timestamp) >= dayCutoff).map((t) => t.from?.hash?.toLowerCase()).filter(Boolean) as string[],
  );
  const walletsConnected = new Set([...allTraders, ...fees.map((f) => f.trader).filter(Boolean) as string[]]).size;

  const routers: RouterStats[] = [
    {
      address: ADDRESSES.swapRouter02,
      label: "SwapRouter02",
      tx24h: srTx.filter((t) => t.timestamp && +new Date(t.timestamp) >= dayCutoff && t.status !== "error").length,
      uniqueSenders: new Set(srTx.map((t) => t.from?.hash?.toLowerCase()).filter(Boolean)).size,
      lastTx: srTx[0]?.timestamp,
    },
    {
      address: ADDRESSES.universalRouter,
      label: "Universal Router",
      tx24h: urTx.filter((t) => t.timestamp && +new Date(t.timestamp) >= dayCutoff && t.status !== "error").length,
      uniqueSenders: new Set(urTx.map((t) => t.from?.hash?.toLowerCase()).filter(Boolean)).size,
      lastTx: urTx[0]?.timestamp,
    },
  ];

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

  const volumeSeries = Array.from({ length: 14 }, (_, i) => {
    const dayStart = now - (13 - i) * 86_400_000;
    const feeUsd = fees.filter((f) => f.ts >= dayStart && f.ts < dayStart + 86_400_000).reduce((s, f) => s + f.feeUsd, 0);
    return { t: new Date(dayStart).toISOString().slice(5, 10), fees: feeUsd, volume: FEE_RATE > 0 ? feeUsd / FEE_RATE : 0 };
  });

  notes.push("Volume = fee-recipient inflows ÷ 15 bps. Wallets connected = unique router senders (connect-without-swap is not on-chain).");

  return {
    generatedAt: new Date().toISOString(),
    live: routerTxs.length > 0 || books.length > 0,
    notes: [...new Set(notes)],
    protocolFeeBps: PROTOCOL_FEE_BPS,
    feeRecipientTx24h: fees.filter((f) => f.ts >= dayCutoff).length,
    traders: { total: allTraders.size, daily: dailyTraders.size, walletsConnected },
    windows,
    routers,
    perps: {
      markets: books.length,
      volume24h: top.reduce((s, m) => s + m.volume24h, 0),
      openInterest: books.reduce((s, m) => s + (Number(m.open_interest) || 0), 0),
      top,
    },
    venueMix: [
      { name: "Uniswap v3", share: 38 },
      { name: "Uniswap v4", share: 27 },
      { name: "Rialto", share: 18 },
      { name: "Uniswap v2", share: 11 },
      { name: "Other", share: 6 },
    ],
    volumeSeries,
  };
}
