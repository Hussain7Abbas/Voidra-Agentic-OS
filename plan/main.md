# Voidra implementation plan

Status: P00–P04 completed on 2026-09-20; P05 is in progress. The 14 refinement questions below remain pending. Existing confirmed requirements remain authoritative; provisional defaults used for implementation are not user answers.

## Purpose and source of truth

Build a Jarvis-like personal assistant for macOS using Next.js and Electron. It combines private workspaces, shared knowledge, scoped instructions, Markdown/graph navigation, manual subscription handoffs, OpenRouter agents, MCP tools, daily planning, browser/Mac control, voice, and remote access while the Mac is awake.

This index and its phase files are the implementation source of truth. [PLANNING.md](../PLANNING.md) retains the product decisions and research comparison. [Root instructions](../AGENTS.md) apply; [planning instructions](AGENTS.md) add documentation rules. The user authorized implementation on 2026-09-20; phase prerequisites and safety boundaries still apply.

## Phase index

| Phase | Document | Outcome | Prerequisites |
| --- | --- | --- | --- |
| P00 | [Architecture and test harness](phase-00-foundation-and-test-harness.md) | Prove desktop packaging and testing boundaries | Resolve build/platform decisions |
| P01 | [Workspaces, settings, and instructions](phase-01-workspaces-settings-instructions.md) | Independent workspace directories, inheritance, paired scoped rules | P00 |
| P02 | [Markdown, storage, and recovery](phase-02-markdown-storage-history.md) | Reliable local editing, links, indexing, history | P01 |
| P03 | [Shared knowledge, graph, and memory](phase-03-shared-knowledge-graph-memory.md) | Scoped retrieval and graph across explicit shared bases | P02 |
| P04 | [Skills, routines, and manual handoffs](phase-04-skills-routines-manual-handoffs.md) | Useful Claude/Codex handoffs without API credentials | P01–P03 |
| P05 | [OpenRouter agent runtime](phase-05-openrouter-agent-runtime.md) | Observable, cancellable automatic tasks and enforced grants | P01–P04 |
| P06 | [MCP marketplace and custom servers](phase-06-mcp-marketplace.md) | Discover/configure tools and scoped accounts | P05 |
| P07 | [Daily planning and scheduling](phase-07-day-planning-scheduling.md) | Default daily planner and custom awake-only routines | P04–P06 |
| P08 | [Browser and HTML artifacts](phase-08-browser-artifacts.md) | Workspace browsing, agent tabs, isolated artifact previews | P01, P02, P05 |
| P09 | [Mac automation](phase-09-macos-control.md) | Scoped file/app/desktop actions with takeover | P05, P06; P08 for browser-assisted workflows |
| P10 | [Voice interaction](phase-10-voice.md) | ElevenLabs voice, push-to-talk, interruption, wake word | P05, P07; P09 for voice-triggered desktop actions |
| P11 | [Remote companion](phase-11-remote.md) | Authenticated remote control of the awake Mac | P05, P07; P10 for remote voice |
| P12 | [Release and full-system verification](phase-12-release-verification.md) | Reproducible release with documented evidence | All selected-scope phases P00–P11 |

Each phase includes unit and Playwright E2E coverage. P12 aggregates evidence; it is not the first time tests are written. Dependency-ready work may proceed independently; all device-wide automation is serialized at runtime.

## Confirmed scope

1. macOS first, Next.js with Electron; local folders and a rebuildable index.
2. First-launch default workspace folder selection; distinct folders for additional workspaces.
3. Per-workspace memory, persona, settings, accounts, job context, and private knowledge.
4. Shared Markdown knowledge bases attached to selected workspaces through Settings.
5. Explicit workspace settings override global defaults.
6. Root/scoped AGENTS.md files paired with sibling CLAUDE.md files containing @AGENTS.md.
7. Markdown editor/preview, wiki links/backlinks, graph, and tag search/highlighting.
8. MCP marketplace and custom local/remote connections.
9. OpenRouter automatic execution and Claude/Codex manual clipboard handoffs per skill/routine/model preference.
10. Plan the Day as an editable default job; customizable jobs/routines.
11. Ordinary browsing, agent-controlled browsing, and HTML artifact display.
12. Personal Mac control, text, voice, push-to-talk, conversational interruption, wake word, and remote access.
13. User-provided ElevenLabs voice; execution only while the Mac is awake.
14. Unit testing and Playwright E2E, explicitly requested by the user.

## Refinement questions and provisional decisions

These questions have been sent to the user. Answers should update this table and affected phases. Do not equate unanswered questions with approval of the defaults.

| ID | Question | Provisional default | Affected phases |
| --- | --- | --- | --- |
| Q01 | Usable milestone releases or release only after the whole feature set? | Usable milestones leading to complete v1 | All, P12 |
| Q02 | Apple Silicon initially or both Apple Silicon/Intel? | Apple Silicon initially | P00, P09, P12 |
| Q03 | Personal development build, signed installer, or Mac App Store? | Personal build first; signed installer path retained | P00, P09, P12 |
| Q04 | Which calendar, email, and task applications first? | Local tasks/notes work without accounts; provider choice pending | P06, P07 |
| Q05 | Built-in browser, existing Chrome, or both? | Built-in workspace browser | P08, P09 |
| Q06 | Source/preview, Obsidian-style live preview, or both initially? | Source plus split preview | P02 |
| Q07 | Expected notes per workspace including shared knowledge? | Up to 10,000; measure before committing budgets | P02, P03, P12 |
| Q08 | Shared knowledge read-only or read/write on attachment? | Read-only, with explicit editable grants | P01, P03 |
| Q09 | Built-in history, Git, or both? | Built-in local revisions/restore | P02, P12 |
| Q10 | Interface/spoken languages, including Iraqi Arabic? | No language availability assumed; Unicode data required regardless | P00, P02, P10 |
| Q11 | Private-network remote first or internet access in earliest usable release? | Private network first; internet path remains planned | P11, P12 |
| Q12 | Assist, review every write, or trusted-routine default? | Assist with standing grants per routine | P05–P11 |
| Q13 | Local tests plus GitHub Actions or another CI arrangement? | Local plus GitHub Actions with macOS Electron checks | P00, P12 |
| Q14 | IDE-style, chat-first, or dashboard-first interface? | Sidebar/tabs/split panes with Today and quick assistant panel | P00, all UI phases |

Exact model IDs, the ElevenLabs voice ID, and provider credentials are onboarding inputs rather than planning blockers. Do not request credentials in this document or store real credentials in fixtures.

## Proposed architecture

Use TypeScript for UI and local services, a static-exported Next.js renderer, and Electron for desktop lifecycle. A native macOS helper may be needed for accessibility/app automation; decide its boundary in P00/P09 rather than placing native privileges in the renderer.

| Boundary | Owns | Must not own |
| --- | --- | --- |
| Next.js renderer | UI state, accessible controls, editor/graph presentation | Raw filesystem, secrets, process spawning, direct privileged execution |
| Narrow preload bridge | Validated commands/events with request and workspace IDs | Arbitrary IPC forwarding or unrestricted shell/file APIs |
| Electron main | Window/session lifecycle, dialogs, clipboard, keychain adapter, OS consent | Long-running inference/indexing loops |
| Local service | Workspace/domain logic, agent jobs, schedules, MCP lifecycle, retrieval, journals | Assumption that UI's active workspace controls background tasks |
| Knowledge owner/indexer | Canonical Markdown, revisions, base identity, file events, indexes | Implicit private-data sharing |
| Browser/artifact adapters | Dedicated web sessions and isolated previews | Application credentials or unrestricted privileged bridge |
| Native Mac adapter | Explicit OS operations and a shared-device action queue | Concurrent autonomous control of the same desktop |
| Remote gateway | Paired identities and workspace-scoped commands/events | A second cloud agent that runs when the Mac is asleep |

Initial library candidates: pnpm, TypeScript, Vitest, Playwright Test, SQLite/FTS, CodeMirror for source editing, and a canvas/WebGL graph renderer selected through measurement. These are recommendations; lock exact compatible versions during implementation P00. Do not install them during planning.

Static export omits runtime Next.js Server Actions and other server-only features; use the local bridge for desktop data operations. Remote clients use the authenticated gateway rather than that bridge. See [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports) and [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model).

## Data and execution invariants

- Every task, prompt, retrieval, event, artifact, and tool invocation carries workspace identity and stable run identity.
- Global preferences are defaults; explicit workspace values win. Routine execution fields can make explicit per-run choices. Device-only controls are labeled global-only.
- Knowledge access is private-base plus explicitly attached bases; possession of a source path is not an attachment grant.
- Markdown is canonical content. Indexes are rebuildable; histories, jobs, grants, and settings are durable and require backup/migration.
- Treat task intent, observed action results, and completion as different records. A network timeout is not proof an external write failed.
- Manual handoff never calls inference/embedding APIs, submits to a subscription client, or marks success merely because a prompt was copied.
- Persona/rules cannot grant OS/tool permissions. External subscription clients retain their own permissions; generated prompts are guidance rather than an enforcement boundary there.
- Closing the window can leave the menu-bar runtime alive; full Quit and system sleep stop availability.
- Shared edits/revocation, workspace changes, and permission changes are handled explicitly during ongoing tasks.

## Testing strategy

### Unit tests — proposed Vitest

- Test settings merge semantics, scoped rules, link/tag parsing, grants, job transitions, prompt compilation, scheduling, and routing decisions as domain behavior.
- Use fake clocks and transport interfaces where appropriate. Assertions must cover wrong-workspace and failure cases, not only happy paths.
- Use real temporary SQLite databases/files in focused storage integration tests, also run by the unit-test toolchain; label them integration tests rather than pretending pure mocks prove persistence.
- Use component tests only for behavior hard to isolate otherwise; avoid snapshots of entire implementation trees.
- Start with a proposed 80% branch-coverage floor on domain packages, combined with explicit scenario coverage for isolation, grants, and recovery. Revisit after initial coverage measurement; coverage percentage never substitutes for required scenarios.

### End-to-end tests — Playwright

- Desktop suite launches a real Electron build and uses the packaged Next.js UI, real IPC, local files, and a local service.
- Run web-only/component companion tests separately; passing Chromium tests alone does not prove Electron works.
- Use local HTTP/WebSocket provider fixtures, real test MCP child processes, temporary workspaces, isolated application data, and dedicated browser profiles.
- Native folder dialogs may be stubbed at the Electron main-process boundary; the selected real temporary folder still flows through production validation/storage. Check cancellation too.
- Verify embedded browser/preview target discovery in P00. Do not assume every WebContentsView appears as a normal Playwright page. If needed, test its observable behavior through a documented test adapter plus native release checks; report the boundary honestly.
- Use accessible locators, condition-based assertions, and fixture cleanup. Capture traces/screenshots/logs on failure using synthetic data and redact configured secrets.
- Default automated suites require no real OpenRouter/ElevenLabs tokens or personal accounts. Live provider tests are opt-in, separate, and bounded.
- Native permission dialogs, physical microphones, wake-word accuracy, sleep/wake, native UI takeover, signing, and installation require dedicated macOS acceptance checks in addition to automated mocks.
- Playwright's Electron API is experimental and has a documented launch-fuse caveat. Do not weaken release configuration to satisfy test launch; validate any test/release configuration difference and test the actual distributable separately. See [Electron automation](https://playwright.dev/docs/api/class-electron), [test fixtures](https://playwright.dev/docs/test-fixtures), and [Vitest](https://vitest.dev/guide/).

### Shared fixture catalog

| Fixture | Purpose |
| --- | --- |
| Work and Personal roots | Different personas/settings; same filenames and private sentinel text to expose leaks |
| Shared Learning base | Two attachments with different access; duplicate-title links; detach/move/unavailable cases |
| Nested rule tree | Root/child/sibling rules and valid/invalid CLAUDE.md pairs |
| Local provider server | Streaming, malformed tools, rate limits, failure after potential side effects, offline behavior |
| MCP fixture servers | Local stdio and remote transport, auth failures, hangs, crashes, changing capability lists |
| Local browser site | Login cookie, redirects, frames, forms, downloads, and user takeover |
| HTML bundle | Relative assets, script interaction, attempted traversal/privilege access, broken asset |
| Clock/power adapter | Timezone changes, daylight-saving transitions, suspend/resume, duplicate timer events |
| Audio fixture | Silence, partial/final transcript, interruption, disconnect, workspace switch |

## Requirement-to-phase coverage

| Requirement | Owning phases | Representative acceptance evidence |
| --- | --- | --- |
| Next.js/Electron on macOS | P00, P12 | Built renderer launches in Electron; distributable smoke |
| First/default and additional workspace directories | P01 | Two folders, restart, missing-folder recovery |
| Global/workspace settings and persona | P01, P03 | Inheritance and overrides through UI; no cross-context leakage |
| Root and scoped AGENTS/CLAUDE pairs | P01, P04 | Per-target rule resolution; exact imports; prompt content |
| Local Markdown/index/history | P02 | Edit/restart/rebuild/conflict/restore scenarios |
| Shared knowledge and private memory | P03 | Visibility matrix, write grants, detach/revoke, memory edit |
| Links, graph, tags | P02, P03 | Rename/backlinks, scoped graph and tag highlighting |
| Manual Claude/Codex model handoffs | P04 | Clipboard contains correct context; zero model calls |
| OpenRouter model choice and agent loop | P05 | Stream/tool/cancel/error fixtures and recorded model |
| MCP marketplace/custom connections | P06 | Catalog-to-connection, stdio/remote, tools/resources/prompts |
| Plan the Day/custom routines | P04, P07 | Default editable template, manual/automatic paths |
| Autonomy and grants | P05–P09 | Authorized actions proceed; exceeded/revoked grants do not |
| Awake-only operation | P07, P11 | Resume policy, no duplicate actions, remote offline state |
| Ordinary/agent browsing and HTML | P08 | Session separation, takeover, isolated artifact interaction |
| Mac control | P09 | Supported app/file workflow and native acceptance |
| ElevenLabs voice, conversation, wake word | P10 | Audio fixture tests plus physical-device measurements |
| Remote access | P11 | Pair/revoke/scope/offline from companion browser |
| Unit and Playwright E2E | Every phase, P12 | Linked scenario results, traceability and release gate |

## Delivery checkpoints and estimates

Provisional checkpoints: knowledge workspace (P00–P03), manual assistant (P04), connected planner (P05–P07), computer assistant (P08–P09), full interaction (P10–P12). These are usable increments, not permission to omit later confirmed features. Q01 may change release timing without deleting scope.

Stories use relative points (1/2/3/5/8); no story is 13+. Dependencies appear in each phase. Do not convert points to dates until team capacity, selected answers, and P00 spikes establish velocity. External APIs, macOS permissions, browser control, and voice remain the largest uncertainty areas.

## Definition of ready and done

A phase is ready when prerequisites are demonstrated, affected unanswered questions are resolved or its default explicitly accepted for implementation, and its stories have testable outcomes. Drafting these documents does not require all questions to be answered first.

A phase is done only when its unit tests, specified Playwright E2E cases, real-system acceptance checks, failure/recovery behavior, and documentation pass. Preserve evidence showing what was real and what was simulated. The full product is complete only when every selected requirement above has acceptance evidence; documentation alone is not product implementation.

## Decision update workflow

Record replies against Q IDs, update affected phase assumptions/acceptance criteria, and add targeted follow-up questions where needed. Preserve explicit user choices and flag conflicts. Technical research links are references, not permission to change selected product requirements.
