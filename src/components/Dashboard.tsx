"use client";

import type { AnalyticsPayload } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const usd = (value: number, digits = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(value);
const whole = (value: number) => new Intl.NumberFormat("en-US").format(value);

type DailyRow = { date: string; volume: number; cumulative: number; wallets: number };

function seriesFor(data: AnalyticsPayload): DailyRow[] {
  const trailingVolume = data.volumeSeries.reduce((sum, point) => sum + point.volume, 0);
  let cumulative = Math.max(0, data.windows.all.volume - trailingVolume);
  const walletsByDate = new Map<string, Set<string>>();

  for (const inflow of data.inflows) {
    const date = new Date(inflow.ts).toISOString().slice(5, 10);
    const wallets = walletsByDate.get(date) ?? new Set<string>();
    wallets.add(inflow.trader.toLowerCase());
    walletsByDate.set(date, wallets);
  }

  return data.volumeSeries.map((point) => {
    cumulative += point.volume;
    return { date: point.t, volume: point.volume, cumulative, wallets: walletsByDate.get(point.t)?.size ?? 0 };
  });
}

function ChartCard({ title, subtitle, rows, dataKey, color }: { title: string; subtitle: string; rows: DailyRow[]; dataKey: "volume" | "cumulative"; color: string }) {
  return <section className="rounded-[22px] border border-line bg-surface p-5 sm:p-6">
    <div className="mb-5 flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-mute">{subtitle}</p><h2 className="mt-1 text-lg font-semibold tracking-tight text-ivory">{title}</h2></div><span className="rounded-full border border-line bg-ink px-2.5 py-1 font-mono text-[11px] text-mute">14D</span></div>
    <div className="h-64"><ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
      <defs><linearGradient id={`fill-${dataKey}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.35} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
      <CartesianGrid stroke="#2a2a2e" strokeDasharray="3 5" vertical={false} />
      <XAxis dataKey="date" tick={{ fill: "#8d8a84", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={22} />
      <YAxis tick={{ fill: "#8d8a84", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value) => `$${Number(value).toLocaleString("en-US", { notation: "compact" })}`} width={58} />
      <Tooltip cursor={{ stroke: "#525057", strokeDasharray: "3 3" }} contentStyle={{ background: "#171719", border: "1px solid #343238", borderRadius: 10, fontSize: 12 }} formatter={(value) => [usd(Number(value ?? 0), 2), dataKey === "volume" ? "Volume" : "Cumulative volume"]} />
      <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.25} fill={`url(#fill-${dataKey})`} />
    </AreaChart></ResponsiveContainer></div>
  </section>;
}

export function Dashboard() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => fetch("/api/analytics", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<AnalyticsPayload> : Promise.reject()).then((next) => active && setData(next)).catch(() => active && setError(true));
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const rows = useMemo(() => data ? seriesFor(data) : [], [data]);
  if (error) return <main className="mx-auto max-w-6xl px-5 py-20 text-mute">Analytics are temporarily unavailable. Please refresh in a moment.</main>;
  if (!data) return <main className="mx-auto max-w-6xl px-5 py-20 text-mute">Loading Listed analytics…</main>;

  const activity = data.windows.all;
  const updated = new Date(data.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
    <header className="flex items-center justify-between border-b border-line pb-6"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full border border-up/30 bg-up/10 text-lg font-bold text-ivory">L<span className="-ml-0.5 self-end pb-1 text-amber">.</span></span><div><p className="font-semibold tracking-[0.14em] text-ivory">LISTED</p><p className="text-xs text-mute">Exchange analytics</p></div></div><div className="text-right"><p className="inline-flex items-center gap-1.5 text-xs text-up"><span className="h-1.5 w-1.5 rounded-full bg-up" />Live</p><p className="mt-1 text-[11px] text-mute">Updated {updated}</p></div></header>
    <section className="py-12 sm:py-16"><p className="text-xs font-medium uppercase tracking-[0.18em] text-up">Robinhood Chain</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.055em] text-ivory sm:text-6xl">Trading activity,<br /><span className="font-serif font-normal text-up">made visible.</span></h1><p className="mt-5 max-w-xl text-sm leading-6 text-mute">A live view of confirmed Listed Exchange activity.</p></section>
    <section className="grid gap-3 sm:grid-cols-3" aria-label="All-time activity"><Metric label="Cumulative volume" value={usd(activity.volume, 2)} note="All confirmed activity" /><Metric label="Wallets traded" value={whole(data.traders.total)} note="Unique wallets" /><Metric label="Trades" value={whole(activity.swaps)} note="Confirmed swaps" /></section>
    <section className="mt-3 grid gap-3 lg:grid-cols-2"><ChartCard title="Daily volume" subtitle="Confirmed trading volume" rows={rows} dataKey="volume" color="#37e39a" /><ChartCard title="Cumulative volume" subtitle="All-time growth" rows={rows} dataKey="cumulative" color="#f5a524" /></section>
    <section className="mt-3 rounded-[22px] border border-line bg-surface p-5 sm:p-6"><div className="mb-4"><p className="text-xs font-medium uppercase tracking-[0.16em] text-mute">Daily activity</p><h2 className="mt-1 text-lg font-semibold tracking-tight text-ivory">Volume and participating wallets</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[440px] text-sm"><thead className="border-b border-line text-left text-xs uppercase tracking-[0.12em] text-mute"><tr><th className="pb-3 font-medium">Date</th><th className="pb-3 text-right font-medium">Volume</th><th className="pb-3 text-right font-medium">Wallets</th></tr></thead><tbody>{[...rows].reverse().map((row) => <tr key={row.date} className="border-b border-line/70 last:border-0"><td className="py-3 text-ivory">{row.date}</td><td className="py-3 text-right font-mono text-ivory">{usd(row.volume, 2)}</td><td className="py-3 text-right font-mono text-mute">{whole(row.wallets)}</td></tr>)}</tbody></table></div></section>
  </main>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="rounded-[22px] border border-line bg-surface p-5 sm:p-6"><p className="text-xs font-medium uppercase tracking-[0.14em] text-mute">{label}</p><p className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-ivory">{value}</p><p className="mt-2 text-xs text-mute">{note}</p></article>;
}
