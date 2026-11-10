# Saved-work migration checkpoint — 2026-11-10

This branch coordinates with sibling Portal's `codex/migrate-saved-portal-work-2026-11-10`. The complete host/interface validation and pending-port checklist is in Portal's `MIGRATION-STATUS.md` and `CONTINUE-CODEX.txt`.

Application source stays here. Portal owns shell/preferences, permission state, sandbox, APQE verification and the explicit host SDK. NodeNetwork owns its existing native crate. No release descriptor was populated; builds remain unsigned source artifacts.

Migrated from Portal backup commit `0cc2ccd6b973157ec02420520ef8128f1914fe25`:

- Wallet activity filters/source times, token search/details, receive QR, canonical checksummed local contacts with removal review. Original Cards/tabs/artwork reused; legacy Portal profile contacts preserved for review. RPC-confirmed chain 1266 and permission/account-bound reads. No guessed transaction preparation; manifest now requests readWallet only.
- NodeNetwork public validator monitor and local chain-1266 watchlist inside the existing panel. Source availability/identity ambiguity are explicit. RPC-confirmed chain identity required. Existing qualified native controller retained, host selection deferred, no host actions performed.
- Shared `@synergy-network/dapp-data-view` provides bounded rows, safe amount/text rendering and source-age display. Applications use only `@synergy-network/portal-native/dapp-sdk`; the compatible Portal change exports ModalDialog and fixes resource-key isolation.

Validation: all four `build:apps` entries passed; 17 inert manifests validate; catalog regenerated; diff whitespace checks pass. No test suites run. Wallet connected-account UI and Node native execution have not been manually smoke-tested in this migration. Native Portal compilation is blocked by absent qualified NodeNetwork engine bootstrap.py, not bypassed.

Still pending: native Wallet custody/revocation/proofs in the host; saved Node provisioning/job state reconciled with this repo's qualified controller contract; saved Vault/Spark/Horizon/Learn/Relay/Atlas/Keystone/Forge integration ports after priority apps. The entire historical implementation remains on the pushed Portal backup branch. Do not copy duplicate dApp packages into Portal, restore its generic legacy broker or confuse source previews with qualified releases.


Priority update — 2026-11-10
User prioritized Wallet and Node Control Panel completion. Other dApp feature ports are deferred. Wallet Activity now uses the shared Resource loading/error/read-only Retry presentation instead of conflating failure and loading. Wallet build passed; connected native acceptance remains pending. Next: native Wallet custody/revocation/proof contract and Node qualified provisioning/job recovery reconciliation; keep host selection deferred and transaction submission gated.


Wallet and Node priority follow-up — 2026-11-10
Wallet selected transaction/contact details now bind to account, endpoint identity/RPC and read permission readiness; prior-scope details disappear immediately, and history details hide during loading/failure. Node public Refresh now refreshes RPC observations and Atlas validator inventory together, disabling refresh while either loads. All four build:apps entries passed; diff whitespace check passed. No host selection, credentials, native mutation or transaction. Native Wallet custody/revocation/proof migration and qualified Node provisioning/job recovery remain incomplete. Existing pre-split developer ZIP is historical and does not represent the split repositories. Continue in sibling synergy-dapps; preserve ownership boundary and all existing work.


Completion audit — 2026-11-10
Wallet custody/revocation is INCOMPLETE: current main-only wallet_pairing_request still accepts browserSecret from the renderer; mobile.js disconnect uses fire-and-forget DELETE and suppresses failures. Saved native wallet_phone.rs (462 lines) exists on backup branch but depends on the old IntegrationState and must be adapted, not copied wholesale. Node provisioning is INCOMPLETE: cargo check --locked reproduced build.rs refusal because canonical bootstrap.py is absent. Log: /tmp/synergy-wallet-node-native-check.log. No fallback engine, host selection or provisioning execution used. Frontend source builds pass, but they do not establish native lifecycle acceptance. The pre-split ZIP remains historical for current split-repository work. No reliable revised completion percentage exists after migration; previous62/50/25 figures are historical screen coverage, not present production readiness.
Next: adapt main-owned opaque Wallet session handles/native secret custody and retryable revocation with fail-closed response validation; reconcile Node saved drafts/jobs with qualified controller operations when canonical engine is available. Preserve both repositories and APQE gates.
