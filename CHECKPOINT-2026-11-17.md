# Exact bootstrap outcomes and uncertain journal preservation

Bootstrap now reuses the native duplicate-rejecting receipt decoder and requires exact version/ok/result-or-error envelopes before accepting an outcome. Six malformed wire cases in one real-process regression remain uncertain through the actual scratch request journal and retain the second-mutation fence. All four bootstrap transport tests and all 121 host-independent native cases passed; two actual-host tests excluded. No host selected. The existing Portal bootstrap transport validator filter automatically includes the new case; a full paired rerun after this source change remains pending.

# Bootstrap refusal transport correction

Ported the bounded owner transport fix from bbd04724dc99e7b0d40c5f834d2ea1460f08460a without adopting its engine, target or deployment changes. Authenticated negative bootstrap replies now survive concurrent broken-pipe upload failure. Success still requires every upload-integrity check and transport exit success. Three actual local process cases and all 120 host-independent Node native cases passed; two actual-host cases remain excluded. No host selected or bootstrap dispatched. Portal paired validator now registers the new bootstrap_transport_ test filter; a fresh full paired matrix is pending.

# Native and desktop identity verification follow-up

Portal focused identity-generation and Genesis-stage-journal suites passed all 26 cases. Native cargo test -p nodenetwork-native --lib identity passed all 12 matching cases, including scoped canonical request binding, legacy input-only status, duplicate/contradictory provenance refusal, redacted command output and unchanged journal fencing. Corrected an old custody-status fixture to assert strict refusal of an extra envelope field before testing the canonical envelope; the reconciliation error fixture now includes required version 1. No production parser relaxation. Full paired matrix and selected-host/runtime acceptance remain pending.

# Identity provenance regression follow-up

Ran node --test nodenetwork/tests/identity-preflight.test.mjs nodenetwork/tests/custody-status.test.mjs: all 12 cases passed. New coverage distinguishes scoped input-only custody from durable request attribution; independently reproduces the owner canonical identity_generate SHA-256; rejects contradictory or malformed provenance, future schemas and interrupted-intent replies presented as absence. Native command/journal tests, desktop component tests and full paired validation remain pending. No host selected.

# Low-usage source checkpoint

Saved at user request before quota expiry. Wallet NF1 sale receipt comparison has focused verification (123 Portal cases, TypeScript, Wallet build and compiled Buy replay). NodeNetwork optional identity-request provenance changes are work in progress: finish legacy/scoped/malformed/contradictory-response tests, native tests and acceptance notes before claiming completion. No host selected, provisioned or qualified.

Read the paired Portal CONTINUE-CODEX.txt and AGENTS.md. Last fully green paired baseline was Portal a175c6c / Hub f37aef1; it does not validate the new unfinished changes in this commit.
