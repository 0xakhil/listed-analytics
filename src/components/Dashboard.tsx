"use client";

import { ADDRESSES, EXPLORER, PROTOCOL_FEE_BPS, VENUES } from "@/lib/constants";
import { fmtNum, fmtUsd, pct, shortAddr } from "@/lib/format";
import type { AnalyticsPayload, RangeKey } from "@/lib/types";
import { useEffect, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const COLORS = ["#f5a524", "#37e39a", "#8b7bff", "#6ec8ff", "#ff5d5d"];
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "1h", label: "1H" },
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
  { key: "1m", label: "1M" },
  { key: "all", label: "All" },
];

export function Dashboard() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("1d");

  useEffect(() => {
    fetch("/api/analytics").then((r) => r.json()).then(setData).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <main className="p-8 text-[#ff5d5d]">{err}</main>;
  if (!data) return <main className="p-8 text-[#8d8a84]">Loading protocol stats…</main>;

  const w = data.windows[range] ?? data.windows["1d"];

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-amber-400">Robinhood Chain · 4663</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">LISTED analytics</h1>
          <p className="mt-2 max-w-xl text-sm text-[#8d8a84]">
            Volume from protocol fee inflows ({PROTOCOL_FEE_BPS} bps). Traders from unique router senders.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="inline-flex rounded-full border border-[#2a2a2e] bg-[#141416] p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  range === r.key ? "bg-amber-500 text-[#0c0c0d]" : "text-[#8d8a84] hover:text-ivory"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="text-xs text-[#8d8a84]">{new Date(data.generatedAt).toLocaleString()}</div>
        </div>
      </header>

      {data.notes.length > 0 && (
        <div className="mb-6 space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">
          {data.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={`Volume · ${range.toUpperCase()}`} value={fmtUsd(w.volume)} hint={w.sampleComplete ? "fees ÷ 15 bps" : "sampled explorer pages"} />
        <Kpi label={`Fees · ${range.toUpperCase()}`} value={fmtUsd(w.fees, 2)} hint={`${w.swaps} router txs in window`} />
        <Kpi label="Total traders" value={fmtNum(data.traders.total)} hint="Unique from-addresses on routers" />
        <Kpi label="Daily traders" value={fmtNum(data.traders.daily)} hint="Unique senders last 24h" />
      </section>
      <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Wallets connected" value={fmtNum(data.traders.walletsConnected)} hint="On-chain proxy: unique swap senders" />
        <Kpi label={`Traders · ${range.toUpperCase()}`} value={fmtNum(w.traders)} hint="Unique senders in selected window" />
        <Kpi label="Fee recipient 24h" value={fmtNum(data.feeRecipientTx24h)} hint="Token + native inflows" />
        <Kpi label="Perps 24h volume" value={fmtUsd(data.perps.volume24h)} hint={`${data.perps.markets} Lighter markets`} />
      </section>

      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Daily volume & fees (from fee recipient)">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.volumeSeries}>
                <defs>
                  <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f5a524" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#f5a524" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#2a2a2e" vertical={false} />
                <XAxis dataKey="t" stroke="#8d8a84" fontSize={11} />
                <YAxis stroke="#8d8a84" fontSize={11} />
                <Tooltip contentStyle={{ background: "#141416", border: "1px solid #2a2a2e" }} />
                <Area type="monotone" dataKey="volume" stroke="#f5a524" fill="url(#v)" />
                <Area type="monotone" dataKey="fees" stroke="#37e39a" fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Quote venue mix">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.venueMix} layout="vertical">
                <CartesianGrid stroke="#2a2a2e" horizontal={false} />
                <XAxis type="number" stroke="#8d8a84" fontSize={11} />
                <YAxis type="category" dataKey="name" stroke="#8d8a84" fontSize={11} width={90} />
                <Tooltip contentStyle={{ background: "#141416", border: "1px solid #2a2a2e" }} />
                <Bar dataKey="share" radius={4}>
                  {data.venueMix.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="mb-8 grid gap-4 md:grid-cols-2">
        <Card title="Settlement routers">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[#8d8a84]">
              <tr>
                <th className="pb-2">Router</th>
                <th className="pb-2">24h txs</th>
                <th className="pb-2">Senders</th>
              </tr>
            </thead>
            <tbody>
              {data.routers.map((r) => (
                <tr key={r.address} className="border-t border-[#2a2a2e]">
                  <td className="py-2">
                    <div>{r.label}</div>
                    <a className="text-xs text-[#8d8a84] hover:text-ivory" href={`${EXPLORER}/address/${r.address}`}>
                      {shortAddr(r.address)}
                    </a>
                  </td>
                  <td>{r.tx24h}</td>
                  <td>{r.uniqueSenders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="How LISTED prices a swap">
          <ul className="space-y-2 text-sm text-[#cfcbc2]">
            {VENUES.map((v) => (
              <li key={v.id} className="flex gap-3">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <span>
                  <strong className="text-ivory">{v.label}.</strong> {v.role}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-[#8d8a84]">
            Fee recipient {shortAddr(ADDRESSES.feeRecipient)} · USDG {shortAddr(ADDRESSES.usdg)}
          </p>
        </Card>
      </section>

      <section>
        <Card title="Lighter perps (USDG-margined)">
          <div className="mb-3 flex gap-6 text-sm text-[#8d8a84]">
            <span>OI {fmtUsd(data.perps.openInterest)}</span>
            <span>24h vol {fmtUsd(data.perps.volume24h)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[#8d8a84]">
                <tr>
                  <th className="pb-2">Market</th>
                  <th className="pb-2">Mark</th>
                  <th className="pb-2">24h</th>
                  <th className="pb-2">Volume</th>
                  <th className="pb-2">OI</th>
                </tr>
              </thead>
              <tbody>
                {data.perps.top.map((m) => (
                  <tr key={m.symbol} className="border-t border-[#2a2a2e]">
                    <td className="py-2 font-medium">{m.symbol}</td>
                    <td>{fmtNum(m.mark, 2)}</td>
                    <td className={m.change24h >= 0 ? "text-[#37e39a]" : "text-[#ff5d5d]"}>{pct(m.change24h)}</td>
                    <td>{fmtUsd(m.volume24h)}</td>
                    <td>{fmtUsd(m.openInterest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </main>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-[#2a2a2e] bg-[#141416] p-4">
      <div className="text-xs uppercase tracking-wide text-[#8d8a84]">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-[11px] text-[#6f6c66]">{hint}</div>
    </div>
  );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-[#2a2a2e] bg-[#141416] p-5 ${className}`}>
      <h2 className="mb-3 text-sm font-medium tracking-wide">{title}</h2>
      {children}
    </section>
  );
}
