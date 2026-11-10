# NodeNetwork acceptance map

Source audit 2026-11-10. Requirements remain `synergy-spec/05-NodeNetwork.md` in the parent workspace. No numbered requirement is established complete by this audit. Host selection is deferred.

Current source contracts: `src/NodeNetwork.jsx`, `src/NodeController.jsx`, `src/native-services.js`, `native/src/commands.rs`, `native/src/node_controller.rs`, `native/src/node_bootstrap.rs`. Native full compilation is blocked by the canonical engine prerequisite documented in UPSTREAM.md. Frontend builds do not prove these native paths execute successfully.

| Requirement | Inspected source coverage and required next evidence |
|---|---|
| N01 Fleet | Public validator index/watchlist exists. Authenticated managed-node fleet/import and ownership/health reconciliation absent. |
| N02 Role/target | Explicit deferred target and local/remote configuration exist. Signed role/build policy and full device/operator enrollment acceptance absent. |
| N03 Preflight | install_preflight request and capability gate exist. Required/optional checklist mapping, remediation and qualified host execution unproven. |
| N04 Plan | Native once-only confirmation includes target/parameters/request approval ID. This does not establish the required durable signed-plan journal, drift/replan or elevated scope acceptance. |
| N05 VPN | No dedicated typed VPN enrollment/status/reconcile operation in current Request whitelist. Obtain reviewed control-plane/engine contract; do not infer managed enrollment from local NetBird CLI output. |
| N06 Install/identity | Bootstrap, install, commission and register source controls exist. Qualified package/host/custody execution and interrupted-step recovery unproven. |
| N07 Sync | Public RPC sync observations have source receipt times. Managed-host preactivation sync/readiness and durable progress absent. |
| N08 Stake/register | Controller service registration is not chain stake/registry admission. Canonical intents, phone approvals and finalized state reconciliation absent. |
| N09 Activation | Service start is not eligibility, active-set membership or attributable participation. Approved readiness/participation interfaces absent. |
| N10 Overview | Public monitor and target health request exist. Authenticated node identity, source age, ownership and integrated lifecycle runtime acceptance open. |
| N11 Performance | UI explicitly reports missing bounded authenticated telemetry. No synthetic chart proves performance. |
| N12 Stake | No typed stake/unbond/withdraw contract or qualified phone/chain path. |
| N13 Rewards | No typed rewards/claim/withdraw contract or qualified phone/chain path. |
| N14 Logs/alerts | UI explicitly reports missing bounded redacted node logs; inventory/health are separate. Stream retention/export/alerts absent. |
| N15 Troubleshooter | health/inventory/recovery_preflight requests exist. Ranked symptom findings, reviewed repair plans and full diagnostics acceptance absent. |
| N16 Maintenance | start/stop/restart/upgrade preflight+apply source controls exist. Downtime/schema/rollback/backup/resync procedures and runtime acceptance incomplete. |
| N17 Jobs | Current invoke responses are snapshots. No durable job list/status/reconcile/cancel API, journal replay acceptance or restart-resume proof. Frontend overlap latch is not durable job recovery. |
| N18 Offboarding | Root-confirmed uninstall/preflight exists. Chain exit/unbond, VPN removal and signer-retirement dependencies are not implemented as a complete offboarding flow. |

Next sequence: obtain reviewed canonical engine provenance; compile full native app; qualify controller/bootstrap on an explicitly chosen disposable target when separately authorized; define the missing typed plan/job/VPN/readiness APIs with the node team; integrate canonical wallet/chain actions when qualified upstream contracts exist. Continue frontend/read-only work separately. Do not restore the retired generic integration broker, bypass build.rs, invent signing envelopes or advertise a lifecycle response as finality/participation proof.
