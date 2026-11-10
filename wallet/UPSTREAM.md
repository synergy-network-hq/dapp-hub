# Wallet upstream integration evidence

Reference checkout: sibling synergy-wallet, repository synergy-network-hq/synergy-wallet, commit e7af1fce62c396a95e989cec33edc333eb405a05. Reference only; implementation remains in dApp Hub.

The current web Vite alias maps @wallet-surface-app to apps/web/src/App.jsx. Dashboard uses PortfolioCardBackground, whose built-in design uses assets/brand/wallet/card-backgrounds/graphic1.png (reused here under wallet/assets/card-backgrounds). No key store, wallet creation wizard, private-key provider, signer, backup flow or release artifact was imported.

P0_CRYPTO_POLICY.md and apps/web/src/wallet-link/webHubCrypto.js explicitly deny Wallet Link crypto entrypoints with APQE_NATIVE_PROVIDER_UNAVAILABLE pending qualified APQE bindings. This contradicts older README claims of generally usable key generation/signing. Those README claims cannot qualify Portal pairing, message proofs or transaction signing. The read-only legacy Portal relay is a separate protocol and still lacks current native runtime acceptance; it must not be represented as the qualified WebHub v2 session service.

WalletBalances uses the existing Portal SDK read RPC and Atlas address data, binds reads to the current permitted account/endpoint, shows separate local receipt times, and compares exact integer nwei without spendability or finality claims. No zero is inferred from unsupported data. It reuses the upstream card artwork and existing Portal Cards/tabs. Connected-account runtime, chain-incarnation checks, qualified identity/session proofs, full admission/signing and finality acceptance remain open.

No upstream test totals qualify this integration. No new signing scopes are requested. Current downloadable release descriptor remains null.
