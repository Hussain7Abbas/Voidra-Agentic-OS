# P05 — OpenRouter agent runtime and autonomy

Implementation status: completed on 2026-09-20. The streaming adapter, secure credential boundary, durable task journal, per-step context re-resolution, path-scoped grants, review UI, step/token/runtime limits, cancellation/Stop All, and uncertain-effect recovery are implemented and verified against a local OpenRouter-shaped fixture. See [ADR 0006](../docs/architecture/0006-openrouter-agent-runtime.md) and the [P05 verification report](../docs/verification/p05.md). The opt-in live-provider smoke was not run because no user credential was supplied; this is recorded as an external verification boundary, not simulated evidence.

[Plan index](main.md) · Previous: [P04](phase-04-skills-routines-manual-handoffs.md) · Next: [P06](phase-06-mcp-marketplace.md)

## Outcome and prerequisites

Automatic tasks reason through OpenRouter, call authorized tools, report progress, and recover without losing workspace ownership or repeating uncertain side effects. Manual tasks from P04 remain independent.

Prerequisites: P01–P04 contracts and context. Q12 selects the default autonomy mode; Assist with standing grants is the recommendation. Exact model IDs are user-configurable onboarding values, not fixed by the plan.

## Execution architecture

- Provider adapter exposes streaming text/tool requests, cancellation, usage, model identity, and categorized errors. Choose models by required capabilities (tools and, where needed, images); unsupported combinations produce a useful selection error.
- Record selected model/provider metadata and task configuration. Bound fallback policy to compatible models; a fallback must not repeat a tool whose execution result is uncertain.
- Task runtime uses a durable event journal: queued, running, awaiting approval/input, awaiting external result, cancelling, cancelled, completed, failed, interrupted. Tool invocations have separate requested/authorized/started/observed-result states.
- Resolve workspace/routine/rules/context before each relevant step. Preserve task ownership across UI switches; access revocations apply before future reads/writes even if the task has an earlier settings snapshot.
- Store tool arguments/results with deliberate retention/redaction. Show concise action summaries, sources, outputs, usage, and errors; do not depend on exposing private model reasoning.
- Limit task steps/runtime/tool concurrency and configure optional cost budgets. Finishing due to a limit is an interrupted/limited result, not success.

## Permissions and autonomy

Implement grants in the runtime, not merely in prompts. A grant specifies workspace/run/routine, tool/action category, relevant accounts/folders/domains, and optional expiry/limits. Explicit current user authorization is recorded and reused within scope.

Assist permits approved reads, preparation, and scoped reversible work. Out-of-scope external commitments, publication, deletion, or system changes receive a concrete review. Trusted routines may have standing grants for those operations. Tool metadata from a third-party server is advisory; it is not proof an action is harmless.

Persona/AGENTS content cannot broaden permissions. Keep device-wide Stop All and per-task cancellation; stopping generation is distinct from undoing an already completed remote write.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P05-01: Configure OpenRouter and stream responses | 5 | P01 credentials, P04 | Selected model streams through UI; unsupported model/missing key/offline failures are actionable |
| P05-02: Execute a durable task/tool loop | 8 | P05-01 | Deterministic provider fixture performs read/write steps, records results, and retains workspace ownership across restart |
| P05-03: Enforce grants and review | 5 | P05-02, Q12 | In-scope action proceeds; exceeding/revoking grant stops execution before effect; approval is not repeatedly requested for unchanged scope |
| P05-04: Cancel and resume safely | 5 | P05-02/03 | Stop interrupts pending work; uncertain side effects require reconciliation; restart cannot silently replay writes |
| P05-05: Bound resources and inspect runs | 3 | P05-02 | Step/time/usage limits and model selection are recorded; history explains actual status and links outputs |

## Unit and integration tests

- Streaming decoder handles chunk boundaries, tool-call argument fragments, malformed JSON, cancellation, and partial output without emitting invalid actions.
- Grant matcher tests path traversal, account mismatch, domain changes, expiry, disabled tools, and permission revocation races.
- State machine tests illegal transitions, duplicate events, crash before/after action dispatch, and reconciliation of ambiguous remote outcomes.
- Context tests ensure deleted memory/revoked shared bases are excluded from newly sent context, including resumed tasks.
- Retry classifier only retries safe operations automatically; rate-limit retry respects cancellation and configured bounds.
- Real journal reopen tests recover task state and never duplicate recorded external writes.

## Playwright E2E

1. Connect to local OpenRouter-shaped fixture, choose a model, run a task, and inspect streaming text, tool events, and output.
2. Require approval for a fixture action; review exact target, approve, and verify one effect and one recorded grant.
3. Revoke access mid-task; later tool call is denied even though the initial task snapshot had access.
4. Cancel during streaming and during a pending tool; verify correct terminal/interrupted status and no new actions.
5. Kill/restart the service after fixture server committed a write but before the response arrived; runtime reconciles instead of executing twice.
6. Switch Work→Personal while Work runs; no output/account/context moves to Personal.

External model endpoints are mocked for default E2E, but the real runtime, grant system, journal, and file writes execute. Opt-in live OpenRouter smoke confirms actual provider compatibility separately.

## Exit criteria

No unauthenticated renderer request can directly execute tools; explicit workspace identity and grant checks precede each action. Crash/cancel/retry cases have evidence. Automatic mode works without changing manual mode's zero-model-call contract.

Reference: [OpenRouter client tool calling](https://openrouter.ai/docs/guides/features/tool-calling).
