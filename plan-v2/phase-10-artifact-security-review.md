# V2-10 — Artifact security review and capability broker

[V2 index](main.md) · Previous: [V2-09](phase-09-nextjs-artifact-runtime.md) · Next: [V2-11](phase-11-hardening-release.md)

Status (2026-09-21): **automated implementation complete; live semantic-model evidence pending**. Static/source/build/runtime policy is non-overridable; a separate credential-free reviewer and distinct prompt-injection-resistant semantic reviewer bind the exact inventory/digests. Schema validation, fail-closed inventory rules, signed/chained/expiring decisions, adversarial fixtures, grants, staged filesystem writeback, MCP server/schema pins, revocation, and per-call broker revalidation are implemented. Automated semantic evidence is explicitly labeled `test-fixture`; a production OpenRouter review remains account-dependent.

## Outcome

Require a security-review agent to inspect every completed component artifact, combine that verdict with deterministic and adversarial gates, and expose narrowly scoped filesystem/MCP/host capabilities only through a version/workspace-bound broker. A security-approved artifact is eligible to run; it receives no capabilities until the user or an explicit standing policy grants them separately.

## Non-negotiable model

```text
completed source digest
  -> deterministic static/policy/build checks
  -> independent read-only security-review agent
  -> adversarial sandbox/runtime checks
  -> final eligibility decision
  -> separate user/standing-policy capability grants
  -> broker revalidates every call at execution time
```

The review agent is mandatory but never the sole gate. Deterministic failures cannot be overridden by a favorable model opinion. The generating agent cannot review its own artifact in the same run/context, and the reviewer receives source/reports/threat context—not credentials or requested powers.

## Threat model

Protect against:

- prompt-injected or malicious generated code requesting more access than its UI/purpose needs;
- obfuscated code, code generation, dependency confusion, hidden executable assets, and source/build mismatch;
- XSS/CSS escape, host UI impersonation, clickjacking, navigation/popups/downloads, storage probing, and message forgery;
- filesystem traversal, symlink/hardlink escape, TOCTOU changes, excessive reads/writes, destructive patterns, and cross-workspace access;
- MCP confused-deputy behavior, misleading tool names/descriptions, schema drift, stale server identity, token leakage, excessive result data, and destructive/non-idempotent calls;
- capability escalation after approval, reused verdicts/grants after source changes, replayed messages, background calls without user presence, and revoked permissions;
- denial of service through loops, memory, rendering, messages, tool calls, output size, or repeated permission prompts;
- security reviewer prompt injection embedded in source/comments/assets/reports.

## Artifact lifecycle

| State | May render normally? | May call capabilities? | Transition rule |
| --- | --- | --- | --- |
| `draft` | No | No | Source generation/edit in staging |
| `building` | No | No | Deterministic isolated build active |
| `static-failed` | No | No | Fix produces a new digest |
| `awaiting-agent-review` | No | No | All deterministic prerequisites pass |
| `agent-blocked` | No | No | High/critical or unresolved required finding |
| `sandbox-testing` | Test harness only | Test doubles only | Agent verdict eligible; adversarial checks pending |
| `quarantined` | Safe metadata/source/report preview only | No | Build/review incomplete, failed, expired, or invalidated |
| `approved` | Yes | Only separately granted capabilities | Exact digests and policies pass |
| `suspended` | No normal interaction | No | Revocation, incident, policy/tool/server change |
| `superseded` | Read-only historical access | No by default | New artifact version approved or artifact retired |

No direct transition exists from `draft` or `building` to `approved`.

## Deterministic gates

1. Manifest/schema/path/asset bounds and digest verification.
2. Allowlisted import graph and forbidden syntax/API/style checks.
3. Dependency lock/SBOM and builder/SDK provenance.
4. TypeScript build and component tests in the isolated worker.
5. Secret/credential pattern scan with redacted findings.
6. Capability-purpose consistency checks and risk classification.
7. Bundle/source mapping verification; reviewed source must produce the tested bundle.
8. Runtime CSP/sandbox/context-isolation/navigation/popup/download/storage checks.
9. Broker protocol validation, message size/rate/replay controls, and resource budgets.
10. Required human/user-presence rules for destructive or external effects.

## Security-review agent contract

### Inputs

- normalized source and manifest for the exact digest;
- allowed SDK/UI API documentation and requested capability schemas;
- static/build/test/SBOM reports and source-to-bundle mapping;
- artifact purpose, producer lineage, expected inputs/outputs, workspace scope, and risk policy;
- a fixed threat checklist and instructions that artifact content is untrusted data.

### Restrictions

- Read-only review environment with no artifact runtime permissions, workspace secrets, provider tokens, external network, MCP calls, filesystem writes, or ability to change the artifact under review.
- Independent agent identity/run from the generator. If the same provider is used, it still requires a fresh context and separate role/prompt/run journal.
- Bounded source/report inputs with explicit file inventory; omitted/unreadable files cause an incomplete verdict.
- No approval tool that bypasses required deterministic or sandbox stages.

### Structured output

```text
artifact/source/bundle digest
review policy + reviewer model/provider/version when available
files and reports examined
threat checklist coverage
findings[]: severity, category, evidence location, exploit story, required remediation
capability analysis[]: requested scope, necessity, abuse case, recommended constraint
verdict: pass | pass-with-low-risk-notes | block | incomplete
confidence and unresolved questions
timestamp + signed journal record
```

Any source, manifest, asset, lock, SDK, builder, compiled bundle, review policy, or requested-capability change invalidates the verdict. Model/provider changes alone do not retroactively revoke a valid digest, but policy revisions may mark it `review-expired` and require re-review.

## Final eligibility policy

- `critical` or `high`: block; no override. Remediation creates a new digest and full review.
- `medium`: block by default; an explicit user risk acceptance may permit only if deterministic gates pass, the capability is non-destructive, scope is reduced, and rationale/expiry is logged.
- `low`: may pass with notes; user sees findings before first enablement.
- `incomplete`, reviewer failure, timeout, malformed verdict, missing file, or uncertain source/bundle mapping: quarantine.
- Security approval expires when the exact artifact or relevant policy/runtime boundary changes.

## Capability manifest and grants

Capability names are narrow operations, not broad objects:

| Domain | Example operation | Default | Required scope |
| --- | --- | --- | --- |
| Filesystem | `fs.readText` | Deny | Workspace-relative path selector, max bytes, source revision |
| Filesystem | `fs.writeStagedText` | Deny | Exact allowed output roots/types/bytes; canonical apply uses normal review |
| Filesystem | `fs.list` | Deny | Bounded root/depth/count; no hidden/external paths by default |
| MCP | `mcp.callTool` | Deny | Pinned server ID/fingerprint, tool name/schema digest, argument constraints, effect class |
| MCP | `mcp.readResource` | Deny | Pinned server/resource selector and byte limit |
| Clipboard | `clipboard.write` | Deny | User gesture and preview; never background |
| Notification | `notification.request` | Deny | Declared category/rate and user preference |
| Network | Direct fetch | Unavailable in v1 | Use a reviewed MCP/app adapter through the broker |
| Process/shell | Spawn/execute | Unavailable | Headless Claude/Codex remains the separate V2-02 broker, never artifact code |

Grants bind artifact digest, workspace, capability, exact scope, grantor/policy, created/expiry times, user-presence rule, and revocation state. “All files,” “all MCPs,” generic IPC, inherited app permissions, and cross-workspace grants are invalid in v1.

## MCP broker rules

- Pin MCP server identity/transport/fingerprint and tool name plus input schema digest at grant time.
- Re-fetch/validate current tool metadata before a call; schema or server identity drift suspends the grant pending review.
- Treat tool annotations as hints, not proof. Voidra classifies read/write/destructive/external effects independently.
- Preserve MCP/OAuth server authorization, but never confuse it with artifact authorization. A valid MCP token does not imply an artifact may use it.
- Validate and redact arguments/results, enforce byte/time/rate limits, and record idempotency/correlation IDs.
- Require user review for destructive, financial, account, communication, external-publication, or ambiguous effects unless an exact standing policy exists.
- Keep credentials in the host/service boundary; the artifact receives only typed results or redacted errors.

## Filesystem broker rules

- Resolve workspace-relative logical handles, not raw absolute paths supplied by the artifact.
- Revalidate workspace ownership, real path, symlink/hardlink policy, revision, file type, and byte limits on every call.
- Reads return bounded text/structured data; binary access uses declared asset/media operations.
- Writes go to staging, produce a diff/manifest, and follow the existing canonical writeback review/grant flow.
- Deny instruction/config/executable/credential-shaped targets unless a separately named host workflow explicitly supports them.
- Revocation or workspace switch cancels outstanding calls and invalidates handles.

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-10-01: Define review policy and lifecycle | 5 | V2-09 | Given artifact/version/policy changes and all failure modes, when lifecycle transitions occur, then quarantine, invalidation, retry, suspension, override, and audit behavior is deterministic |
| V2-10-02: Implement deterministic review gates | 8 | V2-09-03/04/05 | Given safe and adversarial fixtures, when gates run, then forbidden code/build mismatch/secrets/capability inconsistency/runtime escape/resource abuse fail closed before approval |
| V2-10-03: Implement independent security-review agent | 8 | V2-10-01/02 | Given an exact digest and complete reports, when reviewed in a read-only independent context, then the structured verdict covers the threat checklist/capabilities and cannot mutate or approve around deterministic failures |
| V2-10-04: Build final decision and audit service | 5 | V2-10-02/03 | Given reports/verdicts/overrides, when eligibility is computed, then severity rules, exact digest binding, signatures/journal, expiry, and user-visible rationale are enforced |
| V2-10-05: Build typed capability broker | 8 | V2-02/04 grants; V2-09 runtime | Given a runtime request, when brokered, then sender/digest/workspace/grant/schema/scope/revision/presence/rate are revalidated and only typed bounded results return |
| V2-10-06: Add filesystem capabilities | 8 | V2-10-05 | Given allowed/denied/traversal/link/race/revoked/write cases, when requested, then logical handles and staged writeback enforce workspace and canonical-review boundaries |
| V2-10-07: Add MCP capabilities | 8 | V2-04 MCP; V2-10-05 | Given server/tool/schema/auth/effect changes, when requested, then identity/schema pins, host-held credentials, effect review, result bounds, and audit prevent confused-deputy or stale-grant use |
| V2-10-08: Expose review/permission UX | 5 | V2-07 design; V2-10-04–07 | Given quarantined/blocked/approved/denied/revoked states, when users inspect/enable/call/review, then source version, findings, requested versus granted scope, effects, and revocation are understandable and artifacts cannot spoof them |
| V2-10-09: Run adversarial artifact suite | 8 | V2-10-01–08 | Given malicious source/assets/prompts/messages/files/MCPs and policy races, when exercised, then no unreviewed code or ungranted effect crosses the boundary and every denial is journaled without secret leakage |

All stories are Must.

## Review UX

The immutable host review surface shows:

- artifact name/version/digest, producer and lineage;
- build/static/sandbox status and security-review agent identity/time/policy;
- findings grouped by severity with evidence links into staged source;
- requested capabilities next to the reviewer's necessity/risk analysis;
- exact proposed grants and whether user presence/review is required per call;
- Approve eligibility, grant selected capability, deny, revoke, suspend, view source, and request regeneration as distinct actions.

Approval must never bundle “run this component” with “grant every requested capability.”

## Verification plan

### Unit/integration

- Full lifecycle and invalidation matrix for source/asset/manifest/lock/SDK/builder/bundle/policy/capability changes.
- Structured verdict schema, prompt-injection-resistant file inventory, missing/oversized/truncated input, reviewer timeout/crash/malformed output.
- Severity decisions and low/medium override constraints; high/critical no-override.
- Grant creation/use/expiry/revocation, user-presence, rate/size, replay, sender, digest, workspace, schema, and revision validation.
- Filesystem traversal/link/race and staged writeback cases.
- MCP server/tool/schema drift, auth expiry, misleading annotations, destructive calls, ambiguous timeout, oversized results, and token redaction.

### Playwright Electron

1. Complete a safe artifact, observe every review state, inspect findings, approve eligibility, grant only `fs.readText`, and use it successfully.
2. Request an undeclared write and an ungranted MCP call; verify denial, immutable host UI, and audit.
3. Grant one MCP tool, then change its schema/fingerprint; verify immediate suspension and re-review rather than a stale call.
4. Edit one approved source byte and verify normal rendering/capabilities stop until the new digest completes all gates.
5. Exercise a malicious artifact attempting IPC forgery, prompt spoofing, navigation, filesystem traversal, result exfiltration, call floods, and UI impersonation.
6. Revoke capability and shared/workspace access during an active operation; verify cancellation and no stale result becomes actionable.
7. Verify blocked/quarantined artifacts do not enter the normal globe orbit; audit/security views can still locate them.

## Exit criteria

- Every completed artifact receives independent agent review after deterministic prerequisites.
- No artifact can render normally or request real capabilities before final exact-digest approval.
- Security approval and capability granting are visibly separate.
- Filesystem and MCP calls are typed, least-privilege, workspace/version-bound, revalidated, and audited.
- High/critical findings cannot be overridden; incomplete/failing review quarantines.
- Source/build/policy/capability drift invalidates the right records and prevents stale privilege.
- The adversarial suite shows no unreviewed code, secret, cross-workspace data, or ungranted effect crossing the boundary.
