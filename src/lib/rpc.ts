import { RPC_URL } from "./constants";

/** A dependency-free JSON-RPC client. The public Robinhood Chain RPC rate-limits bursts with 403s,
 *  so callers should batch aggressively and keep concurrency low. */

type RpcError = { code: number; message: string };
type RpcResponse<T> = { id: number; result?: T; error?: RpcError };

export class RpcFailure extends Error {}

async function post(body: unknown, timeoutMs: number): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt * attempt));
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status === 403) {
        lastErr = new RpcFailure(`rate limited (${res.status})`);
        continue;
      }
      if (!res.ok) throw new RpcFailure(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new RpcFailure(String(lastErr));
}

export async function rpc<T>(method: string, params: unknown[], timeoutMs = 10_000): Promise<T> {
  const json = (await post({ jsonrpc: "2.0", id: 1, method, params }, timeoutMs)) as RpcResponse<T>;
  if (json.error) throw new RpcFailure(`${method}: ${json.error.message}`);
  if (json.result === undefined) throw new RpcFailure(`${method}: empty result`);
  return json.result;
}

/** One HTTP round-trip for many calls. Returns results in the same order as `calls`; an individual
 *  call that errored comes back as `null` rather than failing the whole batch. */
export async function rpcBatch<T>(
  calls: { method: string; params: unknown[] }[],
  timeoutMs = 15_000,
): Promise<(T | null)[]> {
  if (calls.length === 0) return [];
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params }));
  const json = (await post(body, timeoutMs)) as RpcResponse<T>[];
  if (!Array.isArray(json)) throw new RpcFailure("batch: non-array response");
  const out: (T | null)[] = new Array(calls.length).fill(null);
  for (const entry of json) {
    if (typeof entry.id === "number" && entry.result !== undefined) out[entry.id] = entry.result;
  }
  return out;
}

/** Chunk [from, to] into `eth_getLogs` windows, stopping when the time budget runs out. */
export async function getLogsRange(
  filter: { address?: string | string[]; topics: (string | string[] | null)[] },
  fromBlock: number,
  toBlock: number,
  opts: { chunk?: number; budgetMs?: number } = {},
): Promise<{ logs: RpcLog[]; scannedFrom: number; complete: boolean }> {
  const chunk = opts.chunk ?? 100_000;
  const deadline = Date.now() + (opts.budgetMs ?? 9_000);

  // Fast path: one call for the whole range. The chain is young and fee-recipient logs are sparse.
  try {
    const logs = await rpc<RpcLog[]>("eth_getLogs", [
      { ...filter, fromBlock: hex(fromBlock), toBlock: hex(toBlock) },
    ]);
    return { logs, scannedFrom: fromBlock, complete: true };
  } catch {
    // Fall through to walking the range backwards in chunks.
  }

  const logs: RpcLog[] = [];
  let hi = toBlock;
  while (hi >= fromBlock) {
    const lo = Math.max(fromBlock, hi - chunk + 1);
    try {
      const part = await rpc<RpcLog[]>("eth_getLogs", [
        { ...filter, fromBlock: hex(lo), toBlock: hex(hi) },
      ]);
      logs.push(...part);
    } catch {
      return { logs, scannedFrom: hi + 1, complete: false };
    }
    if (lo === fromBlock) return { logs, scannedFrom: fromBlock, complete: true };
    if (Date.now() > deadline) return { logs, scannedFrom: lo, complete: false };
    hi = lo - 1;
  }
  return { logs, scannedFrom: fromBlock, complete: true };
}

export type RpcLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
};

export type RpcTx = { from?: string; to?: string | null; hash?: string };
export type RpcBlock = { number?: string; timestamp?: string };

export const hex = (n: number) => "0x" + Math.max(0, Math.floor(n)).toString(16);
export const toNum = (h?: string | null) => (h ? parseInt(h, 16) : 0);
export const topicAddr = (t?: string) => (t ? "0x" + t.slice(-40).toLowerCase() : "");
