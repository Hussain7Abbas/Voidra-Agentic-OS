# V2-00 — Baseline, contracts, and migration

[V2 index](main.md) · Next: [V2-01](phase-01-skills-router-memory.md)

## Outcome

Freeze the verified V1 baseline before changing persisted data or execution behavior. Define additive V2 contracts, a reversible migration, the child-process threat model, and runtime capability discovery for installed Claude Code and Codex CLIs.

This phase does not run model inference, redesign the home screen, or migrate canonical user data without a verified backup and rollback fixture.

## Architecture decisions to record

- Add V2 schema versions without rewriting canonical Markdown or V1 history.
- Keep the renderer unable to spawn processes. Only the supervised local service may request the Electron/main execution broker to launch an approved CLI.
- Store approved executable identity as absolute canonical path, provider, observed version, file fingerprint, approval time, and last verified time. A changed path or fingerprint returns to review.
- Define one normalized provider-capability document. Unsupported model/effort/session/output flags are hidden or rejected rather than guessed.
- Define a per-run materialization root outside the canonical workspace, with a manifest of every copied/linked input and every output considered for writeback.
- Feature-flag bundles, routers, CLI providers, artifact catalog, apps, and command center independently. Disabling a flag hides execution but never deletes its data.

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-00-01: Freeze V1 regression baseline | 3 | V1 P12 | Given the locked V1 fixtures, when the V2 branch runs the existing gate, then every V1 unit/E2E/package check has an unchanged result or an explicitly reviewed test-only update |
| V2-00-02: Define additive schemas | 5 | V2-00-01 | Given a V1 database and workspace, when the V2 migrator runs, then V2 tables/manifests are added transactionally and every V1 record remains addressable |
| V2-00-03: Prove rollback-safe migration | 5 | V2-00-02 | Given interruption at each migration step, when the app restarts or the feature flag is disabled, then canonical files remain unchanged and the prior app can still open its supported data |
| V2-00-04: Model the CLI threat boundary | 5 | V1 P04/P05/P09 | Given prompts, project config, hooks, scripts, symlinks, environment variables, provider output, and descendant processes, when the threat review completes, then each trust boundary has an enforced owner and test |
| V2-00-05: Discover CLI capabilities | 5 | V2-00-04 | Given absent, moved, changed, old, and supported fixture binaries, when preflight runs, then it reports exact capabilities and never invokes inference |
| V2-00-06: Spike staged workspaces | 8 | V2-00-04 | Given Git and non-Git workspaces with large files and symlinks, when a run sandbox is materialized and discarded, then allowed inputs are available, external paths are absent, and canonical bytes never change |
| V2-00-07: Define visual/accessibility contract | 3 | V1 P00 | Given the screenshot-derived layout, when the design contract is reviewed, then every graph/widget interaction has a keyboard and list/table equivalent |

## CLI capability contract

The broker returns only metadata safe for the renderer:

```ts
type CliCapability = {
  provider: "claude-code" | "codex";
  executableId: string;
  version: string;
  supported: boolean;
  authenticated: "yes" | "no" | "unknown";
  outputModes: Array<"json" | "jsonl" | "text">;
  sandboxModes: Array<"read-only" | "staged-write">;
  supportsModel: boolean;
  effortValues: string[];
  supportsTurnLimit: boolean;
  supportsBudgetLimit: boolean;
  supportsEphemeral: boolean;
  supportsResume: boolean;
  diagnostics: Array<{ code: string; message: string }>;
};
```

Do not parse arbitrary localized help text as the long-term API. Each provider adapter owns a versioned probe with conservative fallbacks. The local versions observed while planning are fixtures, not minimum-version decisions.

## Staged workspace spike

Compare these strategies and record measured tradeoffs:

1. Managed Git worktree for clean repositories.
2. APFS clone/copy for non-Git workspaces.
3. Manifest-driven projection for read-only report runs.

The selected design must:

- Exclude other Voidra workspaces, credential files, application support data, browser profiles, `.env*`, unapproved provider config, hooks, MCP config, and generated run directories.
- Reject symlinks or hardlinks that resolve outside the approved source set.
- Preserve enough repository metadata for the selected task without exposing unrelated branches or credentials.
- Produce an explicit diff and artifact manifest.
- Detect source revisions changed after materialization.
- Clean up after cancellation/crash while retaining a redacted journal and user-selected outputs.

## Unit and integration tests

- Migrate a representative V1 database/workspace twice; the second run is idempotent.
- Inject failure before, during, and after each transaction; verify snapshot and canonical-file integrity.
- Probe fixture CLIs with supported, missing, malformed, hanging, and changing version responses.
- Confirm that capability discovery runs only version/help/auth-status commands explicitly allowed by the adapter.
- Materialize workspaces containing spaces, Unicode, large files, nested repositories, symlinks, hardlinks, sockets, and unreadable files.
- Assert that the child environment contains only the approved allowlist and provider-specific auth location pointers, never secret values from unrelated services.

## Playwright Electron

1. Upgrade a persisted V1 fixture, restart, and use representative Notes, Graph, Manual Handoff, OpenRouter, Jobs, Browser, and Settings workflows.
2. Open CLI Settings with no CLIs, approve fixture binaries, change a fixture fingerprint, and verify re-approval is required.
3. Enable and disable each V2 feature flag; V1 routes remain usable and no V2 data is deleted.
4. Navigate the dashboard design shell by keyboard and verify the accessible alternative appears without a canvas.

## Exit criteria

- Existing V1 automated checks pass.
- Migration and rollback fixtures are durable and documented.
- The staged-workspace strategy has measured evidence and no known canonical-write path.
- Provider capability discovery is deterministic, credential-safe, and makes no inference call.
- An ADR records why V2 remains awake-only and why CLI danger/bypass modes are excluded.

