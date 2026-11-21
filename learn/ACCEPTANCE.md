# Learn current acceptance

Source migration: public catalog search, path/lesson listings, lesson navigation/back/refresh, headings/paragraphs/code/checklists/comparison tables and explicit unsupported scored checkpoints reuse the saved design. Read capability is explicit, response/state is keyed to current lesson and abandoned reads are cancelled/discarded by the shared resource helper. Portal runtime remount handles permission changes. No last-known lesson is displayed under a new slug.

The Learn owner seed uses `prompt` for checkpoint text. The reader accepts that field and preserves earlier aliases. It renders source notes, concept maps, reading manifests and checkpoint prompts as text. Choices and answers are excluded from the reader projection.

The offline mode opens an explicitly selected, bounded local file independently of the live grant. It labels the file's declared source revision and unknown current publication status. Imported data stays in the current view. Review the [snapshot format and generation steps](SNAPSHOT.md) for the owner seed projection. The live path still reports the API error and offers retry during an outage. The application ships without a curriculum snapshot.

Actual public API is deployment-blocked: HTTP200 HTML rather than JSON. Browser isolated public reader verified unavailable guidance and retry. No sample content or progress is substituted. A separate synthetic parser smoke verifies duplicate/unsafe path/table refusal and plain-text lesson blocks. Full live lesson navigation, keyboard/viewport/accessibility, native and permission-revocation acceptance remain open.

Wallet login, account progress/sync, quiz scoring/submission, rewards, credentials and chain actions are absent and not advertised as working. All release/trust/sandbox gates are preserved, no grant or host selected. See UPSTREAM.md and keystone/qa/README.md for exact reproduction/provenance.
