"use client";

import { ADDRESSES, EXPLORER, PROTOCOL_FEE_BPS, VENUES } from "@/lib/constants";
import { fmtNum, fmtUsd, pct, shortAddr } from "@/lib/format";
import type { AnalyticsPayload } from "@/lib/types";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = ["#f5a524", "#37e39a", "#8b7bff", "#6ec8ff", "#ff5d5d"];

export function Dashboard() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <main className="p-8 text-[#ff5d5d]">{err}</main>;
  if (!data) return <main className="p-8 text-[#8d8a84]">Loading protocol stats…</main>;

  const routerTx = data.routers.reduce((s, r) => s + r.tx24h, 0);
  const traders = data.routers.reduce((s, r) => s + r.uniqueSenders, 0);

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-amber-400">Robinhood Chain · 4663</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">LISTED analytics</h1>
          <p className="mt-2 max-w-xl text-sm text-[#8d8a84]">
            Read-only dashboard over the aggregator routers, 15 bps fee recipient, and Lighter perps that power{" "}
            <a className="text-ivory underline decoration-amber-500/50" href="https://listed.exchange">listed.exchange</a>.
          </p>
        </div>
        <div className="text-right text-xs text-[#8d8a84]">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#2a2a2e] px-3 py-1">
            <span className={`h-1.5 w-1.5 rounded-full ${data.live ? "bg-[#37e39a]" : "bg-[#f5a524]"}`} />
            {data.live ? "live sources" : "partial"}
          </div>
          <div className="mt-2">{new Date(data.generatedAt).toLocaleString()}</div>
        </div>
      </header>

      {data.notes.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          {data.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Router txs (sample)" value={fmtNum(routerTx)} hint="SwapRouter02 + Universal Router pages" />
        <Kpi label="Unique senders" value={fmtNum(traders)} hint="From latest explorer pages" />
        <Kpi label="Protocol fee" value={`${PROTOCOL_FEE_BPS} bps`} hint={`${data.feeRecipientTx24h} fee-recipient txs / 24h page`} />
        <Kpi label="Perps 24h volume" value={fmtUsd(data.perps.volume24h)} hint={`${data.perps.markets} Lighter markets`} />
      </section>

      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Implied volume & fee capture">
          <p className="mb-3 text-xs text-[#8d8a84]">
            Placeholder series until swap logs are indexed. Fee assumes {PROTOCOL_FEE_BPS} bps of output.
          </p>
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
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Quote venue mix">
          <p className="mb-3 text-xs text-[#8d8a84]">Design prior from aggregator paths (v2/v3/v4 + Rialto).</p>
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
                <th className="pb-2">Txs</th>
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
            Fee recipient {shortAddr(ADDRESSES.feeRecipient)} · WETH {shortAddr(ADDRESSES.weth)} · USDG {shortAddr(ADDRESSES.usdg)}
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
                {data.perps.top.length === 0 && (
                  <tr>
                    <td className="py-6 text-[#8d8a84]" colSpan={5}>
                      No Lighter books returned.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <footer className="mt-12 text-center text-xs text-[#8d8a84]">
        Sourced from listed.exchange contracts + Blockscout + Lighter public API.
      </footer>
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
