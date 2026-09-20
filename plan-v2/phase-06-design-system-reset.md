# V2-06 — Design-system reset

[V2 index](main.md) · Previous: [V2-05](phase-05-command-center.md) · Next: [V2-07](phase-07-product-redesign.md)

Status: **planned; do not implement until this phase is accepted**.

## Outcome

Turn the reference research into a binding, testable visual language and a replacement application shell. This phase deliberately abandons the old Voidra sidebar/card styling and treats the current Today UI as a service-contract prototype. It must establish the rules and primitives that every host page and generated artifact will use before page-by-page redesign begins.

## Requirements

- Use [`research-video-ui.md`](research-video-ui.md) as the evidence record and [`design-system.md`](design-system.md) as the normative contract.
- Reproduce the reference's edge-to-edge black canvas, narrow bilateral rails, dominant radial center, orange status line, hairline geometry, compact telemetry typography, and restrained motion grammar.
- Use original Voidra identity, icons, wording, data, and assets. Do not copy RUBRIC/source branding or source code.
- Remove the permanent sidebar and inherited V1 top bar from the V2 shell. Navigation must remain discoverable through compact in-canvas controls and the command palette.
- Preserve atomic workspace switching, Stop All, privacy/freshness visibility, keyboard access, zoom, and reduced motion.
- Version design tokens and the component API so host pages and component artifacts can pin compatibility.

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-06-01: Lock the reference frame matrix | 3 | Research document | Given the cited video/screenshot, when dashboard, graph, skills, routines, artifact, and app moments are cataloged, then direct observations, approximate geometry, transition order, and unknowns are recorded without presenting inference as fact |
| V2-06-02: Define semantic tokens | 5 | V2-06-01 | Given color, type, spacing, line, depth, icon, status, and motion roles, when tokens are reviewed in all required states, then contrast, zoom, reduced motion, and original-identity requirements pass without legacy blue/mint fallbacks |
| V2-06-03: Specify the no-sidebar shell | 5 | V2-06-02 | Given every supported window size, when the shell is composed, then workspace/search/run/privacy/Stop All/navigation remain discoverable without a permanent sidebar or V1 top bar |
| V2-06-04: Define shared primitives | 8 | V2-06-02/03 | Given command-center and deep-page needs, when primitive APIs are reviewed, then rails, modules, rows, graph surfaces, inspectors, review sheets, permission prompts, and state surfaces cover host and artifact usage without page-private variants |
| V2-06-05: Specify motion and route continuity | 5 | V2-06-01/03 | Given load, graph focus, search, artifact arrival, route change, workspace switch, review, and Stop All, when motion storyboards are evaluated, then every animation explains hierarchy/state and has a reduced-motion/focus equivalent |
| V2-06-06: Build the visual acceptance harness plan | 3 | V2-06-02–05 | Given deterministic fixture states and target viewports, when the harness is specified, then screenshot, motion, accessibility, and token-usage checks have named inputs, tolerances, owners, and failure evidence |
| V2-06-07: Audit and deprecate legacy styles | 3 | V2-06-02–04 | Given existing selectors/components/routes, when audited, then every legacy token/shell/card dependency has a replacement, migration owner, and removal checkpoint; no silent compatibility layer becomes permanent |

All stories are Must except V2-06-06 automation polish, which is Should after its required manual acceptance matrix exists.

## Deliverables

- Versioned host token schema and a separately consumable artifact-token facade.
- Component inventory with props, states, focus behavior, density rules, and allowed composition.
- Desktop, narrow, 200%-zoom, and reduced-motion shell specifications.
- Reference frame matrix and Voidra wireframes for default, dense, empty, offline, active-run, and permission-required states.
- Route transition/state restoration map.
- Legacy selector/component deprecation ledger.
- Visual review rubric using the score and non-negotiable gates in `research-video-ui.md`.

## Shell behavior

```text
top-edge status rule
  -> compact identity/workspace controls
  -> context-sensitive command strip
  -> route content on one continuous canvas
  -> command palette for global destinations/actions
  -> transient inspector/review layers, never a persistent sidebar
```

- Today opens the three-field command center: left rail, center globe, right rail.
- Deep pages reuse the canvas and command strip. A page may use a contextual rail or split view, but not the former global navigation sidebar.
- A route transition stores a typed return context: source route, focused entity, selected tab/filter, scroll/camera state, and workspace ID.
- Switching workspace clears the prior render before new private data is mounted; there is no cross-workspace crossfade.
- Stop All is always reachable in one keyboard command and at most one pointer action from any V2 route.

## Verification plan

### Unit/static

- Token schema rejects undefined roles, raw legacy colors, invalid motion values, and host-only tokens in the artifact facade.
- Primitive state matrices cover default/hover/focus/active/disabled/loading/stale/error/permission/blocked.
- Route-return context is workspace-bound and rejects stale entity IDs.
- Reduced-motion mapping eliminates ambient/camera/stagger motion without eliminating focus or state change.

### Playwright Electron

1. Navigate every route without a permanent sidebar and reach every destination by keyboard and pointer.
2. Switch workspaces during an open inspector and transition; verify the old workspace never flashes.
3. Exercise default, narrow, 200% zoom, high contrast, and reduced motion.
4. Compare deterministic screenshot states against the approved wireframes and reference rubric.
5. Verify Stop All, privacy, stale data, and permission prompts remain recognizable without color alone.

## Exit criteria

- The design-system and reference-research documents are accepted as binding.
- No unresolved primitive or navigation gap blocks any current route.
- The no-sidebar shell works on paper/prototype for desktop, narrow, zoomed, keyboard, and reduced-motion use.
- Host and artifact token/component facades have an explicit versioning contract.
- Every legacy visual dependency has a planned replacement and removal phase.
- V2-07 can redesign pages without inventing new global tokens or navigation patterns.
