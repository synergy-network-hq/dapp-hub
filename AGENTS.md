# dApp Hub contributor instructions

Read README.md before editing. This repository owns installable dApps, their
application assets, and NodeNetwork's native adapter. Portal is a separate
sibling repository and owns the host, permissions, sandbox and SDK boundary.
Preserve publisher/APQE authentication and engineering-versus-production gates.

All node installation and operation must run through the actual Portal → dApp
Hub → NodeNetwork workflow. Independent CLI or SSH execution is not that
workflow, even for a tool from the master. Fix the canonical master first,
qualify an authenticated uniform release, and distribute it through NodeNetwork.
Keep all node-owned resources within the platform root except tracked,
reversible OS registrations. Preserve other contributors' work and source
ownership; do not copy Wallet/APQE implementations into this repository.
