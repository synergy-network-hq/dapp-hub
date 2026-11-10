## dApp submission or update

- App ID and source directory:
- Source revision and version:
- Requested capabilities and why each is needed:
- Test command and platform results:
- Changes to custody, network access, signing or authorization:

Confirm that no credentials, private keys, generated dependencies or installers are included. Add/update the individual app manifest and regenerate `registry/catalog.json` with `python3 registry/validate.py --generate`.

Publication requires separate maintainer review, native APQE ML-DSA-87 release verification and platform qualification. A merged source submission does not authorize installation.
