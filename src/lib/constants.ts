export const PROTOCOL_FEE_BPS = 15;
export const CHAIN_ID = 4663;
export const EXPLORER_API = "https://robinhoodchain.blockscout.com/api/v2";
export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const LIGHTER_API = "https://api.rh.lighter.xyz/api/v1";

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

export const EXPLORER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  accept: "application/json",
};

export const VENUES = [
  { id: "v4", label: "Uniswap v4", role: "Quoted via v4 Quoter across live fee tiers" },
  { id: "v3", label: "Uniswap v3", role: "SwapRouter02 multicall + sweepTokenWithFee" },
  { id: "v2", label: "Uniswap v2", role: "getAmountsOut quote; ERC-20 allowance path" },
  { id: "rialto", label: "Rialto", role: "Best-execution + propAMM; router from registry" },
  { id: "xpath", label: "xPath / Nordstern", role: "Fee carved from input (cannot skim output)" },
] as const;
