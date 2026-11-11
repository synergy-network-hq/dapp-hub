# Synergy dApp Hub

The community submission repository and release catalog for Synergy Portal applications. Application source lives here, separately from the Portal host repository. Each application owns its directory, entry point, assets and manifest. NodeNetwork also owns its native controller adapter crate; Portal only registers that reviewed host extension.

Submit applications and updates by pull request; see [CONTRIBUTING.md](CONTRIBUTING.md). Quest and Prism are retired. Planned manifests do not imply implemented or installable applications.

Portal reads `registry/catalog.json` for discovery. Versioned packages belong in this repository's GitHub Releases, as referenced by each application's release descriptor. A catalog entry, GitHub transport, source build, hash or static CI result cannot authorize installation. Every current release is `null`: no qualified downloadable application release is published yet. Native APQE ML-DSA-87 verification, approved publisher roots and the package signing/qualification profile are required before installation or updates can execute.

## Development

This checkout builds independently of the Portal source tree. The host SDK is an optional peer dependency. Portal exposes its explicit `@synergy-network/portal-native/dapp-sdk` interface; applications must not import host internals. `pnpm install`, `pnpm run validate`, `pnpm test` and `pnpm run build:apps` validate metadata and produce separate unsigned development artifacts. These are not release qualification. Executing applications inside Portal requires its compatible versioned host SDK; publishing that SDK remains a release prerequisite.

The root `registry/catalog.json` is generated from per-application manifests: run `python3 registry/validate.py --generate` after reviewed metadata changes. CI validates inert documents using the trusted base validator and never executes submitted application build scripts.

Portal recovery can suspend all application/widget execution and make SDK capability checks deny access immediately. Applications must continue using the explicit SDK and host permit checks; a local recovery flag, catalog entry or source build grants no authority. Host-only native policy/transition commands are not dApp APIs. Node adapter invocation is wrapped by the host's native operation lease; recovery does not stop target services, reconcile durable jobs or qualify Node lifecycle/Wallet signing. Source integration and native/runtime/release acceptance remain separate.
