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

New source route implemented in atlas-v3 branch codex/wallet-account-history-2026-11-10 at6e6b2a6; backend build, injected HTTP and PostgreSQL/WASM schema/query checks pass, with native pg-driver/concurrent server/deployment acceptance open. Wallet's account-history.js and WalletHistory.jsx now consume that proposed version1 response while retaining explicit recent-history fallback. This supersedes earlier source-absence statements only for the new branch; it does not establish availability of the deployed Atlas endpoint or canonical chain finality.

## Separate connector source review

Reviewed `synergy-network-hq/synergy-wallet-connector` main at `c9a594d945f0a93774354139331accaa1f3ef5c5` through authenticated GitHub on2026-11-11 UTC. Complete recursive tree reported not truncated. Inspected README.md, PROVENANCE.md, VALIDATION.md, src/types.ts and src/adapters/synergy.ts.

The mobile adapter requests read:identity, read:address and wallet:getCapabilities with synergy_getChainId. Its provider only exposes account/chain methods and rejects other requests; README directs signing users to a separately approved custom adapter. DELETE cleanup accepts a successful object response without a qualified acknowledgement schema. Neither source supplies canonical transaction preparation, APQE/session ownership proofs, approved-session revocation receipts or broadcast/finality reconciliation. Its own validation record uses controlled providers/relay responses and leaves real wallet/Tauri interoperability external. Do not treat those reported upstream tests as current Portal acceptance or replace Portal native custody with renderer fetches. No connector, credentials or transport was installed/executed during review.

This bounds the next integration decision: retain current read-only/native boundaries; obtain qualified owner contracts before enabling signing or retiring uncertain cleanup credentials. It is not proof those contracts are absent from every organization repository.

## Expanded transaction source findings — 2026-11-11

synergy-website-v3@a094b7a22816f10e4b20e2febcf207d05f344f0c src/features/wallet/mobileWalletLink.ts has signMessage/signTransaction/sendTransaction request transport through sessions/:id/requests and request polling, in addition to DELETE. This is newer transport source, not a canonical ETDAG envelope, approved phone/APQE proof or qualified DELETE acknowledgement. No scopes were broadened or requests sent.

testnet-v3@05610db7eb1eaa582caec0adf0c7967c820d5e34 runtime/src/transaction.rs and runtime/src/rpc/rpc_server.rs contain transaction serialization/signature/admission and methods including synergy_getEtdagAdmissionPackage, synergy_simulateTransaction, synergy_getTransactionStatus/Receipt, synergy_getFeeSchedule and synergy_submitEtdagTransaction. runtime/scripts/testnet/signed-transaction-runner.py uses already-signed transaction submission and a separate wallet-pqc-cli; it was inspected, never run. These sources narrow the integration backlog: canonical protocol code exists, but a qualified current deployment, exact phone codec/preparation binding, supported algorithm/provider and broadcast/finality ownership still need reconciliation. Do not construct envelopes by copying old load-test JSON or enable signing based on method names.

APQE@ad4112a6e7e607ece8418a387837ae835ef76925 main contains README/.gitignore only; README points to synergy-address-engine work in progress with production/approval profiles disabled. synergy-address-engine main6810c6fe50adbc8ea2c2372899e74e92487c8975 has typed identity/address and offline governance/object-signing documentation, not by itself a Wallet/mobile APQE session qualification. Existing Wallet P0 policy remains a separate denial boundary. No signer/key/provider was invoked.
