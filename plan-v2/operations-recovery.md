# Voidra V2 operations and recovery

[V2 index](main.md) · [Release evidence](implementation-evidence.md)

This runbook preserves canonical workspace data. Do not delete a workspace, `.voidra` directory, profile database, immutable artifact snapshots, or vendor credential files as a troubleshooting shortcut.

## Installation and startup

- Development: `pnpm install --frozen-lockfile`, then `pnpm start`.
- Automated release candidate: `make v2-release`.
- Current package: `release/mac-arm64/Voidra.app`, Apple Silicon, unsigned and unnotarized. It is a local development candidate, not a general distribution build.
- Voidra runs scheduled work only while the app and Mac are awake. Missed occurrences follow the schedule's explicit skip/run-once/review policy.

## Workspace and migration recovery

- Profile schema upgrades run SQLite integrity preflight, create a mode-0600 pre-migration snapshot for existing databases, and apply the migration chain in one transaction.
- If a workspace directory moved, use Locate folder. Identity/settings remain registered; Voidra does not create an empty replacement.
- Use workspace export/restore to a new empty destination. Restore never overwrites an existing tree.
- If a newer unsupported schema is detected, stop and open it with the newer compatible build. Downgrade conversion is not attempted.
- V2 feature flags may disable skills, headless, catalog, applications, command center, or component artifacts. Flags stop access/dispatch but retain underlying data.

## CLI changes, authentication, and stuck runs

- Claude Code and Codex authentication belongs to each vendor CLI. Voidra does not read or back up their credential stores.
- Binary path, real path, version, or fingerprint change requires fresh review before inference.
- A logged-out/expired CLI should be authenticated in a user-controlled terminal using vendor guidance, then rediscovered.
- Cancel from the owned run or use Stop All. Voidra terminates the process group and records cancelled/interrupted/uncertain state; never assume a provider accepted or rejected an effect without journal evidence.
- On restart, previously active child processes lose authorization and are marked interrupted. Review staged diffs before applying anything.
- Staged roots are disposable. Canonical bytes change only through reviewed writeback with current source revisions.

## Layout, router, and index recovery

- Reset the command-center preset from its keyboard-accessible layout editor if a saved layout is unusable. Layouts are workspace-specific.
- Corrupt layout metadata fails to the preset; it must not affect canonical notes.
- Router suggestions remain drafts until reviewed and applied. A stale source revision requires regeneration/review.
- Markdown files are authoritative. The local index can be rebuilt; renderer queries stay bounded even for the 60,000-file accepted scale.

## Artifact/reviewer incident

- Quarantined/blocked artifacts cannot enter normal preview or receive capabilities.
- A reviewer timeout, crash, malformed output, missing file, digest mismatch, invalid/expired signature, or unavailable semantic-review provider fails closed. Fix the condition and submit the exact version again.
- Editing one source byte invalidates review and grants. Rollback restores an immutable snapshot into quarantine and also requires a new review.
- Revoke grants from the host review UI. Revocation blocks the next broker call; staged writes still require separate apply/reject review.
- Preserve `.voidra/artifact-review-journal.jsonl` and `.voidra/artifact-versions/` during incident analysis. Signed decision-chain tampering prevents preview.
- Legacy HTML conversion produces a separate component. The original remains isolated/read-only and is never overwritten automatically.

## MCP/connector recovery

- Remote bearer tokens stay in secure host storage, not workspace JSON or artifacts.
- Auth expiry, server fingerprint drift, or tool/resource schema drift suspends affected calls/grants. Refresh/reconnect, inspect the new identity/schema pin, and re-grant explicitly.
- A timed-out effectful call may be uncertain. Inspect the canonical MCP action journal before retrying; do not duplicate an external commitment blindly.
- Disable or remove a connection to stop new calls. Removing a connection does not rewrite prior audit records.

## Release evidence boundaries

Automated fixtures prove local contracts, containment checks, migration behavior, and UI journeys. They do not prove subscription eligibility, real inference, OAuth provider behavior, physical sleep/wake, Notification Center delivery, microphone/headset quality, signed native helper consent, phone/LAN/TLS behavior, Developer ID signing, notarization, or update distribution. Those rows remain explicitly Pending until run with the required account, hardware, consent, and signing identity.
