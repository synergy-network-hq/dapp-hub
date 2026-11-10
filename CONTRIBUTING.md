# Submit or update a dApp

1. Submit a pull request with source in its individual root directory. Preserve the app ID when updating an existing application. New applications use a unique lowercase hyphenated ID matching their root directory; the validator discovers their inert manifest automatically. The canonical node ID uses the nodenetwork directory. Retired Quest and Prism IDs cannot be submitted.
2. Declare capabilities and widgets in the app's `manifest.json`. Unimplemented applications remain `planned` / `coming-soon`, with `release: null`.
3. Run `python3 registry/validate.py --generate --self-test`, then `python3 registry/validate.py`. Commit the deterministic catalog and source changes together.
4. Provide reproducible platform test results. CI validates inert metadata and does not execute submitted dApp build scripts or install dependencies.

Maintainers publish versioned artifacts only under `https://github.com/synergy-network-hq/dapp-hub/releases/download/vVERSION/`. Release descriptors require artifact SHA-256 and size, declared capabilities, an APQE ML-DSA-87 signature referencing a trusted release key, and qualification evidence. Static validation checks structure; it does not verify cryptography or approve a release. Native APQE verification and release gates must pass before Portal can install or update it. Unsigned, unqualified or unknown-authority artifacts remain blocked. Do not add classical native signatures or client-side verification bypasses.
