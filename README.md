# LISTED Analytics

Protocol dashboard for [listed.exchange](https://listed.exchange) — DEX aggregator + autonomous DCA + Lighter perps on **Robinhood Chain (4663)**.

Standalone Next.js app. It does not fork the product; it reads the same public surfaces.

Repo: https://github.com/0xakhil/listed-analytics

## Mapped from listed.exchange

| Surface | Product behavior | Dashboard |
|---|---|---|
| Uniswap v2 / v3 / v4 | Quotes raced; best after 15 bps + slippage | Venue model + router activity |
| `PROTOCOL_FEE_BPS = 15` | Skim output (input-carve for xPath / Nordstern) | Fee recipient + inbound sample |
| Rialto | Best-execution / propAMM; registry routers | Documented in venue mix |
| Lighter `api.rh.lighter.xyz` | Perps read-and-route; USDG margin | Live markets, 24h vol, OI |
| Blockscout | Activity + portfolio reconstruction | Router counterparties |

Addresses from `src/lib/contracts/addresses.ts`:

- Fee recipient `0x65DbA8896387EF19F1A9eCA399B856D2E3B35D1B`
- SwapRouter02 `0xCaf681a66D020601342297493863E78C959E5cb2`
- Universal Router `0x8876789976decbfcbbbe364623c63652db8c0904`
- USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`

## Run

```bash
npm install
npm run dev
```

`GET /api/analytics` hits Blockscout + Lighter. Blockscout is behind Cloudflare; the same browser User-Agent LISTED uses is required.

## Limits

- No swap event indexer in the product yet. Router counts are the latest explorer page, not full 24h volume.
- Volume chart is a placeholder (`volume × 15 bps`) until fills are logged.
- Venue mix is a design prior, not measured fill share.
- Perps numbers are live from Lighter `orderBookDetails`.

## Next (product-side)

1. Log `/api/swap/build` + confirmed hash (pair, venue, amountOut, fee).
2. Index transfers to the fee recipient as protocol revenue.
3. DCA fill table after `DcaManager` ships (Phase 1 contracts tested, not deployed).
