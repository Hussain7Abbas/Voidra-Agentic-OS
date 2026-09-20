# P01 — Workspaces, settings, and scoped instructions

Implementation status: complete as of 2026-09-20. Architecture decisions are recorded in [ADR 0002](../docs/architecture/0002-workspace-context.md), with automated evidence in [the P01 report](../docs/verification/p01.md).

[Plan index](main.md) · Previous: [P00](phase-00-foundation-and-test-harness.md) · Next: [P02](phase-02-markdown-storage-history.md)

## Outcome and prerequisites

The user creates Work and Personal in different local directories and switches between independent contexts. Global defaults, workspace overrides, and scoped instructions resolve predictably.

Prerequisite: P00 contracts, desktop dialogs, persistence, and harness. Shared-base access defaults depend on Q08, but attachment behavior is completed in P03. Interface presentation follows Q14.

## Data and ownership design

- Global registry: stable workspace ID, display name, canonical directory reference, default ID, recent state, and schema version. Device preferences remain in application support storage.
- Workspace-owned data: settings overrides, persona, memory/knowledge references, durable job state, local index, conversations, and artifacts. Canonical identity must survive a directory move.
- Detect duplicate physical paths and symlink aliases. Provisionally reject overlapping workspace roots; explicitly attached knowledge directories are handled by base identity, not registered as duplicate workspaces.
- Settings resolve application defaults → global → explicit workspace value. Absence inherits; false and empty collections are deliberate values. Expose effective value, origin, and Reset to Global.
- Apply explicit per-routine execution choices only to that run. Device-wide startup/OS permissions/hardware remain global-only and visibly labeled.
- Prefer full replacement of persona text when overridden; allow copying global persona as an editable starting point.
- Credential adapter keeps secret material outside Markdown/settings. Store opaque references bound to accounts/workspaces. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) is a candidate building block; validate the actual keychain-backed design in the selected build.

## Instruction resolution

Create root AGENTS.md plus CLAUDE.md containing exactly @AGENTS.md. Scoped rules are created only where a subdirectory needs them. Resolve applicable rules root-to-target for every relevant path, not every sibling in the workspace.

Persist rule provenance and scope for future prompt compilation. Detect existing conflicting CLAUDE.md/AGENTS.override.md files without overwriting them. Missing imports, oversized instruction sets, and ambiguous rules are visible problems rather than silent truncation. File content is not an executable permission grant.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P01-01: Create/open/select workspace | 5 | P00 | First launch requests a directory; second workspace uses a different root; selected/default identity survives restart |
| P01-02: Resolve global/workspace settings | 5 | P01-01 | Work override survives global changes; Personal inherits; false/empty overrides and Reset to Global behave correctly |
| P01-03: Create and load scoped instruction pairs | 5 | P01-01 | Root/child pairs exist; each target resolves correct ancestry; sibling rules do not appear; existing files are preserved |
| P01-04: Bind context and account references | 5 | P01-02 | Every command/event retains workspace ID; switching UI cannot redirect an existing operation; settings contain no plaintext secrets |
| P01-05: Recover moved/unavailable workspace | 3 | P01-01 | Locate Folder reconnects original identity; removal from registry does not delete source files; failed initialization leaves no half-registered workspace |

Implement Create/Open flows, workspace switcher, default/ask-on-startup setting, local configuration schema, atomic writes, and recoverable registration. A created root's owned files are documented so later backup/export is possible. Existing directories must be inspected before initialization; unrelated files remain intact.

## Unit and integration tests

- Table-driven inheritance tests cover missing fields, null where supported, explicit false, empty strings/lists, nested objects, version migration, and unknown keys.
- Canonical path tests cover spaces, Unicode, symlink aliases, nested roots, moved folders, and case behavior appropriate to the actual volume.
- Rule resolution tests use root/child/grandchild/sibling fixtures and multiple target files, including a file reached through a rejected escape path.
- Pair validation requires sibling import content and reports orphan instructions; it never rewrites conflicting user content without a chosen resolution.
- Registration transaction failure and crash/reopen leave either a valid registered root or a recoverable unregistered directory.
- Account references resolve within authorized workspace bindings; renderer settings serialization excludes secret values.

## Playwright E2E

1. Fresh launch → choose Work folder → create Personal elsewhere → restart → verify default selection and both roots on disk.
2. Set global voice/model; override only Work model/persona; change global values; inspect both workspaces and reset the override.
3. Create nested rule scope; inspect generated sibling files and resolved-rules UI for child versus sibling content.
4. Begin a fixture request in Work, switch to Personal, and verify its result is still labeled/stored under Work.
5. Move Work folder outside the app between runs; relaunch, choose Locate Folder, and verify identity/history persist.
6. Cancel folder selection, choose a duplicate root, and simulate unwritable storage; no partial workspace is shown as usable.

## Failure and recovery

Use atomic config writes and versioned schemas. Reject incompatible schemas with a useful recovery path. Startup selection must not create a new empty workspace over an unavailable original. A lost keychain entry asks for reconnection and does not erase the account configuration.

## Exit criteria

Two physical workspace roots, effective-settings UI, instruction pairs, and relocation/restart tests pass. Private IDs/account references stay scoped through real IPC. P03 may attach knowledge later, but nothing in P01 automatically shares memory or browser state.
