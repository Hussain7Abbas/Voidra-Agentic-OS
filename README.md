# Voidra

Voidra is a local-first, workspace-scoped personal assistant for macOS. The repository follows the phased implementation plan in [`plan/main.md`](plan/main.md); P00–P06 are complete, P07's automated implementation is complete with live/native acceptance pending, and P08 is next.

## Foundation commands

Prerequisites: Apple Silicon macOS, Node.js 24+, and pnpm 10.30.3.

Run `make` to see the complete, sectioned command reference. The common workflows are:

```sh
make install-frozen
make start
make verify
make release
```

The Makefile delegates to the package scripts below, which remain available directly:

```sh
pnpm install
pnpm start
```

Verification is split so failures identify the affected boundary:

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm package:dir
pnpm smoke:package
```

The Electron suite uses temporary profiles and workspaces. It never needs personal accounts, OpenRouter credentials, or ElevenLabs credentials.

## Current scope

P00 establishes the static Next.js shell, a narrow Electron preload bridge, a supervised local service, durable SQLite schema handling, an isolated-content probe, and automated test harnesses. P01 adds real workspace registration/relocation, default and ask-on-startup behavior, settings inheritance, personas, opaque account references, and scoped instruction pairs. P02 adds canonical Markdown editing and recovery. P03 adds independently granted shared bases, source-labeled accessible search/graph, shared-write conflicts and locking, and inspectable workspace memory. P04 adds versioned skills/routines, locally compiled Claude/Codex prompts, explicit clipboard handoff states, and previewed output application. P05 adds secure OpenRouter credentials, streaming automatic tasks, current-context resolution, enforced file grants, durable journals, limits, cancellation, and crash-safe recovery. P06 adds official Registry discovery, custom stdio and Streamable HTTP connections, encrypted bearer credentials, tools/resources/prompts, exact reviewed MCP calls, lifecycle recovery, and agent integration. P07 adds an editable default Plan-the-Day routine, local tasks and sourced plans, explicit fixture-calendar application, manual/automatic schedules, timezone and missed-run policy, run history, and awake-only notification dispatch.

Provider-specific account flows beyond bearer authorization, browser/artifacts, Mac control, voice, and remote access remain in later phases and are intentionally represented only as placeholders. P07's physical sleep/resume and notification delivery checks remain an explicit acceptance item.

See [`docs/architecture/0001-foundation-boundaries.md`](docs/architecture/0001-foundation-boundaries.md) for the decisions and test/release differences.
Workspace ownership and inheritance decisions are recorded in [`docs/architecture/0002-workspace-context.md`](docs/architecture/0002-workspace-context.md).
Markdown storage and recovery decisions are recorded in [`docs/architecture/0003-markdown-storage-recovery.md`](docs/architecture/0003-markdown-storage-recovery.md), with measured evidence in [`docs/verification/p02.md`](docs/verification/p02.md).
Shared knowledge, graph, and memory decisions are recorded in [`docs/architecture/0004-shared-knowledge-graph-memory.md`](docs/architecture/0004-shared-knowledge-graph-memory.md), with evidence in [`docs/verification/p03.md`](docs/verification/p03.md).
Manual skill/routine handoff decisions are recorded in [`docs/architecture/0005-manual-handoff-boundary.md`](docs/architecture/0005-manual-handoff-boundary.md), with evidence in [`docs/verification/p04.md`](docs/verification/p04.md).
OpenRouter runtime, grants, and recovery decisions are recorded in [`docs/architecture/0006-openrouter-agent-runtime.md`](docs/architecture/0006-openrouter-agent-runtime.md), with evidence in [`docs/verification/p05.md`](docs/verification/p05.md).
MCP catalog, connection, capability, and credential decisions are recorded in [`docs/architecture/0007-mcp-connections.md`](docs/architecture/0007-mcp-connections.md), with evidence in [`docs/verification/p06.md`](docs/verification/p06.md).
Planning, schedule, occurrence, and calendar-application decisions are recorded in [`docs/architecture/0008-awake-scheduler.md`](docs/architecture/0008-awake-scheduler.md), with automated evidence in [`docs/verification/p07.md`](docs/verification/p07.md).
