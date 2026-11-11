# Forge integration checkpoint

Restores the existing workspace, editor, diagnostics, build/artifact history and local ZIP interface. The real SynQ compiler is built from clean pinned source 01125b6470c6b49c586b7a28fe054a62e1c913c6 with tools/synq-compiler-wasm/build.sh; its generated WebAssembly runtime is an intentional application asset. Rebuild requires the sibling synq-language checkout, Rust wasm target and wasm-pack.

Local project records have bounded schema/path validation. Imported ZIP streams have per-file and total expansion limits. Completed builds/checks persist before completion is displayed; asynchronous results are scoped to the submitted project/source snapshot. These controls do not establish adversarial archive, storage-failure or multi-window acceptance.

Actual browser verification: Counter starter compiled with compiler1.0.0; five artifact checks passed and survived immediate reload; invalid source produced a real compiler diagnostic, then restoring Counter rebuilt successfully. These are local artifact checks, not VM or chain execution. No archive import/export or trust action was exercised. Deployment remains unavailable pending compatible transaction contracts. No host selection or native engine was used.
