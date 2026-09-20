# Voidra V2 design system — binding rules

[V2 index](main.md) · Research basis: [Video UI research](research-video-ui.md)

Status: **planned, not implemented**. These rules become binding for V2-06 onward. They intentionally retire the old sidebar, blue/mint application chrome, soft card dashboard, and decorative constellation. Exceptions require a written decision in `plan-v2/main.md`; individual pages and generated artifacts may not invent parallel visual systems.

## Principles

1. **One operational canvas.** The application is edge-to-edge, workspace-first, and free of a permanent sidebar.
2. **Center the second brain.** The dashboard's dominant object is the real Markdown relationship globe and artifact orbit, not a hero message or generic activity feed.
3. **Dense, not cramped.** Use compact labels, hairlines, and stable alignment to show more state without sacrificing minimum targets, zoom, or hierarchy.
4. **Data before decoration.** A dot, edge, count, pulse, or status must represent a real record or event.
5. **Motion explains continuity.** Animation reveals hierarchy, focus, lineage, and state changes; it is never a screensaver.
6. **One system for host and artifacts.** Generated components consume the same versioned tokens, primitives, states, and motion contracts.
7. **Permission is visible.** Privileged actions and artifact capabilities look and behave consistently across every surface.
8. **Original identity.** Reproduce the reference's design grammar, not its name, logos, copy, icons, assets, or source code.

## Canvas and navigation

- The root canvas fills the Electron content area. No V2 route mounts the V1 sidebar or V1 top bar.
- A 1 px orange status rule occupies the top edge and may encode safe, active, attention, or offline state through label/icon changes; color alone is insufficient.
- Global controls are compact in-canvas elements: Voidra identity, current workspace, search/command, run indicator, privacy/freshness, and Stop All.
- Primary destination navigation is a command strip/palette plus contextual module launchers. It may temporarily expand, but it never reserves a sidebar column.
- Back, close, workspace switch, and Escape behavior are deterministic. Deep pages return to the prior canvas state, focus, and graph camera.
- Window drag regions and native controls must never overlap interactive content.

## Layout geometry

Desktop command-center proportions are constraints, not hard-coded pixels:

- left rail: 18–23% of usable width;
- center field: 54–64%;
- right rail: 18–23%;
- module gutters: 1 px rules plus 8–12 px internal spacing;
- outer canvas inset: 12–20 px, except the top status rule;
- dashboard modules use square or at most 4 px radii;
- no floating stack of unrelated rounded cards.

At widths below the proven three-column minimum, preserve priority rather than shrinking everything: center globe first, critical status/Stop All second, then rail modules in a deterministic sequence. A compact module switcher replaces simultaneous rails. The accessible list/table mode remains available at every width.

## Color tokens

These planned semantic roles must be implemented as versioned tokens; final hexadecimal values are locked during V2-06 contrast review.

| Token role | Planned value | Use |
| --- | --- | --- |
| `canvas` | `#050505` | Root background |
| `surface-1` | `#090907` | Rail/module surface |
| `surface-2` | `#10100D` | Focused inspector and elevated review |
| `ink` | `#F1E8D6` | Primary text and graph core |
| `ink-muted` | `#918B80` | Metadata and inactive labels |
| `line` | `rgba(241,232,214,.15)` | Default hairlines/edges |
| `line-strong` | `rgba(241,232,214,.32)` | Focused boundaries |
| `accent` | `#FF6A1A` | Selection, live lineage, primary highlight |
| `success` | `#A7C875` | Successful state with icon/text |
| `warning` | `#E8B44E` | Attention state with icon/text |
| `danger` | `#FF5D55` | Destructive/blocked state with icon/text |
| `info` | `#7EA7C8` | Neutral information only; never recreate the old blue theme |

- Accent covers less than 10% of a normal dashboard viewport.
- Gradients are limited to graph depth/occlusion and subtle scrims; no large blue/purple hero gradients or glassmorphism.
- Category colors may differentiate graph node types, but state and permission never depend on hue alone.

## Typography

- Use one bundled/licensed compact grotesk or the established local UI sans for interface text and one monospaced face for paths, timestamps, IDs, and metrics.
- Module labels are uppercase, 0.10–0.18 em letter-spaced, and visually small; they must remain readable at 100% and 200% zoom.
- Default text never drops below 12 CSS px; tertiary telemetry may use 11 px only when it is duplicated in an accessible label.
- Titles stay compact. No marketing-size hero heading displaces operational data.
- Use tabular numerals for timers, counts, dates, and resource metrics.
- Truncation always offers a focusable full-value disclosure; paths preserve meaningful start/end segments.

## Lines, depth, and iconography

- Dividers and module frames are 1 px hairlines; focus indication is at least 2 px and passes contrast requirements.
- Shadows are rare and shallow. Depth comes primarily from luminance, occlusion, and line strength.
- Icons use a single original/openly licensed stroke family, 14–18 px in compact controls, with accessible names where meaning is not repeated in text.
- Do not use emoji as core product icons.
- Status badges are compact squared capsules or counters, not decorative pill collections.

## Component grammar

Every host page and generated artifact uses the same primitives:

- `Canvas`, `Rail`, `Module`, `ModuleHeader`, `Metric`, `DataRow`, `Status`, `IconAction`;
- `CommandStrip`, `SearchField`, `SegmentedFilter`, `Inspector`, `ReviewSheet`;
- `GraphViewport`, `GraphNode`, `GraphEdge`, `ArtifactOrbit`, `LineageList`;
- `DataTable`, `Tree`, `EmptyState`, `ErrorState`, `StaleState`, `Skeleton`;
- `PrimaryAction`, `SecondaryAction`, `DestructiveAction`, `PermissionPrompt`.

Pages may compose these primitives but may not copy/paste private variants. Component artifacts import them from a pinned `@voidra/artifact-ui` facade; they cannot access host internals or global styles.

## Module anatomy

Each module has a stable five-part contract:

1. uppercase label and optional live/stale state;
2. one primary metric or action, if relevant;
3. dense rows with stable alignment;
4. loading, empty, unavailable, error, and permission-required states;
5. a textual accessible summary and last-updated source.

Widgets do not invent fake values to preserve a screenshot. Missing connectors show intentional, reference-shaped empty states.

## Motion tokens

| Token | Duration band | Use |
| --- | ---: | --- |
| `instant` | 0–80 ms | Press/focus feedback |
| `fast` | 120–160 ms | Row/filter state change |
| `base` | 180–240 ms | Module content and inspector entry |
| `focus` | 360–480 ms | Globe focus/camera transition |
| `reveal` | 600–900 ms | First dashboard assembly only |
| `ambient` | 30–90 s | One slow globe drift cycle |

- Standard easing: a quick decelerating curve for entry, symmetric ease for camera movement, linear only for ambient rotation/progress.
- Initial reveal order: top rule → side rails → center core → explicit edges → artifact orbit.
- Stagger is capped at 30–50 ms per group and 240 ms total; large data sets reveal by layer, never node-by-node.
- Hover movement is at most 2 px. Controls do not scale enough to disturb layout.
- No infinite shimmer after loading, no bouncing, no random particle bursts, and no animation that hides queued/failed states.
- `prefers-reduced-motion` removes ambient movement, camera travel, parallax, and stagger while retaining state changes and focus visibility.

## Route and overlay transitions

- Dashboard-to-detail keeps the canvas background and shared command controls; the selected module/node expands into a detail plane while unrelated content dims.
- Detail-to-dashboard restores scroll, keyboard focus, selected graph node, filters, and camera.
- Review and permission surfaces are modal in behavior but visually integrated as compact dark sheets with hairline boundaries.
- Loading never blanks the complete canvas when a prior safe state exists; stale data remains visible and labeled until replacement is validated.
- Workspace switching performs an atomic content swap. Old private content must not crossfade beneath the new workspace.

## Knowledge globe rules

- The visual center is reserved for graph content; side widgets may not cover its interaction zone.
- Markdown nodes occupy the inner sphere/cloud. Reviewed artifacts occupy the outer ring. Skills, routines, and apps appear only when linked by a selected graph filter or lineage path.
- Node radius reflects a documented metric such as relationship count within a bounded range; it never implies quality or trust.
- Explicit and inferred edges are visually different. Security/review state is represented with icon/label and inspector text, not edge color alone.
- Labels use level-of-detail rules. Zoom/focus progressively reveals names; the default view cannot render thousands of overlapping DOM labels.
- The WebGL/canvas view and accessible list/tree consume the same query and stable IDs.

## Artifact-native rules

- An artifact may style only through design tokens, layout primitives, and documented local slots. No reset, global selector, font injection, or host theme override.
- The artifact root inherits canvas/surface/ink/accent/motion/zoom preferences and declares its minimum/ideal size.
- Filesystem, MCP, network, clipboard, notification, and host actions use typed SDK calls and declared capabilities. UI controls must show unavailable/denied/pending states.
- Artifacts cannot impersonate host permission prompts, security verdicts, window chrome, or Stop All.
- Every rendered artifact exposes its name, version, review state, capability status, producer run, and source lineage in the host inspector.

## Forbidden patterns

- Permanent left/right application navigation sidebar.
- Old Voidra blue/mint theme, rounded-card dashboard, oversized hero copy, or generic SaaS settings shell.
- Decorative orb, random graph, invented activity, or unexplained relationship lines.
- Excessive pills, glass panels, glow, drop shadows, gradients, or floating action clutter.
- Hidden hover-only actions, drag-only layout editing, animation-only meaning, or color-only status.
- Per-page token forks, artifact-specific theme engines, arbitrary inline colors, or copied source branding/assets.
- Raw HTML artifact generation as the normal V2 output path.

## Accessibility and quality gates

- WCAG AA contrast for text/controls, visible focus, logical landmarks, screen-reader names, and predictable focus restoration.
- All pointer interactions have keyboard and programmatic equivalents; target sizes satisfy the chosen accessibility baseline even when the visual glyph is compact.
- 200% zoom, narrow window, high contrast, and reduced motion retain every action and state.
- Screenshot states: default, dense, empty, offline, permission-required, active run, failed run, quarantined artifact, narrow, and 200% zoom.
- Motion captures: initial load, graph focus, search, artifact arrival, route enter/return, workspace switch, review prompt, and Stop All.
- No page or artifact is accepted if it uses legacy chrome, violates stable workspace switching, or cannot identify the real record behind visible data.
