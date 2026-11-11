# Relay integration checkpoint

Restores the saved Relay Panel/Button quote design in the separate Hub. Public health, token registry and same-chain indicative quote reads use the explicit Portal SDK and independent native request validation. Amounts retain decimal precision; replies must match the submitted pair, chain and amount, and be unexpired. Transaction payloads are discarded. No wallet, recipient, approval, swap or cross-chain execution is exposed.

Owner API reviewed: synergy-network-hq/synergy-relay main 53b7330d5fc8a9397e10209e3d3c19215b86dbfa. Live health and token endpoints returned HTML rather than JSON; the real UI displays unavailable/retry and disables quotes. No live quote was submitted. Deployment routing and live quote acceptance remain open.

Synthetic actual-module smoke covers precision and malformed/mismatched/expired response refusal. Browser preview verified the actual unavailable/retry path. This is not native HTTP, wallet or swap qualification. Host selection remains deferred.
