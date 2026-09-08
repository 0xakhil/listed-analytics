# LISTED Analytics

Protocol dashboard for [listed.exchange](https://listed.exchange) — DEX aggregator + autonomous DCA on **Robinhood Chain (4663)**.

Standalone Next.js app. It does not fork the product; it reconstructs protocol activity from public chain data.

Repo: https://github.com/0xakhil/listed-analytics

## What it measures

Everything is derived from **ERC-20 `Transfer` events into the fee recipient** — the `PROTOCOL_FEE_BPS`
output skim (`30` bps, input-carve for xPath / Nordstern).

| Metric | How |
|---|---|
| Fees taken | USD value of each inbound transfer, priced via DexScreener (`robinhood` chain) |
| Implied volume | fees ÷ `PROTOCOL_FEE_BPS / 10_000` — *implied*, not router notional |
| Traders | distinct `tx.from` of the fee-paying transactions (not the router that forwarded the skim) |
| Fees by router | fee USD grouped by `tx.to` — SwapRouter02 / Universal Router / Rialto (resolved live from the registry) / other |
| Fees by token | fee USD grouped by the skimmed token |
| Fee wallet now | current ETH + ERC-20 balances of the fee recipient, marked to market |

Data source: the public JSON-RPC at `rpc.mainnet.chain.robinhood.com` (`eth_getLogs` + batched
`eth_getTransactionByHash` / `eth_getBlockByNumber` / `eth_call`). Blockscout is **not** used — it sits
behind a Cloudflare JS challenge that blocks serverless fetches.

Addresses mirror `listed.exchange/src/lib/contracts/addresses.ts`:

- Fee recipient `0x65DbA8896387EF19F1A9eCA399B856D2E3B35D1B`
- SwapRouter02 `0xCaf681a66D020601342297493863E78C959E5cb2`
- Universal Router `0x8876789976decbfcbbbe364623c63652db8c0904`
- Rialto registry `0x71a120CbBf3Ce7cD910a3c50fF77aFc62735687E`
- USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`

## Run

```bash
npm install
npm run dev
```

`GET /api/analytics` returns the full payload.

### Env (all optional)

| Var | Default | Use |
|---|---|---|
| `PROTOCOL_FEE_BPS` | `30` | override if the product changes the skim before this repo is synced |
| `ROBINHOOD_RPC_URL` | public RPC | point at a private / higher-limit RPC |
| `ANALYTICS_START_BLOCK` | `0` | skip pre-launch history to speed up the log scan |

## Limits

- **Prices are current, not historical.** DexScreener has no time series, so an inflow from last week
  is marked at today's price. Fine for a rough revenue read; not an accounting ledger.
- **Native-ETH fee legs are not counted** in fees / volume. When the output token is native ETH the
  skim is an internal transfer, invisible to `eth_getLogs`; it would need trace access. It *is*
  included in "Fee wallet now".
- Tokens with no DexScreener pool show in the inflow ledger but are excluded from fee / volume totals
  (surfaced in `unpricedTokens`).
- The public RPC rate-limits bursts. The route caches for 30s (`s-maxage`); under load a refresh can
  come back `degraded: true` with partial numbers.
- "Implied volume" assumes every trade paid the full skim. Promo / zero-fee routes would undercount.

## Next (product-side)

1. Log `/api/swap/build` + confirmed hash (pair, venue, amountOut, fee) for exact per-swap notional.
2. Emit a fee event on-chain so price-at-time and venue are unambiguous.
3. DCA fill table after `DcaManager` ships.
