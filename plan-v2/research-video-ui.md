# V2 design research — RoboNuggets Agentic OS reference

[V2 index](main.md) · Governing rules: [Design system](design-system.md)

Status: planning evidence recorded on 2026-09-20. This document separates what is directly supported by the supplied screenshot/video transcript from what Voidra proposes to build. It is not implementation evidence.

## Sources

- Primary reference: [“The NEW Agentic OS standard for Claude 5 Models is here (Full Breakdown)”](https://www.youtube.com/watch?v=8NSyI-npJCU), Jay E / RoboNuggets.
- Textual verification: [full transcript](https://www.usetranscribe.io/yt/8NSyI-npJCU/agentic-os-claude-5).
- Timestamped summary and frame index: [Modern Creator ARMS breakdown](https://moderncreator.app/2026-08-21-jay-e-robonuggets-the-arms-framework-a-4-part-agentic-os-for-claude-code).
- User-supplied visual reference: [`image-1.png`](/Users/hussainabbas/.codex/attachments/c44789c6-394c-4ad4-babc-6e210209eba7/image-1.png).
- Platform constraints: Next.js [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components), Electron [Security](https://www.electronjs.org/docs/latest/tutorial/security), and MCP Apps [Authorization](https://apps.extensions.modelcontextprotocol.io/api/documents/authorization.html).

## Evidence confidence

| Classification | Meaning |
| --- | --- |
| Direct | Visible in the supplied screenshot or stated in the transcript at the cited segment |
| Strong inference | Supported by multiple reference frames/summary statements, but exact implementation details are not shown |
| Voidra proposal | A deliberate product/design decision required to make the idea usable, accessible, secure, or original |

No source code, token values, proprietary assets, or exact easing curves from the reference are available. “Clone” therefore means high-fidelity reproduction of composition, density, hierarchy, navigation behavior, and motion character—not copying its name, logos, content, icons, source code, or private assets.

## Timeline and product anatomy

| Video segment | Direct signal | Voidra translation |
| --- | --- | --- |
| 00:43–03:54, My Agentic OS | One dashboard presents micro apps, calendar/time zones, email attention, creator metrics, routines, skills, an artifact ring, and a central second brain | One edge-to-edge command canvas; left and right information rails surround a dominant knowledge globe |
| 03:54–05:09, Framework | The visual dashboard is the surface over an ARMS system | UI must reflect real Applications, Routines, Memory, and Skills records; no fabricated dashboard data |
| 05:09–10:35, Skills | Skills are richer than a single prompt and may include references, brand guidance, scripts, and headless triggers | Skill bundle and router work remains foundational; the skills deck is a compact launcher into canonical run review |
| 10:35–14:34, Memory | Root `CLAUDE.md` routes toward department files, skills, and references; the visual second brain makes connections searchable and previewable | Voidra uses canonical `AGENTS.md` plus sibling `CLAUDE.md` pointers, indexes Markdown relationships, and exposes search/focus/preview in the globe |
| 14:34–18:33, Routines | Scheduled prompts create artifacts that appear in the OS for review and iteration | Routines produce immutable artifact versions and lineage; only approved artifacts appear as runnable ring items |
| 18:33–21:06, Apps | Custom micro apps include a generations grid, second brain, and an Excalidraw landing pad | Apps are compact dashboard surfaces or reviewed component artifacts using the same system and capability broker |

## Reference composition

The supplied screenshot establishes the desktop target:

```text
thin orange status rule across the top edge
┌──────────────────┬──────────────────────────────────────┬──────────────────┐
│ MICRO APPS       │         compact identity/tools       │ EMAIL            │
│ compact tiles    │                                      │ attention rows   │
├──────────────────┤                                      ├──────────────────┤
│ CALENDAR / TIME  │       MARKDOWN KNOWLEDGE GLOBE       │ SKILLS DECK      │
│ dense schedule   │  inner relationship cloud and links  │ compact launchers│
├──────────────────┤   outer reviewed-artifact orbit      ├──────────────────┤
│ METRIC / CONTENT │                                      │ ROUTINES         │
│ terse telemetry  │                                      │ run/state rows   │
└──────────────────┴──────────────────────────────────────┴──────────────────┘
```

Direct visual characteristics:

- Near-black, edge-to-edge canvas; no conventional sidebar, card grid, or large product header.
- Dominant central radial graph occupying most of the viewport.
- Narrow left and right rails composed of square, hairline-separated modules.
- Warm off-white text, muted gray metadata, and one strong orange accent.
- Very small uppercase, letter-spaced labels and dense information presentation.
- Low-radius or square geometry, restrained shadows, thin rules, and minimal decorative chrome.
- Circular nodes and small numeric badges around the globe's perimeter.
- A compact wordmark/title above the globe with small utility controls.

## What the center globe means

The transcript at approximately 12:02–14:25 describes the second brain as a visualization of how workspace files and folders connect, rooted in a router file and searchable/previewable. The user further confirms that Voidra's center must be a graph of Markdown files surrounded by artifacts. This yields the binding semantic model:

| Layer | Data | Meaning |
| --- | --- | --- |
| Core | Workspace root router (`AGENTS.md`, with its `CLAUDE.md` compatibility pointer) | Entry point for the selected workspace's agent instructions |
| Inner cloud | Markdown routers, notes, skill instructions, references, and explicit shared-knowledge attachments | The workspace's navigable memory/context graph |
| Inner edges | Markdown links, wiki links, router references, skill/reference declarations, tags, and explicit shared-base attachment edges | Explainable relationships; inferred similarity is optional and visually distinct |
| Outer orbit | Reviewed artifacts grouped by run/project/type and placed near their strongest source/producer relationship | Durable outputs surrounding the knowledge that produced them |
| Lineage edges | `used`, `generated-by`, `derived-from`, `supersedes`, and `reviewed-as` records | Auditable path from source Markdown and skill/routine to artifact version |

The globe is invalid if it uses random particles, fake edges, or placeholder counts when real indexed data exists. Every visible node resolves to a stable record, every explicit edge has a human-readable reason, and every graph state has an equivalent list/tree view.

## Motion and transition language

The reference communicates continuous ambient activity and focus through a radial dashboard. Exact implementation curves are unavailable, so the following are Voidra proposals chosen to reproduce its character without fabricating source facts:

| Pattern | Planned behavior | Accessibility equivalent |
| --- | --- | --- |
| Dashboard arrival | Top rule draws in, rails reveal from outside toward center, then the globe resolves from core to orbit in a short stagger | Immediate final state under reduced motion |
| Globe idle | Extremely slow rotational drift/parallax; labels remain legible and pointer targets do not move materially | Static graph with identical controls |
| Node focus | Selected node eases toward center; unrelated nodes dim; connected paths brighten; inspector enters from the nearest rail | Focus moves to the inspector and announces relationship count |
| Graph search | Matches hold opacity, non-matches fade, result stepping uses a short camera pan/zoom | Ordered results list and next/previous controls |
| Artifact arrival | New approved artifact enters the outer ring with one restrained radial pulse; quarantined items never appear in the normal ring | Live-region text announcement; no repeated pulse |
| Panel change | Content crossfades/slides 4–8 px within fixed rail geometry; the entire page does not wipe | Instant replacement under reduced motion |
| Route transition | Shared canvas remains; title/controls and content morph or crossfade inside it | Focus restoration plus page-title announcement |
| Destructive/privileged action | Motion pauses and a compact review surface takes focus | Same review semantics independent of animation |

Motion must communicate state, hierarchy, or continuity. Continuous glow, bouncing, large parallax, random particles, and cursor-chasing decoration are prohibited.

## Clone matrix

| Reference pattern | Fidelity target | Voidra-specific change |
| --- | --- | --- |
| Edge-to-edge black dashboard | High | Voidra identity and workspace status replace source branding |
| Left/right stacked rails | High | Modules map to configured Voidra widgets and real empty states |
| Central second-brain sphere | High in silhouette, density, and focus behavior | Real Markdown/index/lineage data; accessible list mode |
| Artifact ring | High in radial placement and discoverability | Only approved artifact digests; review state and permissions are visible |
| Tiny uppercase telemetry labels | High | Minimum readable size, zoom support, and assistive labels remain mandatory |
| Orange accent and hairline grid | High | Exact tokens are original Voidra values in `design-system.md` |
| Source wordmark/icons/content | None | Original Voidra wordmark, icons, examples, and data only |
| Old Voidra sidebar/card styling | None | Removed from all V2 routes after migration |

## Research gaps that implementation must close

Before the first V2-06 component is accepted, capture a local, timestamped frame matrix from the reference at desktop dashboard, artifact focus, second-brain focus, skills, routines, and micro-app states. Record only observable geometry and motion—not source assets. The matrix must measure:

- viewport and approximate rail/center proportions;
- panel alignment, line weight, density, type scale, and label cadence;
- entry/focus/search/route transition ordering and approximate duration bands;
- globe idle behavior, focus behavior, and artifact-ring relationship;
- narrow-window behavior if the source reveals it; otherwise document Voidra's responsive behavior as an original extension.

If direct evidence conflicts with this document, update the evidence classification and design decision before implementation rather than silently changing the UI.

## Acceptance rubric

Design review scores each representative state from 0–2 on composition, hierarchy, density, typography, color/line language, globe silhouette, motion character, and interaction continuity. A state requires:

- no zero in any category;
- at least 13/16 overall;
- no accessibility or data-honesty failure;
- original Voidra brand/assets;
- exact compliance with the no-sidebar and real-data globe rules.

This rubric is a design gate, not a claim of pixel identity with the reference.
