# P03 — Shared knowledge, graph, and memory

Implementation status: complete as of 2026-09-20. Architecture decisions are recorded in [ADR 0004](../docs/architecture/0004-shared-knowledge-graph-memory.md), with automated and measured evidence in [the P03 report](../docs/verification/p03.md).

[Plan index](main.md) · Previous: [P02](phase-02-markdown-storage-history.md) · Next: [P04](phase-04-skills-routines-manual-handoffs.md)

## Outcome and prerequisites

Work and Personal each see private knowledge and explicitly attached shared bases. Graph/search reflect exactly that accessible set. The assistant's memory is inspectable and workspace-specific.

Prerequisites: P02 identity/parser/index/revisions. Q07 determines scale, Q08 default attachment access, and Q09 recovery backend. Semantic similarity is an optional retrieval enhancement, not a replacement for explicit links or tag highlights.

## Shared-base ownership and data

- Distinguish Base (physical source/identity), Attachment (workspace/base/access), Document (base/document identity), and Retrieval Result (origin/revision/quote).
- One source directory can be attached to several workspaces without copying its Markdown. A registry resolves its canonical location; metadata must not require writing to a read-only external source.
- Initialize app-owned bases with stable metadata. Imported read-only folders can use application-owned registration metadata; moving between machines may require explicit reattachment if that metadata is absent.
- Each base has a serialized write/index owner in the local runtime; simultaneous workspace edits use revision checks from P02. Multiple unrelated application instances cannot independently overwrite shared state; use ownership/locking and fail visibly.
- Access applies at retrieval/read/write time, not only in the sidebar. Index results are filtered before selection and content extraction. Recheck on each tool operation.
- Detach invalidates graph/search/cached context and stops future reads. Existing quoted conversation text is retained as history unless explicitly removed; start a fresh model context rather than replaying revoked material.
- Cross-base links name the base explicitly; a duplicate filename never silently switches to a different base. Inaccessible targets appear unavailable without revealing private content.

## Graph and memory behavior

Graph nodes identify notes and optionally tags; note-to-note edges represent explicit links. Selecting a tag highlights matching notes and the defined relevant existing edges, with a separate filter-only mode. Color/labels indicate source base. Local graph has bounded depth; global workspace graph spans accessible bases.

Provide an accessible list/result view alongside a visual graph so graph behavior is testable without relying on force-layout coordinates. Defer large layouts to a worker and use viewport/level-of-detail limits as scale requires.

Memory records include workspace owner, text, source/provenance, created/updated timestamps, and optional expiry. Editing/deleting a memory changes later retrieval. Knowledge sharing never implicitly shares personal memory. Present inferred memories distinctly from user-confirmed preferences; define capture preference in workspace settings.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P03-01: Attach a shared base | 5 | P02, Q08 | Work/Personal attach the same physical base, see updates, and retain independent read/write grants |
| P03-02: Enforce shared/private access | 8 | P03-01 | Private sentinels cannot appear in another workspace search, graph, export, or tool result; detach stops future retrieval |
| P03-03: Navigate graph and tag highlights | 5 | P03-01/02 | Node opens correct note; duplicate names retain identity; tag highlighting/filtering agrees with accessible search results |
| P03-04: Inspect/edit workspace memory | 5 | P02, P03-02 | User changes or deletes a memory and subsequent context reflects that; Work/Personal personas and memories remain separate |
| P03-05: Recover shared-source/index changes | 5 | P03-01/02 | Concurrent edits conflict safely; unavailable/moved bases recover without duplicate attachments or data loss |

## Unit and integration tests

- Full visibility matrix: Work-private, Personal-private, shared read-only, shared writable, detached, unavailable, and revoked during retrieval.
- Verify query filtering and content extraction both honor attachment grants; an ID copied from another workspace is insufficient.
- Graph edge construction, duplicate-name disambiguation, tag normalization, local depth, and highlight sets are deterministic data tests.
- Real file races verify serialization and revision conflicts across two workspace sessions.
- Memory expiry/deletion/provenance and prompt-context selection exclude private/expired/revoked items.
- Cross-base links remain stable through location changes and fail closed when access disappears.

## Playwright E2E

1. Attach Learning to Work and Personal; create a note in the writable attachment and observe the update in both without copied source files.
2. Attempt editing through the read-only workspace; assert editor and agent-tool fixture reject the write.
3. Search/tag/graph the same title across three bases; open each result and inspect correct source labels.
4. Detach Learning from Work while a delayed retrieval is pending; no new result from it enters Work's context, while Personal retains access.
5. Edit/delete a Work memory, switch to Personal, then reopen Work; verify persistence and separation.
6. Rename/move/unmount a shared directory and reconnect; verify graph/search recover and content remains intact.

## Exit criteria

All access-matrix cases pass at UI and service boundaries. Graph behavior agrees with query results and handles the selected scale. Shared storage is referenced once, private memory remains private, and context revocation behavior is documented rather than implying historical data can be un-sent to providers.
