# V2 legacy-design removal ledger

[Design system](design-system.md) · [Whole-product redesign](phase-07-product-redesign.md)

Status: automated removal complete on 2026-09-21; human visual acceptance remains a separate release gate.

| Retired V1 dependency | V2 replacement | Enforcement/evidence |
| --- | --- | --- |
| Permanent `.sidebar` navigation | Fixed, compact `.v2-commandbar` destination strip | Every production Electron route asserts a visible primary navigation; Today asserts zero `.sidebar` nodes |
| `.topbar`, `.crumb`, `.top-actions`, `.avatar` chrome | Workspace/runtime/search/Stop All controls inside the canvas command bar | Old selectors removed from `app/globals.css`; static token/selector test |
| Sidebar-only workspace switcher and runtime card | `.v2-workspace-select` and `.v2-runtime-state` | Responsive command bar remains present at 200% Electron zoom |
| Blue/mint `--mint` / `--blue` palette | Semantic black, warm ivory, orange accent, and status tokens | Deprecated token/color scan in `tests/unit/design-system.test.ts` |
| Soft rounded dashboard cards | Hairline, squared telemetry modules and route panels | Host and artifact facade radius bounded to 2–4 px; route override covers domain panels |
| Decorative `.orb` hero | Indexed Markdown/ARMS knowledge globe and approved-artifact orbit | Old selector/component removed; globe has data-backed list/edge explanations |
| Generic global `nav` styles | `.v2-destination-strip` scoped navigation | Generic selector removed so artifacts/deep pages cannot inherit V1 nav behavior |
| One-size responsive collapsed sidebar | Two-row, horizontally scrollable destination strip | Narrow and 200%-zoom Electron acceptance journey |
| V1 page entrance drift | `v2-route-in`, graph focus/orbit motion, reduced-motion override | `prefers-reduced-motion` E2E checks animated and reduced paths |

The words `.sidebar` and `.topbar` remain only in negative E2E assertions. They are not shipped CSS classes or rendered application nodes.

Compatibility is data-only: feature flags disable V2 modules without deleting workspace notes, histories, layouts, grants, or artifacts. Rollback does not remount the retired V1 visual shell.

## Review rule

New host UI must use semantic V2 tokens and existing V2 primitives. New component artifacts use only the pinned artifact facade. A legacy selector/token reintroduction fails the design-system unit test and requires a recorded decision in `plan-v2/main.md`.
