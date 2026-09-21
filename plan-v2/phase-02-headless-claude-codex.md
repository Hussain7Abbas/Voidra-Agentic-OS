# V2-02 — Headless Claude Code and Codex runtime

[V2 index](main.md) · Previous: [V2-01](phase-01-skills-router-memory.md) · Next: [V2-03](phase-03-routines-runs-artifacts.md)

Status (2026-09-21): **automated implementation complete; live acceptance pending**. Exact executable discovery/fingerprinting, direct argument spawning, sanitized snapshots, read-only and staged-write profiles, bounded normalized journals, cancellation/process-group cleanup, restart interruption, exact diff review, stale-source denial, and durable reviewed writeback are implemented with fixture coverage. Real authenticated Claude and Codex inference/cancel/write smokes still require explicit user authorization and remain V2-11 evidence.

## Outcome

Run installed Claude Code and Codex CLIs as first-class, supervised Voidra providers. A user can choose a skill, preview its exact context and execution profile, start a read-only or staged-write run, observe normalized events, cancel it, and review outputs without exposing another workspace or silently changing canonical files.

This phase adds local headless execution; it does not replace manual handoff or OpenRouter, automate CLI login, promise subscription eligibility, enable always-on cloud execution, or permit provider danger/bypass modes.

## Common executor contract

```ts
type HeadlessRunRequest = {
  runId: string;
  workspaceId: string;
  provider: "claude-code" | "codex";
  executableId: string;
  contextPackDigest: string;
  model: string | null;
  effort: string | null;
  access: "read-only" | "staged-write";
  limits: { wallMs: number; idleMs: number; outputBytes: number; turns?: number; budgetUsd?: number };
  allowedCapabilities: string[];
};
```

The provider adapter owns discovery, preflight, argument construction, stdin framing, event parsing, capability mapping, graceful cancellation, hard termination, and exit classification. The common broker owns queueing, staged workspace creation, environment filtering, process-group lifecycle, journal limits, and workspace/run authorization.

## Provider launch profiles

Exact flags are negotiated from the approved binary's capabilities. The initial target behavior is:

### Claude Code

- Non-interactive `-p` with `stream-json`, verbose events, explicit model/effort only when supported, maximum turns, no session persistence by default, no Chrome, and an exact tool allowlist.
- Read-only profile exposes only bounded file-reading/search tools inside the staged workspace.
- Staged-write profile may expose file edit/write tools inside the staged workspace. Shell, web, MCP, hooks, plugins, and skill scripts remain disabled until separately implemented and reviewed.
- Use a non-prompting permission mode and fail if the installed version cannot guarantee unattended denial of unapproved actions.
- Do not use `--bare` by default because versions may change authentication and instruction-discovery behavior; capability tests decide which settings sources are safe.
- Never pass `--dangerously-skip-permissions` or enable its equivalent.

### Codex

- `codex exec - --json --ephemeral` with the approved staged directory, explicit `read-only` or `workspace-write` sandbox, and model/config overrides only when supported.
- Prompt is provided over stdin. Non-Git staged projections may use `--skip-git-repo-check` only after V2-00 proves that the target is the disposable run root.
- Managed mode ignores mutable user config while continuing to use the CLI's own authentication; project instructions copied into the staged root remain active. A compatibility mode that loads user config is opt-in and visibly expands the trust boundary.
- Do not use `danger-full-access`, bypass approvals/sandbox, bypass hook trust, or ignore rules in the initial release.

Provider flag examples are implementation targets, not permission to assume future versions retain identical semantics. Unsupported or changed behavior blocks the run with remediation instead of falling back to broader access.

## Run states

```text
draft -> preflight -> queued -> materializing -> starting -> running
  -> awaiting-writeback-review -> applying -> completed
  -> completed-with-report
  -> cancelled | timed-out | failed | interrupted | outcome-uncertain
```

Each transition records timestamp, actor, workspace, provider, executable identity, context digest, staged-root digest, and a reason. A process exit code alone is not proof that requested external work succeeded.

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-02-01: Supervise provider processes | 8 | V2-00 CLI/staging contracts | Given fixture providers that succeed, hang, fork, flood output, or ignore termination, when runs execute, then the broker enforces limits and reaps the complete process group |
| V2-02-02: Add Claude Code adapter | 8 | V2-02-01 | Given a supported approved Claude fixture/CLI, when a run starts, then prompt stdin, model/effort/tool/limit flags, events, denial behavior, and exit status match the reviewed profile |
| V2-02-03: Add Codex adapter | 8 | V2-02-01 | Given a supported approved Codex fixture/CLI, when a run starts, then `exec` JSONL, sandbox, cwd, model/config, ephemeral behavior, events, and exit status match the reviewed profile |
| V2-02-04: Normalize live events | 5 | V2-02-02/03 | Given provider-specific partial/final/tool/file/usage/error events, when parsed, then the UI receives one bounded schema with raw redacted evidence retained for diagnosis |
| V2-02-05: Review staged writeback | 8 | V2-00 staging, V2-02-02/03 | Given staged edits, deletes, renames, binaries, and source changes, when review/apply runs, then only granted current-revision changes reach canonical paths and recovery metadata is written first |
| V2-02-06: Enforce headless grants | 5 | V1 P05/P09 | Given read-only, one-run write, and standing-routine grants, when capability requests exceed scope or are revoked, then the broker denies the next effect and records it |
| V2-02-07: Cancel and recover | 5 | V2-02-01/04 | Given user cancellation, Stop All, service crash, app quit, or Mac sleep, when recovery runs, then no orphan stays authorized and durable state distinguishes cancelled, interrupted, and uncertain outcomes |
| V2-02-08: Guide authentication safely | 3 | V2-00 capability probe | Given logged-out/expired/unknown provider auth, when preflight runs, then Voidra shows a terminal command or vendor guidance without reading or displaying token files |

## Staged writeback policy

- Canonical workspace is never the provider working directory for a staged-write run.
- Before launch, record source paths and revisions. After exit, compute creates/modifies/deletes/renames and flag untracked binaries or files outside declared outputs.
- Text changes receive a diff. Binary changes receive MIME, size, digest, and preview when safe.
- Apply is atomic per file where possible and journaling precedes mutation. Multi-file application has a recoverable transaction plan and reports partial rollback honestly.
- A changed source revision invalidates automatic apply. The user must rebuild or manually reconcile.
- A trusted routine may auto-apply only exact declared output patterns and size/type limits. Deletes, executables, instruction files, settings, credential-like files, and files outside the workspace always require current review.

## Secrets and configuration boundary

- Construct the child environment from an allowlist. Preserve only required locale, temporary directory, home/auth pointers needed by the approved vendor CLI, and explicit proxy/certificate values the user reviewed.
- Never serialize credential file contents, environment secrets, keychain results, browser cookies, or unrelated provider keys into prompts, journals, logs, crash reports, or backups.
- Exclude unapproved `.claude`, `.codex`, `.mcp*`, hook, plugin, and lifecycle configuration from the staged root. Include canonical `AGENTS.md`/`CLAUDE.md` and skill/context inputs through the manifest.
- Redaction is defense in depth; exact context preview remains available before first launch and for every changed context digest.

## Unit and integration tests

- Fixture binaries cover split JSON records, invalid UTF-8, ANSI noise, stderr-only errors, gigabyte-attempt output, delayed final events, contradictory success/error, and nested children.
- Assert the prompt is absent from argv and process listings exposed by the harness.
- Assert exact environment absence for OpenRouter, ElevenLabs, MCP, test sentinels, and unrelated home directories.
- Test version change between preflight and spawn; the run must stop.
- Test source revocation/change before materialization, during execution, and before writeback.
- Test deletion, mode-bit change, instruction/config file modification, external symlink, and credential-shaped output.
- Test resume metadata without enabling resume; the default run stays ephemeral/one-shot.

## Playwright Electron

1. Configure Claude fixture, run a read-only skill, observe streaming events, and open the final report/artifact.
2. Configure Codex fixture, start a staged-write skill, review a multi-file diff, change a source externally, and verify apply is blocked.
3. Run the same canonical context through manual handoff, OpenRouter fixture, Claude fixture, and Codex fixture; compare the visible shared context manifest.
4. Cancel Claude and Codex runs during output and during a child action; verify queue/resource status and no orphan fixture process.
5. Attempt cross-workspace, unapproved network/MCP/shell, traversal, instruction-file, and danger-flag actions; verify denial in both provider adapters.
6. Revoke a standing grant during a run and confirm future writeback is blocked.

## Real CLI acceptance

Real provider checks are opt-in and separate:

1. `--version`/help/auth-status capability check with no inference.
2. Read-only synthetic prompt in a temporary workspace, with the exact provider/model/access profile shown to the user.
3. Staged creation of one text file, followed by Voidra review and apply.
4. Cancellation during a bounded run.

Record CLI version, macOS/build, profile, timestamps, exit state, artifact digests, and whether usage/cost metadata was available. Never record auth material or claim that one account configuration represents all subscription/API arrangements.

## Exit criteria

- Both fixture adapters pass identical isolation, cancellation, limit, and writeback suites.
- Malformed output and unsupported versions fail closed.
- Canonical workspaces change only through reviewed/standing-grant writeback.
- Default profiles contain no danger/bypass flags and expose no arbitrary shell/network/MCP/browser capability.
- One opt-in real Claude and one opt-in real Codex smoke are recorded before V2 release; absence keeps the corresponding provider marked unverified.
