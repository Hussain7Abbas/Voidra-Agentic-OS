# Voidra V2 — ARMS command-center plan

Status: implementation started on 2026-09-20. The first reversible V2-05 presentation slice exists on the Today route, but it is now treated as a disposable prototype rather than the visual foundation. The approved direction is a full design-system reset, no permanent application sidebar, a high-fidelity recreation of the video's dashboard grammar, a real Markdown knowledge globe with an artifact ring, and reviewed Next.js component artifacts. None of V2-06–V2-11 is implemented. V1 automated implementation remains complete as recorded in [`plan/main.md`](../plan/main.md); its live/native/audio/network/signing acceptance items remain pending.

## Goal

Evolve Voidra from a capable workspace assistant into a visual, local-first agentic operating system inspired by the referenced RoboNuggets demonstration. V2 adopts the useful product model from the video—Skills, Memory, Routines, and Applications (ARMS)—without copying its brand or weakening Voidra's isolation, permission, and awake-Mac constraints.

The finished V2 should let a user:

1. Create rich, reusable skill bundles with references, assets, and reviewed scripts.
2. Navigate large workspaces through agent-oriented router files and a visual second brain.
3. Run a skill manually, through OpenRouter, or headlessly through an installed Claude Code or Codex CLI.
4. Schedule those execution modes locally while the Mac is awake and inspect every run.
5. Connect applications through reviewed MCP, API, or CLI adapters and expose their summaries as widgets.
6. Use a configurable, edge-to-edge command center with live widgets, a skills deck, routine status, searchable artifacts, micro apps, and the second-brain graph—without the old sidebar shell.
7. Generate artifacts as versioned Next.js/React components that inherit Voidra's design system, run behind a capability broker, and cannot become usable until deterministic checks and an independent security-review agent approve the exact artifact version.

## Evidence used

### Video-derived product signals

The source video, [“The NEW Agentic OS standard for Claude 5 Models is here”](https://www.youtube.com/watch?v=8NSyI-npJCU), and its [full transcript](https://www.usetranscribe.io/yt/8NSyI-npJCU/agentic-os-claude-5) show these concrete patterns:

- A single command center summarizes calendar, email, time zones, creator metrics, routines, skills, micro apps, artifacts, and a visual second brain.
- The visible dashboard is only a presentation layer; the underlying value comes from organized context and repeatable agent workflows.
- ARMS means Applications, Routines, Memory, and Skills. The recommended adoption order is bottom-up: skills, memory, routines, then applications.
- A mature skill is a folder-sized capability, not only one Markdown prompt. It may route to references, visual guidance, scripts, and other supporting files.
- Skills can be triggered headlessly and produce a durable report or artifact.
- Router files guide an agent to the right subset of a large workspace instead of forcing it to search every file.
- Routines are scheduled prompts that should surface their outputs for review.
- Application connections may be official connectors, APIs, CLIs, MCP servers, or purpose-built micro apps.

The referenced screenshot reinforces the target visual hierarchy: a dark edge-to-edge command-center canvas, central graph, orbiting entities, left-side micro apps/calendar/content metrics, right-side email/skills/routines, and an artifact-oriented navigation model. The follow-up research and the distinction between direct observation and design inference are recorded in [`research-video-ui.md`](research-video-ui.md). V2 will closely reproduce the layout, density, motion grammar, and interaction hierarchy while using Voidra names, icons, content, and original assets.

### Official platform constraints for generated component artifacts

- Next.js distinguishes Server and Client Component module graphs, and client interactivity crosses an explicit `"use client"` boundary; V2 must not treat arbitrary generated TSX as trusted server code. See the official [Server and Client Components guide](https://nextjs.org/docs/app/getting-started/server-and-client-components) and [lazy-loading guide](https://nextjs.org/docs/app/guides/lazy-loading).
- Electron warns that untrusted code has far greater impact in a desktop shell and recommends process sandboxing, context isolation, restrictive CSP, no Node integration, limited navigation/window creation, and sender validation for privileged IPC. See Electron's [security checklist](https://www.electronjs.org/docs/latest/tutorial/security), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), and [process sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox).
- MCP authorization is server/resource authorization, not permission for a generated UI to call every tool. The artifact broker must independently pin server/tool identity, validate typed arguments, honor current grants, and retain consent/audit. See the official [MCP Apps authorization guidance](https://apps.extensions.modelcontextprotocol.io/api/documents/authorization.html).

### Official CLI facts that constrain the plan

- Anthropic documents `claude -p` for non-interactive execution, structured `json`/`stream-json` output, model and effort selection, turn/budget limits, tool allow/deny lists, permission modes, session controls, and related automation flags in the [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage).
- Official OpenAI documentation defines `codex exec` as the non-interactive mode, with JSONL events, read-only or workspace-write sandboxes, structured output, cancellation-friendly streams, saved CLI authentication, and resumable sessions in [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).
- Local read-only inspection on 2026-09-20 found Claude Code `2.1.236` and Codex CLI `0.155.0-alpha.9.2`. These observations establish only the development machine baseline. V2 must negotiate capabilities at runtime instead of assuming those versions or flags forever.

## V1 baseline and V2 gap

| Area | V1 evidence | V2 gap |
| --- | --- | --- |
| Desktop shell | Next.js/Electron deep routes plus an initial responsive, full-window command-center home are implemented | Deep routes still use the old sidebar/chrome; there is no binding reference-derived system, complete page migration, resizable layout editor, widget registry, saved list mode, or layout persistence |
| Skills | Versioned Markdown instructions and routines are implemented | No bundle references/assets/scripts, import/export, or compatibility validation |
| Memory | Private/shared Markdown, FTS, graph, tags, and editable memory exist | No router-file workflow, unified ARMS graph, or large-graph progressive exploration |
| Execution | Manual Claude/Codex handoff and automatic OpenRouter runs exist | No supervised local `claude -p` or `codex exec` provider |
| Routines | Awake-only schedules, Plan the Day, and run history exist | No headless CLI dispatch, skills deck, resource governor, or unified run timeline |
| Applications | MCP catalog/custom servers, browser, Mac actions, voice, and remote boundaries exist | No normalized app-summary/widget contract or micro-app promotion flow |
| Artifacts | Isolated HTML bundles and generated files can be opened | HTML is a legacy format; there is no reviewed Next.js component package, shared design-system SDK, capability manifest/broker, security verdict, cross-run catalog, lineage, or ring view |
| Release | Automated V1 gate and Apple Silicon package exist | V1 live gates remain pending; V2 adds new CLI/security/performance gates |

V2 is additive. It must migrate existing data in place, retain every V1 workflow, and remain able to disable all V2 features through feature flags during rollout.

## Confirmed V2 scope

The user's latest requests add these requirements to the existing product contract:

1. Build toward the video's ARMS-style agentic OS and command-center experience.
2. Support headless execution of both Claude Code and Codex.
3. Ditch the old design across every current page: no permanent sidebar, and use the video's layout, density, animation, and transition patterns as the V2 design reference.
4. Make the center a real graph of Markdown files with artifacts surrounding it, not a decorative orb.
5. Generate new interactive artifacts as Next.js/React components that use Voidra's design system and access only explicitly exposed filesystem/MCP capabilities.
6. Run an independent security-review agent on every completed artifact, with deterministic checks and runtime containment as mandatory companion gates.

All existing requirements remain in force, especially:

- Workspaces remain independent. Private notes, memory, histories, accounts, browser profiles, CLI run data, and layouts never merge implicitly.
- Shared knowledge is included only through explicit attachments and current grants.
- Manual handoff remains available and still performs no model call.
- Headless execution is a separate, visible, opt-in mode. Selecting a Claude or Codex label must never silently launch a process.
- Schedules run only while the user's Mac and Voidra runtime are awake. The video's VPS/always-on pattern is deliberately outside V2.
- Global defaults may be overridden per workspace; an individual skill or routine may override its execution provider, model, effort, and risk profile.
- Root/scoped `AGENTS.md` and sibling `CLAUDE.md` rules remain canonical and must be resolved for the run target.

## Target product experience

### Command center

The default V2 home is a per-workspace, edge-to-edge canvas with no permanent sidebar and no inherited V1 application chrome. Workspace identity, search, run state, privacy state, and Stop All live in compact canvas controls modeled on the reference rather than in a conventional product header. The initial layout includes:

- Central knowledge globe: Markdown routers/notes/skills/references form the inner linked graph; reviewed artifacts occupy the surrounding ring; every node and edge is backed by indexed data and has an explainable textual equivalent.
- Skills deck: pinned skills with provider, model, effort, risk profile, estimated context, and Run.
- Routine board: next occurrences, owning workspace, execution mode, current state, and last artifact.
- Artifact ring: searchable reviewed component/file outputs grouped by project/tag/run, with lineage back to Markdown inputs and the producing skill.
- Calendar/time widget and attention widget backed by explicit connectors; unavailable connectors show honest empty states.
- Micro-app dock: reviewed local apps or safe external links, never privileged renderer code.
- Resource widget: active processes, elapsed time, usage when emitted by a provider, queue depth, and cancellation.

Every visual surface also has an accessible list/table representation. Keyboard navigation, reduced motion, screen-reader labels, and non-color status cues are release requirements.

### Bottom-up ARMS workflow

```text
Skill bundle
  -> router-guided context pack
    -> manual / OpenRouter / Claude headless / Codex headless run
      -> routine schedule and observable run journal
        -> artifact catalog and app/widget summaries
          -> command-center presentation
```

## Execution modes

| Mode | V1/V2 | Authentication | Writes | Scheduling |
| --- | --- | --- | --- | --- |
| Manual Claude/Codex handoff | Retained from V1 | Destination client owns auth | User imports and reviews result | Prepare only; never copy or submit in background |
| OpenRouter automatic | Retained from V1 | Voidra keychain reference | Existing grant/review engine | Awake-only |
| Claude Code headless | New in V2 | Installed Claude CLI owns its auth | Read-only report or staged writeback | Awake-only and opt-in |
| Codex headless | New in V2 | Installed Codex CLI owns its auth | Read-only report or staged writeback | Awake-only and opt-in |

Headless defaults:

- Discover an explicitly approved absolute binary path, record its version and fingerprint, and require review when it changes.
- Spawn an argument array directly; never construct a shell command string.
- Send the compiled prompt over stdin so private context does not appear in the process list.
- Build a minimal environment instead of inheriting the Electron/service environment. Never pass OpenRouter, ElevenLabs, MCP bearer tokens, or unrelated credential variables.
- Run inside a per-run staged workspace. Canonical files change only after Voidra computes a diff, revalidates grants and source revisions, and the user or standing routine grant approves writeback.
- Start with no agent-controlled web/network tool, browser, MCP, arbitrary shell, external directory, or device-control access. The vendor CLI's own model/auth transport is an explicit provider trust boundary; it is not permission for the agent to browse or call arbitrary connectors.
- Never pass Claude's permission-bypass flag, Codex's danger-full-access/bypass flag, or an equivalent unless a later separately approved phase supplies an independently verified external sandbox. Those modes are out of V2's initial release.
- Treat CLI output as untrusted, bounded input. Normalize JSON/JSONL events, retain a redacted journal, and fail closed on malformed streams or unsupported flags.

Authentication remains the vendor CLI's responsibility. Voidra may invoke a documented status command and guide the user to authenticate in a terminal, but it must not read, copy, export, or back up Claude/Codex credential files. A live run may consume subscription allowance or API credit according to the user's CLI configuration; Voidra must disclose that before the first run and cannot promise account eligibility.

## Architecture additions

| Component | Responsibility | Boundary |
| --- | --- | --- |
| Skill bundle service | Editable bundle, validation, immutable versions, imports/exports | Scripts/assets are data until explicitly granted |
| Router/context service | Router suggestions, typed relationships, bounded context packs | Does not rewrite user files silently |
| CLI broker | Discovery, capability negotiation, sanitized spawn, event normalization, cancellation | Renderer never receives process handles or secrets |
| Run sandbox | Materialized allowed inputs, scratch output, diff, artifact manifest | No canonical write before writeback review |
| Routine orchestrator V2 | Resolve execution provider, queue, limits, missed-run behavior, outcome linkage | Schedule ownership remains workspace-bound |
| Artifact catalog | Content-addressed metadata, preview, lineage, search, review state, and component-version digest | Unapproved code remains quarantined and cannot enter the normal preview/runtime |
| Component artifact builder | Validates and bundles a constrained Next.js/React component package against a pinned Voidra UI SDK | Generated code cannot import arbitrary packages, server modules, Node built-ins, or global CSS |
| Artifact security reviewer | Performs independent agent review after deterministic static/build checks and emits a structured verdict for the exact digest | The reviewer is read-only, receives no artifact capabilities, and cannot approve its own generated code |
| Artifact capability broker | Mediates filesystem, MCP, network, and host actions using artifact/version/workspace-scoped grants | No ambient Electron/Node bridge, credentials, raw process handles, or implicit MCP access |
| App/widget registry | Normalized read/query/action contracts and freshness | Widgets cannot call connectors or filesystem directly |
| Command-center renderer | Layout, visualizations, commands, accessible alternatives | Presentation only; all effects use validated service requests |

## Phase index

| Phase | Document | Outcome | Prerequisites |
| --- | --- | --- | --- |
| V2-00 | [Baseline, contracts, and migration](phase-00-baseline-contracts-migration.md) | Freeze the V1 baseline; prove schemas, threat model, CLI capability discovery, and feature-flag rollback | V1 automated gate |
| V2-01 | [Skill bundles and router memory](phase-01-skills-router-memory.md) | Rich skills, agent-oriented routers, bounded context packs, and a unified second-brain graph | V2-00 |
| V2-02 | [Headless Claude and Codex runtime](phase-02-headless-claude-codex.md) | Safe, observable local CLI runs with staged outputs and normalized events | V2-00; V2-01 context contract |
| V2-03 | [Routines, runs, and artifact lineage](phase-03-routines-runs-artifacts.md) | Headless-aware schedules, resource controls, run inspection, and a searchable artifact catalog | V2-01, V2-02 |
| V2-04 | [Applications and micro apps](phase-04-apps-microapps.md) | Unified connectors, widget data sources, and isolated custom micro apps | V2-00; V1 P06/P08/P09 |
| V2-05 | [Visual command center prototype](phase-05-command-center.md) | Retain service/view-model lessons while explicitly superseding its current visual shell | V2-01, V2-03, V2-04 |
| V2-06 | [Design-system reset](phase-06-design-system-reset.md) | Make the reference-derived design rules binding and retire the old sidebar/chrome patterns | V2-05 research prototype |
| V2-07 | [Whole-product redesign](phase-07-product-redesign.md) | Redesign every current page with the new shell, panels, motion, and transitions | V2-06 |
| V2-08 | [Knowledge globe and artifact ring](phase-08-knowledge-globe-artifact-ring.md) | Build the real Markdown relationship globe with reviewed artifacts around it | V2-01, V2-03, V2-06 |
| V2-09 | [Next.js component artifact runtime](phase-09-nextjs-artifact-runtime.md) | Replace new HTML artifacts with constrained, design-system-native component packages | V2-03, V2-06 |
| V2-10 | [Artifact security review and capabilities](phase-10-artifact-security-review.md) | Gate every component version through deterministic and agent review, then mediate explicit filesystem/MCP capabilities | V2-09; V2-02/V2-04 permission contracts |
| V2-11 | [Hardening and release](phase-11-hardening-release.md) | Migration, design fidelity, artifact security, scale, real CLI, native, and packaged release evidence | V2-00–V2-10 |

Dependencies are real gates, not a requirement to serialize unrelated design work. V2-04 connector contracts may proceed beside V2-01 after V2-00. V2-08 graph-data work and V2-09 artifact-package schema may proceed in parallel after their stated dependencies, but artifact capability exposure waits for V2-10 and release waits for V2-11.

## MoSCoW priority

### Must have

- Existing workspace isolation and every V1 workflow remain intact.
- Rich skill bundle format and migration from current versioned skills.
- Router/context packs with visible provenance and size controls.
- Claude and Codex headless providers with preflight, cancellation, staged writes, and redacted journals.
- Awake-only routine integration and a durable artifact catalog.
- Command-center widgets for skills, routines, artifacts, run status, and second brain.
- Binding reference-derived design system, no permanent sidebar, and migration of every current page.
- A data-backed Markdown knowledge globe with reviewed artifacts on its outer ring and an accessible list/tree equivalent.
- New artifacts generated as constrained Next.js/React component packages using the Voidra design-system SDK.
- Deterministic security checks plus an independent security-review agent for every artifact digest before enablement.
- Version/workspace-scoped capability grants for filesystem and MCP access through a typed broker; no ambient bridge.
- Unit, integration, production-built Electron Playwright, adversarial security, and opt-in real CLI acceptance.

### Should have

- First selected calendar/email connector surfaced through normalized widgets.
- Layout presets, widget templates, graph saved views, and artifact lineage filters.
- Import/export for portable skill bundles and command-center layouts.
- Resume for compatible provider sessions only after ownership and revocation semantics pass.

### Could have

- Excalidraw-style landing pad, creator metrics, and user-authored widget templates.
- Optional Syncthing documentation for user-managed file sync, without making it a Voidra trust or correctness dependency.
- Connector recommendation assistant that proposes official sources before community adapters.
- User-authored artifact templates after the same build, review, and capability gates.

### Will not have in V2

- A cloud/VPS runtime that continues while the Mac sleeps.
- Silent submission to Claude/Codex, automatic permission bypass, or unreviewed canonical writes.
- Automatic installation of community connectors, CLIs, skill scripts, or dependencies.
- A general Node/React plugin executing in the privileged Electron renderer, arbitrary NPM dependencies in generated artifacts, or server components supplied by artifacts.
- Newly generated standalone HTML artifacts. Existing HTML remains a quarantined/read-only legacy format until converted or archived.
- Security approval based only on an LLM verdict; deterministic checks and runtime isolation remain mandatory.
- Claims that a fixture test proves live provider, macOS permission, network, signing, or subscription behavior.

## Delivery checkpoints

1. **ARMS foundation:** V2-00 and V2-01; existing users can migrate and use bundles/routers without headless execution.
2. **Local agent runners:** V2-02; attended Claude/Codex runs produce reports and staged diffs.
3. **Repeatable work:** V2-03; selected headless runs can be scheduled while awake and produce indexed artifacts.
4. **Connected workspace:** V2-04; connectors and micro apps expose normalized data without expanding renderer privilege.
5. **Prototype learning:** V2-05; retain contracts and discard the old visual direction.
6. **Visual reset:** V2-06 and V2-07; the new reference-derived system governs the command center and every deep page, with no permanent sidebar.
7. **Living second brain:** V2-08; the center globe is backed by Markdown relationships and the outer ring by reviewed artifacts.
8. **Component artifacts:** V2-09 and V2-10; artifacts are design-system-native components with digest-bound review and least-privilege capabilities.
9. **Release candidate:** V2-11; migration, fidelity, scale, artifact security, real CLI, packaged, and remaining selected V1 gates have evidence.

Story points are relative (1/2/3/5/8). No story may be 13 points or larger; split it first. Dates must not be inferred until team capacity and V2-00 measurements establish velocity.

## Delivery board

Use `Backlog → Ready → In Progress → Review → Evidence → Done`.

- Backlog is ordered by the phase dependencies and MoSCoW priority above.
- Ready requires the phase definition of ready and an accepted/provisional answer for every gating question.
- In Progress has a default WIP limit of one phase-changing story per engineer; security/migration review may proceed independently.
- Review means implementation and code review are complete but required automated evidence is not yet attached.
- Evidence contains passing tests, measurements, migration results, and honest live/native boundary labels.
- Done requires the phase exit criteria; a UI demo or fixture provider alone cannot move a story to Done.

## Cross-phase test strategy

### Unit and integration

- Use fixture CLI executables that emit valid, partial, malformed, oversized, delayed, and contradictory Claude/Codex streams.
- Exercise real child processes without network or credentials to prove stdin handling, sanitized environment, exit classification, timeout, cancellation, and descendant cleanup.
- Use real temporary SQLite/files for migrations, bundle versions, routers, runs, artifact manifests, review verdicts, capability grants, and layouts.
- Compile generated artifact fixtures with valid, forbidden-import, traversal, dependency-confusion, dynamic-code, oversized, and malicious capability cases; bind every verdict and grant to the artifact digest.
- Test wrong-workspace IDs, revoked shared bases, changed source revisions, symlink/hardlink escapes, malicious project settings, unsafe widget payloads, and restart recovery.
- Keep the existing domain branch-coverage floor and add explicit scenario gates; coverage percentages do not replace isolation and destructive-action tests.

### Playwright Electron

- Launch the production-built Electron application with temporary app data, workspaces, CLI fixtures, MCP fixtures, local connector servers, and artifact bundles.
- Verify the entire path from a dashboard skill click to a streamed run, cancellation or review, artifact registration, and graph/dashboard refresh.
- Verify keyboard-only dashboard use, accessible alternatives, saved layouts, workspace switching, and Stop All.
- Never place real Claude/Codex authentication, personal provider accounts, or host files in the default automated suite.

### Real-system acceptance

- Read-only CLI discovery/version tests are safe by default.
- Each real inference smoke is opt-in, names the provider/model/configuration shown by the CLI, states that usage may be consumed, uses a synthetic temporary workspace, and records no credential material.
- Claude and Codex are accepted separately. Passing one never implies the other works.
- Physical sleep/wake, Notification Center, signed native helper, Accessibility, microphone/voice, browser session, phone/TLS/LAN, signing, and notarization retain separate evidence labels.

## Refinement register

The plan can begin with the provisional defaults below. These are not treated as user answers.

| ID | Question | Provisional default | Gate |
| --- | --- | --- | --- |
| V2-Q01 | Should V2 become the default home immediately or remain opt-in until release? | Feature-flagged through V2-10; default only after V2-11 | V2-07/11 |
| V2-Q02 | Which live calendar/email provider should supply the first real widgets? | Build provider-neutral contracts and fixtures; require a user choice before live acceptance | V2-04/11 |
| V2-Q03 | May an unattended headless run write back automatically? | Only a named trusted routine with an exact standing writeback grant; otherwise review | V2-02/03 |
| V2-Q04 | May headless providers use the network or their own MCP configuration? | No; provider network for inference/auth only, with Chrome/MCP/custom hooks disabled unless separately reviewed | V2-02 |
| V2-Q05 | Should compatible CLI sessions persist for resume? | One-shot/ephemeral by default; add resume only after revocation and ownership tests | V2-02/03 |
| V2-Q06 | What corpus size should the second brain target? | Index 60,000 synthetic files; render/query progressively instead of loading a 60,000-node DOM/SVG | V2-01/08/11 |
| V2-Q07 | Can custom micro apps run JavaScript? | Yes, but migrate them to the reviewed component-artifact boundary; no direct Electron/Node bridge | V2-04/09/10 |
| V2-Q08 | How exact should the visual clone be? | High fidelity for composition, density, hierarchy, motion, and interaction; original Voidra brand/content/assets and no copied source code | V2-06/07 |
| V2-Q09 | May generated artifacts include third-party packages? | No arbitrary packages in V2; imports are limited to React and the pinned Voidra artifact SDK allowlist | V2-09 |
| V2-Q10 | May security approval grant capabilities automatically? | No; review establishes code eligibility, while users/standing policy separately grant each capability | V2-10 |
| V2-Q11 | Can a security finding be overridden? | Low/medium may be explicitly accepted with a logged rationale; high/critical remains blocked until a new digest passes | V2-10 |
| V2-Q12 | How are legacy HTML artifacts handled? | Read-only legacy preview behind its existing isolation; no new creation, and conversion produces a new reviewed component version | V2-09/10 |

## Definition of ready

A phase is ready when its dependencies have recorded evidence, affected provisional decisions are either accepted or explicitly used, migrations have rollback fixtures, threat boundaries are named, and every story has points, dependencies, and testable acceptance criteria.

## Definition of done

A V2 phase is done only when:

- Its unit/integration and production-built Electron journeys pass.
- Existing V1 tests remain green and persisted V1 fixtures migrate without loss.
- Workspace isolation, revocation, cancellation, and restart cases pass.
- User documentation and the requirement matrix state what is implemented and what remains simulated or pending.
- Any provider/native/live claim links to evidence from that real boundary.
- Feature flags support safe rollback without downgrading or deleting canonical user data.

V2 as a whole is complete only after V2-11 and the selected remaining V1 live gates pass. A polished dashboard, an agent-approved artifact, or a fixture-only provider result by itself is not completion.
