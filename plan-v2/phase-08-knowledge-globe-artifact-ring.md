# V2-08 — Markdown knowledge globe and artifact ring

[V2 index](main.md) · Previous: [V2-07](phase-07-product-redesign.md) · Next: [V2-09](phase-09-nextjs-artifact-runtime.md)

Status: **planned**. The current constellation is a visual prototype and is not accepted as this phase's graph.

## Outcome

Build the dashboard's central object as a real, searchable visualization of workspace Markdown relationships, with reviewed artifacts arranged in a surrounding orbit. The globe must resemble the reference's dense radial second brain while remaining explainable, bounded, accessible, workspace-isolated, and fast at the selected corpus scale.

## Binding semantic model

```text
workspace root router
  ├─ explicit Markdown/router/tag/skill/reference links
  │    └─ inner knowledge cloud
  ├─ routine/run lineage
  │    └─ approved artifact versions on outer orbit
  └─ explicit shared-knowledge attachments
       └─ visibly scoped external nodes; never silently merged
```

### Node types

| Type | Placement | Stable identity | Notes |
| --- | --- | --- | --- |
| Root router | Core | workspace + canonical path + revision | `AGENTS.md` is canonical; sibling `CLAUDE.md` compatibility pointer is shown as paired metadata, not duplicate knowledge |
| Router/department Markdown | Inner core | workspace + path + revision | High structural weight; direct routing relationships |
| Note/reference Markdown | Inner cloud | workspace + path + revision | Explicit links/tags plus optional inferred similarity |
| Skill instruction/reference | Inner cloud | skill/version + file identity | Links to producing runs and consumed references |
| Explicit shared-base file | Bounded satellite cluster | shared base + grant + path + revision | Distinct scope treatment and revocation behavior |
| Artifact version | Outer orbit | artifact ID + immutable digest | Only approved versions appear normally; lineage points inward |
| Quarantined/blocked artifact | Inspector/list only by default | artifact ID + digest | Never presented as a normal usable orbit item |

### Edge types

- `markdown-link` and `wiki-link` from parsed source.
- `routes-to` from validated router declarations.
- `uses-reference` and `belongs-to-skill` from skill bundles.
- `tagged-with` only when the tag relationship is useful at the active zoom/filter.
- `shared-through` for explicit shared-base grants.
- `input-to`, `generated-by`, `produced`, `derived-from`, `supersedes`, and `reviewed-as` for run/artifact lineage.
- `similar-to` only as an opt-in inferred edge with score/model/version and a dashed visual treatment.

Every edge has a plain-language reason, source record, revision, and scope. An unexplained edge is a defect.

## Visual model

- Use a 2.5D/WebGL or canvas projection that reads as a globe without requiring true spatial meaning from depth.
- The selected root or node remains near the center. Explicit neighbors form a dense bounded cloud; second-order nodes fade toward the surface.
- Artifacts occupy one or more outer rings, clustered by lineage/project/type while maintaining stable placement between sessions for the same graph revision.
- A restrained ambient rotation provides the reference's living-system character. Pointer targets and labels remain usable; reduced motion freezes it.
- Zoom level controls detail: silhouette/counts → category clusters → named nodes → edge reasons/metadata.
- New approved artifacts receive one bounded pulse and join the ring only after the catalog/review event commits.
- Search dims nonmatches rather than removing context abruptly. Focus animates the selected node toward center and opens an inspector.

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-08-01: Define graph projection contract | 5 | V2-01 graph; V2-06 | Given canonical entities/edges, when projected, then stable IDs, edge reasons, revisions, scopes, and list-view representations are preserved independently of renderer layout |
| V2-08-02: Index Markdown relationships | 8 | V2-08-01 | Given root/scoped instructions, notes, links, tags, skills, references, and shared attachments, when indexed incrementally, then cycles, broken links, revocation, rename, and revision changes produce deterministic graph updates |
| V2-08-03: Join artifact lineage | 5 | V2-03 catalog; V2-08-01 | Given runs and artifact versions, when approved/quarantined/superseded states change, then only eligible versions enter the orbit and every item traces to producer and inputs |
| V2-08-04: Render the progressive globe | 8 | V2-08-01–03 | Given up to the selected corpus scale, when the dashboard loads/pans/zooms/focuses, then bounded level-of-detail rendering matches the reference silhouette without creating a node-per-DOM-element bottleneck |
| V2-08-05: Implement search, focus, and preview | 8 | V2-08-04 | Given a query or node selection, when users navigate results/relationships, then camera, dimming, inspector, preview, and return context remain stable and keyboard accessible |
| V2-08-06: Implement the artifact orbit | 5 | V2-08-03/04 | Given approved artifacts, when grouped/filtered/updated, then orbit placement is deterministic, searchable, visually connected to source lineage, and synchronized with catalog/list queries |
| V2-08-07: Build the accessible equivalent | 5 | V2-08-01–03 | Given the same query, when list/tree mode is used, then nodes, filters, edge reasons, lineage, review state, and actions are equivalent without canvas interaction |
| V2-08-08: Meet isolation/performance budgets | 5 | V2-08-02–07; V2-Q06 | Given 60,000 files, 10,000 artifacts, dense/cyclic graphs, rapid workspace switching, and revoked shares, when measured, then renderer/query budgets pass and no stale/private node flashes or remains actionable |

All stories are Must.

## Query and render boundaries

- The service returns a bounded graph page: center ID, selected filters, nodes, edges, continuation tokens, aggregate counts, and graph revision.
- The renderer never receives the entire 60,000-file corpus by default.
- Expansion is explicit by hop, cluster, search result, or lineage. Repeated requests carry the workspace ID and expected graph revision.
- Layout coordinates are a cache derived from canonical records, never canonical knowledge.
- The cache key includes workspace, graph revision, filter set, viewport class, and layout algorithm version.
- A stale response is discarded if workspace, query token, selection, or graph revision no longer matches.
- Artifact visibility requires current catalog eligibility at query and open time; a cached ring item cannot bypass revocation/quarantine.

## Interaction specification

| Input | Result |
| --- | --- |
| Hover/focus node | Show concise name/type/scope; emphasize direct explainable edges |
| Select node | Center/focus, dim unrelated context, open inspector, update URL/return state |
| Select edge | Explain relationship type, source location, revision, and whether explicit/inferred |
| Type search | Rank stable records, step through matches, retain surrounding context |
| Scroll/pinch | Bounded zoom with level-of-detail changes; never accidental route navigation |
| Drag background | Rotate/pan within limits; keyboard buttons offer equivalent movement |
| Activate artifact | Open review-aware artifact detail; revalidate status and grants |
| Escape/back | Close inspector or restore prior focus/camera/filter in deterministic order |

## Data honesty and privacy

- Node size uses a documented bounded relationship metric; it never claims importance, quality, safety, or truth.
- Inferred similarity is off by default for security-sensitive views and never looks like an explicit link.
- Private workspace graphs, layout caches, searches, and previews remain separate.
- Shared-base nodes show the base identity and current grant. Revocation removes them and invalidates layouts/query pages.
- Hidden/quarantined artifacts may contribute aggregate audit counts only in security views; normal orbit counts cannot imply usability.
- Search snippets and previews revalidate access and source revision before display.

## Verification plan

### Unit/integration

- Markdown/wiki/router/skill/reference parsing, broken targets, cycles, rename/delete, and incremental revision updates.
- Explicit versus inferred edge provenance and textual explanations.
- Shared-base attach/revoke and cross-workspace denial.
- Artifact approval/quarantine/supersede transitions and deterministic orbit grouping.
- Graph paging, continuation invalidation, layout cache keys, stale-response cancellation, and stable placement.
- Accessible list/tree equivalence against the same query fixtures.

### Playwright Electron

1. Load a reference-shaped fixture and verify root, inner Markdown cloud, explicit edges, and artifact orbit.
2. Search a Markdown file, focus it, follow lineage to a reviewed artifact, open it, and return to the same camera/selection.
3. Toggle inferred edges and confirm visual/textual distinction.
4. Revoke a shared base and quarantine an artifact during an open graph; verify immediate removal/disabled action with no stale preview.
5. Repeat the complete journey using keyboard-only list/tree mode and reduced motion.
6. Switch workspaces during graph expansion/search and verify no stale node, label, count, or action flashes.
7. Measure the 60,000-file/10,000-artifact fixture without sending all records to the renderer.

## Exit criteria

- The central dashboard object is a real Markdown graph, not a decorative constellation.
- Approved artifacts visibly surround knowledge and retain auditable inward lineage.
- Search, focus, preview, and route return match the V2 motion/transition rules.
- Every visible relation is explainable and every canvas journey has a list/tree equivalent.
- Quarantine, revocation, workspace switching, and stale response tests pass.
- The selected scale budgets pass with progressive queries and bounded renderer load.
