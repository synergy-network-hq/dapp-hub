# Saved-work migration checkpoint — 2026-11-10

This branch coordinates with sibling Portal's `codex/migrate-saved-portal-work-2026-11-10`. The complete host/interface validation and pending-port checklist is in Portal's `MIGRATION-STATUS.md` and `CONTINUE-CODEX.txt`.

Application source stays here. Portal owns shell/preferences, permission state, sandbox, APQE verification and the explicit host SDK. NodeNetwork owns its existing native crate. No release descriptor was populated; builds remain unsigned source artifacts.

Migrated from Portal backup commit `0cc2ccd6b973157ec02420520ef8128f1914fe25`:

- Wallet activity filters/source times, token search/details, receive QR, canonical checksummed local contacts with removal review. Original Cards/tabs/artwork reused; legacy Portal profile contacts preserved for review. RPC-confirmed chain 1266 and permission/account-bound reads. No guessed transaction preparation; manifest now requests readWallet only.
- NodeNetwork public validator monitor and local chain-1266 watchlist inside the existing panel. Source availability/identity ambiguity are explicit. RPC-confirmed chain identity required. Existing qualified native controller retained, host selection deferred, no host actions performed.
- Shared `@synergy-network/dapp-data-view` provides bounded rows, safe amount/text rendering and source-age display. Applications use only `@synergy-network/portal-native/dapp-sdk`; the compatible Portal change exports ModalDialog and fixes resource-key isolation.

Validation: all four `build:apps` entries passed; 17 inert manifests validate; catalog regenerated; diff whitespace checks pass. No test suites run. Wallet connected-account UI and Node native execution have not been manually smoke-tested in this migration. Native Portal compilation is blocked by absent qualified NodeNetwork engine bootstrap.py, not bypassed.

Still pending: native Wallet custody/revocation/proofs in the host; saved Node provisioning/job state reconciled with this repo's qualified controller contract; saved Vault/Spark/Horizon/Learn/Relay/Atlas/Keystone/Forge integration ports after priority apps. The entire historical implementation remains on the pushed Portal backup branch. Do not copy duplicate dApp packages into Portal, restore its generic legacy broker or confuse source previews with qualified releases.
