# ADR 0005: Local manual handoffs and explicit clipboard control

- Status: accepted for P04
- Date: 2026-09-20
- Prerequisites: ADR 0002 workspace context, ADR 0003 Markdown storage, ADR 0004 scoped knowledge
- Inputs: P04 and the confirmed Claude/Codex subscription-handoff requirement

## Decision

Voidra models reusable skills, routines, and manual runs as workspace-owned local records. Skill instructions are immutable version files under `skills/<skill-id>/vN.md`; their mutable registry points at the latest version. A routine pins the skill version that existed when the routine was created or duplicated. A run stores another complete skill snapshot, selected source revisions, target paths, destination client/model preference, exact prompt, trigger, timestamps, and result linkage.

Claude and Codex are manual destinations, not API transports. Prompt compilation calls no inference, embedding, client-login, or model-selection interface. The user-maintained preferred-model string is guidance shown in the prompt; the user still selects the model in the destination client.

## Prompt assembly

Compilation starts from one originating workspace and resolves:

1. the routine's pinned skill version and inline instructions;
2. the workspace's effective persona;
3. root-to-target `AGENTS.md` rules for explicitly selected existing targets;
4. active workspace memory selected by the local deterministic matcher; and
5. only the explicitly selected private or currently attached shared notes.

The resulting prompt labels rules separately from quoted source material and records a source/revision manifest. Selected shared notes are reauthorized when read, so a detached base fails closed. Common credential references, bearer tokens, API-key-shaped tokens, and PEM private keys are replaced locally. A 200,000-character ceiling rejects oversized assemblies rather than silently dropping applicable rules or selected context.

This redaction is defense in depth, not a general secret scanner. Users must still review the exact editable prompt before copying it.

## State and clipboard boundary

Runs use `ready-to-copy`, `awaiting-result`, `result-under-review`, `completed`, and `cancelled`; persisted schemas retain `draft` for future authoring workflows. Compilation produces `ready-to-copy`. Only an explicit renderer action invokes the narrow trusted clipboard IPC method and then records `awaiting-result`. A successful clipboard write is not external execution and cannot transition directly to completion.

A scheduled manual trigger only compiles and persists a `ready-to-copy` run. The service has no clipboard dependency, subscription-client adapter, or automatic fallback to OpenRouter. Therefore a background/manual schedule cannot overwrite the clipboard, submit a prompt, or claim completion.

Production clipboard writes use Electron's native clipboard in the main process. E2E mode substitutes an in-memory clipboard reachable only through test-only diagnostics, so parallel/repeatable tests do not modify the developer's real clipboard.

## Returned results and local writes

The user pastes the external result and proposes one relative output path beneath the routine's granted output directory. Voidra snapshots the current bytes and revision before showing a before/after preview. Apply revalidates the output root and canonical parent, rejects traversal and symlink escapes, and compares the current revision with the preview. It then uses an atomic write. The run retains its source manifest, result text, preview, and applied output path.

Completion is a user assertion after result review. It is not independent proof that the subscription client performed every claimed effect.

## Consequences

- P05 may add automatic OpenRouter execution, but it must be a separate explicit execution path and cannot reinterpret a manual run as authorization.
- P07 may schedule manual routines by calling the preparation operation and notifying the user; it must retain the no-clipboard/no-submission rule.
- Routine duplication preserves its pinned skill version. Creating a new routine after a skill edit opts into the new version.
- Registries use atomic JSON replacement. Corrupt metadata fails visibly as incompatible schema rather than being reset.
- The current result importer supports reviewed text-to-file output. Rich attachment import and diff viewers can extend this boundary without bypassing canonical-path and revision checks.
