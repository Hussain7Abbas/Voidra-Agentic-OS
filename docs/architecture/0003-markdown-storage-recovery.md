# ADR 0003: Canonical Markdown, indexing, and recovery

- Status: accepted for P02
- Date: 2026-09-20
- Prerequisite: ADR 0002 and workspace-owned canonical roots
- Inputs: P02 and provisional defaults Q06, Q07, Q09, and Q10

## Decision

Voidra stores private workspace notes as ordinary UTF-8 Markdown files below `knowledge/`. Source files and durable recovery data are authoritative; the SQLite search/link index is disposable and can be rebuilt. The initial editor offers source, split, and preview modes using CodeMirror, with explicit save and a revision-aware conflict workflow.

The provisional P02 choices are source plus split preview, built-in local revisions, and a measured 10,000-note corpus. They remain implementation assumptions rather than recorded answers to the open refinement questions.

## Workspace-owned storage

| Path | Role |
| --- | --- |
| `knowledge/**/*.md` | Canonical user-authored notes |
| `.voidra/documents.json` | Durable document IDs, paths, creation timestamps, and tombstones |
| `.voidra/history.json` | Durable revision metadata |
| `.voidra/revisions/<document-id>/*.md` | Recoverable prior file bytes |
| `.voidra/rename-journal.json` | Temporary resumable multi-file rename operation |
| `.voidra/index.sqlite` plus WAL files | Rebuildable full-text, tag, link, and backlink index |

Imported files receive registry identities without frontmatter rewriting. An in-app rename retains identity and updates only references already resolved to that document. An external move currently appears as deletion plus a newly imported document identity; content remains intact, and the limitation is visible in the P02 verification boundary.

## Index and link semantics

The index stores content hashes, modified times, extracted titles, tags, outgoing links, resolution status, and FTS5 text. Parsing supports wiki links, aliases, heading anchors, relative Markdown links, inline tags, frontmatter tags, Unicode, and exclusions for code and escaped syntax. Duplicate names remain ambiguous unless a path identifies exactly one note. Missing targets remain broken rather than being guessed.

Initial and explicit rebuilds scan canonical files. Normal reads/searches query the current index; a recursive, debounced workspace watcher coalesces external Markdown changes and schedules a forced rescan. Watcher rescans and renderer operations share a per-workspace queue so index and rename-journal mutations cannot interleave. If the index is deleted, the next list/rebuild recreates it from Markdown and durable metadata.

Full rescan writes and link-resolution updates are batched in SQLite transactions. Link resolution uses path, ID, title, and stem maps rather than a document scan per edge. The explorer retains summary metadata in renderer state but renders at most 250 rows until search narrows the corpus; it never loads every note body into React state.

## Save, history, and conflict behavior

An opened document carries a SHA-256 revision. Save compares that revision with current disk bytes. A match records the previous content and atomically replaces the file. A mismatch leaves the file untouched, records both disk and editor snapshots, and offers disk, editor, or user-edited merge resolution. Atomic-write failure removes the temporary file and preserves the original.

History retains the newest 100 non-conflict revisions for each document. Conflict snapshots are excluded from automatic pruning so neither side of a detected race silently disappears. Restore records the current content before replacing it with the selected revision.

Rename first records all exact replacements and their original hashes in a journal. Each source update is atomic and marked complete before the target moves and the registry path changes. Startup/rescan resumes an interrupted journal. If a source changed to bytes other than the original or intended replacement, repair stops and preserves the journal for recovery.

## Renderer trust boundary

The renderer receives validated note operations through the existing preload contract and never receives an arbitrary filesystem API. Note paths are workspace-relative `.md` paths; absolute paths, traversal, and symlink escapes are rejected by the service. Preview converts Markdown then sanitizes HTML, forbidding scripts and embedded active content. Executable HTML remains P08 scope.

## Consequences

- P03 can build a scoped graph from explicit link/tag records without making the graph authoritative storage.
- Workspace backup must include Markdown, the document registry, history metadata, and revision files; the SQLite index may be omitted.
- A watcher is a convergence mechanism, not the only recovery path; explicit rebuild remains available after overflow, crash, or manual index deletion.
- The measured 10,000-note result is a baseline on one Mac, not a universal latency budget or a claim of 100,000-note support.
