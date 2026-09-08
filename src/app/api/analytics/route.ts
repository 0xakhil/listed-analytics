import { collectAnalytics } from "@/lib/analytics";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET() {
  const data = await collectAnalytics();
  return NextResponse.json(data, {
    headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}
