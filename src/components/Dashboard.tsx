"use client";

import { ADDRESSES, EXPLORER, VENUES } from "@/lib/constants";
import { fmtNum, fmtUsd, shortAddr } from "@/lib/format";
import type { AnalyticsPayload, RangeKey } from "@/lib/types";
import { useEffect, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const COLORS = ["#f5a524", "#37e39a", "#8b7bff", "#6ec8ff", "#ff5d5d", "#d0d0d0"];
const STRIP: { key: RangeKey; label: string }[] = [
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
  { key: "1m", label: "1M" },
  { key: "all", label: "Cumulative" },
];
const FEE_SCENARIOS = [1, 5, 10] as const;

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
  const bps = data.protocolFeeBps;
  const rateLabel = `${bps} bps`;
  const feeScenarios = FEE_SCENARIOS.map((scenarioBps) => ({
    bps: scenarioBps,
    feeUsd: w.volume * scenarioBps / 10_000,
  }));

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-amber-400">Robinhood Chain · 4663</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">LISTED analytics</h1>
          <p className="mt-2 max-w-xl text-sm text-[#8d8a84]">
            Fees = tokens actually sent to {shortAddr(ADDRESSES.feeRecipient)}. Volume = fees ÷ {rateLabel}.
            Read straight from the chain RPC.
          </p>
        </div>
        <div className="text-right text-xs text-[#8d8a84]">
          <div>{new Date(data.generatedAt).toLocaleString()}</div>
          {data.blockScanned > 0 && <div>from block {data.blockScanned.toLocaleString()}</div>}
        </div>
      </header>

      {data.degraded && (
        <div className="mb-4 rounded-xl border border-[#ff5d5d]/30 bg-[#ff5d5d]/5 px-4 py-3 text-xs text-[#ffb4b4]">
          A data source failed on this refresh — some numbers below are partial. Reload in a moment.
        </div>
      )}
      {!data.live && !data.degraded && (
        <div className="mb-4 rounded-xl border border-[#2a2a2e] bg-[#141416] px-4 py-3 text-xs text-[#8d8a84]">
          No priced fee inflows on record yet. The wiring is live; the numbers fill in once swaps pay a fee.
        </div>
      )}

      {data.notes.length > 0 && (
        <div className="mb-6 space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">
          {data.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <p className="mb-2 text-xs uppercase tracking-wide text-[#8d8a84]">Implied volume</p>
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {STRIP.map((r) => (
          <button key={r.key} onClick={() => setRange(r.key)} className="text-left">
            <Kpi
              label={r.label}
              value={fmtUsd(data.windows[r.key].volume, 2)}
              hint={`fees ${fmtUsd(data.windows[r.key].fees, 2)} ÷ ${rateLabel}`}
              active={range === r.key}
              partial={!data.windows[r.key].sampleComplete}
            />
          </button>
        ))}
      </section>

      <section className="mb-8 rounded-2xl border border-[#2a2a2e] bg-[#141416] p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#8d8a84]">Fee simulator · selected period</p>
            <h2 className="mt-1 text-lg font-medium">What {fmtUsd(w.volume, 2)} of volume earns</h2>
          </div>
          <p className="text-xs text-[#8d8a84]">Gross protocol fees before rebates or revenue share</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {feeScenarios.map((scenario) => (
            <div key={scenario.bps} className="rounded-xl border border-[#2a2a2e] bg-[#101012] p-4">
              <p className="text-xs uppercase tracking-wide text-[#8d8a84]">{scenario.bps} bps · {(scenario.bps / 100).toFixed(2)}%</p>
              <p className="mt-2 text-2xl font-semibold">{fmtUsd(scenario.feeUsd, 2)}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="mb-2 text-xs uppercase tracking-wide text-[#8d8a84]">Fees taken</p>
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {STRIP.map((r) => (
          <Kpi
            key={r.key}
            label={r.label}
            value={fmtUsd(data.windows[r.key].fees, 2)}
            hint={`${plural(data.windows[r.key].swaps, "inflow")} · ${plural(data.windows[r.key].traders, "trader")}`}
            active={range === r.key}
            partial={!data.windows[r.key].sampleComplete}
          />
        ))}
      </section>

      <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Fee wallet now" value={fmtUsd(data.treasuryUsd, 2)} hint="Live balances, marked to market" />
        <Kpi label="Traders · selected" value={fmtNum(w.traders)} hint="Unique tx senders in highlighted window" />
        <Kpi label="Total traders" value={fmtNum(data.traders.total)} hint="All-time unique fee-paying senders" />
        <Kpi label="Daily traders" value={fmtNum(data.traders.daily)} hint="Last 24h" />
      </section>

      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Daily implied volume · 14d">
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
        <Card title="Fee wallet holdings">
          {data.holdings.length === 0 ? (
            <p className="text-sm text-[#8d8a84]">Nothing priced in the wallet right now.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[#8d8a84]">
                <tr>
                  <th className="pb-2">Token</th>
                  <th className="pb-2">Amount</th>
                  <th className="pb-2">USD</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings.slice(0, 8).map((h) => (
                  <tr key={h.address} className="border-t border-[#2a2a2e]">
                    <td className="py-2">{h.symbol}</td>
                    <td>{fmtNum(h.amount, 6)}</td>
                    <td>{h.priced ? fmtUsd(h.usd, 2) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      <section className="mb-8 grid gap-4 md:grid-cols-2">
        <Card title="Fees by router / entrypoint">
          {data.routers.length === 0 ? (
            <p className="text-sm text-[#8d8a84]">No router activity on record yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[#8d8a84]">
                <tr>
                  <th className="pb-2">Router</th>
                  <th className="pb-2">Swaps</th>
                  <th className="pb-2">Traders</th>
                  <th className="pb-2">Fees</th>
                </tr>
              </thead>
              <tbody>
                {data.routers.map((r) => (
                  <tr key={r.address} className="border-t border-[#2a2a2e]">
                    <td className="py-2">
                      <a className="underline decoration-amber-500/40" href={`${EXPLORER}/address/${r.address}`}>
                        {r.label}
                      </a>
                    </td>
                    <td>{fmtNum(r.swaps)}</td>
                    <td>{fmtNum(r.uniqueTraders)}</td>
                    <td>{fmtUsd(r.feesUsd, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Fees by token">
          {data.feeByToken.length === 0 ? (
            <p className="text-sm text-[#8d8a84]">No priced inflows yet.</p>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.feeByToken} layout="vertical">
                  <CartesianGrid stroke="#2a2a2e" horizontal={false} />
                  <XAxis type="number" stroke="#8d8a84" fontSize={11} />
                  <YAxis type="category" dataKey="name" stroke="#8d8a84" fontSize={11} width={70} />
                  <Tooltip
                    contentStyle={{ background: "#141416", border: "1px solid #2a2a2e" }}
                    formatter={(value) => [fmtUsd(Number(value ?? 0), 2), "fees"]}
                  />
                  <Bar dataKey="usd" radius={4}>
                    {data.feeByToken.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </section>

      <section className="mb-8 grid gap-4 md:grid-cols-2">
        <Card title="Every inflow that built the volume number">
          {data.inflows.length === 0 ? (
            <p className="text-sm text-[#8d8a84]">No inflows recorded.</p>
          ) : (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-[#8d8a84]">
                  <tr>
                    <th className="pb-2">When</th>
                    <th className="pb-2">Amount</th>
                    <th className="pb-2">Via</th>
                    <th className="pb-2">USD</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inflows.map((f, i) => (
                    <tr key={`${f.tx}-${i}`} className="border-t border-[#2a2a2e]">
                      <td className="py-2 text-xs text-[#8d8a84]">
                        <a className="underline decoration-amber-500/40" href={`${EXPLORER}/tx/${f.tx}`}>
                          {new Date(f.ts).toLocaleString()}
                        </a>
                      </td>
                      <td>
                        {fmtNum(f.amount, 6)} {f.symbol}
                      </td>
                      <td className="text-xs text-[#8d8a84]">{f.routerLabel}</td>
                      <td>{f.priced ? fmtUsd(f.usd, 4) : "unpriced"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="How routing works">
          <ul className="space-y-2 text-sm text-[#cfcbc2]">
            {VENUES.map((v) => (
              <li key={v.id}>
                <strong className="text-ivory">{v.label}.</strong> {v.role}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-[#8d8a84]">
            Static reference — the measured split is in “Fees by router” above.
          </p>
          <p className="mt-2 text-xs text-[#8d8a84]">
            <a className="underline decoration-amber-500/40" href={`${EXPLORER}/address/${ADDRESSES.feeRecipient}`}>
              {ADDRESSES.feeRecipient}
            </a>
          </p>
        </Card>
      </section>
    </main>
  );
}

function Kpi({
  label,
  value,
  hint,
  active = false,
  partial = false,
}: {
  label: string;
  value: string;
  hint: string;
  active?: boolean;
  partial?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${active ? "border-amber-500/50 bg-[#1a1610]" : "border-[#2a2a2e] bg-[#141416]"}`}>
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-[#8d8a84]">
        {label}
        {partial && <span title="Partial sample — lookback capped">·&nbsp;partial</span>}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-[11px] text-[#6f6c66]">{hint}</div>
    </div>
  );
}

function plural(n: number, word: string) {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-[#2a2a2e] bg-[#141416] p-5 ${className}`}>
      <h2 className="mb-3 text-sm font-medium tracking-wide">{title}</h2>
      {children}
    </section>
  );
}
