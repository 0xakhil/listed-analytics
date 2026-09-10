import { NextResponse } from "next/server";
import type { ListedDashboardPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const source = `${(process.env.LISTED_EXCHANGE_URL ?? "https://listed.exchange").replace(/\/$/, "")}/api/analytics/summary`;
  try {
    const response = await fetch(source, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("source unavailable");
    return NextResponse.json(await response.json() as ListedDashboardPayload, { headers: { "cache-control": "public, s-maxage=20, stale-while-revalidate=40" } });
  } catch {
    return NextResponse.json({ error: "Listed swap tracker is unavailable" }, { status: 503 });
  }
}
