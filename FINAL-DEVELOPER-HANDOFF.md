# Final developer handoff — Synergy Portal and dApp Hub

Prepared November 17, 2026 (America/New_York). This is a source handoff, not a production release. The project goal was ended at the user's request; the hourly Git automation was removed. No host was selected or provisioned.

## Saved repositories

Both repositories use `codex/migrate-saved-portal-work-2026-11-10`.

| Repository | Saved checkpoint before this documentation-only handoff commit |
|---|---|
| https://github.com/synergy-network-hq/portal-app | `257650587b556cf2ed8f788d8f070ffcf90d5c05` |
| https://github.com/synergy-network-hq/dapp-hub | `1bc6b38a6591ef48dfedd49d8d584548bf628fe1` |

The GitHub branch HEAD contains this handoff. The accompanying ZIP's MANIFEST.json records the exact post-handoff commits exported from each repository; the checkpoint hashes above intentionally identify the sources before this file was added.

Local checkouts:

- `/Users/robmarek/Downloads/Synergy Portal App/portal-app`
- `/Users/robmarek/Downloads/Synergy Portal App/synergy-dapps`

## Completed implementation work

### Core Portal

- Standalone React/Tauri shell, recoverable startup and resumable optional-pairing/offline onboarding.
- Dashboard/settings/profile/activity/notifications, scoped permissions, diagnostics and recovery containment source integrations; detailed per-requirement evidence is in COMPLETION-AUDIT.md.
- Retained native preference-backup listing and exact-digest review. Startup Recovery and Advanced Settings share allowlisted restoration, current-state/migration-journal drift checks, native writable-main-window guards and original-byte preservation.
- Restored privacy opt-ins start off. Settings adopts the restored baseline so later edits persist correctly. Explicit Retry completes startup after standalone restore.
- Isolated native QA 0e2ec45 restored preferences, retained a recovery copy and preserved theme/privacy opt-outs across process restart. A later restore-success keyboard-focus fix passed component tests; its final native observation remains pending.
- Existing native trust, publisher, sandbox, permission and release gates were preserved. No production distribution qualification is claimed.

### Wallet

- Paired public account reads; separate balance/stake/token/collectible observations with explicit source and availability states.
- Stable-cursor account history, exact numeric quantities, transaction details, Receive, contact management, connection management and signing preparation.
- Offline Spark Mint/List/Cancel/Buy draft review and draft-bound reported receipt comparisons. Existing owner designs/assets were reused.
- Account/network/consent drift handling and bounded read/receipt checks. The recent owner cursor change is already subsumed by the saved reader's stricter ordering checks.
- Qualified physical-phone transaction signing, attributable broadcast, settlement and independent finality are NOT complete. The newer owner PoSy processing profile is a different protocol/network contract; it must not silently replace saved chain-1266 context or qualify legacy pairing as Wallet Link v2.

### NodeNetwork

- Provisioning preparation, typed native controller integration, identity/formation/Genesis checks, VPN/lifecycle controls and local request-journal fencing.
- Optional exact identity-request provenance support, distinguishing durable request attribution from Genesis-input-only custody evidence.
- Reused owner bootstrap transport fix bbd0472: authenticated refusal survives concurrent BrokenPipe upload failure; success still requires full upload integrity and successful transport exit.
- Duplicate-rejecting exact bootstrap envelopes; malformed/contradictory replies stay uncertain and prevent repeat mutations.
- Positive bootstrap acknowledgement binds reviewed release/manifest, fixed root, exact host records and staging-only enrollment flags before journal settlement.
- Existing Validator setup design now has a scoped Target enrollment reported panel. It withholds raw host-registration paths, retires changed draft/context results and refuses stale dispatch scope.
- No selected-host custody, VPN, installation, validator startup or lifecycle qualification was performed in this checkout.

### Other ecosystem work

Atlas, Learn, Relay, Forge, Spark, Horizon, Keystone and Vault source/build work is retained in the dApp Hub. These applications are not all complete or release-qualified. Read their application ACCEPTANCE.md and UPSTREAM.md files before continuing. Core Portal, Wallet and NodeNetwork remain the priority.

## Verification and its exact scope

- Last complete paired matrix: all 250 checks passed, including 2,008 desktop component cases, at Portal `4ad88581150ebfed97f0bbed624a7886b6f935c1` / Hub `e6bea340028edc6dafa5d75add030aa6756e7aa9`.
- Exact local report: `portal-app/releases/split-handoff/evidence/VALIDATION.json`; SHA-256 `30c002a4c65a39911a3d68f854ebb850ec4fe15569c07db9974c3b97bad213a2`.
- Subsequent native changes passed all 122 host-independent Node native cases. Two actual-host cases were excluded: `native_bootstrap_streams_authenticated_master_to_disposable_target` and `disposable_headless_bridge_checks_pin_before_reading_target`.
- Latest Node enrollment-panel changes passed nine installation/setup component cases, desktop TypeScript and the NodeNetwork build.
- THE LATEST COMBINED BRANCH HEADS HAVE NOT HAD A FRESH FULL PAIRED MATRIX. Historical green results do not qualify later changes or any unmerged developer work.
- Ad hoc signed native QA bundles are development evidence, not production installers. No qualified downloadable dApp releases are claimed.

## Duplicate work and unmerged developer branches

Developer work was fetched, but not merged. There is substantive overlapping NodeNetwork work: the newer owner workflow already includes guest selection/configuration, formation/public export, signed-Genesis staging, authorization, VPN and lifecycle controls. Consolidate on the compatible owner workflow rather than rebuilding it on the older retained protocol.

Verified developer heads at the last sync:

| Repository | Branch | Commit |
|---|---|---|
| Portal | `integration/apqe-canary` | `b37af0a4f60aac2938a00fa7c48632bbf7437d4c` |
| Hub | `delivery/wallet-history-2026-11-15` | `bbd04724dc99e7b0d40c5f834d2ea1460f08460a` |
| Hub | `delivery/nodenetwork-existing-chain-2026-11-15` | `ad4b4f30864167cf93c54ddd63c3e7dee505b7cc` |
| Hub | `integration/apqe-canary` | `77f53aef300fd6555bc9f645a212257acdc1f935` |

Read-only merge previews found 15 Portal conflicts and 20 Hub conflicts. No merge/rebase/reset or conflict markers were applied to the working trees. The 35-file preservation/reconciliation map is in Portal MIGRATION-STATUS.md.

The branches differ in protocol/root/admission requirements, including `/opt/Synergy` versus `/opt/synergy` and newer removal-guard acknowledgement fields. Our exact older acknowledgement must not be copied unchanged into the newer contract. Preserve distinct Core preference restore/Spark receipt work and reconcile the native journal/acknowledgement improvements where compatible.

Existing reconciliation PR: https://github.com/synergy-network-hq/portal-app/pull/2

## Remaining blockers and unfinished acceptance

1. **Canonical policy:** developer branches require `/Volumes/PortableSSD/02-Synergy-Network/AGENTS.md` and explicitly say Stop if it is inaccessible. That volume is not mounted here. Repository AGENTS files point to this separate parent policy and do not embed it. The user says it is in Git on another developer's machine; its exact published repository/branch/path remains unresolved. Retrieve the correct committed policy, including its Aegis exemption, before applying those branches. Do not substitute older Agent Operating System instructions or silently remove the requirement.
2. **Cross-repository integration:** resolve the 35-file conflict map, profile/root/build dependencies and matching host SDK/native registrations; then run the complete paired checks on clean merged commits.
3. **Wallet:** qualified supported phone/session protocol, physical signing, broadcast ownership, settlement and finality acceptance. Collectible media remains unavailable pending a supported constrained media service; no arbitrary metadata URLs are loaded directly.
4. **NodeNetwork:** independently admitted compatible engine, host enrollment/custody, VPN/sync/startup, staking contracts and managed lifecycle acceptance. Host selection is deliberately deferred.
5. **Release:** signed feeds/packages, APQE/publisher/distribution qualification and final native acceptance. The final restore-focus correction still needs native observation in its rebuilt QA app.

Previous completion percentages and time estimates were rough engineering estimates for this branch, not an audited assessment of all organization-wide work or a production-release commitment. Reassess after consolidation.

## Resume procedure

1. Retrieve/read the canonical policy and both repository AGENTS.md/README.md files.
2. Clone the two saved branches as sibling checkouts, preserving the `synergy-dapps` sibling name. GitHub authentication is required for private dependencies and developer branches.
3. Read Portal CONTINUE-CODEX.txt, MIGRATION-STATUS.md and COMPLETION-AUDIT.md; then Hub CHECKPOINT-2026-11-17.md and Wallet/NodeNetwork ACCEPTANCE.md and UPSTREAM.md.
4. Fetch current developer heads and reconcile the existing integration PR using the conflict map. Preserve canonical Jarvis ownership/dependency pinning and all native trust gates. Do not select or operate a host as part of source setup.
5. Install dependencies using the repository README commands. Native builds require a qualified canonical engine via SYNERGY_NODE_ENGINE_ROOT. Historical scratch-engine fixtures are not a production engine substitute.
6. Run focused reconciled-contract tests first, then both Portal editions, dApp builds, registry, locked native checks and the full paired validator on clean commits. Update the audit/handoff and push both repositories.

## Shareable ZIP contents

The ZIP is a source handoff containing committed Portal and dApp Hub source/assets, this summary, the supplied Markdown specs and available revision-bound validation JSON. MANIFEST.json records exact exported Git commits and per-file SHA-256 hashes. README.txt explains source layout and evidence limits. Git history, dependencies, caches, local profiles, credentials, signing material, native installers and unverified compiled builds are excluded. Fetch the named upstream branches from GitHub to perform history-aware merges. Known credential-pattern scanning and archive integrity verification are applied; this is not an exhaustive security audit.
