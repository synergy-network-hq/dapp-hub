# Isolated component verification

From Hub root run `pnpm exec vite --config keystone/qa/vite.config.mjs`. Open localhost:4195/ for the actual Keystone text editor/review. It uses local text storage on that preview origin, not an account or grant. Do not enter secrets. Copy uses the actual clipboard and was not exercised in the recorded check.

/learn.html renders the actual public Learn reader against the fixed public API proxy, independently of Portal authority. Production LearnApp still checks its declared readNetwork capability; no fake native flag or permission context is provided. The recorded live API returned website HTML; the reader reports non-JSON and retries without sample content. Lesson success is not established by that run.

QA sources are separate from production entries. Build outputs under keystone/dist-qa stay ignored. Existing actual SDK/React dependencies are resolved from documented sibling checkouts.
