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
| N17 Jobs | Native local dispatch journal and Management history now record bounded fingerprint-only local mutation attempts and received/uncertain outcomes, with unresolved configured-target fencing. Temporary-file smoke checks fresh-process persistence/fencing, private modes, interrupted-entry retention and symlink refusal; actual journal/controller compile in isolation. This is not a durable target job list/status/reconcile/cancel API or signed plan. No replay, clearing or automatic retry. Response receipt does not prove completion. Node command/bootstrap integration, full host bridge/native restart/concurrency and qualified reconciliation/retention remain open. Host aliases are not authenticated identity; do not bypass uncertainty by changing an alias. |
| N18 Offboarding | Root-confirmed uninstall/preflight exists. Chain exit/unbond, VPN removal and signer-retirement dependencies are not implemented as a complete offboarding flow. |

Next sequence: obtain reviewed canonical engine provenance; compile full native app; qualify controller/bootstrap on an explicitly chosen disposable target when separately authorized; define the missing typed plan/job/VPN/readiness APIs with the node team; integrate canonical wallet/chain actions when qualified upstream contracts exist. Continue frontend/read-only work separately. Do not restore the retired generic integration broker, bypass build.rs, invent signing envelopes or advertise a lifecycle response as finality/participation proof.

Permission-scope follow-up: target controller remounts when effective inspection permission changes, immediately dropping displayed prior-scope results and invalidating late response publication through its existing unmount guard. The module-level mutation latch remains across remounts. This does not cancel native transport or establish native grant-revocation acceptance.

Public status response follow-up: node/PoSy/sync reads reject null/scalar/array payloads independently, preserving successful sibling observations and showing failed-source errors. An HTTP/RPC success alone does not establish a usable status object or managed-host readiness.

Controller capability parsing rejects non-array/oversize tables, missing/duplicate operation entries and non-Boolean availability; blocker presentation accepts bounded plain text only. These frontend denials do not replace native validation or establish host authorization.

Native confirmation target review now includes local/remote kind and the effective SSH port (including default22) for controller and bootstrap prompts. This distinguishes configured connections but is not host identity proof or a signed plan. Actual controller compilation is checked in isolation; full command/dialog runtime remains engine-blocked.

Bootstrap review now includes the validated node name and SHA-256 of the selected normalized operator public-key text. The fingerprint is a local comparison aid, not independent key authorization or APQE proof. No key material is journaled; native dialog/runtime acceptance remains unverified.

Saved-target recovery distinguishes missing/null records from unreadable/unsupported records. The latter retain their original bytes, show an error and block Save rather than silently treating corruption as a fresh target. No controller mounts for the invalid target. Reviewed recovery and storage-failure/browser/native acceptance remain open.

Local record parsing now checks raw string size before JSON parsing: Wallet contacts512Ki characters, Node public draft16Ki and saved target4Ki. Supported formats fit within these bounds. Oversized originals remain untouched and reads/writes report unavailable instead of inferring empty data. Browser storage-failure/full acceptance remains open.

Unsupported-schema preservation: unknown contact fields or unknown provisioning-envelope fields now make the existing record unsupported rather than allowing a later save to silently discard those fields. Original storage is retained; reviewed migration/recovery remains required.

Target canonicalization now rejects an explicitly incompatible root and non-decimal/non-numeric remote port values instead of coercing them into a different connection. Existing saved-target error retention applies. Native target validation remains independent and mandatory; no host selected.
