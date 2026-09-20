# ADR 0013: Verified workspace snapshots and explicit release evidence

- Status: accepted for P12 automated implementation
- Date: 2026-09-20
- Prerequisites: P00–P11 durable workspace ownership and packaging
- Inputs: P12 and provisional Apple Silicon/personal-build defaults for Q02/Q03

## Decision

Voidra exports a workspace as a timestamped `.voidra-backup` directory. The bundle contains `manifest.json` and a `workspace/` snapshot. Every regular file has a byte count, mode, and SHA-256 digest. Export copies to a hidden staging directory and renames the completed bundle into place. Restore validates the entire manifest and every payload digest before it creates the destination workspace.

Canonical workspace files and durable `.voidra` state are included. Rebuildable SQLite indexes, transient rename journals, temporary files, and symbolic links are omitted and named with a reason in the manifest. Search indexes are rebuilt lazily after restore. The snapshot retains workspace identity, personas, scoped rules, histories, routines, schedules, task journals, browser artifact metadata, and other workspace-owned durable files.

Credentials are not exported. The manifest records only that credentials were excluded and the provider names that need reauthorization; it never contains credential references or secret values. Account credential references remain host-owned. A restored workspace begins with no account-reference rows.

## Shared knowledge

Shared knowledge sources are not copied into every workspace backup. The manifest stores each base identity, path, access grant, timestamps, and availability at export exactly once. Restore reconnects a compatible identity/path pair. If the source is missing, the attachment remains present and visibly unavailable so the user can locate it later. Identity/path collisions are reported rather than silently remapped.

## Recovery safety

Export and restore preflight available bytes. Restore requires a new destination folder and never overwrites an existing tree. A failed copy removes only its private staging directory. A failure after the final filesystem rename leaves the verified files at the reported destination for manual recovery; it does not delete the source backup. Backups from a newer database schema are rejected before registration. Incompatible downgrade conversion is not attempted.

The application-profile database follows a separate upgrade boundary. Before upgrading any existing supported schema, Voidra runs SQLite `quick_check` and creates a mode-`0600` snapshot beside `foundation.sqlite` named `foundation.sqlite.pre-migration-v<from>-to-v<current>-<uuid>.sqlite`. The snapshot is created by SQLite itself so committed WAL content is included. All required schema steps then run in one outer transaction: either the complete chain and final `user_version` commit, or the original database remains unchanged. A failed integrity preflight or migration aborts service startup and retains the pre-migration snapshot for recovery. New empty databases do not need a pre-migration snapshot, and newer unsupported schemas are rejected without mutation.

## Release evidence

The selected release artifact is an unsigned Apple Silicon directory build. Next.js uses the application version as its deterministic build ID unless `VOIDRA_BUILD_ID` is explicitly supplied. `scripts/release-manifest.mjs` inventories the built `.app`, hashes every file and symlink deterministically, verifies that the main executable is arm64, and records app/schema versions, the lockfile digest, toolchain inputs, total bytes, and a tree digest. `SOURCE_DATE_EPOCH` pins the manifest timestamp for repeatable evidence generation. Two consecutive builds with identical source, lockfile, toolchain, and pinned epoch must produce the same tree digest.

Production and test runtime modes are now explicit. Electron assigns the service child either `production` or `test`; inherited `VOIDRA_E2E` or remote-fixture flags cannot enable the plaintext loopback companion, wake fixture, schedule clock injection, or post-effect delay in a packaged production runtime. Production remote access remains disabled without TLS certificate and key material.

## Consequences

- A directory bundle is inspectable and recoverable with ordinary filesystem tools, but is not compressed or encrypted. Users must protect the destination because workspace content may itself be sensitive.
- User-authored files can contain secrets; Voidra does not rewrite or heuristically redact canonical content. The guarantee is that application credentials and credential references are excluded.
- Symlinks are listed but not restored because following or recreating them could escape the workspace or change meaning on another machine.
- Successful upgrades retain their pre-migration application-profile snapshot deliberately; release operators remove it only after the upgraded profile has been accepted and a separate profile backup exists.
- Signing, notarization, update identity, Intel builds, physical permissions, real microphones, sleep/wake, and phone/TLS/LAN behavior remain real-system acceptance work.
