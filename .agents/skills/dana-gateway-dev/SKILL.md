---
name: dana-gateway-dev
description: "Develop, diagnose, and locally verify dana-api-gateway: QRIS generation, DANA notifications, SQLite transactions, and payment callbacks."
---

# DANA Gateway Development

Use this skill in the `dana-api-gateway` repository. Resolve paths from the skill
directory or repository root; do not assume the caller's working directory.

Read the current source for the requested change. Use
[project-map.md](references/project-map.md) for API, schema, and operational
context, and the relevant section of [workflows.md](references/workflows.md)
for development, callback diagnosis, database changes, or deployment preparation.
These references describe a source snapshot, not verified production behavior.

## Local verification

Run `npm run verify` from the repository root, or run
`node <skill-directory>/scripts/verify-local.js` from any directory. Install
locked dependencies with `npm ci` only if needed. This helper runs syntax checks,
the existing selfcheck, and HTTP flows against temporary SQLite databases and a
loopback callback receiver. It prevents its HTTP requests from leaving loopback
and avoids loading the repository's `.env`.

For documentation-only edits, validate changed links and `git diff --check`.
For source changes, use the local helper and add focused coverage only when the
existing checks do not exercise the changed behavior. UI changes also need visual
and interaction checks; the helper only checks HTML responses and authentication.

## Payment decisions

- Preserve uppercase API states, lowercase callback states, reference propagation,
  five-minute expiry, and terminal payment state when callback delivery fails.
- Treat `reference_id` as correlation, not deduplication. Matching is amount/FIFO;
  duplicate phone notifications can pay another transaction of the same amount.
- Check the current `processExpiredWebhooks()` policy before diagnosing retry.
  `expiry_webhook_sent` can be set after rejection or exhausted retries; report
  delivery result separately from the flag.
- Use synthetic data and injected fetch/mocks for callback tests. GET status and
  checkout routes can mutate expiry state and dispatch callbacks, so they are not
  automatically safe production probes.

Report what changed, relevant validation, and unresolved limits. Only perform
deployment, secret changes, callback replay, or remote data writes when the user's
request authorizes them; do not add an approval step for the disposable local tests.
