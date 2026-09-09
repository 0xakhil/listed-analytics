import { NextResponse } from "next/server";
import type { AnalyticsPayload, RangeKey, WindowStats } from "@/lib/types";

export const dynamic = "force-dynamic";

type Summary = {
  totals?: { volume?: number; swaps?: number; wallets?: number; updated_at?: string | null };
  days?: Array<{ date?: string; volume?: number; wallets?: number }>;
};

const emptyWindow = (): WindowStats => ({ volume: 0, fees: 0, swaps: 0, traders: 0, sampleComplete: true });

function dayLabels() {
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (13 - index));
    return date.toISOString().slice(5, 10);
  });
}

function payload(summary: Summary): AnalyticsPayload {
  const total = summary.totals ?? {};
  const volume = Number(total.volume ?? 0);
  const swaps = Number(total.swaps ?? 0);
  const wallets = Number(total.wallets ?? 0);
  const byDay = new Map((summary.days ?? []).map((day) => [day.date, day]));
  const all: WindowStats = { volume, fees: 0, swaps, traders: wallets, sampleComplete: true };
  const windows = Object.fromEntries((["1h", "1d", "1w", "1m"] as RangeKey[]).map((key) => [key, emptyWindow()])) as Record<RangeKey, WindowStats>;
  windows.all = all;
  const labels = dayLabels();

  return {
    generatedAt: total.updated_at ?? new Date().toISOString(), live: swaps > 0, degraded: false, notes: [], protocolFeeBps: 0, blockScanned: 0, treasuryUsd: 0,
    holdings: [], inflows: [], unpricedTokens: [], traders: { total: wallets, daily: Number(byDay.get(labels.at(-1) ?? "")?.wallets ?? 0) },
    windows, routers: [], feeByToken: [],
    volumeSeries: labels.map((date) => {
      const day = byDay.get(date);
      return { t: date, volume: Number(day?.volume ?? 0), fees: 0, wallets: Number(day?.wallets ?? 0) };
    }),
  };
}

export async function GET() {
  const source = `${(process.env.LISTED_EXCHANGE_URL ?? "https://listed.exchange").replace(/\/$/, "")}/api/analytics/summary`;
  try {
    const response = await fetch(source, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("source unavailable");
    return NextResponse.json(payload(await response.json() as Summary), { headers: { "cache-control": "public, s-maxage=20, stale-while-revalidate=40" } });
  } catch {
    return NextResponse.json({ error: "Listed swap tracker is unavailable" }, { status: 503 });
  }
}
