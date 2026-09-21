# V2-01 — Skill bundles and router memory

[V2 index](main.md) · Previous: [V2-00](phase-00-baseline-contracts-migration.md) · Next: [V2-02](phase-02-headless-claude-codex.md)

Status (2026-09-21): **automated implementation complete**. Bundle migration/snapshots, portable import/export, reference/asset/script/test resources, inert executable risk labels, deterministic fixture validation, router draft/review/apply, bounded context manifests, typed ARMS graph enrichment, and a 60,000-file bounded-query gate are implemented.

## Outcome

Implement the bottom two ARMS layers: rich skill bundles and agent-oriented memory routing. Existing skills migrate without losing version pinning. Users can preview exactly which routers, rules, memories, notes, and bundle resources form a run's bounded context pack. The second-brain graph expands beyond notes while preserving source and workspace boundaries.

## Canonical skill bundle

```text
skills/<user-visible-slug>/
  SKILL.md                 # instructions and portable metadata
  references/              # Markdown, text, schemas, examples
  assets/                  # images/templates used as input
  scripts/                 # inert until separately reviewed and granted
  tests/                   # optional skill fixtures/expected shapes
.voidra/skill-versions/
  <skill-id>/<digest>/...  # immutable snapshots used by runs
```

Rules:

- `SKILL.md` is the entry point; referenced files must resolve within the bundle unless they are explicit workspace/shared-base references captured in the run manifest.
- Editable working files and immutable run snapshots are separate. A routine may track latest or pin a digest.
- Import never executes scripts, installs dependencies, follows external symlinks, or overwrites an existing bundle silently.
- A script declares runtime, arguments, input/output paths, network need, and risk. Approval belongs to the run profile, not prose inside `SKILL.md`.
- Claude/Codex export adapters may generate provider-compatible views, but Voidra's canonical bundle must not depend on one vendor's private storage.

## Router model

Routers are ordinary reviewable Markdown plus derived metadata. A root router links domains; domain routers link relevant notes, skills, routines, applications, and child routers. Generation is suggestion-based:

- Never rewrite `AGENTS.md`, `CLAUDE.md`, an existing router, or a note without preview and explicit apply.
- Preserve human sections byte-for-byte. Generated sections use stable markers and refuse to update if those markers are damaged.
- A router is navigation/context, not permission. It cannot attach a shared base, grant a tool, or expose another workspace.
- Every generated link stores a stable document/entity ID in derived metadata so file renames can update it safely.

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-01-01: Migrate V1 skills to bundles | 5 | V2-00 schema | Given pinned V1 skills/routines, when migration runs, then editable bundles and immutable snapshots preserve IDs, versions, instructions, and routine behavior |
| V2-01-02: Validate/import/export bundles | 5 | V2-01-01 | Given valid, conflicting, oversized, traversing, symlinked, and malformed bundles, when import/export runs, then valid data round-trips and unsafe data is rejected without execution |
| V2-01-03: Edit rich skill resources | 5 | V2-01-02 | Given a bundle, when a user adds references/assets/scripts and saves a version, then the UI shows type, size, digest, link target, and executable-risk status |
| V2-01-04: Test skills before pinning | 5 | V2-01-03 | Given a skill fixture and expected output schema, when validation runs, then no external model is required and failures identify the exact missing input/reference/shape |
| V2-01-05: Create router suggestions | 5 | V1 P02/P03 | Given an indexed workspace, when the user requests routers, then Voidra proposes root/domain files with sources and applies only reviewed changes |
| V2-01-06: Compile bounded context packs | 8 | V2-01-03/05 | Given a target, skill, attached bases, and token/byte budget, when compilation runs, then every included/excluded item has a reason and no inaccessible source appears |
| V2-01-07: Build the unified ARMS graph | 8 | V2-01-01/05 | Given notes, routers, skills, routines, apps, and artifacts, when graph data is queried, then typed nodes/edges retain source, access, freshness, and lineage labels |
| V2-01-08: Scale discovery and graph queries | 5 | V2-01-07 | Given 60,000 synthetic files, when indexing/searching/expanding the graph, then the UI streams bounded pages and never creates a 60,000-node DOM/SVG |

## Context-pack contract

A context pack contains:

- Workspace/run identity and effective persona/settings.
- Root-to-target `AGENTS.md` rules and validated sibling `CLAUDE.md` pointers.
- Exact skill snapshot and selected bundle resources.
- Router traversal path with cycle detection and maximum depth.
- Explicitly selected note/shared-base excerpts with base, document, revision, and access.
- Relevant confirmed/inferred memories with provenance and expiry.
- Target/output paths, completion criteria, and execution risk profile.
- Byte/token estimate, omitted candidates, redaction warnings, and a digest of the complete manifest.

Provider prompts are generated from the same canonical pack so manual, OpenRouter, Claude, and Codex runs can be compared. Provider-specific wrappers may differ, but source selection must not.

## Unified graph

Node types: workspace, router, note, tag, memory, skill, routine, app/connector, artifact, and run. Secret/account values are never nodes.

Edge types include: links-to, routes-to, contains, references, uses-skill, scheduled-by, invokes-provider, connects-to, produced, derived-from, and supersedes. Each edge must be explainable from a file, registry record, or run manifest; inferred similarity edges are opt-in and visibly different.

Use server-side filtering, incremental neighborhood expansion, cached layout coordinates, level of detail, and a virtualized result list. Do not send the entire graph to the renderer by default.

## Unit and integration tests

- V1-to-bundle migration, immutable digest stability, routine pinning, rename, duplicate, and conflict cases.
- Frontmatter/schema limits, Unicode, broken links, cycles, deep routers, duplicate slugs, and external symlink rejection.
- Script resources remain inert during list, preview, import, export, indexing, and context compilation.
- Context budgets are deterministic and disclose truncation. Revoked/detached/changed sources fail closed.
- Cross-workspace sentinel notes, memories, skills, routines, and artifacts never appear in search, context, or graph.
- Generate 60,000 files with controlled graph density; record cold index, incremental update, search, neighborhood expansion, and memory use without inventing universal performance claims.

## Playwright Electron

1. Migrate a V1 skill and routine, add a reference and image, save a new version, and prove the existing routine remains pinned.
2. Import a malicious bundle containing traversal and an executable script; verify rejection or inert quarantine and no process spawn.
3. Generate router suggestions, edit them, apply, rename a linked note, and verify graph/context updates without rewriting human text.
4. Preview a context pack, remove a shared-base grant, run preview again, and verify the source disappears with a revocation diagnostic.
5. Explore the unified graph from router to skill to run to artifact by mouse and keyboard/list alternative.
6. Load the 60,000-file fixture and verify progressive results and UI responsiveness with measured evidence.

## Exit criteria

- Every V1 skill/routine has a lossless, rollback-safe representation.
- Rich resources are versioned and never executed by inspection/import.
- Router writes are always previewed and preserve user-authored content.
- Context packs are deterministic, bounded, source-labeled, and workspace-scoped.
- The unified graph supports ARMS relationships and the 60,000-file fixture without an unbounded renderer payload.
