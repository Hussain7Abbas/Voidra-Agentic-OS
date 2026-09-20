# V2-07 — Whole-product redesign

[V2 index](main.md) · Previous: [V2-06](phase-06-design-system-reset.md) · Next: [V2-08](phase-08-knowledge-globe-artifact-ring.md)

Status: **planned; no page migration has been performed by this plan update**.

## Outcome

Redesign every current page under the V2 canvas so the user never falls back into the old sidebar/top-bar/card application. Preserve domain behavior and workspace boundaries while replacing presentation, navigation, state feedback, transitions, and responsive behavior with the reference-derived system.

## Page migration map

| Current route | V2 composition | Primary reference pattern | Must preserve |
| --- | --- | --- | --- |
| Today `/` | Bilateral rails around the Markdown globe and artifact orbit | Full Agentic OS dashboard | Workspace switch, live summaries, Stop All, planner access |
| Assistant `/assistant/` | Run stream/work queue with a compact context rail and review inspector | Dense telemetry/routine panels | Streaming, cancellation, approvals, source provenance |
| Notes `/notes/` | Markdown editor/preview as a focused canvas with graph/lineage context | Second-brain preview flow | Autosave/revisions, links, tags, private/shared boundaries |
| Graph `/graph/` | Full-screen knowledge globe/list with search, filters, and inspectors | Visual second brain | Real graph queries, bounded expansion, textual edge reasons |
| Browser `/browser/` | Browser/artifact workbench using squared panes and review/status strip | Micro-app and artifact surfaces | Session isolation, ordinary vs agent control, safe preview |
| Mac `/mac/` | Capability console with explicit grants, state, and audit rows | Dense operational panel | Native permission truth, review, no hidden actions |
| Jobs `/jobs/` | Skills deck, routines board, run/artifact history | Skills/routines modules | Plan the Day, schedules, execution mode, headless/manual distinctions |
| Remote `/remote/` | Awake-Mac gateway status and request audit | Compact system-status module | Awake-only boundary, TLS/network truth, no offline queue claims |
| Settings `/settings/` | Searchable settings plane with scoped sections and permission states | In-canvas utility surface | Global/workspace precedence, MCP/app configuration, destructive review |

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-07-01: Replace the shared shell | 8 | V2-06 | Given any current route, when it renders, then it uses the V2 canvas/command strip/transition contract and mounts no legacy sidebar or top bar |
| V2-07-02: Rebuild Today composition | 8 | V2-07-01; V2-05 view models | Given real/empty/stale data, when Today loads, then bilateral rails and the center region match the approved reference composition without invented metrics |
| V2-07-03: Redesign knowledge work | 8 | V2-07-01 | Given Notes and Graph workflows, when editing/searching/focusing/returning, then state continuity, provenance, keyboard use, and private/shared scope remain explicit |
| V2-07-04: Redesign execution work | 8 | V2-07-01; V2-02/03 contracts | Given Assistant and Jobs workflows, when runs stream or wait for review, then provider/mode/risk/source/cancel/artifact state is dense but unambiguous |
| V2-07-05: Redesign connected surfaces | 8 | V2-07-01; V2-04 contracts | Given Browser and Mac workflows, when sessions/capabilities/actions change, then isolation, grants, stale state, and review are visible in the new grammar |
| V2-07-06: Redesign operations/settings | 8 | V2-07-01 | Given Remote and Settings, when users inspect or change configuration, then global/workspace scope, awake-only limits, auth state, and destructive effects are explicit |
| V2-07-07: Add route transition/state restoration | 5 | V2-07-02–06 | Given dashboard-to-detail-to-dashboard journeys, when users return, then focus, filter, selection, scroll/camera, and workspace state restore without leaking stale data |
| V2-07-08: Remove legacy presentation dependencies | 5 | V2-07-02–07 | Given the migration ledger, when the final route moves, then no reachable V2 UI imports legacy shell/card/theme selectors and feature-flag rollback still preserves canonical data |
| V2-07-09: Pass visual/accessibility regression matrix | 5 | V2-07-02–08 | Given representative fixture states, when screenshot, motion, keyboard, screen-reader, zoom, contrast, and reduced-motion checks run, then every route meets the V2-06 rubric |

V2-07-01–09 are Must. The work may be sliced by route, but a route is not Done until its legacy presentation dependency is removed.

## Migration order

1. Shared shell, command palette, workspace controls, Stop All, and transition container.
2. Today static composition using current service/view-model data.
3. Jobs and Assistant because they establish run/review patterns used elsewhere.
4. Notes and Graph because they establish editor/inspector/graph transitions.
5. Browser and Mac because they exercise isolation and capability messaging.
6. Remote and Settings because they exercise configuration density and global/workspace scope.
7. Legacy CSS/component removal only after route-level parity and rollback fixtures exist.

V2-08 may replace Today's temporary center implementation after the shell/rails are stable. V2-07 must therefore expose a `KnowledgeGlobeSlot` contract rather than coupling the shell to placeholder nodes.

## Interaction rules

- Global navigation opens from the command strip or `⌘K`; destinations, entity search, and commands are visually distinct.
- Compact icon controls always have labels/tooltips and keyboard focus; icon-only glyphs are never the sole discoverability path.
- Rail modules can focus/expand into deep pages. Return restores the exact originating module and data selection.
- Loading uses retained stale state plus freshness labels where safe. Private state is cleared before workspace replacement.
- Empty states keep the same structural footprint as populated modules but never invent counts, email, calendar, runs, or artifacts.
- Privileged actions always enter the canonical review/permission surface; dense UI is not permission to skip review.

## Verification plan

### Unit/integration

- Navigation/command results, route-return contexts, workspace-switch cancellation, and deep-link restoration.
- Per-page view models for loading, empty, stale, offline, auth-required, active, failed, blocked, and partial states.
- Legacy token/selector import lint and raw color/radius/motion policy checks.
- Focus-management and reduced-motion state transitions.

### Playwright Electron

1. Complete one representative workflow on each of the nine current routes using only the keyboard.
2. Traverse Today → node/artifact/skill/routine → deep page → back and verify exact context restoration.
3. Switch workspaces during each page's longest request and confirm no old data or action survives.
4. Capture desktop, narrow, 200% zoom, empty, offline, active, failed, and permission-required states.
5. Compare motion captures for dashboard reveal, page expansion, inspector, review, and return under normal/reduced motion.
6. Assert no permanent `.sidebar`, V1 `.topbar`, or legacy theme surface is reachable in V2 mode.

## Exit criteria

- Every current route uses the new system and no permanent sidebar.
- All existing domain actions and safeguards remain available.
- Route transitions preserve context and never cross workspace boundaries.
- Required screenshot/motion/accessibility states meet V2-06 acceptance.
- Legacy presentation code is removed or isolated behind the explicit V1 rollback flag with no shared default path.
- The center slot is ready for the real V2-08 knowledge globe, not a decorative approximation.
