# Voidra

Voidra is a local-first, workspace-scoped personal assistant for macOS. The repository follows the phased implementation plan in [`plan/main.md`](plan/main.md); P00–P04 are complete and P05 is in progress.

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

P00 establishes the static Next.js shell, a narrow Electron preload bridge, a supervised local service, durable SQLite schema handling, an isolated-content probe, and automated test harnesses. P01 adds real workspace registration/relocation, default and ask-on-startup behavior, settings inheritance, personas, opaque account references, and scoped instruction pairs. P02 adds canonical Markdown editing and recovery. P03 adds independently granted shared bases, source-labeled accessible search/graph, shared-write conflicts and locking, and inspectable workspace memory. P04 adds versioned skills/routines, locally compiled Claude/Codex prompts, explicit clipboard handoff states, and previewed output application.

Automatic agents, tools, browser/artifacts, voice, and remote access remain in later phases and are intentionally represented only as placeholders.

See [`docs/architecture/0001-foundation-boundaries.md`](docs/architecture/0001-foundation-boundaries.md) for the decisions and test/release differences.
Workspace ownership and inheritance decisions are recorded in [`docs/architecture/0002-workspace-context.md`](docs/architecture/0002-workspace-context.md).
Markdown storage and recovery decisions are recorded in [`docs/architecture/0003-markdown-storage-recovery.md`](docs/architecture/0003-markdown-storage-recovery.md), with measured evidence in [`docs/verification/p02.md`](docs/verification/p02.md).
Shared knowledge, graph, and memory decisions are recorded in [`docs/architecture/0004-shared-knowledge-graph-memory.md`](docs/architecture/0004-shared-knowledge-graph-memory.md), with evidence in [`docs/verification/p03.md`](docs/verification/p03.md).
Manual skill/routine handoff decisions are recorded in [`docs/architecture/0005-manual-handoff-boundary.md`](docs/architecture/0005-manual-handoff-boundary.md), with evidence in [`docs/verification/p04.md`](docs/verification/p04.md).
