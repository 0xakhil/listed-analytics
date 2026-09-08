import { ADDRESSES, EXPLORER_API, EXPLORER_HEADERS, PROTOCOL_FEE_BPS } from "./constants";
import type { AnalyticsPayload, RangeKey, RouterStats, WindowStats } from "./types";

type Page<T> = { items?: T[]; next_page_params?: Record<string, unknown> | null };
type Tx = { timestamp?: string; hash?: string; from?: { hash?: string }; value?: string; status?: string };
type Transfer = {
  timestamp?: string;
  transaction_hash?: string;
  from?: { hash?: string };
  to?: { hash?: string };
  token?: { address?: string; address_hash?: string; symbol?: string; decimals?: string };
  total?: { value?: string; decimals?: string };
};

type Leg = { ts: number; volumeUsd: number; trader?: string; router: string };

const USDG = ADDRESSES.usdg.toLowerCase();
const WETH = ADDRESSES.weth.toLowerCase();
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

async function feed<T>(path: string, maxPages = 6): Promise<T[]> {
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

function tokenAmount(t: Transfer): { addr: string; symbol: string; amount: number } {
  const addr = (t.token?.address_hash || t.token?.address || "").toLowerCase();
  const dec = Number(t.total?.decimals ?? t.token?.decimals ?? 18);
  const amount = Number(t.total?.value ?? "0") / 10 ** (Number.isFinite(dec) ? dec : 18);
  return { addr, symbol: (t.token?.symbol ?? "").toUpperCase(), amount };
}

async function ethUsd(): Promise<number> {
  const ds = await getJson<{ pairs?: Array<{ priceUsd?: string }> }>(
    `https://api.dexscreener.com/latest/dex/tokens/${ADDRESSES.weth}`,
  );
  const p = Number(ds?.pairs?.[0]?.priceUsd);
  if (p > 0) return p;
  return 4300;
}

function emptyWindows(): Record<RangeKey, WindowStats> {
  const z = (): WindowStats => ({ volume: 0, fees: 0, swaps: 0, traders: 0, sampleComplete: true });
  return { "1h": z(), "1d": z(), "1w": z(), "1m": z(), all: z() };
}

export async function collectAnalytics(): Promise<AnalyticsPayload> {
  const notes: string[] = [];
  const price = await ethUsd();
  const [srTx, urTx, srTok, urTok] = await Promise.all([
    feed<Tx>(`/addresses/${ADDRESSES.swapRouter02}/transactions?filter=to`, 6),
    feed<Tx>(`/addresses/${ADDRESSES.universalRouter}/transactions?filter=to`, 6),
    feed<Transfer>(`/addresses/${ADDRESSES.swapRouter02}/token-transfers?type=ERC-20`, 6),
    feed<Transfer>(`/addresses/${ADDRESSES.universalRouter}/token-transfers?type=ERC-20`, 6),
  ]);

  const routersMeta = [
    { txs: srTx, toks: srTok, address: ADDRESSES.swapRouter02, label: "SwapRouter02" },
    { txs: urTx, toks: urTok, address: ADDRESSES.universalRouter, label: "Universal Router" },
  ];

  const byHash = new Map<string, Leg>();
  for (const r of routersMeta) {
    for (const t of r.txs) {
      if (!t.hash || t.status === "error") continue;
      const eth = Number(t.value ?? "0") / 1e18;
      const prev = byHash.get(t.hash) ?? {
        ts: t.timestamp ? +new Date(t.timestamp) : 0,
        volumeUsd: 0,
        trader: t.from?.hash?.toLowerCase(),
        router: r.label,
      };
      prev.volumeUsd += eth * price;
      if (t.timestamp) prev.ts = +new Date(t.timestamp);
      byHash.set(t.hash, prev);
    }
    for (const tok of r.toks) {
      const { addr, symbol, amount } = tokenAmount(tok);
      if (!amount) continue;
      const hash = tok.transaction_hash;
      if (!hash) continue;
      let usd = 0;
      if (addr === USDG || symbol.includes("USD")) usd = amount;
      else if (addr === WETH || symbol === "WETH" || symbol === "ETH") usd = amount * price;
      else continue;
      const prev = byHash.get(hash) ?? {
        ts: tok.timestamp ? +new Date(tok.timestamp) : 0,
        volumeUsd: 0,
        trader: tok.from?.hash?.toLowerCase(),
        router: r.label,
      };
      prev.volumeUsd = Math.max(prev.volumeUsd, usd);
      if (tok.timestamp) prev.ts = +new Date(tok.timestamp);
      byHash.set(hash, prev);
    }
  }

  const legs = [...byHash.values()];
  const routerTxs = [...srTx, ...urTx].filter((t) => t.status !== "error" && t.hash);
  if (!routerTxs.length) notes.push("Blockscout returned no aggregator router txs.");

  const now = Date.now();
  const oldest = legs.reduce((m, l) => (l.ts && l.ts < m ? l.ts : m), now);
  const windows = emptyWindows();

  for (const { key, ms } of WINDOWS) {
    const cutoff = key === "all" ? 0 : now - ms;
    const slice = legs.filter((l) => l.ts >= cutoff);
    const txSlice = routerTxs.filter((t) => (t.timestamp ? +new Date(t.timestamp) : 0) >= cutoff);
    const volume = slice.reduce((s, l) => s + l.volumeUsd, 0);
    const traders = new Set(
      txSlice.map((t) => t.from?.hash?.toLowerCase()).filter(Boolean) as string[],
    );
    windows[key] = {
      volume,
      fees: volume * FEE_RATE,
      swaps: Math.max(txSlice.length, slice.length),
      traders: traders.size,
      sampleComplete: key === "all" || oldest <= now - ms || legs.length === 0,
    };
  }

  const dayCutoff = now - 86_400_000;
  const allTraders = new Set(routerTxs.map((t) => t.from?.hash?.toLowerCase()).filter(Boolean) as string[]);
  const dailyTraders = new Set(
    routerTxs
      .filter((t) => t.timestamp && +new Date(t.timestamp) >= dayCutoff)
      .map((t) => t.from?.hash?.toLowerCase())
      .filter(Boolean) as string[],
  );

  const routers: RouterStats[] = routersMeta.map((r) => ({
    address: r.address,
    label: r.label,
    tx24h: r.txs.filter((t) => t.timestamp && +new Date(t.timestamp) >= dayCutoff && t.status !== "error").length,
    uniqueSenders: new Set(r.txs.map((t) => t.from?.hash?.toLowerCase()).filter(Boolean)).size,
    lastTx: r.txs[0]?.timestamp,
  }));

  const srVol = legs.filter((l) => l.router === "SwapRouter02").reduce((s, l) => s + l.volumeUsd, 0);
  const urVol = legs.filter((l) => l.router === "Universal Router").reduce((s, l) => s + l.volumeUsd, 0);
  const tot = srVol + urVol || 1;
  const venueMix = [
    { name: "SwapRouter02 (v2/v3)", share: Math.round((srVol / tot) * 100) },
    { name: "Universal Router (v4)", share: Math.round((urVol / tot) * 100) },
  ];

  const volumeSeries = Array.from({ length: 14 }, (_, i) => {
    const dayStart = now - (13 - i) * 86_400_000;
    const volume = legs.filter((l) => l.ts >= dayStart && l.ts < dayStart + 86_400_000).reduce((s, l) => s + l.volumeUsd, 0);
    return { t: new Date(dayStart).toISOString().slice(5, 10), volume, fees: volume * FEE_RATE };
  });

  notes.push(
    `Volume = ETH sent to routers × $${price.toFixed(0)} plus USDG/WETH token legs on SwapRouter02 and Universal Router. Fees = volume × ${PROTOCOL_FEE_BPS} bps (implied; fee-recipient index is still empty). Sampled explorer pages, not a full chain indexer.`,
  );

  return {
    generatedAt: new Date().toISOString(),
    live: routerTxs.length > 0,
    notes,
    protocolFeeBps: PROTOCOL_FEE_BPS,
    ethUsd: price,
    traders: { total: allTraders.size, daily: dailyTraders.size, walletsConnected: allTraders.size },
    windows,
    routers,
    venueMix,
    volumeSeries,
  };
}
