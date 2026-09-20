# Voidra — planning and feature decisions

Research date: 2026-09-20. Status: planning baseline incorporating the user's decisions; proposed implementation details and autonomy defaults are identified below. P00–P04 implementation completed on 2026-09-20; detailed progress is tracked in the phase index and implementation records.

Detailed implementation phases now live in [plan/main.md](plan/main.md). That index owns the phase sequence, refinement-question register, and unit/Playwright E2E strategy. This document retains product decisions and research context; phase-level dependencies supersede the earlier candidate S-number backlog below.

## Confirmed by the user

- Build a Jarvis-like personal assistant that helps manage the user's life and computer.
- Target macOS first.
- Use Next.js with Electron.
- Include an MCP marketplace and the ability to add custom MCP servers.
- Include a Markdown editor and preview.
- Include an Obsidian-like knowledge graph with links and tag search that highlights related content.
- Include browser support for displaying HTML artifacts.
- Support multiple customizable workspaces, such as Work and Personal, each with its own memory, assistant persona, settings, and separate local directory.
- Choose the default workspace location during initial setup/opening; choose another directory for each additional workspace.
- Support knowledge bases explicitly shared with selected workspaces through Settings.
- Provide global settings and workspace overrides; workspace values take precedence while operating in that workspace.
- Use local folders with an index.
- Provide Plan the Day as the default job and allow users to create and customize other jobs.
- Include ordinary web browsing and agent-controlled browsing.
- Support text, push-to-talk, conversational voice, wake word, and remote access. This records the user's answer of "all of them" to that list; remote access still operates through the awake Mac.
- Use OpenRouter for automatic API-backed execution (interpreting "open routers" as the service name).
- Let each skill/routine choose automatic OpenRouter execution or manual handoff to the user's Claude or Codex subscription client, with a preferred model and a prompt copied to the clipboard.
- Use root and scoped `AGENTS.md` instructions, with a sibling `CLAUDE.md` containing `@AGENTS.md` beside every such file.
- Use the user's ElevenLabs voice for assistant speech; actual credentials and voice ID are setup inputs, not needed during planning.
- Run tasks while the Mac is awake. Cloud execution while the Mac sleeps is outside the selected execution scope.
- The original planning session was planning-only. The user subsequently authorized implementation beginning with P00.
- Implementation planning must include unit testing and Playwright end-to-end testing, with detailed phase documents linked from `plan/main.md`.

## Recommended defaults and remaining implementation choices

The user requested an autonomy recommendation: use bounded autonomy with per-job standing permissions, described below. These defaults are recommendations rather than previously accepted requirements.

- Keep private memory and browser sessions separate by workspace. Share knowledge only through explicitly attached knowledge bases.
- Attach shared knowledge read-only by default; allow explicit editing access per workspace.
- Use a static Next.js interface with a narrow Electron bridge and a managed local agent service. Reassess only if an identified feature needs a local Next.js server.
- Use SQLite for local metadata/full-text indexing as an initial architecture recommendation; notes remain ordinary Markdown files. Vector retrieval can be added where useful without making the graph depend on embeddings.
- Select exact editor, graph, wake-word, remote-transport, and automation libraries during technical design. Calendar/task providers and the user's actual ElevenLabs voice are onboarding choices.
- No additional personal-workflow examples are required to proceed with this planning baseline: Plan the Day and customizable jobs are now selected.

## Research references and applicability

The observations below come from official documentation and repositories. No applications were installed or tested. The suggested uses are design judgments, not claims that a product already provides Voidra's complete feature set. Features on a repository's main branch may differ from its released application.

| Reference | Documented capabilities relevant here | Suggested use in Voidra planning |
| --- | --- | --- |
| [OpenClaw](https://github.com/openclaw/openclaw) | Personal assistant on user devices, multiple communication channels, persistent state and memory | Assistant continuity and background execution |
| [OpenClaw memory](https://docs.openclaw.ai/concepts/memory) and [heartbeat](https://docs.openclaw.ai/gateway/heartbeat) | Searchable persistent memory and proactive checks | Editable memory, context retrieval, and meaningful follow-ups |
| [Goose](https://github.com/aaif-goose/goose) and [extensions](https://goose-docs.ai/docs/getting-started/using-extensions/) | Local agent execution, model providers, MCP extensions, custom local and remote connections | Tool management and execution behavior |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio) | Desktop model client, custom assistants, MCP integration, Markdown rendering | Provider settings and assistant configuration; distinguish README roadmap items from shipped features |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | Document knowledge, cited answers, workspace agents, MCP support | Retrieval over personal documents and visible sources |
| [LobeHub](https://github.com/lobehub/lobehub) | Agent groups, projects, shared writing pages, schedules, editable memory | Agent organization and shared task context |
| [Kortix / Suna](https://github.com/kortix-ai/suna) | Agents, skills, memory, connectors, isolated sessions, reviewed changes, triggers | Reviewable work and reusable routines |
| [Claude / Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork) and [artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) | Multi-step work and outputs displayed alongside conversations | Assistant-to-deliverable interaction |
| [Manus Browser Operator](https://manus.im/blog/manus-browser-operator) and [schedules](https://manus.im/blog/manus-schedules) | Browser operation, user takeover, recurring work retaining task context | Browser tasks and persistent routines |
| [Obsidian graph](https://obsidian.md/help/plugins/graph), [tags](https://obsidian.md/help/tags), and [links](https://obsidian.md/help/links) | Note links, local/global graph, filtering, color groups, tags, internal-link updates on renaming | Knowledge navigation and link behavior |

Source availability differs: Goose is Apache-2.0, AnythingLLM is MIT, and Cherry Studio is AGPL-3.0 according to their repositories. LobeHub uses a [community license](https://github.com/lobehub/lobehub/blob/main/LICENSE); Kortix's current [license](https://github.com/kortix-ai/suna/blob/main/LICENSE) is Elastic License 2.0. Claude and Manus are commercial product references. Selecting any codebase for reuse requires a separate assessment; no fork or reuse decision has been made.

## Proposed product experience

One assistant experience, accessible through a quick panel and a full workspace, with a customizable persona and memory for each workspace. Specialized agents may be added behind that experience if workflows justify them.

The full workspace contains Today, conversations and jobs, notes, the graph, integrations, browser/artifact tabs, and Settings. A menu bar entry exposes running work and cancellation. A visible workspace name accompanies chat, voice, browser control, and remote sessions so their operating context is clear.

The default workflow is Plan the Day: read the current workspace's goals, unfinished tasks, relevant shared knowledge, and connected calendar where configured; propose priorities and time blocks; save an editable daily plan. External calendar changes are a separate action governed by the user's job permissions. A workspace with no calendar connection still supports planning from local goals and tasks.

Another supported workflow: select notes tagged with a project, research a question using connected tools, save a report linked to its sources, and open an HTML dashboard generated from the result.

## Workspace directories and onboarding

On first opening, show Create Workspace or Open Existing Workspace and a native folder picker. The user selects the name and directory for the default workspace before notes, memory, or project settings are created. Additional workspaces repeat this flow with another directory. A saved default can be changed in global settings; subsequent launches open it unless the user chooses a workspace from the launcher. Offer an "ask on startup" preference.

Proposed storage layout (descriptive, not generated application files):

| Location | Contents |
| --- | --- |
| Application support directory | Global defaults, workspace registry containing IDs and directory references, default-workspace selection, device preferences |
| Each workspace root | Its own knowledge, memory, persona, settings, conversations, jobs, artifacts, and index |
| `knowledge/` within a workspace | Private Markdown notes and attachments |
| `memory/` within a workspace | Editable assistant memories with provenance; separate from conversation history |
| `persona.md` within a workspace | Workspace-specific assistant identity, tone, preferences, and instructions |
| Root `AGENTS.md` and `CLAUDE.md` | Workspace-wide operating rules and the Claude-compatible import reference |
| Scoped `AGENTS.md` and `CLAUDE.md` pairs | Additional rules for a project or subdirectory that needs distinct behavior |
| `skills/` within a workspace | User-editable reusable skill instructions and supporting resources; a routine selects a skill and execution mode |
| `.voidra/` within a workspace | Workspace overrides, knowledge-base attachment references, job definitions, task state/history, schema version, rebuildable index |
| `artifacts/` within a workspace | Generated HTML and supporting assets |
| A selected shared knowledge directory | Markdown notes/attachments and knowledge-base identity; no automatic inclusion of the owner's private memory, conversations, settings, or credentials |
| macOS credential storage | OpenRouter/ElevenLabs keys and connected-account credentials; configuration stores references rather than plaintext secrets |

- Use stable workspace and knowledge-base IDs, with paths as relocatable references.
- Prevent registering the same canonical directory twice; resolve symlinks when checking identity. Recommend rejecting overlapping workspace roots to avoid accidental ingestion of another workspace.
- Do not silently create a new empty workspace if its original directory is unavailable. Show Locate Folder and retain its identity/settings.
- Indexes are derived and rebuildable. Conversation history, job state, and settings are durable records and must not be treated as disposable cache.
- Writes detect outside edits; renames update links; simultaneous edits use conflict detection rather than last-writer-wins data loss.
- Switching the visible workspace does not reassign existing jobs. Each task keeps its originating workspace, persona, knowledge access, output paths, and account bindings. Local GUI-control tasks need a single device-wide execution queue because workspaces share the same Mac desktop.

## Shared knowledge bases

Settings → Workspace → Knowledge Bases allows creating a base, attaching an existing base/folder, and choosing which registered workspaces may access it. Sharing a private workspace base is allowed only by explicitly selecting that base or knowledge folder; sharing a workspace root is not the default.

Example: Work and Personal have separate private knowledge and memory. Both may attach a Learning knowledge base. Work cannot search Personal's private notes, and sharing Learning does not share either workspace's persona or browser logins.

Recommended behavior:

- Attach the same underlying base by reference instead of copying Markdown into every workspace.
- Each attachment exposes a name, location, availability, and read-only or read/write access. Editing access requires an explicit setting.
- Retrieval, tag search, graph, backlinks, and agent tools operate on the active workspace's private base plus explicitly attached shared bases. Indicate each result's source base.
- Identify graph nodes by knowledge-base ID and document ID. Duplicate note names require disambiguation; tag highlighting can span attached bases without merging their note identities.
- Preserve portable Markdown links within a base. For cross-base links, store an explicit base reference and show an unavailable target if it is no longer attached.
- Track file changes once per physical base and invalidate derived results in attached workspaces. A missing shared directory is shown as unavailable rather than an empty base.
- Shared edits use conflict detection and history. Read-only mounts must block writes through the editor and agent file tools.
- Detaching stops future search, retrieval, and tool access and removes that base from the workspace graph. It never deletes shared source files. Removing already quoted content from conversation history is a separate explicit operation; detaching cannot retract information already sent to a model provider.
- Revalidate access before each retrieval/tool call. Resume an affected conversation with fresh context if prior shared content would otherwise be replayed after revocation.
- Workspace separation governs Voidra's own context and capabilities. A local MCP process or arbitrary shell tool is not sandboxed merely because a workspace directory or MCP root was supplied; broad tools need an enforced execution boundary or must be clearly configured as device-wide capabilities.

## Global settings and workspace overrides

Precedence is application defaults → global settings → explicit workspace overrides. A setting not overridden inherits its global value. Show its effective value and origin, with Reset to Global for each override.

- Global defaults cover execution mode/client/model, voice, base persona, job preferences, autonomy defaults, and appearance. Workspace overrides can select different execution defaults, an ElevenLabs voice, persona, enabled tools/accounts, job behavior, and appearance.
- Evaluate structured settings per defined field. A missing field inherits; explicit false, an empty string where valid, or an empty list is a deliberate override. Lists replace inherited lists unless their editor explicitly offers per-item inheritance.
- A workspace persona replaces the global persona text rather than concatenating conflicting identities; provide Copy Global Persona as a starting point. Private memory never follows settings inheritance.
- An attached shared knowledge base provides reference material, not implicit settings/persona instructions.
- Device-wide facts such as startup behavior, default workspace, OS permissions, credential storage, and microphone hardware are global-only; label them accordingly.
- Installing an MCP package globally does not automatically connect every workspace to an account. Package reuse, account credentials, and workspace enablement are separate.
- New tasks resolve the owning workspace's effective settings. Running tasks retain a recorded configuration snapshot; access revocations and Stop All take effect immediately. A settings change must not silently switch a running task to another account or workspace.
- Skills/routines inherit the workspace's effective execution defaults and may explicitly select a different execution mode, client, or preferred model for their own run. This is an explicit task configuration, not a modification of global or workspace defaults.

Example: a global OpenRouter model and ElevenLabs voice are inherited by Personal; Work overrides only the model and persona. Changing the global voice affects both, while changing the global model affects Personal and leaves Work's explicit model unchanged.

## Scoped instructions and Claude compatibility

Maintain `AGENTS.md` as the canonical instruction file at each workspace root and at project/subdirectory boundaries that need additional rules. Each has a real sibling `CLAUDE.md` whose complete default contents are `@AGENTS.md` followed by a newline. Keep the rules in one place, without duplicating them in the compatibility file.

- Apply workspace-root rules to its descendants. A more-specific directory's rules refine or override broader rules for that directory's scope; unrelated sibling instructions do not apply.
- Resolve applicable rules for each file/location a task touches, rather than treating one chosen current directory as sufficient for every file in a multi-scope task.
- Global preferences and the workspace's effective persona supply defaults; scoped operating rules constrain the relevant work. Instructions in notes or third-party retrieved content do not become operating rules merely because an agent reads them.
- Instruction prose cannot expand runtime tool grants, shared-base access, or OS permissions. Changing a persona or `AGENTS.md` does not implicitly authorize new accounts or actions.
- When a task may edit a shared base, include that base's explicitly managed rules for its own files. Do not import rules from another workspace just because it also attaches the base.
- When creating a new scoped `AGENTS.md`, create/check its sibling `CLAUDE.md` in the same operation. Do not overwrite an existing user's instruction file or create instructions in every empty directory unnecessarily.
- When opening an existing workspace, detect instruction pairs and show any existing `AGENTS.override.md` or conflicting client-specific instructions; reconcile them explicitly to avoid different clients following different rules.
- Keep rule provenance and scope in the manual prompt. Include the resolved rule text for clients without local file access; file paths and `@` references alone do not transfer file contents into a web chat.
- When the chosen client can access the directory, the handoff identifies the workspace and target paths and asks it to inspect applicable instruction files before work. External clients still enforce their own instruction-loading behavior and permissions.

This matches the intent of [Codex's root-to-directory instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md) and [Claude Code's instruction imports](https://code.claude.com/docs/en/memory). The import pattern supports Claude Code; do not claim that all Claude web/desktop chat modes automatically discover local files or apply nested rules identically.

The repository keeps one root instruction pair because no application subdirectory currently needs different contributor rules. The future workspace creation flow creates its own pair and offers scoped pairs as the user's projects grow.

## Skills and routines: automatic or manual execution

| Execution mode | Model/client selection | What Voidra does |
| --- | --- | --- |
| Automatic — OpenRouter | Select an available API model and configured provider preferences | Run the task and tool loop in Voidra under the workspace/job grants |
| Manual — Claude subscription | Choose Claude as the destination and save a preferred model available in the user's client | Build a reviewable prompt locally and copy it for the user to paste |
| Manual — Codex subscription | Choose Codex as the destination and save a preferred model available in the user's client | Build a reviewable prompt locally and copy it for the user to paste |

The subscription client controls actual model selection and execution. A preferred-model field is a reminder/instruction, not a claim that clipboard text changes the client's model. Do not hard-code a subscription model catalog as guaranteed account availability. Allow a user-maintained choice or "use current client model."

Manual flow:

1. Select a skill/routine, workspace, target scope, execution mode, preferred client/model, and inputs.
2. Build the prompt using local templates and local indexed retrieval: objective, applicable persona/rules, the chosen skill, relevant context and source labels, constraints, requested outputs, and success criteria.
3. Show the exact prompt and included sources in an editable preview. Include selected knowledge only from accessible bases; omit credentials. Distinguish quoted source material from trusted task instructions.
4. On the user's Copy Prompt action, put that text on the clipboard. The user pastes it into the chosen subscription client and selects the desired model there.
5. Record the handoff as Awaiting User / Awaiting Result. Copying does not mean the task ran or completed.
6. Let the user paste a result, attach output files, or explicitly mark the external work complete. Preview imported changes before applying them; link accepted outputs to the original routine/run.

- Prompt assembly works without an OpenRouter API key and makes no hidden LLM, embedding, or subscription API call. Use saved templates plus local keyword/tag/graph selection; optional AI prompt improvement must be explicitly requested and labeled as API usage.
- A skill defines reusable instructions and expected outputs; a routine binds them to workspace inputs, schedule, destination, and execution preference. Built-in Plan the Day supports manual mode as well as automatic mode.
- For an external client without local tools/files, bundle selected context into the prompt or identify attachments the user must provide. Do not imply that Voidra's MCP connections, browser sessions, or local paths automatically exist in that client.
- Voidra records desired constraints but cannot enforce its in-app grants on independently operated external clients. Explain the selected working scope in the prompt and keep local import/apply actions governed by Voidra's own controls.
- If a prompt is too large, require deliberate context reduction or a supported attachment export; never silently drop applicable rules or claim absent files are included.
- A scheduled manual routine prepares a draft handoff and notifies the user while the Mac is awake. It never pastes/submits into a subscription client or overwrites the clipboard in the background. It waits for the user to copy and run it.
- Do not automatically fall back from manual mode to a paid API. Subscription credentials are not imported into Voidra for this feature.
- Optional copy/export is text-only by default, so manual handoff does not require ElevenLabs usage. Voice features remain separately configurable.

## Recommended autonomy model

Default to Assist mode: automatically read approved sources, search, draft plans, create notes/artifacts within the job's writable locations, and perform explicitly requested reversible actions. Require a review for unapproved external commitments, sending/publishing, permanent deletion, or system-level changes.

Offer three workspace defaults, with narrower job-specific grants:

| Mode | Behavior |
| --- | --- |
| Suggest | Research and prepare proposed changes; user applies actions |
| Assist — recommended | Complete normal preparation and scoped reversible work; ask when an action exceeds the existing grant |
| Trusted routines | Execute named jobs within standing permissions, including explicitly authorized external actions, without repeating the same approval every run |

A standing grant specifies actions, folders/accounts/domains, applicable job, and optional limits or expiry. A request such as "create these calendar blocks" is authorization for those blocks; do not ask again without a new ambiguity or changed scope. "Plan my day" alone prepares a plan and does not imply sending invitations or rearranging other people's meetings.

For Plan the Day, recommend automatically preparing the local plan, then offering Apply to Calendar. The user may enable automatic scheduling for a chosen calendar and constraints as a trusted routine. Custom jobs select their output locations and allowed tools/actions when created. Keep a visible activity history and a device-wide stop control; retain recoverable file revisions where feasible.

## Jobs and awake-only execution

- Ship Plan the Day as an editable template, not a hard-coded special case. Users can duplicate it and create custom jobs through conversation or a settings form.
- A job defines its workspace, skill/instructions, inputs, enabled tools/accounts, output destination, on-demand or scheduled trigger, notification behavior, autonomy grant, and automatic/manual execution target.
- Workspace-specific jobs may continue while another workspace is visible; their access and outputs stay bound to their owner. An explicitly configured combined daily plan may use selected sources across workspaces; no automatic cross-workspace aggregation.
- Keep the runtime in the menu bar when the window closes. Full Quit stops execution; sleeping pauses availability. Do not promise unattended work when the Mac is asleep or offline from required providers.
- On wake, recommend one catch-up run for the current day's missed daily plan. Skip older daily-plan runs. Let custom jobs choose skip, run once, or request review for missed occurrences. Persist run IDs to avoid duplicate effects.
- Interrupted external writes require checking the observed result before retrying. Resuming a conversation is not proof that a prior action failed.

## Models, voice, and remote interaction

- In automatic mode, use OpenRouter for reasoning and tool selection. Choose tool-capable models for agent tasks; require image capability when a task needs screenshots. Configure model and fallback preferences globally with workspace and explicit job overrides. Tool execution remains in Voidra, as described by [OpenRouter's tool-calling interface](https://openrouter.ai/docs/guides/features/tool-calling). Manual mode follows the clipboard workflow above instead.
- Use the user's ElevenLabs voice ID for speech output. ElevenLabs documents [streaming speech synthesis](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts) and [real-time transcription](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming). Recommend these as speech components around the same Voidra task runtime, preserving OpenRouter as the reasoning provider.
- Include text, push-to-talk, interruptible conversation, and optional wake-word activation. Local wake-word detection is recommended; choose the engine after testing language support and latency. Show microphone/listening state and a mute control.
- Stop queued speech on interruption; distinguish interrupting speech from canceling an action already underway. A workspace switch starts a new voice context and stops pending output from the previous one.
- Remote access uses an authenticated companion interface paired to the Mac, with explicit workspace selection. Recommend a private connection or authenticated relay with transport encryption; no publicly exposed unauthenticated command endpoint. Commands execute only while the Mac runtime is awake and connected. Queueing stale commands for later is not the default.
- Local file storage does not imply offline inference: selected prompt/context data goes to OpenRouter's selected provider, and enabled speech services receive the relevant audio/text.
- Voice credentials, the exact model, and calendar/task connections are configured during onboarding; they are not prerequisites to complete this plan.

## Detailed feature behavior

### MCP marketplace and custom servers

- Marketplace entries describe the provider, purpose, connection type, configuration requirements, and available capabilities.
- Use existing registry metadata plus curated entries as a possible discovery source. The [official MCP Registry](https://modelcontextprotocol.io/registry/about) supplies discovery and installation metadata; it is not Voidra's installer, credential manager, or execution policy.
- Custom connections support local process configuration and remote URLs. The applicable transport and authentication details need a compatibility review during technical design.
- Proposed setup: choose an entry or add custom configuration, supply settings, connect, inspect capabilities, and choose where it is enabled.
- Provide connection health, useful errors, logs with secrets removed, and reconnect/restart controls.
- Distinguish installing a server, connecting an account, and enabling its tools for a task.
- MCP tools, resources, and prompts are distinct protocol capabilities; decide support explicitly instead of treating tool listing as full MCP support.
- Plan tool discovery/execution, resource listing/reading, and prompt selection as distinct supported host features. Server-initiated sampling and other advanced capabilities need their own policy and compatibility work rather than implicit enablement.
- Keep connection/account bindings and server lifecycle scoped to the owning workspace. Do not reuse a local process across workspaces when its credentials, roots, or mutable state differ.

### Markdown and graph

- Editor and rendered preview share the same document state.
- Support wiki links, backlinks, and tags. Consider standard Markdown links and frontmatter tags for file interoperability.
- Keep three relationship types distinct: an explicit link, a shared tag, and an inferred semantic similarity.
- Proposed tag search highlights matching notes and existing edges while fading other nodes; offer a separate filter-only mode.
- A shared tag does not silently create permanent links between every matching note.
- Clicking a node opens its note. Local graph shows the active note's neighborhood; global graph shows the workspace.
- Renaming inside Voidra should preserve references. External renames, duplicate filenames, missing targets, and concurrent edits need defined behavior.
- Selecting graph results as agent context is recommended, not confirmed.
- Semantic suggestions and people/project entities are possible extensions; they are not substitutes for the confirmed linked-note graph.

### Artifacts and browser

- Confirmed: display HTML artifacts and support ordinary browsing plus agent-controlled browsing. Include source/preview switching and relative CSS, JavaScript, and image assets in the proposed implementation.
- Treat generated content as an isolated preview without access to privileged application APIs. See [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
- Decide network access, persistence, downloads, navigation, and refresh behavior for previews.
- Give each workspace a separate persistent browsing session, tab set, downloads destination, and account context. Electron provides [session partitions](https://www.electronjs.org/docs/latest/api/session); artifact previews use a separate, less-privileged session from signed-in browsing.
- The user can watch, take over, or stop an agent browser task. An agent controls only the tabs assigned to its task. Browser tool results preserve the owning workspace and source URL.
- Use a dedicated browser-control adapter through the same task/permission runtime as MCP and Mac tools. Browser session isolation does not isolate the shared physical Mac desktop.
- Connecting an artifact to its originating conversation and source notes is recommended.

### Personal assistant and Mac control

- Memory should be inspectable, editable, and deletable. Separate personal preferences, source-backed knowledge, and temporary task state.
- Remembering a deadline is separate from registering a runnable reminder or scheduled job.
- Proposed routines retain instructions, required integrations, run history, and outputs. Notify for meaningful results or required attention.
- Use direct integrations and supported app automation where available; use browser or desktop interaction where necessary.
- macOS scripting support varies by app. UI automation needs OS permission; see [Apple's automation guide](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html).
- The OS permission to access an app or screen is separate from Voidra's decision about whether an individual task may act automatically.
- Ask for relevant OS capabilities when the corresponding feature is enabled. [Electron's systemPreferences API](https://github.com/electron/electron/blob/main/docs/api/system-preferences.md) supports checking several permission states.
- A hidden main window coexists with the runtime in the menu bar. Execute only while the Mac is awake, with the missed-run behavior specified above. Remote clients are control surfaces for that runtime, not separate cloud execution hosts.

## Proposed architecture boundaries

| Component | Responsibility |
| --- | --- |
| Next.js interface | Workspace onboarding/switching, Today, chat/voice, editor, graph, browser controls, global/workspace settings |
| Electron host | Windows, menu bar, shortcuts, notifications, OS integration |
| Workspace/configuration service | Directory registry, effective settings, personas, credential references, shared-base attachments |
| Background agent service | Workspace-bound task execution, OpenRouter calls, MCP lifecycle, grants, cancellation, schedules, run history |
| Instruction and handoff service | Scoped rule resolution, local prompt assembly, Claude/Codex destination preferences, clipboard export, result review |
| Mac automation adapter | Files, app scripting, accessibility interaction, screen context where enabled |
| Knowledge store and index | Local Markdown, workspace-private memory, shared-base indexing, links, tags, scoped search |
| Browser adapter | Ordinary tabs and agent-controlled tabs in workspace-specific sessions |
| Isolated preview | HTML artifacts and their assets |
| Speech adapter | Transcription, ElevenLabs output, interruption, push-to-talk and wake-word activation |
| Remote gateway | Paired clients, workspace-bound commands and status, awake-Mac availability |

These boundaries are recommendations. The background service may be a managed child process initially; keeping work alive after full application exit would require a different lifecycle arrangement.

Recommend a static Next.js UI communicating through a narrow Electron bridge. [Static exports](https://nextjs.org/docs/app/guides/static-exports) do not support runtime Server Actions and other server-dependent features, so local operations belong to the background service. The remote companion reaches an authenticated gateway rather than Electron APIs. A bundled Next.js server remains an alternative if a concrete requirement justifies it. Exact libraries are implementation choices rather than unresolved product scope.

## Candidate implementation backlog

This backlog separates confirmed scope from recommended behavior. Points are rough relative estimates, not time commitments. Each item states a user outcome, a minimum acceptance criterion, and dependencies; implementation tickets should expand edge-case coverage before coding. All explicitly requested features remain included.

| ID | User outcome | Minimum acceptance criterion | Depends on | Points | Status |
| --- | --- | --- | --- | --- | --- |
| S1 | Create/open independent workspaces | First launch selects the default directory; adding Work and Personal uses distinct directories; unavailable folders are not silently recreated | Electron packaging, directory registry | 5 | Confirmed |
| S2 | Give the assistant a task and inspect its progress | An OpenRouter tool-capable model executes a bounded task; progress, failure, cancellation, and owning workspace are visible | S1, S13 | 8 | Confirmed provider and goal |
| S3 | Add my own MCP connection | Local and remote test servers connect; tools/resources/prompts appear as supported; errors are actionable and secrets absent from logs | S1, S13, credential storage | 8 | Explicit requirement |
| S4 | Discover MCP servers through a marketplace | An entry guides configuration and connects through the same lifecycle as custom servers | S3, catalog source | 5 | Explicit requirement |
| S5 | Write and preview Markdown notes | Saved edits survive restart and render in preview; external changes are detected without silently losing unsaved edits | S1, local index | 5 | Explicit requirement |
| S6 | Navigate links and backlinks | Linking A to B creates the correct backlink; renaming B within Voidra preserves the relationship | S5, link identity rules | 5 | Explicit requirement |
| S7 | Explore knowledge by links and tags | Nodes open notes; selecting a tag highlights its matching set; explicit edges remain distinguishable from tag membership | S6, tag semantics | 5 | Explicit requirement |
| S8 | View generated HTML artifacts | An HTML file with relative assets displays and refreshes; preview scripts cannot call privileged app APIs | S1, preview policy | 5 | Explicit requirement |
| S9 | Have the assistant use selected knowledge | A task uses selected notes, identifies its sources, and saves an output linked to them | S2, S5, S6 | 5 | Integration proposal |
| S10 | Customize workspace persona and memory | Work and Personal use their own personas/memories; edits change subsequent retrieval; switching does not leak prior voice/chat context | S1, S5, S13 | 5 | Confirmed |
| S11 | Delegate a Mac workflow through a custom job | A user-defined job opens selected apps or organizes files within its grant; device-wide UI tasks serialize; outcomes are inspectable | S2, S16, S17, Mac adapter | 8 | Confirmed goal; representative workflow |
| S12 | Run jobs while the Mac is awake | Jobs retain workspace/context/history; manual schedules prepare handoffs without API credentials; sleep/wake and restart obey missed-run policy without duplicate effects | S16, S17, S24; S2 for automatic execution | 8 | Confirmed |
| S13 | Override global defaults per workspace | Unset fields inherit; explicit false/empty lists override; Reset to Global restores inheritance; global changes preserve explicit overrides | S1 | 5 | Confirmed |
| S14 | Attach shared knowledge to selected workspaces | Work and Personal see an attached base once each, see edits, and cannot retrieve each other's private notes; detach removes future access without deleting sources | S1, S5, S6 | 8 | Confirmed |
| S15 | Plan my day by default | Same template supports an automatic editable plan or manual handoff from local goals/tasks and configured calendar; works without calendar; external writes follow grants | S5, S10, S16, S24; S2 for automatic execution | 5 | Confirmed |
| S16 | Create and customize jobs | Create through form or chat, edit/duplicate, choose skill/tools/inputs/outputs/trigger/execution target, and record workspace/settings; form/manual use needs no API key | S1, S13, S17; S2 for agent-assisted creation | 5 | Confirmed |
| S17 | Set autonomy once for a routine | Standing grant permits matching actions without repeated prompts; out-of-scope actions request review; revocation and Stop All affect subsequent execution | S1, S13 | 5 | Recommended policy requested by user |
| S18 | Browse normally in each workspace | Tabs and cookies survive restart inside their owner; Work/Personal logins stay separate; downloads use the correct destination | S1, S13 | 5 | Confirmed |
| S19 | Ask an agent to operate browser tabs | Agent completes a scoped website task; user can observe/take over/stop; wrong-workspace tabs are inaccessible to that task | S2, S17, S18 | 8 | Confirmed |
| S20 | Speak using push-to-talk and my chosen voice | Speech becomes task input; ElevenLabs voice speaks streamed output; text/voice share task history and workspace selection | S2, S10, speech adapter | 5 | Confirmed |
| S21 | Converse naturally and use a wake word | Wake-word setting activates listening as configured; interruption stops stale speech; mute and workspace switches behave predictably | S20, local wake-word engine | 8 | Confirmed |
| S22 | Reach my assistant remotely | Paired client selects an authorized workspace and submits tasks while Mac is awake; sleeping/offline states are explicit and stale actions are not auto-run | S2, S12, S17, remote gateway | 8 | Confirmed via "all" interaction choices |
| S23 | Search and graph private plus shared knowledge | Tag queries cover exactly accessible bases; duplicate filenames remain distinct; origin and read-only state are visible; detach invalidates graph/search results | S7, S14 | 5 | Confirmed combination |
| S24 | Run a skill/routine through my subscription client | Select Claude or Codex plus preferred model, preview/copy a scoped prompt with no API call/key; scheduled manual runs await user and never overwrite the clipboard | S5, S10, S13, S16, S25 | 5 | Confirmed |
| S25 | Use consistent scoped instructions across agents | New root/scoped AGENTS.md files have sibling CLAUDE.md files containing @AGENTS.md; rule resolution covers each target path, excludes siblings, and preserves scope in handoffs | S1, instruction resolver | 5 | Confirmed |
| S26 | Bring external results back into the workspace | Copying leaves a run awaiting result; user can import outputs or mark external completion; imported files are reviewed and associated with the run | S24, S17 | 3 | Recommended completion flow |

## Recommended implementation sequence

1. Workspace foundation: S1, S13, S25, S5, S6, S14, S7, S23. Establish directory ownership, scoped rules, inheritance, and sharing before agent context depends on them.
2. Skills, jobs, and the assistant: S17, S10, S16, S24, S26, S2, S3, S4, S9, S15. Deliver manual Claude/Codex handoffs, OpenRouter execution, and the daily planner using the same workspace/skill definitions. Keep manual mode independently usable without API credentials.
3. Mac and browser work: S8, S18, S19, S11. Connect the assistant to visible artifacts, ordinary browsing, browser automation, and Mac actions.
4. Persistent interaction: S12, S20, S21, S22. Add awake-only scheduling, the full voice experience, and paired remote access.

This sequence is delivery order, not a reduction of the selected scope. Voice, wake word, remote access, shared knowledge, manual subscription handoffs, scoped instructions, and agent browsing remain planned deliverables. Multi-agent orchestration and device-to-device file sync are optional extensions, not prerequisites for the requested assistant.

## Planning completion and implementation gate

The research comparison, user-selected product scope, workspace/storage design, autonomy recommendation, manual subscription handoffs, scoped instruction convention, and candidate implementation milestones are documented. The repository root instruction pair is present; future workspace/scoped pairs are product requirements, not claimed as implemented. The user opened the implementation gate on 2026-09-20. Provider account setup is still deferred to its owning phases; implementation must not connect personal accounts or execute planned jobs prematurely.
