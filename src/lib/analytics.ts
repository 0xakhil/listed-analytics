import {
  ADDRESSES,
  PROTOCOL_FEE_BPS,
  ROUTER_LABELS,
  TRANSFER_TOPIC,
} from "./constants";
import { ethUsd, priceMany } from "./prices";
import {
  getLogsRange,
  hex,
  rpc,
  rpcBatch,
  RpcFailure,
  toNum,
  topicAddr,
  type RpcBlock,
  type RpcTx,
} from "./rpc";
import type {
  AnalyticsPayload,
  FeeInflow,
  Holding,
  RangeKey,
  RouterStats,
  WindowStats,
} from "./types";

const FEE = ADDRESSES.feeRecipient.toLowerCase();
const FEE_RATE = PROTOCOL_FEE_BPS / 10_000;
const START_BLOCK = Number(process.env.ANALYTICS_START_BLOCK ?? 0);

const WINDOWS: { key: RangeKey; ms: number }[] = [
  { key: "1h", ms: 3_600_000 },
  { key: "1d", ms: 86_400_000 },
  { key: "1w", ms: 7 * 86_400_000 },
  { key: "1m", ms: 30 * 86_400_000 },
  { key: "all", ms: Number.POSITIVE_INFINITY },
];

// Minimal ABI selectors.
const SEL = {
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  balanceOf: "0x70a08231",
  ownerOf: "0x6352211e",
};

const padAddr = (a: string) => a.toLowerCase().replace("0x", "").padStart(64, "0");
const padUint = (n: number) => n.toString(16).padStart(64, "0");

function decodeString(hexData: string | null): string {
  if (!hexData || hexData === "0x") return "";
  const raw = hexData.slice(2);
  // ABI-encoded string: offset(32) + length(32) + bytes
  if (raw.length >= 128) {
    const len = parseInt(raw.slice(64, 128), 16);
    if (len > 0 && len < 256) {
      const bytes = raw.slice(128, 128 + len * 2);
      return hexToUtf8(bytes);
    }
  }
  // bytes32 (right-padded)
  return hexToUtf8(raw).replace(/\u0000+$/, "").replace(/ +$/, "").trim();
}

function hexToUtf8(h: string): string {
  let s = "";
  for (let i = 0; i < h.length; i += 2) {
    const c = parseInt(h.slice(i, i + 2), 16);
    if (c > 0) s += String.fromCharCode(c);
  }
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

type Leg = {
  token: string;
  router: string;
  amountRaw: bigint;
  tx: string;
  block: number;
};

function emptyWindows(): Record<RangeKey, WindowStats> {
  const z = (): WindowStats => ({ volume: 0, fees: 0, swaps: 0, traders: 0, sampleComplete: true });
  return { "1h": z(), "1d": z(), "1w": z(), "1m": z(), all: z() };
}

function emptyPayload(degraded: boolean, notes: string[]): AnalyticsPayload {
  return {
    generatedAt: new Date().toISOString(),
    live: false,
    degraded,
    notes,
    protocolFeeBps: PROTOCOL_FEE_BPS,
    blockScanned: 0,
    treasuryUsd: 0,
    holdings: [],
    inflows: [],
    unpricedTokens: [],
    traders: { total: 0, daily: 0 },
    windows: emptyWindows(),
    routers: [],
    feeByToken: [],
    volumeSeries: dayBuckets(Date.now(), () => 0),
  };
}

function dayBuckets(now: number, fees: (start: number) => number) {
  return Array.from({ length: 14 }, (_, i) => {
    const start = now - (13 - i) * 86_400_000;
    const f = fees(start);
    return {
      t: new Date(start).toISOString().slice(5, 10),
      fees: f,
      volume: FEE_RATE > 0 ? f / FEE_RATE : 0,
    };
  });
}

export async function collectAnalytics(): Promise<AnalyticsPayload> {
  const notes: string[] = [];
  let degraded = false;

  let tip: number;
  try {
    tip = toNum(await rpc<string>("eth_blockNumber", []));
  } catch {
    return emptyPayload(true, [
      "Could not reach the Robinhood Chain RPC. Numbers are unavailable, not zero.",
    ]);
  }

  // 1. Every ERC-20 transfer into the fee recipient.
  const scan = await getLogsRange(
    { topics: [TRANSFER_TOPIC, null, "0x" + padAddr(FEE)] },
    START_BLOCK,
    tip,
    { budgetMs: 9_000 },
  );
  if (!scan.complete) degraded = true;

  const legs: Leg[] = scan.logs.map((l) => ({
    token: l.address.toLowerCase(),
    router: topicAddr(l.topics[1]),
    amountRaw: BigInt(l.data === "0x" ? "0x0" : l.data),
    tx: l.transactionHash,
    block: toNum(l.blockNumber),
  }));

  if (legs.length === 0) {
    notes.push(feeNote());
    const base = emptyPayload(degraded, notes);
    base.blockScanned = scan.scannedFrom;
    base.treasuryUsd = await treasuryValue([]).catch(() => 0);
    return base;
  }

  // 2. Resolve tx senders/entrypoints, block timestamps, token metadata, Rialto router — batched.
  const txHashes = [...new Set(legs.map((l) => l.tx))];
  const blockNums = [...new Set([...legs.map((l) => l.block), scan.scannedFrom])];
  const tokens = [...new Set(legs.map((l) => l.token))];

  const [txs, blocks, meta, rialto] = await Promise.all([
    rpcBatch<RpcTx>(txHashes.map((h) => ({ method: "eth_getTransactionByHash", params: [h] }))).catch(
      () => [] as (RpcTx | null)[],
    ),
    rpcBatch<RpcBlock>(
      blockNums.map((b) => ({ method: "eth_getBlockByNumber", params: [hex(b), false] })),
    ).catch(() => [] as (RpcBlock | null)[]),
    rpcBatch<string>(
      tokens.flatMap((t) => [
        { method: "eth_call", params: [{ to: t, data: SEL.symbol }, "latest"] },
        { method: "eth_call", params: [{ to: t, data: SEL.decimals }, "latest"] },
      ]),
    ).catch(() => [] as (string | null)[]),
    rialtoRouters().catch(() => [] as string[]),
  ]);

  const txFrom = new Map<string, string>();
  const txTo = new Map<string, string>();
  txHashes.forEach((h, i) => {
    const t = txs[i];
    if (t?.from) txFrom.set(h, t.from.toLowerCase());
    if (t?.to) txTo.set(h, t.to.toLowerCase());
  });
  if (txHashes.some((h) => !txFrom.has(h))) degraded = true;

  const blockTs = new Map<number, number>();
  blockNums.forEach((b, i) => {
    const ts = toNum(blocks[i]?.timestamp);
    if (ts) blockTs.set(b, ts * 1000);
  });

  const sym = new Map<string, string>();
  const dec = new Map<string, number>();
  tokens.forEach((t, i) => {
    sym.set(t, decodeString(meta[2 * i] ?? null) || shortToken(t));
    const d = toNum(meta[2 * i + 1] ?? null);
    dec.set(t, d > 0 && d <= 36 ? d : 18);
  });

  const routerLabels: Record<string, string> = { ...ROUTER_LABELS };
  for (const r of rialto) routerLabels[r.toLowerCase()] = "Rialto";

  // 3. Price every token seen (current price; DexScreener has no history).
  const [prices, eth] = await Promise.all([priceMany(tokens), ethUsd().catch(() => 0)]);

  const now = Date.now();
  const coverageSince = scan.complete ? 0 : (blockTs.get(scan.scannedFrom) ?? now);

  type Priced = {
    ts: number;
    usd: number;
    amount: number;
    priced: boolean;
    token: string;
    symbol: string;
    trader: string;
    router: string;
    tx: string;
  };

  const priced: Priced[] = legs.map((l) => {
    const d = dec.get(l.token) ?? 18;
    const amount = Number(l.amountRaw) / 10 ** d;
    const px = prices.get(l.token) ?? 0;
    const usd = px > 0 ? amount * px : 0;
    return {
      ts: blockTs.get(l.block) ?? now,
      usd,
      amount,
      priced: px > 0,
      token: l.token,
      symbol: sym.get(l.token) ?? shortToken(l.token),
      trader: txFrom.get(l.tx) ?? "",
      router: txTo.get(l.tx) ?? l.router,
      tx: l.tx,
    };
  });

  const unpricedTokens = [
    ...new Set(priced.filter((p) => !p.priced).map((p) => p.symbol)),
  ];

  // 4. Windows.
  const windows = emptyWindows();
  for (const { key, ms } of WINDOWS) {
    const cutoff = key === "all" ? 0 : now - ms;
    const slice = priced.filter((p) => p.ts >= cutoff && p.priced);
    const fees = slice.reduce((s, p) => s + p.usd, 0);
    windows[key] = {
      fees,
      volume: FEE_RATE > 0 ? fees / FEE_RATE : 0,
      swaps: slice.length,
      traders: new Set(slice.map((p) => p.trader).filter(Boolean)).size,
      sampleComplete: key === "all" ? scan.complete : cutoff >= coverageSince,
    };
  }

  // 5. Daily implied-volume series (last 14 days).
  const volumeSeries = dayBuckets(now, (start) =>
    priced
      .filter((p) => p.priced && p.ts >= start && p.ts < start + 86_400_000)
      .reduce((s, p) => s + p.usd, 0),
  );

  // 6. Fee split by token.
  const byToken: Record<string, number> = {};
  for (const p of priced) if (p.priced) byToken[p.symbol] = (byToken[p.symbol] ?? 0) + p.usd;
  const tokenTot = Object.values(byToken).reduce((s, n) => s + n, 0) || 1;
  const feeByToken = Object.entries(byToken)
    .sort((a, b) => b[1] - a[1])
    .map(([name, usd]) => ({ name, usd, share: Math.round((usd / tokenTot) * 100) }));

  // 7. Fee split by router / entrypoint (measured, not a prior).
  const routerAgg = new Map<string, { usd: number; swaps: number; traders: Set<string>; last: number }>();
  for (const p of priced) {
    const r = p.router || "unknown";
    const cur = routerAgg.get(r) ?? { usd: 0, swaps: 0, traders: new Set<string>(), last: 0 };
    cur.usd += p.usd;
    cur.swaps += 1;
    if (p.trader) cur.traders.add(p.trader);
    cur.last = Math.max(cur.last, p.ts);
    routerAgg.set(r, cur);
  }
  const routers: RouterStats[] = [...routerAgg.entries()]
    .map(([address, v]) => ({
      address,
      label: routerLabels[address] ?? shortToken(address),
      feesUsd: v.usd,
      swaps: v.swaps,
      uniqueTraders: v.traders.size,
      lastTx: v.last ? new Date(v.last).toISOString() : undefined,
    }))
    .sort((a, b) => b.swaps - a.swaps);

  // 8. Traders.
  const dayCutoff = now - 86_400_000;
  const allTraders = new Set(priced.map((p) => p.trader).filter(Boolean));
  const dailyTraders = new Set(
    priced.filter((p) => p.ts >= dayCutoff).map((p) => p.trader).filter(Boolean),
  );

  // 9. Inflow ledger.
  const inflows: FeeInflow[] = priced
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .map((p) => ({
      ts: new Date(p.ts).toISOString(),
      symbol: p.symbol,
      address: p.token,
      amount: p.amount,
      usd: p.usd,
      priced: p.priced,
      trader: p.trader,
      router: p.router,
      routerLabel: routerLabels[p.router] ?? shortToken(p.router),
      tx: p.tx,
    }));

  // 10. Treasury (current balances, marked to market).
  const treasuryUsd = await treasuryValue(tokens, prices, dec, sym, eth).catch(() => {
    degraded = true;
    return 0;
  });
  const holdings = treasuryUsd > 0 ? await holdingsList(tokens, prices, dec, sym, eth).catch(() => []) : [];

  notes.push(feeNote());
  if (unpricedTokens.length)
    notes.push(
      `No market price for ${unpricedTokens.join(", ")} — those inflows are shown in the ledger but excluded from fee and volume totals.`,
    );
  if (!scan.complete)
    notes.push(
      `Log scan stopped at block ${scan.scannedFrom.toLocaleString()} (time budget). "Cumulative" and older windows are partial.`,
    );

  return {
    generatedAt: new Date().toISOString(),
    live: priced.some((p) => p.priced),
    degraded,
    notes,
    protocolFeeBps: PROTOCOL_FEE_BPS,
    blockScanned: scan.scannedFrom,
    treasuryUsd,
    holdings,
    inflows,
    unpricedTokens,
    traders: { total: allTraders.size, daily: dailyTraders.size },
    windows,
    routers,
    feeByToken,
    volumeSeries,
  };
}

function feeNote() {
  return `Fees = ERC-20 transfers into ${ADDRESSES.feeRecipient} (the ${PROTOCOL_FEE_BPS} bps output skim), priced at the current DexScreener rate. Implied volume = those USD fees ÷ ${(FEE_RATE).toFixed(4)}. Native-ETH fee legs and price-at-time-of-trade are not yet captured.`;
}

function shortToken(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

async function rialtoRouters(): Promise<string[]> {
  const res = await rpcBatch<string>([
    { method: "eth_call", params: [{ to: ADDRESSES.rialtoRegistry, data: SEL.ownerOf + padUint(2) }, "latest"] },
    { method: "eth_call", params: [{ to: ADDRESSES.rialtoRegistry, data: SEL.ownerOf + padUint(3) }, "latest"] },
  ]);
  return res
    .filter((r): r is string => !!r && r.length >= 42)
    .map((r) => "0x" + r.slice(-40).toLowerCase())
    .filter((a) => a !== "0x0000000000000000000000000000000000000000");
}

async function balancesOf(
  tokens: string[],
): Promise<{ eth: bigint; erc20: Map<string, bigint> }> {
  const [ethBal, ...tokBals] = await rpcBatch<string>([
    { method: "eth_getBalance", params: [ADDRESSES.feeRecipient, "latest"] },
    ...tokens.map((t) => ({
      method: "eth_call",
      params: [{ to: t, data: SEL.balanceOf + padAddr(ADDRESSES.feeRecipient) }, "latest"],
    })),
  ]);
  const erc20 = new Map<string, bigint>();
  tokens.forEach((t, i) => {
    const v = tokBals[i];
    if (v && v !== "0x") {
      try {
        erc20.set(t, BigInt(v));
      } catch {
        /* ignore */
      }
    }
  });
  return { eth: ethBal ? BigInt(ethBal) : BigInt(0), erc20 };
}

async function treasuryValue(
  tokens: string[],
  prices?: Map<string, number>,
  dec?: Map<string, number>,
  _sym?: Map<string, string>,
  eth?: number,
): Promise<number> {
  const p = prices ?? (await priceMany(tokens));
  const e = eth ?? (await ethUsd().catch(() => 0));
  const { eth: ethBal, erc20 } = await balancesOf(tokens);
  let total = (Number(ethBal) / 1e18) * e;
  for (const [t, bal] of erc20) {
    const d = dec?.get(t) ?? 18;
    total += (Number(bal) / 10 ** d) * (p.get(t) ?? 0);
  }
  return total;
}

async function holdingsList(
  tokens: string[],
  prices: Map<string, number>,
  dec: Map<string, number>,
  sym: Map<string, string>,
  eth: number,
): Promise<Holding[]> {
  const { eth: ethBal, erc20 } = await balancesOf(tokens);
  const out: Holding[] = [];
  const ethAmt = Number(ethBal) / 1e18;
  if (ethAmt > 0) out.push({ symbol: "ETH", address: "native", amount: ethAmt, usd: ethAmt * eth, priced: eth > 0 });
  for (const [t, bal] of erc20) {
    const d = dec.get(t) ?? 18;
    const amount = Number(bal) / 10 ** d;
    if (amount <= 0) continue;
    const px = prices.get(t) ?? 0;
    out.push({ symbol: sym.get(t) ?? shortToken(t), address: t, amount, usd: amount * px, priced: px > 0 });
  }
  return out.sort((a, b) => b.usd - a.usd);
}

// Surface the RPC failure type for callers/tests.
export { RpcFailure };
