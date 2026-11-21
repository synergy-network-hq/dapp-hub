# Relay integration checkpoint

Relay preserves the owner’s Panel/Button design and pair direction control. The quote form uses the existing public health, token registry and same-chain indicative SDK calls. Registry requests run when Relay reports an online aggregator, enables same-chain reads, and advertises the selected chain. Tokens marked swap-disabled are excluded. Pair and amount changes and service reloads invalidate pending and displayed quotes.

The quote must match the requested chain, pair and amount and have a future expiry. Output and reported minimum use the selected token’s exact base-unit conversion. Route sources, route shares and the reported treasury fee rate use bounded public fields from the owner’s 0x and Uniswap contracts. The shared network-fee field has different units by provider and is omitted. Transaction payloads, spender and recipient fields are excluded. Portal supports indicative reads only.

Owner API reviewed at [synergy-relay 53b7330](https://github.com/synergy-network-hq/synergy-relay/tree/53b7330d5fc8a9397e10209e3d3c19215b86dbfa). On 2026-11-15 both published health and Ethereum token endpoints returned HTTP 200 with the coming-soon website as HTML. Production JSON routing and live quote acceptance remain open.

The Relay source build and six component/model cases cover healthy and disabled service, retry after non-JSON failure, exact optional fields, pair reversal, late response after refresh, expiry, and malformed/mismatched responses. Tests use fixtures. Native transport, live quotes and swaps remain unverified. Host selection stays deferred.
