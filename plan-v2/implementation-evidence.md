# V2 implementation and release evidence

[V2 index](main.md) · [Release phase](phase-11-hardening-release.md) · [Operations](operations-recovery.md)

Status timestamp: 2026-09-21. The implementable repository plan is complete. This ledger keeps automated fixture evidence separate from human, authenticated-provider, physical-device, live-account, and signing evidence. A passing fixture or unsigned package never changes a Pending external row to Passed.

## Implemented product

- No-sidebar product shell on every route: fixed command bar, workspace/runtime state, destination strip, cross-domain command search, Stop All, workspace-scoped route/scroll state, reduced-motion behavior, and data-preserving feature rollback.
- Reference-shaped Today canvas: bilateral application/calendar/attention/skills/routines rails around the dominant graph, keyboard layout move/resize/hide/reset, honest freshness/empty/error states, exact skills/routine/output links, queue status, and last output.
- Real knowledge center: Markdown notes, scoped instructions/routers, memory, skills, routines, runs, applications, and artifacts provide typed nodes and explainable edges. IPC returns bounded pages; the globe renders a bounded LOD projection, accessible list/inspector, keyboard camera controls, saved per-workspace camera, search dimming/focus, and deterministic approved-artifact groups.
- Bottom-up ARMS: portable resource-bearing skill bundles and deterministic fixtures; reviewed routers and context manifests; versioned manual/OpenRouter/headless routines; application/widget summaries and reviewed actions; declarative micro-app promotion through the artifact pipeline.
- Supervised Claude Code and Codex: absolute executable discovery/fingerprint/version, direct argument arrays, prompt stdin, minimal environment, sanitized staged workspaces, read-only/staged-write profiles, bounded normalized journals, device/workspace queueing, cancellation/process-group cleanup, restart interruption, exact diff review, and stale-source-safe writeback.
- Unified outputs: manual/OpenRouter/headless timeline, multi-type content-sniffed catalog, digest/lineage/tags/search, retained run objects, and explicit text/Markdown reuse as bounded run input.
- Component artifacts: strict `artifact.json` plus `src/Artifact.tsx`, pinned UI/SDK facades, copied-source disposable builder worker, exact source/bundle receipts, isolated runtime CSP, deterministic checks, separate reviewer process, distinct semantic verdict, signed/chained/expiring final decision, immutable approved snapshots, re-reviewing rollback, and guided non-executing legacy conversion.
- Capability boundary: approval grants no powers; workspace/artifact/digest-scoped grants are revalidated for every typed filesystem/MCP request. Writes are staged; MCP server and schema identities are pinned; credentials and raw host handles remain outside the artifact.

The exact artifact contract is in [`artifact-authoring-contract.md`](artifact-authoring-contract.md), retired visual dependencies are in [`legacy-design-removal-ledger.md`](legacy-design-removal-ledger.md), and recovery is in [`operations-recovery.md`](operations-recovery.md).

## Automated evidence

| Gate | Result | Evidence boundary |
| --- | --- | --- |
| TypeScript | Pass | `pnpm typecheck` from the final tree |
| Unit/integration | Pass: 30 files, 161 tests; 80.17% branch coverage | Real temporary files/SQLite and local fixture providers; no subscription inference |
| Production Electron E2E | Pass: 59/59 | Production build, real Electron, temporary workspaces; includes component review/rollback/conversion, headless, migration/recovery, no-sidebar/deep-link/zoom/rollback, 10k artifacts, and all retained V1 journeys |
| Production build | Pass | Static Next.js output plus bundled Electron/service/preloads |
| Knowledge scale | Pass at 60,000 Markdown files | Cold first corpus list/index 191,198 ms; graph 896 ms; search 66 ms; open 88 ms; edit 41 ms; 698 MB total Electron working set; renderer graph page bounded to 500 records |
| Artifact scale | Pass at 10,000 versions | Catalog load/sort 573 ms; renderer payload 500 records; orbit 10 records; 679 MB total Electron working set |
| Apple Silicon package | Pass | Unsigned `arm64` directory package; tree SHA-256 `3d5d36d58c51a9f58c2b4230d98884734d08a3c9fe926059479cc1affd5598b5`; signing/notarization unavailable |
| Packaged smoke | Pass | Packaged renderer startup, direct compiler dependency, disposable builder worker, CSP shell, and isolated reviewer |
| Design static/interaction | Pass automated portion | Legacy selector/token scan, no-sidebar DOM, keyboard layout controls, reduced motion, accessible globe list, 200% Electron zoom |
| Semantic artifact review | Pass as `test-fixture` | Exact digest/inventory/final-decision flow; not a live model claim |

The 60,000-file cold first index takes about 3.2 minutes on this development machine. V2 therefore accepts 60,000 files as a background cold-start/rebuild scope, not an interactive cold-index promise. Once indexed, the recorded graph/search/open/edit transitions are interactive. Measurements are single observations, not universal percentiles.

## Phase disposition

| Phase | Automated disposition | Remaining boundary |
| --- | --- | --- |
| V2-00 baseline/migration | Complete | None beyond final external release composition |
| V2-01 skills/router memory | Complete | None |
| V2-02 Claude/Codex runtime | Complete against hostile fixtures | Real authenticated Claude and Codex runs require explicit authorization |
| V2-03 routines/runs/artifacts | Complete | Provider-specific live consumption remains outside fixtures |
| V2-04 applications/micro apps | Provider-neutral complete | First live connector/account was not selected or authorized |
| V2-05 command center | Automated complete | Human visual and screen-reader review |
| V2-06 design reset | Automated complete | Human reference-fidelity/contrast review |
| V2-07 product redesign | Automated complete | Human all-route visual review |
| V2-08 globe/orbit | Selected-scale automated complete | Prolonged human interaction/resource soak |
| V2-09 component runtime | Automated complete | None |
| V2-10 review/capabilities | Automated complete | Live OpenRouter semantic-review evidence requires a credential |
| V2-11 hardening/release | Automated candidate complete | External matrix below; signed distribution is not claimed |

## External/live acceptance matrix

| Boundary | State | Exact missing condition |
| --- | --- | --- |
| Claude Code real read/write/cancel | Pending | Explicit approval to consume the installed/authenticated CLI account |
| Codex real read/write/cancel | Pending | Explicit approval to consume the installed/authenticated CLI account |
| Semantic security-review model | Pending | OpenRouter credential and explicit live-review authorization |
| First calendar/email connector | Pending | User selection, test account, OAuth consent, and reviewed-write authorization |
| Sleep/wake and Notification Center | Pending | Physical macOS acceptance session |
| Browser/artifact human session | Pending | Human packaged-app inspection |
| Native helper/Accessibility | Pending | Signed helper/Accessibility consent and representative workflows |
| ElevenLabs microphone/headset/voice | Pending | Live key, audio hardware, OS microphone consent, and language session |
| Remote phone/TLS/LAN/firewall | Pending | Physical phone/network/certificate acceptance environment |
| Visual fidelity/contrast/screen reader | Pending | Human reference comparison and assistive-technology session |
| Developer ID signing/notarization | Pending | Valid Apple Developer ID identity and notarization credentials |

Pending rows are accepted limitations for this unsigned local release candidate; they are not silently waived and must be completed before claiming the corresponding production capability or general distribution.

## Reproducible release command

`make v2-release` runs strict typing, coverage, the complete production Electron suite, the dedicated 60,000-note gate, Apple Silicon packaging, release-manifest generation, and packaged smoke. It intentionally does not spend subscription allowance, authorize OAuth, request physical OS/device consent, or use signing identities.

## Completion rule

Repository implementation is complete: the final automated rerun is green and `release/release-manifest.json` is refreshed. Product distribution acceptance remains conditional on the external/live rows relevant to the intended release. This distinction follows the plan's rule that unavailable accounts, hardware, consent, or signing identity may remain prominently Pending but may never be called Passed.
