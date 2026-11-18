# Isolated Wallet Activity fixture preview

From the Hub root run `pnpm exec vite --config wallet/qa/vite.config.mjs`, then open http://127.0.0.1:4193/ . Requires the sibling Portal checkout and its desktop dependencies as documented in Portal README. The config resolves the real public SDK and installed Tauri packages; it does not replace native authority.

This manually operated preview renders the actual WalletHistory, Activity and transaction detail components with explicitly synthetic public read responses. The production caller retains the real SDK defaults. It creates no phone session, permission, account query, signing operation or native runtime. It is not in the production entry point or app build.

Scenarios cover two pages, endpoint failure/recent-source fallback, delayed next-page cancellation, overlapping records and changed snapshot refusal. Select a transaction, go Next, filter the two returned records, then Previous; page changes clear details and page-local filters. Start a delayed Next and Restart before completion: Page 1 must remain after the delay. Overlap and changed-snapshot errors must retain the current page. These checks do not establish live API deployment, connected/native transport, ownership, finality or full cache-limit/concurrency acceptance.

The first record has null fee/nonce; the second uses fee1000000000000000001 nwei and nonce9007199254740993 to inspect unavailable handling and exact integer presentation.

The Transaction RPC observations scenario uses synthetic hashes with the supported format. Select the first hash, click Check status on selected RPC and observe the synthetic pending result and check time. Change Next RPC response, then click Check RPC again. Confirmed at another height shows the discrepancy with Atlas. No transaction replaces the previous result without claiming the transaction was dropped. Mismatched hash reports a fixed error. The Portal desktop Vitest target `tests/wallet-transaction-observation.test.tsx` verifies this component with injected read functions, including pending request cancellation when changing selection.

## Receive fixture

Open http://127.0.0.1:4193/receive.html under the same preview command. The actual Receive component shows a synthetic selected endpoint. Normal/delayed modes use the real QR library for the public protected checksum vector. Failure mode exercises the fallback. Switch to the legacy address fixture to check that the QR and copy action are removed. These synthetic vectors must never be used as payment destinations. Both HTML entries build into the ignored dist-qa directory.

Prior browser checks with older fixture addresses passed QR success, synthetic generation failure with address retained, pending address switch hiding the old image, a different QR after second-address completion, and original QR restored on returning to the first address. QR bytes were compared; no phone scan or decoded-payload/ownership proof is claimed. An initial comparison was discarded because changing Vite configuration reloaded the fixture; the stable run was performed afterward.

The Portal test `wallet-receive.test.tsx` verifies that the current Receive component sends the protected vector's exact checksum case to the QR generator and clipboard. It uses qrcode's Node PNG renderer and a clipboard spy. `wallet-receive-scope.test.tsx` checks admission refusal, network display, late response isolation, QR fallback and copy feedback. Native clipboard behavior and phone scanning remain unverified.
