# Horizon run inspection

The file inspector restores the saved workbench glass panels and local run import from Portal backup commit `0cc2ccd6b973157ec02420520ef8128f1914fe25`. It reads one selected UTF-8 JSON file of up to 2 MB. It compares the version 1 record with its hashed content, checks the exact UTF-8 SHA-256 digest and recomputes the comparisons in any recorded two-run replay. Record object keys may be reordered by the original export. The report displays a model label, output length and digest. Prompts, generated output and receipt contents stay outside the report.

Inspection runs on the device and needs no account, credentials, runtime service or Portal capability grant. A receipt field is reported as present and device signature verification remains unavailable in this view. A valid digest demonstrates consistency of the file's content. An editor can recompute the digest. Device origin, model identity, inference correctness and distributed verification remain open.

Horizon owner source at `68ed949157ab5100541689216de25788798e9d7d` is a static demo. At AIVM owner commit `9debf33e11fdf4c0c20c3a07d4794e3b37751138`, the verifier implementation, attestation implementation and small property circuit files are empty. Local inference, replay execution, same-device signature verification and network proof verification need separate integration and acceptance.

`pnpm --filter @synergy-network/dapp-horizon test` checks reordered keys, altered records and digests, incorrect replay summaries, UTF-8 byte and nesting limits, and cancellation during digest computation using synthetic file contents. Host selection and release qualification are deferred.
