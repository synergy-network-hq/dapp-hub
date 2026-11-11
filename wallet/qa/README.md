# Isolated Wallet Activity fixture preview

From the Hub root run `pnpm exec vite --config wallet/qa/vite.config.mjs`, then open http://127.0.0.1:4193/ . Requires the sibling Portal checkout and its desktop dependencies as documented in Portal README. The config resolves the real public SDK and installed Tauri packages; it does not replace native authority.

This manually operated preview renders the actual WalletHistory, Activity and transaction detail components with explicitly synthetic public read responses. The production caller retains the real SDK defaults. It creates no phone session, permission, account query, signing operation or native runtime. It is not in the production entry point or app build.

Scenarios cover two pages, endpoint failure/recent-source fallback, delayed next-page cancellation, overlapping records and changed snapshot refusal. Select a transaction, go Next, filter the two returned records, then Previous; page changes clear details and page-local filters. Start a delayed Next and Restart before completion: Page 1 must remain after the delay. Overlap and changed-snapshot errors must retain the current page. These checks do not establish live API deployment, connected/native transport, ownership, finality or full cache-limit/concurrency acceptance.

The first record has null fee/nonce; the second uses fee1000000000000000001 nwei and nonce9007199254740993 to inspect unavailable handling and exact integer presentation.
