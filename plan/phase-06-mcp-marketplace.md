# P06 — MCP marketplace and custom servers

[Plan index](main.md) · Previous: [P05](phase-05-openrouter-agent-runtime.md) · Next: [P07](phase-07-day-planning-scheduling.md)

Implementation status: completed on 2026-09-20. The official Registry, stdio, and Streamable HTTP flows have fixture-backed protocol evidence; a live calendar/email/task connector remains pending Q04 and is not represented as tested.

## Outcome and prerequisites

Users discover integrations, add custom local or remote MCP servers, configure workspace-specific accounts, inspect capabilities, and use them through the task runtime.

Prerequisites: P05 runtime/grants, P01 credentials/settings, P00 process management. Q04 identifies the first real calendar/email/task connectors. Do not claim all catalog entries are verified or every MCP feature is supported.

## Catalog and connection architecture

- Catalog adapter ingests official registry metadata plus curated entries. Normalize stable ID, publisher/source, version, transport, runtime requirements, configuration fields, docs, and review status.
- Separate catalog/package installation, server instance configuration, account authorization, and workspace enablement. A globally cached package is not a globally authorized account.
- Initially support stdio local processes and Streamable HTTP remote connections; document legacy compatibility only if explicitly implemented and tested.
- Validate runtime prerequisites (for example installed Node/Python/container tooling) and explain setup failures. Pin selected package/version where possible; never treat arbitrary catalog text as an instruction to execute a shell command.
- Server lifecycle states: configured, starting/connecting, ready, authorization-required, degraded, stopped, failed. Expose redacted diagnostics, capability list, reconnect/restart, and remove/disable controls.
- Support tools/list-call, resources/list-read, and prompts/list-get as separate host features. Pagination and capability changes are explicit. Sampling/elicitation/other server-initiated features require negotiated support and a distinct policy.
- Scope each instance's environment, roots, credentials, and mutable state to its workspace. Do not share a process across differing privilege contexts.
- Use a maintained MCP SDK after compatibility review. A process launched under the current OS user can exceed the suggested roots unless an enforced sandbox exists; present its actual reach and configure grants accordingly.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P06-01: Browse catalog and inspect entry | 5 | Catalog adapter | Search/details show source/version/setup requirements; offline cached state is labeled and custom setup remains available |
| P06-02: Add custom local server | 5 | P05, process supervisor | Command/arguments/environment are validated, connection tested, and crash/hang/stop behavior visible |
| P06-03: Add remote/account connection | 8 | P05, credentials | URL/auth flow connects to supported server; expiration/revocation/reconnect and workspace binding behave correctly |
| P06-04: Discover and invoke capabilities | 5 | P06-02/03 | Tools/resources/prompts display and work through scoped runtime; disabled or changed capability cannot execute from stale UI |
| P06-05: Install/update/disable lifecycle | 5 | P06-01–04 | Installation is concrete/reviewable; version/config changes preserve credentials safely; removal stops future tasks without deleting user data |

UI: marketplace search/category/details, Add Custom form/import, setup validation, capability inspector, per-workspace enablement, account selector, and diagnostics. Configuration import redacts secrets in previews and persists them through the credential adapter.

## Unit and integration tests

- Catalog normalization rejects malformed fields and distinguishes declared compatibility from verified support.
- Process spawning passes executable/arguments without shell interpolation; environment is minimized and secrets redacted from errors.
- Protocol integration uses actual disposable stdio processes and local HTTP servers, including pagination, timeout, invalid responses, startup failure, and capability-change events.
- Authorization fixtures cover missing/expired grants and reconnect without switching accounts. Do not broaden auth scopes silently.
- Runtime rejects disabled tools, wrong-workspace instance IDs, revoked accounts, and writes outside the configured capability boundary.
- Removal/update races cannot leave orphan processes or mark a disconnected instance ready.

## Playwright E2E

1. Choose catalog fixture entry, inspect requirements, configure, test, and invoke a tool through chat.
2. Add custom stdio fixture with arguments/environment; inspect resources and choose a prompt; restart the app and reconnect.
3. Add remote fixture, complete local authorization simulation, expire credentials, and reconnect to the same workspace account.
4. Enable one server only for Work; assert Personal cannot discover/invoke it through UI or manipulated request fixtures.
5. Crash/hang a process, inspect useful diagnostics, restart it, and disable during a running task; future calls are rejected.
6. Update an entry version that fails startup; previous configuration remains recoverable and no secret appears in logs.

## Failure and recovery

Timeouts distinguish connection failures from ambiguous tool outcomes. Non-idempotent tools are not automatically replayed. Cache useful catalog metadata, but do not fabricate availability when offline. Missing local runtimes are explicit setup requirements rather than unexpected installation attempts.

## Exit criteria

Catalog and custom flows converge on one tested connection lifecycle. Both required transports and tools/resources/prompts have protocol evidence. Real connector smoke for the selected Q04 provider is separate from fixture tests and uses a designated test account.

Reference: [MCP Registry](https://modelcontextprotocol.io/registry/about).
