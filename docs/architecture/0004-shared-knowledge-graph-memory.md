# ADR 0004: Shared-base grants, accessible graph, and workspace memory

- Status: accepted for P03
- Date: 2026-09-20
- Prerequisite: ADR 0003 canonical Markdown and revision-aware writes
- Inputs: P03 and provisional defaults Q07 and Q08

## Decision

Voidra distinguishes a physical knowledge base from a workspace attachment. A base has one application-owned UUID, name, and canonical directory reference. An attachment binds one workspace to that base with an independent `read` or `write` grant. The default is read-only; write access must be explicit.

The application-support SQLite database owns base identities and attachments. Imported shared directories are not modified with persistent registration metadata, so read-only sources remain attachable. A moved base is unavailable until Locate reconnects its existing identity. Paths alone never authorize access.

## Access and revocation

Every list, search, read, graph, create, save, and delayed-retrieval operation resolves the originating workspace and rechecks its current attachment. Results are filtered before return. A copied base/document ID is insufficient without a live attachment. Detach prevents later reads and removes that base from any delayed result before it enters new context; it does not pretend previously displayed or externally sent text can be erased.

Shared-base directories cannot overlap any private workspace root. This prevents attaching another workspace's private knowledge, memory, settings, or instructions as a shared source. Unavailable bases fail closed without exposing cached private content.

Writable operations use both a per-runtime queue and a short-lived `.voidra-write.lock` in the shared source. The lock contains an owner token and process ID. A live owner causes a retryable busy error; a demonstrably dead process lock is reclaimed. Revision hashes then detect stale editors, so serialization does not silently turn an old write into a last-writer-wins overwrite.

## Search and graph

Private notes continue to use the P02 SQLite index. Attached shared Markdown is scanned from its canonical source for each current read/search/graph operation, ensuring direct external updates are visible without copying files or storing metadata in a read-only base. This is intentionally simple; a future application-owned shared index may cache parsed records while retaining the same access checks and source authority.

Graph nodes use composite base/document identity, never title alone. Links resolve inside their source base by path and then by a unique title/stem. Cross-base wiki links require `Base Name::path/to/note`; an inaccessible or ambiguous target produces no guessed edge. Link edges, shared tags, and future inferred similarity remain distinct.

The service returns deterministic nodes/edges and bounded local-depth neighborhoods. Tag mode marks matching notes; filter-only mode retains only matches and existing edges whose endpoints remain visible. The renderer provides an accessible result list beside an SVG overview, renders at most 120 visual nodes and 250 list rows, and keeps source/access labels visible.

## Memory

Each workspace stores inspectable records in `memory/memories.json`. A record contains text, provenance, confirmed/inferred state, timestamps, and optional expiry. Active context selection excludes expired/deleted records and filters only within the requesting workspace. Edits and deletion are atomic and affect subsequent context selection.

Memory is never attached with a knowledge base. Work and Personal can attach the same shared source while retaining separate personas and memory files.

## Consequences

- P04 prompt compilation can consume only current accessible search results and active workspace memory, with provenance.
- P05 tool execution must recheck grants at action time, as P03 does; UI visibility alone is not authorization.
- Shared-source updates are immediately reflected but repeated large-base scans have a cost. P03 records a 10,000-file measurement and does not claim 100,000-note support.
- Multiple application profiles writing the same shared directory coordinate through the physical lock; read-only access never needs to create that lock.
