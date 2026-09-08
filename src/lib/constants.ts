/**
 * Protocol fee, in basis points, skimmed from swap output and sent to the fee recipient.
 * Mirrors `PROTOCOL_FEE_BPS` in listed.exchange (`src/lib/contracts/addresses.ts`). There is no
 * on-chain source of truth for this — the product applies it in calldata — so it is kept in sync
 * here and can be overridden without a redeploy via the `PROTOCOL_FEE_BPS` env var.
 */
export const PROTOCOL_FEE_BPS = Number(process.env.PROTOCOL_FEE_BPS ?? 30);

export const CHAIN_ID = 4663;

/** Public JSON-RPC for Robinhood Chain. Not behind Cloudflare (unlike Blockscout). */
export const RPC_URL = process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const EXPLORER_API = "https://robinhoodchain.blockscout.com/api/v2";

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const ADDRESSES = {
  feeRecipient: "0x65DbA8896387EF19F1A9eCA399B856D2E3B35D1B",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  swapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
  universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
  v2Router: "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba",
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  quoterV2: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  v4Quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
  rialtoRegistry: "0x71a120CbBf3Ce7cD910a3c50fF77aFc62735687E",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

/** Tokens we treat as $1 when no market price is available. */
export const STABLES: Record<string, number> = {
  [ADDRESSES.usdg.toLowerCase()]: 1,
};

/** Router / relay addresses we can name on sight. Rialto's live router is resolved at runtime
 *  from the registry and merged in on top of this. Lowercased keys. */
export const ROUTER_LABELS: Record<string, string> = {
  [ADDRESSES.swapRouter02.toLowerCase()]: "Uniswap SwapRouter02",
  [ADDRESSES.universalRouter.toLowerCase()]: "Uniswap Universal Router",
};

/** How routing works on listed.exchange — static reference, not a measured fill split. */
export const VENUES = [
  { id: "v4", label: "Uniswap v4", role: "Quoted via v4 Quoter across live fee tiers" },
  { id: "v3", label: "Uniswap v3", role: "SwapRouter02 multicall + sweepTokenWithFee" },
  { id: "v2", label: "Uniswap v2", role: "getAmountsOut quote; ERC-20 allowance path" },
  { id: "rialto", label: "Rialto", role: "Best-execution + propAMM; router resolved from registry" },
  { id: "nordstern", label: "Nordstern", role: "External aggregator; fee carved from input" },
  { id: "xpath", label: "xPath", role: "Fee carved from input (cannot skim output)" },
] as const;
