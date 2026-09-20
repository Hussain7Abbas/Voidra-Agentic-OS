# P02 — Markdown, local storage, and recovery

Implementation status: complete as of 2026-09-20. Architecture decisions are recorded in [ADR 0003](../docs/architecture/0003-markdown-storage-recovery.md), with automated and measured evidence in [the P02 report](../docs/verification/p02.md).

[Plan index](main.md) · Previous: [P01](phase-01-workspaces-settings-instructions.md) · Next: [P03](phase-03-shared-knowledge-graph-memory.md)

## Outcome and prerequisites

Users edit ordinary Markdown files, follow links/backlinks, search locally, and recover from outside edits or mistaken changes. Index loss does not lose notes.

Prerequisites: P01 root identity and scoped file access. Q06 selects source/split preview versus live preview; Q07 sets corpus targets; Q09 selects built-in history/Git; Q10 influences UI direction and voice later. Unicode note paths/content work regardless of interface language.

## Storage and editor design

- Keep Markdown and attachments canonical. Record document identity in base metadata/registry without requiring destructive rewriting of imported notes. Decide managed frontmatter opt-in separately from import.
- Maintain SQLite metadata, full-text search, outgoing links, tags, file revision/hash, and indexing status. Durable revisions and source files are separate from the rebuildable search index.
- Editor works from a document revision. Save compares the current disk revision, writes atomically when safe, and opens a conflict workflow if it changed externally.
- File watchers debounce/coalesce changes and schedule parsing; rescan after watcher overflow, unavailable volume, or crash. Parsing runs off the UI thread.
- Preserve wiki links and ordinary Markdown links, aliases, heading anchors, frontmatter tags, and inline tags according to documented syntax. Broken/ambiguous targets remain visible.
- Rename updates resolved references through a planned multi-file operation with a journal; interrupted updates resume or offer repair. Do not rewrite unrelated text matching the old name.
- Preview sanitizes untrusted HTML and delegates executable HTML artifacts to P08. Link clicks resolve through the workspace/base service, not arbitrary privileged paths.
- For Q06 live preview, retain a canonical Markdown round trip: editing must preserve syntax it does not understand. Add selection/composition/undo tests rather than relying on visual similarity.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P02-01: Edit and preview local notes | 5 | P01 | Saved text matches disk and preview; restart restores document; unsaved changes are not discarded by external edits |
| P02-02: Resolve links and backlinks | 5 | P02-01 | A→B shows the correct backlink; duplicate names disambiguate; rename updates only resolved references |
| P02-03: Index and search the corpus | 5 | P02-01 | Keyword/tag queries return current documents; index rebuild preserves content and converges after external changes |
| P02-04: Recover revisions and conflicts | 5 | P02-01, Q09 | User can inspect/restore a revision and choose a conflict result without silently overwriting either version |
| P02-05: Meet selected editing/scale behavior | 5 | P02-01/03, Q06/Q07 | Chosen editor mode round-trips supported documents and remains usable at the selected corpus target |

Build file explorer, tab state, save status, split preview, link picker, backlinks panel, search results, and revision/conflict UI. Git support, if selected, must define uncommitted changes and conflicts; never auto-reset the user's repository. Local revision history remains distinct from a filesystem backup.

## Unit and integration tests

- Parsing fixtures cover links in code blocks, escaped brackets, aliases, headings, duplicate titles, nested tags, frontmatter, Unicode, and malformed Markdown.
- Save conflict tests race editor writes with external writes using real temp files; verify both versions are recoverable.
- File-operation validation rejects traversal and symlink escapes. Atomic-save failure preserves original bytes.
- Rename journal tests interrupt between file updates and verify repair doesn't produce duplicate or unrelated substitutions.
- Real index tests cover deletion, reappearance, moved files, watcher overflow/rescan, and rebuild equivalence to source content.
- History retention removes eligible revisions without deleting current notes or active conflict snapshots.

## Playwright E2E

1. Create, edit, preview, and reopen a note; verify file bytes and rendered link behavior after relaunch.
2. Link two notes, rename the target, navigate from source and backlinks, then inspect persisted references.
3. Edit a note in-app, change it externally, save, and resolve the conflict; neither input disappears silently.
4. Restore a previous revision, restart, and confirm both restored current content and later revision remain available as designed.
5. Delete the disposable index and reopen; search repopulates while files/history are unchanged.
6. Load the selected corpus fixture, type/search/navigate, and collect latency and memory measurements under recorded hardware conditions.

## Performance and recovery

Proposed initial measurements: first usable shell, note-open latency, keystroke responsiveness, indexed search latency, full rescan time, and process memory. Set numeric budgets after Q07 and a P00 baseline; do not declare an unmeasured 100k-note graph or editor supported.

Expose indexing progress/failure without blocking ordinary editing. Detached volumes become unavailable, not deleted corpora. Avoid loading every note body into React state.

## Exit criteria

Editor mode matches Q06; notes and links survive restart; outside edits and interrupted operations are recoverable; full-text/tag index is rebuildable; unit and Electron E2E scenarios pass against real files.
