import { ADDRESSES, EXPLORER_API, EXPLORER_HEADERS, PROTOCOL_FEE_BPS } from "./constants";
import type { AnalyticsPayload, Holding, RangeKey, RouterStats, WindowStats } from "./types";

type Page<T> = { items?: T[]; next_page_params?: Record<string, unknown> | null };
type Tx = { timestamp?: string; hash?: string; from?: { hash?: string }; value?: string; status?: string };
type Transfer = {
  timestamp?: string;
  transaction_hash?: string;
  from?: { hash?: string };
  to?: { hash?: string };
  token?: {
    address?: string;
    address_hash?: string;
    symbol?: string;
    decimals?: string;
    exchange_rate?: string;
  };
  total?: { value?: string; decimals?: string };
};

type TokenBal = {
  value?: string;
  token?: { symbol?: string; decimals?: string; exchange_rate?: string; address_hash?: string };
};

const FEE = ADDRESSES.feeRecipient.toLowerCase();
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

async function feed<T>(path: string, maxPages = 8): Promise<T[]> {
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

function transferUsd(t: Transfer): number {
  const dec = Number(t.total?.decimals ?? t.token?.decimals ?? 18);
  const amount = Number(t.total?.value ?? "0") / 10 ** (Number.isFinite(dec) ? dec : 18);
  const px = Number(t.token?.exchange_rate ?? "0");
  if (!amount) return 0;
  if (px > 0) return amount * px;
  const sym = (t.token?.symbol ?? "").toUpperCase();
  if (sym.includes("USD")) return amount;
  return 0;
}

export async function collectAnalytics(): Promise<AnalyticsPayload> {
  const notes: string[] = [];
  const [feeTransfers, feeNative, balances, srTx, urTx] = await Promise.all([
    feed<Transfer>(`/addresses/${ADDRESSES.feeRecipient}/token-transfers?type=ERC-20`, 8),
    feed<Tx>(`/addresses/${ADDRESSES.feeRecipient}/transactions?filter=to`, 3),
    getJson<TokenBal[]>(`${EXPLORER_API}/addresses/${ADDRESSES.feeRecipient}/token-balances`),
    feed<Tx>(`/addresses/${ADDRESSES.swapRouter02}/transactions?filter=to`, 4),
    feed<Tx>(`/addresses/${ADDRESSES.universalRouter}/transactions?filter=to`, 4),
  ]);

  type FeeLeg = { ts: number; usd: number; trader?: string; symbol: string };
  const inbound: FeeLeg[] = [];
  for (const t of feeTransfers) {
    if (t.to?.hash?.toLowerCase() !== FEE) continue;
    const usd = transferUsd(t);
    if (usd <= 0) continue;
    inbound.push({
      ts: t.timestamp ? +new Date(t.timestamp) : 0,
      usd,
      trader: t.from?.hash?.toLowerCase(),
      symbol: t.token?.symbol ?? "?",
    });
  }
  for (const t of feeNative) {
    const eth = Number(t.value ?? "0") / 1e18;
    if (eth <= 0) continue;
    inbound.push({
      ts: t.timestamp ? +new Date(t.timestamp) : 0,
      usd: eth * 2480,
      trader: t.from?.hash?.toLowerCase(),
      symbol: "ETH",
    });
  }

  const holdings: Holding[] = (balances ?? [])
    .map((b) => {
      const dec = Number(b.token?.decimals ?? 18);
      const amount = Number(b.value ?? "0") / 10 ** (Number.isFinite(dec) ? dec : 18);
      const px = Number(b.token?.exchange_rate ?? "0");
      return { symbol: b.token?.symbol ?? "?", amount, usd: amount * (px > 0 ? px : 0) };
    })
    .filter((h) => h.usd > 0.0001 || h.amount > 0)
    .sort((a, b) => b.usd - a.usd);
  const treasuryUsd = holdings.reduce((s, h) => s + h.usd, 0);

  const now = Date.now();
  const windows = emptyWindows();
  const oldest = inbound.reduce((m, f) => (f.ts && f.ts < m ? f.ts : m), now);

  for (const { key, ms } of WINDOWS) {
    const cutoff = key === "all" ? 0 : now - ms;
    const slice = inbound.filter((f) => f.ts >= cutoff);
    const fees = slice.reduce((s, f) => s + f.usd, 0);
    const traders = new Set(slice.map((f) => f.trader).filter(Boolean) as string[]);
    windows[key] = {
      volume: FEE_RATE > 0 ? fees / FEE_RATE : 0,
      fees,
      swaps: slice.length,
      traders: traders.size,
      sampleComplete: key === "all" || oldest <= now - ms || inbound.length === 0,
    };
  }

  const dayCutoff = now - 86_400_000;
  const routerTxs = [...srTx, ...urTx].filter((t) => t.status !== "error" && t.hash);
  const allTraders = new Set(inbound.map((f) => f.trader).filter(Boolean) as string[]);
  const dailyTraders = new Set(inbound.filter((f) => f.ts >= dayCutoff).map((f) => f.trader).filter(Boolean) as string[]);

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

  const bySym: Record<string, number> = {};
  for (const f of inbound) bySym[f.symbol] = (bySym[f.symbol] ?? 0) + f.usd;
  const feeTot = Object.values(bySym).reduce((s, n) => s + n, 0) || 1;
  const venueMix = Object.entries(bySym)
    .sort((a, b) => b[1] - a[1])
    .map(([name, usd]) => ({ name, share: Math.round((usd / feeTot) * 100) }));

  const volumeSeries = Array.from({ length: 14 }, (_, i) => {
    const dayStart = now - (13 - i) * 86_400_000;
    const fees = inbound.filter((f) => f.ts >= dayStart && f.ts < dayStart + 86_400_000).reduce((s, f) => s + f.usd, 0);
    return { t: new Date(dayStart).toISOString().slice(5, 10), fees, volume: FEE_RATE > 0 ? fees / FEE_RATE : 0 };
  });

  notes.push(
    `Fees are realized ERC-20 + ETH inflows to ${ADDRESSES.feeRecipient}. Volume = fees ÷ ${PROTOCOL_FEE_BPS} bps. Treasury is the live token balance of that wallet — not Uniswap router flow.`,
  );
  if (!inbound.length) notes.push("No fee-wallet transfers returned from Blockscout.");

  return {
    generatedAt: new Date().toISOString(),
    live: inbound.length > 0 || routerTxs.length > 0,
    notes,
    protocolFeeBps: PROTOCOL_FEE_BPS,
    treasuryUsd,
    holdings,
    traders: { total: allTraders.size, daily: dailyTraders.size, walletsConnected: allTraders.size },
    windows,
    routers,
    venueMix,
    volumeSeries,
  };
}
