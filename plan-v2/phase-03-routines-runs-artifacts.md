# V2-03 — Routines, runs, and artifact lineage

[V2 index](main.md) · Previous: [V2-02](phase-02-headless-claude-codex.md) · Next: [V2-04](phase-04-apps-microapps.md)

## Outcome

Make headless providers useful as repeatable local routines. Skills can be launched from a deck or awake-only schedule with explicit provider/model/effort/access/limits. Every run has one observable timeline and produces cataloged reports, files, or HTML artifacts with provenance back to its skill and inputs.

## Routine V2 contract

A routine version records:

- Workspace and skill snapshot policy (`pinned` or reviewed `latest`).
- Execution mode: manual Claude/Codex, OpenRouter, Claude headless, Codex headless, or local deterministic action.
- Provider model/effort only when applicable and supported.
- Context-pack query, router roots, required/optional inputs, and output declarations.
- Risk profile, exact grants, runtime/turn/output limits, concurrency class, and retry policy.
- Manual trigger and optional awake-only schedule with timezone/missed-run policy.
- Artifact naming/tags/retention and success schema.

Editing a routine creates a new version. Claimed occurrences and active runs retain their original snapshot.

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-03-01: Migrate routine execution modes | 5 | V2-01/V2-02 | Given V1 manual/OpenRouter routines, when migration runs, then their behavior is unchanged and new headless modes remain unselected |
| V2-03-02: Launch a skills-deck run | 5 | V2-02 | Given a pinned skill and compatible provider, when the user reviews model/effort/access/context and presses Run, then one owned run is queued with that immutable snapshot |
| V2-03-03: Dispatch awake-only headless schedules | 8 | V1 P07, V2-03-01 | Given due, missed, duplicate, sleeping, quit, or unavailable-provider occurrences, when scheduler recovery runs, then each occurrence follows its explicit policy and is never double-submitted |
| V2-03-04: Govern resources and concurrency | 5 | V2-02 broker | Given multiple workspaces and CPU/memory/output pressure, when runs queue, then configured device/workspace limits, fair ordering, pause/cancel, and Stop All are enforced |
| V2-03-05: Unify run timelines | 5 | V2-02 events | Given any execution mode, when a run progresses, then preparation, provider events, tool/writeback review, artifacts, usage, cancellation, and final state appear in one ordered journal |
| V2-03-06: Catalog artifacts and reports | 8 | V1 P02/P08, V2-03-05 | Given text, Markdown, image, PDF, HTML bundle, directory, or unknown output, when registered, then safe metadata, digest, lineage, preview policy, tags, and owning workspace persist |
| V2-03-07: Search and reuse outputs | 5 | V2-03-06 | Given prior artifacts, when users filter by project/tag/type/date/skill/provider/run text, then authorized matches open or can be selected as a new run input without implicit execution |
| V2-03-08: Upgrade Plan the Day | 5 | V2-03-01/03 | Given local/manual/OpenRouter/Claude/Codex modes, when Plan the Day runs, then it uses the same sourced plan contract and never modifies a calendar without separate reviewed connector action |

## Resource governor

Initial policy:

- Device-wide headless concurrency defaults to one; the user may increase it after seeing measured resource cost.
- GUI/Mac automation retains its separate single-device lease and cannot overlap an incompatible headless action.
- Each run has wall-clock, idle, output-byte, artifact-byte, and process-count caps. Provider-supported turn/budget caps are additional, not substitutes.
- Queue priority: current explicit user action, due trusted routine, due reviewed routine, background index/preview work. Starvation prevention is required.
- Resource pressure may pause queue admission, not silently kill canonical writeback. A killed process becomes interrupted or uncertain and still requires cleanup/review.

## Artifact catalog

The catalog stores metadata and a pointer to canonical workspace output or retained run output; it does not duplicate large content by default.

Required fields: artifact ID, workspace ID, run ID, routine/skill version, provider/executable version, path or retained object, content type, byte size, digest, title, tags, created/updated time, preview state, source context digest, parent artifact IDs, and retention state.

Artifact code is untrusted. HTML continues through the isolated V1 preview. PDFs/images use safe viewers. Unknown/binary types never execute. Deleting a catalog entry does not silently delete the source file; deleting the source is a separate reviewed operation.

## Retry and resume rules

- Automatic retry is allowed only before a provider accepts the run or for operations proven idempotent by the adapter.
- A timeout after a possible external effect is `outcome-uncertain`, not failed-and-safe-to-repeat.
- Resume is provider/session-specific and disabled by default. Enabling it requires the same workspace, executable identity, context access, run owner, and current grants.
- A changed skill/router/source creates a new run; it does not mutate or continue the old run invisibly.

## Unit and integration tests

- Migrate V1 routines/schedules and compare dispatch snapshots byte-for-byte for retained modes.
- Fake clocks cover time zones, DST gaps/duplicates, long sleep, quit/restart, disabled schedules, and duplicate ticks for both headless providers.
- Queue tests cover fairness, pressure, provider unavailability, workspace close, grant revocation, and Stop All.
- Artifact sniffing ignores misleading extensions, checks traversal/symlinks, handles duplicate digests, unavailable files, revisions, and malicious HTML.
- Search and selection enforce workspace/shared-base authorization and never index redacted journals as ordinary user knowledge.

## Playwright Electron

1. Pin four copies of a skill to manual, OpenRouter fixture, Claude fixture, and Codex fixture; launch each and inspect the unified timeline.
2. Schedule Claude and Codex fixture routines at the same time; verify queue order, no duplicate occurrence, and correct workspace after switching the visible workspace.
3. Exercise skip, run-once, and review missed policies through service restart.
4. Produce Markdown, image, HTML bundle, and unknown binary artifacts; verify safe previews and metadata.
5. Search the artifact catalog, open lineage, select an artifact as a new skill input, and verify the original remains immutable.
6. Stop All while one run is active and others are queued; all resulting states and descendant cleanup are visible.

## Exit criteria

- V1 routines retain their behavior after migration.
- Headless occurrences are awake-only, deduplicated, and recover correctly.
- Queue/resource policy prevents invisible concurrent load and retains explicit ownership.
- Every completed run has a final report or a documented reason it produced none.
- Artifacts are searchable, source-linked, safely previewed, and workspace-scoped.
