# Contributing

Use an issue to explain a methodological change before altering published statistics. Submit a focused pull request with `pnpm typecheck`, `pnpm test`, and `pnpm check:data` results. Include original synthetic fixtures for new behavior; never upload MovieSum text, summaries, titles, or character lists.

For a data update, explain input source revision, rights, split order, fingerprint, method version, exclusions, and why the distributions changed. Preserve the CC BY-NC attribution block. A second maintainer should inspect the generated diff and independently reproduce the change from lawfully held inputs before approving it. Code changes and data changes have different licenses.

Report product issues through the Inkwell help site; this repository is for reproducible research tooling. See SECURITY.md for private vulnerability reporting and CODE_OF_CONDUCT.md for community expectations.
