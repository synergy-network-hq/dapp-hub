# Isolated Wallet Activity fixture preview

From the Hub root run `pnpm exec vite --config wallet/qa/vite.config.mjs`, then open http://127.0.0.1:4193/ . Requires the sibling Portal checkout and its desktop dependencies as documented in Portal README. The config resolves the real public SDK and installed Tauri packages; it does not replace native authority.

This manually operated preview renders the actual WalletHistory, Activity and transaction detail components with explicitly synthetic public read responses. The production caller retains the real SDK defaults. It creates no phone session, permission, account query, signing operation or native runtime. It is not in the production entry point or app build.

Scenarios cover two pages, endpoint failure/recent-source fallback, delayed next-page cancellation, overlapping records and changed snapshot refusal. Select a transaction, go Next, filter the two returned records, then Previous; page changes clear details and page-local filters. Start a delayed Next and Restart before completion: Page 1 must remain after the delay. Overlap and changed-snapshot errors must retain the current page. These checks do not establish live API deployment, connected/native transport, ownership, finality or full cache-limit/concurrency acceptance.

The first record has null fee/nonce; the second uses fee1000000000000000001 nwei and nonce9007199254740993 to inspect unavailable handling and exact integer presentation.

## Receive fixture

Open http://127.0.0.1:4193/receive.html under the same preview command. This renders the actual Receive component with conspicuously synthetic, unowned addresses that must never receive funds. Normal/delayed modes use the real QR library; failure mode throws deliberately. Switching address checks image clearing and scope without native permissions, phone or network access. Clipboard remains the real browser API; it was not exercised and clipboard permissions/results are unqualified. Both HTML entries build into the ignored dist-qa directory; neither is part of production application entry points.

Stable browser checks passed QR success, synthetic generation failure with address retained, pending address switch hiding the old image, a different QR after second-address completion, and original QR restored on returning to the first address. QR bytes were compared; no phone scan or decoded-payload/ownership proof is claimed. An initial comparison was discarded because changing Vite configuration reloaded the fixture; the stable run was performed afterward.
