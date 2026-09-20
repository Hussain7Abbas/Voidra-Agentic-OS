# ADR 0002: Workspace identity, settings, and scoped instructions

- Status: accepted for P01
- Date: 2026-09-20
- Prerequisite: ADR 0001 and the P00 process/storage boundaries

## Decision

Voidra separates global device/application state from workspace-owned state. The application-support SQLite database stores the registry, selected/default workspace IDs, global defaults, startup preference, and opaque account references. Each workspace directory stores a stable manifest and explicit setting overrides under `.voidra/`, plus its persona and instruction files.

A workspace ID is a UUID that survives relocation. Its directory path is a canonical, replaceable reference rather than its identity. All service requests still carry an explicit workspace ID; changing the visible workspace cannot retarget an in-flight operation.

## Workspace-owned files

P01 creates these files without modifying unrelated directory content:

| Path | Ownership and recovery |
| --- | --- |
| `.voidra/workspace.json` | Stable workspace ID, display name, creation time, schema version |
| `.voidra/settings.json` | Versioned explicit overrides only; no credentials |
| `persona.md` | Workspace persona when overridden; otherwise an inheritance notice |
| `AGENTS.md` | Canonical root instructions for a newly initialized workspace |
| `CLAUDE.md` | Exact `@AGENTS.md` compatibility import for a newly initialized workspace |

The `.voidra` directory is staged and renamed into place. Registration happens only after initialization. If registry insertion fails, the initialized directory remains recoverable through Open Existing; it is not shown as registered. Existing `AGENTS.md`, `CLAUDE.md`, `AGENTS.override.md`, and `persona.md` content is preserved and surfaced as an issue instead of being overwritten.

Later phases own knowledge, memory, conversations, jobs, skills, artifacts, revisions, and rebuildable indexes. P01 does not create or share their content prematurely.

## Canonical paths and overlap

Creation, opening, and relocation resolve the physical directory with `realpath`. This collapses symlink aliases and the macOS `/var` to `/private/var` alias. Exact duplicates and ancestor/descendant workspace roots are rejected. Spaces and Unicode names are supported. Case behavior follows the mounted volume because identity is checked against the filesystem's canonical result.

An unavailable directory remains registered with its stable ID. It is never replaced by an empty workspace. Locate Folder accepts only a manifest with the same ID. Removing a registry entry deletes database references only and leaves all source files untouched.

## Settings resolution

Settings resolve independently at each supported leaf:

1. application defaults;
2. explicit global overrides;
3. explicit workspace overrides.

Missing fields inherit. `false`, `null` where supported, an empty string, and an empty list are explicit values. Lists replace rather than merge. The settings API returns both effective values and an origin map so the renderer can label each value. Reset to Global is represented by removing that workspace leaf, not copying the current global value.

The current schema covers execution mode/model/tools, voice enablement/voice reference, appearance, reduced motion, and persona. Device startup/default-workspace preferences are visibly global-only. Routine-specific choices remain future run configuration and do not mutate these defaults.

## Instruction resolution

New scopes are created only in an existing directory inside the workspace and always write an `AGENTS.md` plus a sibling `CLAUDE.md` containing exactly `@AGENTS.md` and a newline. If either file already exists, neither is overwritten.

Resolution canonicalizes each target, rejects missing targets and path/symlink escapes, then loads only the root-to-target directory ancestry. Sibling rules cannot leak into the result. Each rule keeps its path and relative scope for future prompt compilation. Missing imports, orphan imports, conflicting Claude content, `AGENTS.override.md`, and instruction sets above 128 KB are explicit issues; content is never silently truncated.

Instruction text does not grant tools, accounts, shared knowledge, or operating-system permissions.

## Account references

P01 stores only opaque `keychain://…` references bound to a workspace and provider. The renderer-facing list returns account ID, provider, and connection state without serializing the credential reference. Actual secret capture and keychain lifecycle belong to the provider/integration phase; plaintext secrets are not accepted in the settings schemas or workspace files.

## Consequences

- P02 can rely on stable workspace ownership and canonical roots for Markdown, revisions, and indexes.
- P03 can attach shared bases without treating a path as an access grant.
- Background tasks can retain their originating workspace even while the visible selection changes.
- Global and workspace configuration migrations must remain non-destructive and versioned.
- Ask-on-startup changes only initial UI selection. It does not merge or reassign context.
