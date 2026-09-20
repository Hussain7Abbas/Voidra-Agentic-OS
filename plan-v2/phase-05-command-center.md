# V2-05 — Visual command center

[V2 index](main.md) · Previous: [V2-04](phase-04-apps-microapps.md) · Next: [V2-06](phase-06-design-system-reset.md)

Implementation status (2026-09-20): **prototype slice implemented; phase incomplete and visual direction superseded**. The initial Today route proved workspace-safe V1 data composition, refresh cancellation, honest empty states, and a full-window route without the V1 shell. It does not meet the newly approved fidelity bar and must not become the basis for polishing the old design. V2-06 defines the replacement design system, V2-07 migrates all current pages, and V2-08 replaces the approximate constellation with the real Markdown knowledge globe and artifact ring. Preserve useful service/view-model work; freely replace its markup, CSS, layout, and motion.

## Outcome

Deliver the video/screenshot-inspired Voidra home: a polished per-workspace command center that makes skills, memory, routines, applications, artifacts, and active runs understandable and actionable from one screen. The UI composes existing service contracts; it does not implement a second permission or execution system in React.

## Layout

Desktop default:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ workspace · command/search · privacy/freshness · runs · Stop All    │
├────────────────┬───────────────────────────────────┬─────────────────┤
│ micro apps     │                                   │ attention inbox │
│ calendar/time  │       central constellation       │ skills deck     │
│ creator metric │  routers/notes/skills/runs/apps   │ routine board   │
│ quick links    │                                   │ resources       │
├────────────────┴───────────────────────────────────┴─────────────────┤
│ artifact ring / recent outputs / active-run inspector               │
└──────────────────────────────────────────────────────────────────────┘
```

Narrow windows use a one-column ordered dashboard with the same information and controls. Users can switch to a full accessible list/table mode at any width.

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-05-01: Build command-center shell | 8 | V2-03/V2-04 contracts | Given any workspace/window size, when the home loads, then identity, search, privacy/freshness, active runs, Stop All, and responsive regions are usable without leaking another workspace's state |
| V2-05-02: Add widget layout editing | 8 | V2-05-01 | Given move/resize/add/remove/reset actions, when a layout is saved, then constraints, keyboard operations, versioning, per-workspace persistence, and preset restore are deterministic |
| V2-05-03: Implement skills deck | 5 | V2-03 | Given pinned skills, when provider/model/effort/access/context is selected, then capability-invalid combinations are unavailable and Run opens exact review before dispatch |
| V2-05-04: Implement routine board | 5 | V2-03 | Given schedules/runs, when displayed, then next fire, mode, workspace, state, queue position, last output, and required attention remain current and actionable |
| V2-05-05: Implement artifact ring | 5 | V2-03 catalog | Given many outputs, when users search/filter/navigate, then recent/project clusters remain understandable and every item opens safe preview plus lineage |
| V2-05-06: Implement central constellation | 8 | V2-01 graph | Given typed ARMS entities, when users focus/search/expand/filter, then only bounded neighborhoods render and every relation has a textual explanation |
| V2-05-07: Add command palette and global search | 5 | V2-01/03/04 | Given notes, skills, routines, apps, artifacts, and commands, when searched, then results show type/scope/source and privileged commands still require their normal review |
| V2-05-08: Meet accessibility and theming contract | 5 | V2-00 design contract | Given keyboard, screen reader, reduced motion, high contrast, zoom, and light/dark settings, when the dashboard is used, then no required action depends on drag, hover, animation, or color alone |

## Widget rules

- A widget definition declares minimum/maximum grid span, data source, empty/error/loading states, refresh policy, and accessible summary.
- Layout stores widget IDs and presentation preferences, never provider secrets or raw application payloads.
- Dragging is an enhancement. Move/resize controls and keyboard shortcuts provide equivalent behavior.
- Refresh is visibility-aware and rate-limited. Hidden/minimized widgets do not continue aggressive polling.
- Stale or unavailable data remains visibly labeled; the dashboard never makes old data look current.
- A widget action invokes the canonical service capability and grant flow. A dashboard button cannot bypass review because it is “quick.”

## Central constellation

The constellation begins with a workspace or selected entity and expands one bounded neighborhood at a time. Visual encoding:

- Shape/icon identifies entity type.
- Color identifies user-selected grouping, not security state alone.
- Solid edge represents explicit links/usage/lineage; dashed edge represents opt-in inferred similarity.
- Badge shows freshness, access, active/failed run, or unavailable source.
- Side inspector explains the entity, source path/registry, relationships, last update, and allowed actions.

The artifact ring may be a radial view, but it is backed by the same catalog query as the list view. Do not build a separate, inconsistent artifact store for the visual.

## Interaction details

- Opening the command center restores the last stable layout for the selected workspace, not the last visible workspace globally.
- Switching workspaces swaps the complete layout/data subscription atomically and cancels stale renderer requests; it never reassigns active runs.
- Run cards stream normalized events without rendering raw provider HTML/ANSI.
- Stop All is device-wide, visually distinct, and confirms scope when effects are pending; it does not erase journals.
- Search and command results use stable IDs and revalidate access when opened.
- The current V1 routes remain accessible only during migration. V2-07 redesigns them under the same no-sidebar system; the command center does not eliminate full editors/settings, but those destinations must no longer fall back to the old visual shell at release.

## Unit and integration tests

- Layout constraint solver, collision resolution, migration, reset, version conflict, and workspace isolation.
- Widget refresh scheduling, stale request cancellation, cache invalidation, rate-limit backoff, and unmount cleanup.
- Command-palette authorization and stable-ID resolution after rename/delete/revocation.
- Graph query pagination, saved views, entity filters, and textual edge explanations.
- Deterministic view models for empty, loading, stale, auth-required, offline, partial, failed, and active states.

## Playwright Electron

1. Start with default layout, rearrange/resize by pointer and keyboard, restart, and verify Work/Personal layouts remain independent.
2. Pin and launch a Claude fixture skill, inspect events, cancel it, then run a Codex fixture skill that produces a reviewed artifact.
3. Create schedules in two time zones; verify the routine board and attention state through fake-clock progression/restart.
4. Search for a router, expand to a skill/run/artifact/app, and repeat the journey in list mode.
5. Exercise artifact ring filters and open Markdown/image/HTML/unknown outputs through the correct preview boundary.
6. Disconnect/revoke widget applications and verify stale/auth-required/removed states.
7. Run keyboard-only, reduced-motion, 200% zoom, and automated accessibility scans on representative states.
8. Switch workspaces rapidly during streaming/search/widget refresh and verify no stale private data flashes in the new context.

## Visual acceptance

Capture deterministic screenshots for default, dense, empty, offline, active-run, and narrow layouts. Compare them against the frame matrix in [`research-video-ui.md`](research-video-ui.md) and the rules in [`design-system.md`](design-system.md). Acceptance uses measured composition, density, hierarchy, motion, interaction, and accessibility while retaining Voidra's own identity and original assets.

## Exit criteria

- All ARMS layers are visible and usable from one per-workspace home.
- Layout editing persists safely and has full non-drag equivalents.
- Skills and routines launch only after canonical execution review.
- Graph and artifact visuals are bounded and match their accessible/query views.
- Rapid workspace switching produces no cross-workspace flash or stale action.
- V1 deep routes remain functional behind the new home.
