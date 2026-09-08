import { ADDRESSES, STABLES } from "./constants";

/**
 * Robinhood Chain has no CoinGecko coverage, so token USD prices come from DexScreener by contract
 * address (it indexes this chain as `robinhood`). Prices are *current* — DexScreener exposes no
 * historical series — so every inflow is marked at today's price, not the price when it landed.
 * Stablecoins fall back to $1; anything with no pool returns 0 and is surfaced as unpriced.
 */

type DsPair = {
  chainId?: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  baseToken?: { address?: string };
};

const TTL_MS = 60_000;
const cache = new Map<string, { price: number; expires: number }>();

async function dexscreener(address: string): Promise<number> {
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return hit.price;

  let price = 0;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const json = (await res.json()) as { pairs?: DsPair[] };
      const pairs = (json.pairs ?? []).filter(
        (p) => p.baseToken?.address?.toLowerCase() === key && Number(p.priceUsd) > 0,
      );
      if (pairs.length) {
        const best = pairs.reduce((a, b) =>
          (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a,
        );
        price = Number(best.priceUsd) || 0;
      }
    }
  } catch {
    price = 0;
  }
  cache.set(key, { price, expires: Date.now() + TTL_MS });
  return price;
}

/** USD price for one token address. 0 means "no market price found". */
export async function priceOf(address: string): Promise<number> {
  const key = address.toLowerCase();
  if (STABLES[key] != null) return STABLES[key];
  return dexscreener(address);
}

/** USD price for native ETH (via the WETH pool). */
export async function ethUsd(): Promise<number> {
  return dexscreener(ADDRESSES.weth);
}

/** Price a map of {address -> true} in parallel, de-duplicated. */
export async function priceMany(addresses: Iterable<string>): Promise<Map<string, number>> {
  const uniq = [...new Set([...addresses].map((a) => a.toLowerCase()))];
  const prices = await Promise.all(uniq.map((a) => priceOf(a)));
  return new Map(uniq.map((a, i) => [a, prices[i]]));
}
