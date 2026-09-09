import { NextResponse } from "next/server";
import type { AnalyticsPayload, RangeKey, WindowStats } from "@/lib/types";

export const dynamic = "force-dynamic";

type Window = {
  volume?: number;
  fees?: number;
  swaps?: number;
  users?: number;
  usersWith3Trades?: number;
};

type Summary = {
  protocolFeeBps?: number;
  splitFeeBps?: number;
  totals?: { volume?: number; swaps?: number; wallets?: number; updated_at?: string | null };
  windows?: Partial<Record<"1d" | "7d" | "30d" | "all", Window>>;
  days?: Array<{ date?: string; volume?: number; wallets?: number }>;
};

const emptyWindow = (): WindowStats => ({ volume: 0, fees: 0, swaps: 0, traders: 0, sampleComplete: true });

function asWindow(row?: Window): WindowStats {
  return {
    volume: Number(row?.volume ?? 0),
    fees: Number(row?.fees ?? 0),
    swaps: Number(row?.swaps ?? 0),
    traders: Number(row?.users ?? 0),
    sampleComplete: true,
  };
}

function dayLabels() {
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (13 - index));
    return date.toISOString().slice(5, 10);
  });
}

function payload(summary: Summary): AnalyticsPayload & {
  listedWindows: Record<"1d" | "7d" | "30d" | "all", Window>;
} {
  const total = summary.totals ?? {};
  const volume = Number(total.volume ?? 0);
  const swaps = Number(total.swaps ?? 0);
  const wallets = Number(total.wallets ?? 0);
  const byDay = new Map((summary.days ?? []).map((day) => [day.date, day]));
  const labels = dayLabels();
  const windows = Object.fromEntries((["1h", "1d", "1w", "1m", "all"] as RangeKey[]).map((key) => [key, emptyWindow()])) as Record<RangeKey, WindowStats>;
  windows["1d"] = asWindow(summary.windows?.["1d"]);
  windows["1w"] = asWindow(summary.windows?.["7d"]);
  windows["1m"] = asWindow(summary.windows?.["30d"]);
  windows.all = asWindow(summary.windows?.all ?? { volume, swaps, users: wallets });

  return {
    generatedAt: total.updated_at ?? new Date().toISOString(),
    live: swaps > 0,
    degraded: false,
    notes: [],
    protocolFeeBps: Number(summary.protocolFeeBps ?? 0),
    blockScanned: 0,
    treasuryUsd: 0,
    holdings: [],
    inflows: [],
    unpricedTokens: [],
    traders: { total: wallets, daily: Number(byDay.get(labels.at(-1) ?? "")?.wallets ?? 0) },
    windows,
    routers: [],
    feeByToken: [],
    volumeSeries: labels.map((date) => {
      const day = byDay.get(date);
      return { t: date, volume: Number(day?.volume ?? 0), fees: 0, wallets: Number(day?.wallets ?? 0) };
    }),
    listedWindows: {
      "1d": summary.windows?.["1d"] ?? {},
      "7d": summary.windows?.["7d"] ?? {},
      "30d": summary.windows?.["30d"] ?? {},
      all: summary.windows?.all ?? { volume, swaps, users: wallets },
    },
  };
}

export async function GET() {
  const source = `${(process.env.LISTED_EXCHANGE_URL ?? "https://www.listed.exchange").replace(/\/$/, "")}/api/analytics/summary`;
  try {
    const response = await fetch(source, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("source unavailable");
    return NextResponse.json(payload(await response.json() as Summary), { headers: { "cache-control": "public, s-maxage=20, stale-while-revalidate=40" } });
  } catch {
    return NextResponse.json({ error: "Listed swap tracker is unavailable" }, { status: 503 });
  }
}
