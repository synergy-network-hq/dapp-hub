# Wallet upstream integration evidence

Reference checkout: sibling synergy-wallet, repository synergy-network-hq/synergy-wallet, commit e7af1fce62c396a95e989cec33edc333eb405a05. Reference only; implementation remains in dApp Hub.

The current web Vite alias maps @wallet-surface-app to apps/web/src/App.jsx. Dashboard uses PortfolioCardBackground, whose built-in design uses assets/brand/wallet/card-backgrounds/graphic1.png (reused here under wallet/assets/card-backgrounds). No key store, wallet creation wizard, private-key provider, signer, backup flow or release artifact was imported.

P0_CRYPTO_POLICY.md and apps/web/src/wallet-link/webHubCrypto.js explicitly deny Wallet Link crypto entrypoints with APQE_NATIVE_PROVIDER_UNAVAILABLE pending qualified APQE bindings. This contradicts older README claims of generally usable key generation/signing. Those README claims cannot qualify Portal pairing, message proofs or transaction signing. The read-only legacy Portal relay is a separate protocol and still lacks current native runtime acceptance; it must not be represented as the qualified WebHub v2 session service.

WalletBalances uses the existing Portal SDK read RPC and Atlas address data, binds reads to the current permitted account/endpoint, shows separate local receipt times, and compares exact integer nwei without spendability or finality claims. No zero is inferred from unsupported data. It reuses the upstream card artwork and existing Portal Cards/tabs. Connected-account runtime, chain-incarnation checks, qualified identity/session proofs, full admission/signing and finality acceptance remain open.

No upstream test totals qualify this integration. No new signing scopes are requested. Current downloadable release descriptor remains null.

## Legacy cleanup contract review — 2026-11-10 local time

Authenticated bounded source review (GitHub indexed search returned no matches; that is not organization-wide absence):

- `synergy-forge` main tree946d3ca43726c9029a0d75ba9cbe30cb191002d0, [relay source](https://github.com/synergy-network-hq/synergy-forge/blob/946d3ca43726c9029a0d75ba9cbe30cb191002d0/server/wallet-pairing-relay.mjs), blobed8c8bc7fe731d5b01d7a8f016560d5de36625ef. Inspected session handlers implement GET and POST approve/reject; pending rejection returns the public session with sessionId/status. No DELETE handler in this file.
- `synergy-relay` main tree53b7330d5fc8a9397e10209e3d3c19215b86dbfa, [relay source](https://github.com/synergy-network-hq/synergy-relay/blob/53b7330d5fc8a9397e10209e3d3c19215b86dbfa/server/wallet-pairing-relay.mjs), blob3fe8f44b4e77aa2349e40942bbb177796a10b990: inspected session GET/POST handlers, no DELETE handler.
- `atlas-v3` main tree23ca08f43109ccebefabe928975eb9cf54b07e1a, [backend index](https://github.com/synergy-network-hq/atlas-v3/blob/23ca08f43109ccebefabe928975eb9cf54b07e1a/backend/src/index.ts), blob0a3d6db660764331274b811e9027d194cc56e7ad. safeWalletPairingSession includes sessionId/status; pending reject returns that shape. No wallet-pairing DELETE handler identified in the inspected index.
- `forge-v3` main tree976df65850c8a5edce754e5dd1b19de0459cf888, [proxy route](https://github.com/synergy-network-hq/forge-v3/blob/976df65850c8a5edce754e5dd1b19de0459cf888/app/api/wallet-pairing/%5B...path%5D/route.ts), blob482c3868c2ed7d088b7afd5da186f0ad03c3f6a5, exports GET/POST and defaults upstream to the Atlas pairing API.
- `synergy-website-v3` tree2b937d0e76d100d08cac55bc91db2880bab36ff1 contains a deployment origin allowlist for the Forge relay shared with first-party website origins. Source config does not prove current deployed routing or behavior.

These source observations do not qualify the current deployed Portal relay, Wallet Link v2, crypto/session proof or revocation. No live session was created, queried or revoked. Do not switch endpoints or invent a DELETE acknowledgement from these related services.

Portal now retains credentials and local revocation after every unqualified DELETE success, including arbitrary JSON or unsupported revocation fields. A successful legacy pending rejection may retire only its matching sessionId with rejected status and no explicit error/failure, and only when no approved account was observed locally. Mismatched/unsupported responses remain pending. Recovery counts distinguish received cleanup responses needing acknowledgement review; HTTP success and zero pending still do not establish remote revocation. In-memory capacity/retry limits remain; closing Portal loses this recovery state, so review remote connections on the phone. The backend owner must provide a versioned authenticated revocation contract and deployment/runtime evidence before DELETE acknowledgement can retire custody.

## Account history API review

Inspected `synergy-network-hq/atlas-v3` at `23ca08f43109ccebefabe928975eb9cf54b07e1a`, `backend/src/index.ts`. The `/address/:address` query filters sender/receiver but hard-limits indexed transactions to100 and returns no account cursor. `/txs` supports page/limit over the whole network without an account filter. `/contracts/:address/activity` filters sender/receiver and pages results, but first requires an existing active contract. None establishes a general account-scoped stable-cursor history contract. Do not filter a page of network-wide transactions and call it account history, or substitute the contract-only route for Wallet accounts.

The same address route catches unavailable RPC-backed balance reads as zero and transfer-history failures as an empty list. Its returned amount/history shape alone cannot distinguish those fallbacks from observed zero/empty data. Wallet's separate direct RPC observation remains necessary; no spendability/finality or completeness follows from the indexed payload. Deployment identity was not verified by this source review.

W05 next requires an owner-reviewed account-history API with explicit availability/provenance, bounded stable pagination and source/snapshot semantics; then integrate cancellation, account/network scope and deduplication in the existing Activity design. No live account, relay, phone or host request was made by this review.
