# V2-09 — Next.js component artifact runtime

[V2 index](main.md) · Previous: [V2-08](phase-08-knowledge-globe-artifact-ring.md) · Next: [V2-10](phase-10-artifact-security-review.md)

Status: **planned**. Existing HTML artifacts remain legacy inputs; this document does not authorize executing generated TSX in the current renderer.

## Outcome

Make the normal V2 artifact a versioned, constrained React Client Component package rendered by Voidra's Next.js host, not a standalone HTML file. AI-generated artifacts must use the same design tokens and primitives as the product, declare all requested capabilities, build reproducibly, and remain quarantined until V2-10 completes review and approval for the exact digest.

“Next.js component artifact” means a component module consumed by a Voidra-owned Next.js artifact shell. It does **not** mean the artifact may define routes, middleware, Server Components, Server Actions, API handlers, `next.config`, arbitrary dependencies, or a complete Next.js application.

## Platform rationale

- Next.js uses explicit Server/Client Component boundaries; interactive artifacts therefore enter through a host-owned Client Component boundary and never become trusted server modules. See [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components).
- Client components can be loaded separately, but dynamic loading is an optimization rather than a security boundary. See [Lazy Loading](https://nextjs.org/docs/app/guides/lazy-loading).
- Electron treats untrusted content/code as high risk. The artifact renderer must keep Node integration disabled, context isolation and process sandboxing enabled, navigation/window creation limited, CSP restrictive, and privileged messages sender-validated. See Electron's [security checklist](https://www.electronjs.org/docs/latest/tutorial/security), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), and [sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox).

## Artifact package contract

```text
artifact-package/
  artifact.json          # identity, schema version, entry, layout, requested capabilities
  src/
    Artifact.tsx         # required default component; client-safe only
    model.ts             # optional serializable types/validation within limits
  assets/                # bounded local images/data; no executables or hidden archives
  tests/                 # optional component/interaction fixtures
  README.md              # purpose, inputs, actions, limitations
```

Generated/stored build metadata lives outside the source package:

```text
artifact-record/
  source-digest
  builder-version
  artifact-ui-version
  dependency-lock-digest
  compiled-bundle-digest
  static-check-report
  security-verdict
  capability-grants
  provenance-and-lineage
```

## Manifest v1

Required fields:

- artifact ID, name, semantic version, source schema, entry path, producer run/skill/routine, and workspace ID;
- pinned `@voidra/artifact-ui` API range and artifact SDK range;
- minimum/ideal/max surface size and supported compact/full-screen modes;
- serializable input/output schemas with bounded sizes;
- requested capabilities with reason, operation class, scope selector, and whether user presence is required;
- local asset declarations with media type and digest;
- expected network policy (`none` by default); direct network access is not available in v1;
- accessibility summary and declared keyboard actions.

The manifest may request a capability but cannot grant it. Review eligibility and runtime permission are separate records.

## Import and code policy

Allowed imports are versioned and explicit:

- `react` hooks/types from the shipped compatible version;
- `@voidra/artifact-ui` design-system primitives and semantic tokens;
- `@voidra/artifact-sdk` typed data/capability client;
- a small, audited set of pure utility modules exposed through the SDK rather than raw NPM resolution.

Forbidden in artifact source:

- Node/Electron built-ins, filesystem/process/child-process/network modules, environment variables, native addons, WebAssembly, workers, service workers, and dynamic package resolution;
- Next.js server modules, routes, middleware, Server Actions, server-only imports, image/font loaders that escape the package, or host internal imports;
- `eval`, `Function`, string-to-code execution, inline script injection, `dangerouslySetInnerHTML`, uncontrolled iframe/webview, dynamic `import()` paths, and runtime package fetching;
- arbitrary external URLs, global CSS, CSS resets, font injection, raw host selectors, and mutation outside the artifact root;
- direct `window.electron`, IPC, storage shared with the host, clipboard, navigation, popup, download, or credential access.

These are both static policy and runtime boundaries; a linter rule alone is insufficient.

## Design-system contract

- Artifact source uses semantic props/tokens, not raw V2 colors, radii, shadows, or animation values.
- The host supplies theme, density, zoom, contrast, locale, reduced-motion, and surface size through a serializable context.
- Required states use the shared `EmptyState`, `ErrorState`, `StaleState`, `PermissionPrompt`, and review/action primitives.
- Artifact CSS is scoped/compiled to its root. Global selectors, `!important` theme overrides, fixed viewport overlays, and host-chrome impersonation fail validation.
- Host UI always surrounds the artifact with immutable identity, version, review, capability, lineage, and close/Stop All affordances that artifact code cannot hide.

## Build pipeline

```text
AI or user produces staged package
  -> schema and path validation
  -> source normalization and digest
  -> import/AST/policy checks
  -> isolated deterministic TypeScript build against pinned SDK lock
  -> component tests and resource limits
  -> immutable compiled bundle + reports
  -> V2-10 independent security review
  -> approved bundle becomes eligible for explicit capability grants
```

- Builds run outside the privileged renderer in a disposable worker with no secrets, canonical workspace writes, ambient network, user package manager configuration, or inherited agent credentials.
- The worker receives only the staged package, pinned toolchain/SDK, bounded fixture inputs, and an output directory.
- Source and compiled output are content-addressed. Any byte, dependency lock, builder, SDK, manifest, or capability-request change produces a new digest and invalidates the previous verdict.
- Build logs are bounded/redacted and treated as untrusted artifact output.
- A successful build is still quarantined; it is not security approval.

## Runtime shell

- A Voidra-owned Next.js route selects only an approved compiled bundle by stable artifact version/digest.
- The component renders in a dedicated sandboxed renderer boundary with Node integration disabled, context isolation enabled, restrictive CSP, denied navigation/popups/downloads, and a narrow typed message channel.
- The message channel exposes one method per capability operation; it never exposes raw IPC or a generic `send`/`invoke` function.
- The host validates sender, artifact digest, workspace, grant, operation, arguments, source revisions, and user-presence requirement on every request.
- Crashes, render loops, memory/CPU abuse, oversized messages, and repeated denied requests isolate/disable the artifact without taking down the command center.
- Artifacts cannot directly call one another. Composition is host-mediated through serializable inputs and individually reviewed versions.

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-09-01: Define package and manifest v1 | 5 | V2-03 lineage; V2-06 tokens | Given valid/invalid packages, when parsed, then paths, schemas, assets, UI/SDK pins, capabilities, layout, provenance, and limits are deterministic and unknown fields/versions fail safely |
| V2-09-02: Publish the artifact UI/SDK facade | 8 | V2-06 primitives | Given a generated component, when it imports allowed UI/data/action APIs, then it can reproduce the Voidra system and required states without access to host internals |
| V2-09-03: Build deterministic isolated compilation | 8 | V2-09-01/02 | Given the same staged source/toolchain/lock, when built in disposable workers, then output digests match and no network, secrets, canonical writes, or ambient dependencies are available |
| V2-09-04: Enforce source/import/style policy | 8 | V2-09-01–03 | Given forbidden imports, code generation, server modules, globals, CSS escape, hidden assets, and package tricks, when checked/built, then each fails closed with a stable finding and no bundle enters review as clean |
| V2-09-05: Create the host-owned runtime shell | 8 | V2-09-02/03 | Given an approved fixture bundle, when rendered, then sandbox/context isolation/CSP/navigation/message/resource boundaries hold and immutable host identity/review/Stop All UI remains outside artifact control |
| V2-09-06: Add artifact versioning and lifecycle | 5 | V2-09-01/03 | Given create/edit/rebuild/supersede/delete attempts, when lifecycle changes, then immutable digests, lineage, review invalidation, grants, rollback, and retained audit behave deterministically |
| V2-09-07: Migrate legacy HTML behavior | 5 | Existing artifact catalog | Given an existing HTML artifact, when opened or converted, then read-only legacy preview remains isolated, new HTML creation is unavailable, and conversion creates a new quarantined component package without overwriting the original |
| V2-09-08: Add authoring guidance for agents | 3 | V2-09-01/02/04 | Given an AI generation request, when the prompt/context pack is assembled, then it includes the exact manifest, UI/SDK, state, capability, test, and forbidden-pattern contract without granting extra access |

All stories are Must.

## Legacy HTML transition

- Keep existing HTML artifacts readable through their current isolated preview while migration is reversible.
- Label them `legacy-html`, exclude them from component-capability grants, and prevent new normal creation after the component path is available.
- Conversion reads the old bundle as untrusted source material, generates a new component package in staging, preserves provenance to the legacy digest, and runs the complete V2-09/V2-10 pipeline.
- Never replace or delete the original automatically. Archive/delete remains an explicit user action.
- Artifact ring filters distinguish legacy, quarantined component, approved component, blocked, and superseded states.

## Verification plan

### Unit/integration

- Manifest versions, path normalization, MIME/digest validation, asset and schema bounds.
- Allowlisted imports and every forbidden-code/style category.
- Deterministic build output across clean workers and failure on ambient dependency/network assumptions.
- Lifecycle invalidation after one-byte source, manifest, SDK, builder, lock, or capability-request changes.
- Sandbox message schema, sender/digest/workspace validation, resource budgets, crash recovery, and audit records.
- Legacy HTML read-only/open/convert/rollback fixtures.

### Playwright Electron

1. Generate/import a valid component package, observe quarantine, and confirm it cannot open in the normal runtime before V2-10 approval.
2. Approve a safe fixture through the test reviewer, render it in default/compact/full-screen/reduced-motion/200%-zoom states, and verify design-system fidelity.
3. Exercise forbidden navigation, popup, download, storage, Electron/Node access, global CSS escape, and message forgery; verify denial and artifact isolation.
4. Edit one byte of an approved fixture and verify review/grants no longer apply.
5. Open a legacy HTML artifact read-only, convert it, and verify both immutable versions and lineage remain.

## Exit criteria

- New artifacts are constrained Next.js/React component packages, not standalone HTML.
- They use the same versioned design system through the artifact UI facade.
- Deterministic builds have no ambient network, secrets, dependencies, or canonical writes.
- The runtime shell supplies defense in depth and no raw Electron/Node bridge.
- Every new or changed digest remains quarantined until V2-10.
- Legacy HTML remains safely readable and reversibly convertible without new HTML generation.
