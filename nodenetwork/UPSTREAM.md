# NodeNetwork engine and release evidence

Checked 2026-11-10 against authenticated organization repositories. This records a bounded search, not proof that qualified source exists nowhere.

- Native `build.rs` requires `SYNERGY_NODE_ENGINE_ROOT/bootstrap.py`, defaulting to `/Volumes/PortableSSD/02-Synergy-Network/01-Core-Protocol/node-platform/tools/linux-node/bootstrap.py`. That local prerequisite remains absent. No substitute file or qualification pin was created.
- GitHub code search `org:synergy-network-hq filename:bootstrap.py` returned zero indexed results. Search indexing alone is insufficient absence evidence.
- Additional candidate `synergy-network-hq/testnet-node` reports an empty Git repository (tree API HTTP409), despite its description of temporary role setup.
- Complete `synergy-network-hq/node-control-panel` main tree at `6d4f4f54f3b7da6af17a574fcc2fdee4abae38ff` was not truncated. Matching controller/agent paths include `src-tauri/src/agent.rs`, `recipes/treasury_controller.yml` and `templates/treasury-controller.toml`; no bootstrap.py/linux-node engine path was found in that tree. These older contracts do not qualify the current shared lifecycle.
- `synergy-network-hq/synergy-node-control-panel-releases` latest release was `v20.0.0`, published 2026-07-29. Asset metadata lists application installers, update metadata/checksums and an operator manual. It does not supply a separately identified reviewed canonical engine source. No installer was downloaded, executed or repackaged as the missing engine.

To unblock: provide the canonical reviewed engine source and provenance matching the current single-root lifecycle and qualification contracts, then set the real engine path and run the full locked native check. Compilation alone does not establish lifecycle, APQE, host enrollment or release acceptance. Host selection and operations remain deferred.

## Local dispatch evidence (2026-11-10)

`native/src/request_journal.rs` is a Portal-local safety/evidence integration, not a newly discovered remote protocol. Existing native confirmation and host grants remain mandatory. Only normalized configured-target and request SHA-256 fingerprints, local ID, operation, timestamps, response Boolean and local uncertainty state are persisted. The fixed native application data directory contains at most256 records of4KB each; unreadable/unsupported/interrupted entries are retained and block new mutations. No raw host, operator, public/private key, parameters, response body or error text is written. Local input fingerprints are not cryptographic host authentication, signed plans or target-job identities. Atomic exclusive writer files serialize local record changes across Portal processes; an interrupted writer lock is retained and blocks writes/history until an approved recovery procedure. Hostname aliases are outside the qualified identity contract; do not use them to bypass unresolved operations.

Management can inspect local records without selecting a host. Unknown outcomes fence another mutation for the same configured-target fingerprint; there is deliberately no renderer clearing/retry/reconciliation authority. Capacity exhaustion requires a future approved retention procedure. A crash between recording intent and transport may conservatively block work that never reached a host. A received controller response is local evidence only; service state, consensus participation and durable job completion require separate authoritative reads/contracts. Actual module compilation and scratch-file fresh-process smoke do not qualify Node command/bootstrap integration, native app restart or host execution. The canonical engine remains required.

## Expanded owner/local search — 2026-11-11

Inspected complete main trees: synergy-node-control-panel62420f9209b2351f255e846a52e5c598b907bbcd, testnet-v305610db7eb1eaa582caec0adf0c7967c820d5e34 (33,065 entries), APQEad4112a6e7e607ece8418a387837ae835ef76925. Connector tree response for the large testnet repository was unavailable, so authenticated gh API filtering was used. Also inspected control-panel recovery/ssd branch333ffc36dadba41ad576f5655069d1eab1b6d4ee: complete tree, no bootstrap.py/linux-node path.

The testnet reconcile/core-protocol-root branch4e85781f9e24baf65624898dc6ff0e16dd1d6d82 contains node-platform. Its root recursive tree was truncated and is not absence evidence. Direct contents lookup for node-platform/tools/linux-node returned404; the exact tools subtree48f19b76f9c21a6f5be7be298931edcd796ed7c6 was complete and contains bootstrap/{clean-host,install-node,verify-host}.sh plus validator readiness scripts, not the required Python engine. These are candidate owner sources, not a qualified replacement. No script was executed or build prerequisite changed.

Existing docs/control-panel/validator-vpn-coordinator.md, control-service/src/validator_vpn.rs and src/services/validatorProvisioningService.js contain concrete Innernet invite/confirmation/mesh and validator workflows. They use coordinator-owned allocation, stake checks, Ed25519 receipts, legacy challenge-sha256 defaults and paths such as /etc/synergy/validator-vpn and testnet/runtime. They are not directly compatible with this Portal's NetBird-oriented specification, APQE qualification and /opt/Synergy-only lifecycle. Renderer eligibility Boolean checks or local target defaults do not supply host admission authority. Obtain reviewed compatibility/superseding policy and native custody/verification before porting execution. Do not copy their implicit targetId=local fallback or request/admin credentials into Portal.

Local search: an initial all-Volumes filename scan was interrupted because it traversed broad backup volumes; no complete-scan claim. Bounded completed filename scans of the current workspace, Synergy_Network/Synergy Build Stuff and Synergy Docs Workspace found no bootstrap.py. A technical-path search of project-files and Downloads likewise found no canonical engine. Two old wallet-pqc-cli ZIP central directories had README matches but no bootstrap/transaction/codec/APQE paths; contents were not executed or treated as qualification. This is not an all-disk or all-archive absence proof.

Contract reconciliation now in CONTRACT-RECONCILIATION.md: node_readiness_json supports a bounded public RPC observation, not enrolled-host readiness. Numeric chain_incarnation is normalized exactly. Live response reported ready/healthy at height0; it does not establish validator participation or network-tip freshness. Native/browser full acceptance remains open.

## Validator Operations saved-file contract

The pinned `synergy-network-hq/synergy-node-control-panel` revision `608f2529dfe6c7d8a0d932342aa478c2995a20c3` defines `ValidatorOperationsObservation` and its 1 MiB input bound in `control-service/src/validator_operations.rs`. The companion `control-service/VALIDATOR_OPERATIONS_API.md` documents the runtime file and separate authenticated HTTP contract. Monitoring accepts the raw `synergy.validator-operations.v1` observation from a user-selected file. The owner fixture wrapper and the authenticated API's derived status are different shapes. When `expected_release` is absent, the saved-file reader marks comparison unavailable. An included reference only compares values within the selected file. The snapshot producer and authenticated native transport still need qualification.

To exercise the pinned owner contract, obtain `control-service/fixtures/validator-operations/five-validator-observations.json` at the above revision and point `SYNERGY_VALIDATOR_OPERATIONS_OWNER_FIXTURE` at that file before running `node --test nodenetwork/tests/validator-operations-observation.test.mjs` from the Hub. The fixture test reads the source envelope in the test process and passes its `base_observation` and documented variants through the saved-file parser. Standard split validation uses its independent local fixture.

## Offboarding owner review

Node Control Panel main remained `608f2529dfe6c7d8a0d932342aa478c2995a20c3` at the review. Its complete tree had no `bootstrap.py` or `tools/linux-node` path. `control-service/src/netbird_broker.rs` exposes enrollment and assignment reconciliation. The reconciliation result reports `expected_vpn_ip` and `assigned`. A qualified peer-removal receipt is still needed. Testnet v3 main remained `05610db7eb1eaa582caec0adf0c7967c820d5e34`. In `runtime/src/rpc/rpc_server.rs` and `runtime/src/token.rs`, `synergy_getStakingInfo` returns rows selected by staker address. Individual rows have no token symbol or finalized exit state. Chain exit and unbonding still need an authoritative validator-scoped contract. Portal’s offboarding evidence uses the already admitted local request journal and the saved observation’s service enum.

## Active list and NodeNetwork delivery review

Testnet v3 `05610db7eb1eaa582caec0adf0c7967c820d5e34` exposes `synergy_getValidators` in `runtime/src/rpc/rpc_server.rs`. It filters the node’s `network_validator_snapshot` to `ValidatorStatus::Active`. That snapshot combines source validator state and configured/genesis inputs. The separately implemented `synergy_getValidatorSetSnapshot` builds a finalized membership response and needs its own Portal admission. The existing Portal allowlist admits the public active list and chain ID. NodeNetwork uses those two reads for the selected Testnet endpoint and scopes the result to observation only.

Hub delivery branch `delivery/nodenetwork-existing-chain-2026-11-15` at `ad4b4f30864167cf93c54ddd63c3e7dee505b7cc` contains typed NetBird status/enrollment, validator identity and formation preparation, signed Genesis staging/binding, interrupted custody reconciliation, authenticated removal, and scoped controller diagnostics. The branch also changes the managed root to `/opt/synergy`. Our saved target and install/update/offboarding contracts currently use `/opt/Synergy` and need an explicit migration with the compatible Portal native bridge. The delivery acceptance refers to an external canonical engine used in its type-check. Its engine prerequisite remains in `nodenetwork/native/build.rs`, and the branch tree contains no engine. The dApp release descriptor is still null. Qualified release verification, VPN issuance, and isolated target runtime acceptance remain prerequisites for managed execution. This source review leaves the delivery branch and local lifecycle unchanged.

## Pinned uppercase engine build evidence

The current Testnet v3 `reconcile/core-protocol-root-2026-09-15` and `delivery/canary-epoch5-timeout-2026-11-15` `node-platform/tools` subtrees contain the canonical engine with the lowercase `/opt/synergy` contract. Their root recursive listings were truncated. Core commit `b1641323713f0307140de0c89ad73f1c86005568` introduced that root change. Its parent `613fa6ab8732c6fcb2a8afb40291b68874f4c27f` contains the matching uppercase bootstrap and controller. The bootstrap uses Portal’s seven-field v1 header and independent native manifest digest authorization. The exact bootstrap Git blob is `2e86690192108d8a4d83944750c7236702fbfb30` and its SHA-256 is `266f996706f258380f304afcdc7120e91798da361b558eadc97dc54998c34866`.

Full hostless `cargo check --locked --offline` passed on Apple Silicon at Portal `4c4571f8930392b37dde71ee59277f9eced53f6e` and Hub `4faa5c912ea0e3d575a97d01df33d1c9e6129efb`. The actual native adapter and desktop compiled. `OperationGate::restart` produced an unused-method warning. The exact file was embedded from temporary storage and never executed. Build evidence leaves APQE release authority, compatible master artifacts, native window behavior and host lifecycle qualification open.

From the Portal root with an existing frontend build, authenticated `gh` repository access and locked Cargo dependencies cached, this reproduces the pinned hostless check. The temporary engine and Cargo output are removed afterward.

```sh
python3 - <<'PY'
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
import os
import subprocess

ref = '613fa6ab8732c6fcb2a8afb40291b68874f4c27f'
path = f'repos/synergy-network-hq/testnet-v3/contents/node-platform/tools/linux-node/bootstrap.py?ref={ref}'
bootstrap = subprocess.check_output(['gh', 'api', '-H', 'Accept: application/vnd.github.raw+json', path])
digest = '266f996706f258380f304afcdc7120e91798da361b558eadc97dc54998c34866'
if hashlib.sha256(bootstrap).hexdigest() != digest:
    raise SystemExit('Pinned bootstrap digest mismatch')
with TemporaryDirectory(prefix='portal-hostless-check-', dir='/private/tmp') as directory:
    root = Path(directory)
    engine = root / 'linux-node'
    engine.mkdir(mode=0o700)
    (engine / 'bootstrap.py').write_bytes(bootstrap)
    env = {**os.environ, 'SYNERGY_NODE_ENGINE_ROOT': str(engine), 'CARGO_TARGET_DIR': str(root / 'cargo-target')}
    for key in ('SYNERGY_NODENETWORK_QUALIFICATION_MANIFEST_SHA256', 'SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN'):
        env.pop(key, None)
    result = subprocess.run(['cargo', 'check', '--locked', '--offline', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml'], env=env)
    raise SystemExit(result.returncode)
PY
```

The same uppercase Core revision's `node-platform/tools/linux-node/controller.py` implements `vpn_status` under its fixed read set with empty parameters. Its v1 response reports service registration, staged enrollment, recorded enrollment, reconciliation requirement, checked server binding, connected client and optional overlay CIDR. The adapter uses the existing operation lease and selected-target transport for this read. The separate `vpn_enroll` requires a scoped one-use grant and issuer. Those execution and custody paths need additional qualified integration.

To exercise the native VPN schema tests without the application window, copy the Hub `nodenetwork/native` crate and Portal `apps/desktop/src-tauri/Cargo.lock` to a temporary crate, then run `cargo test --offline --manifest-path <temporary crate>/Cargo.toml --lib node_controller::tests::vpn_status` using the pinned engine environment above. The filter runs the pure request and response tests. The physical-host tests are a separate, explicitly ignored suite.

The pinned uppercase controller exposes `identity_status` and `formation_status` as separate empty-parameter reads after an installation receipt check. The first verifies pending existing-network custody against previously staged signed Genesis. The second verifies preparation and its recorded request digest against the pinned formation context. Both can return `{ "pending": false }` or a `reconciliation_required` refusal. Portal presents the public result and preserves the existing local journal. The later delivery branch introduces additional receipt-based journal reconciliation around its own custody dispatches. That workflow requires the matching native foundation and root migration. The analogous hostless filter is `node_controller::tests::custody_status`.

For `install_preflight`, the pinned controller checks the staged master against the exact requested release and manifest SHA-256, then verifies that the host policy approves the requested network and chain. Its six-field response reports the package and network checks, the release, the canonical root, and false Genesis and activation flags. The response omits individual hardware, clock and port checks. Portal binds the typed receipt to the original request and leaves installation, Genesis and activation in their separately authorized workflows. The hostless unit filter is `node_controller::tests::install_preflight`.

For `health`, the same uppercase controller forwards `synergy-node health --admin-socket /opt/Synergy/run/admin.sock` through its fixed empty-parameter read set. Testnet v3 `613fa6ab8732c6fcb2a8afb40291b68874f4c27f` defines the CLI success envelope in `node-platform/bin/synergy-node/src/main.rs`, the service snapshot in `src/services/admin.rs` within that binary, and the serialized observation and enums in `node-platform/crates/synergy-node-core/src/runtime.rs` and `src/supervisor/service.rs` within that crate. Portal validates the nested mutation-free v1 result, permits up to 128 unique service IDs of up to 64 ASCII characters, and exposes state, health and readiness codes. The Admin request identifier and free-form reason payloads are discarded before the renderer receives the result. The owner's separate readiness operation has its own runtime gate and stays outside this report. The hostless unit filter is `node_controller::tests::health`.
