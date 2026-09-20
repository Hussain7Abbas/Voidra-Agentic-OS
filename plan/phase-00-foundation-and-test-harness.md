# P00 — Architecture and test harness

Implementation status: complete as of 2026-09-20. Verification evidence is recorded in [the P00 report](../docs/verification/p00.md). Provisional defaults were used as documented assumptions, not recorded as answers to Q01–Q03, Q10, Q13, or Q14.

[Plan index](main.md) · Next: [P01](phase-01-workspaces-settings-instructions.md)

## Outcome and prerequisites

Prove that a packaged Next.js interface, Electron host, local service, and test harness work together on the target Mac before building domain features. This is planned implementation work; no spike or test is being executed during planning.

Prerequisites: decide or explicitly accept defaults for Q02 hardware, Q03 distribution, Q10 language direction, Q13 CI, and Q14 UI layout. Q01 determines release packaging timing. Default recommendations are in the index.

## Architecture decisions and deliverables

- Record an architecture decision for static Next.js export versus a bundled server. Prefer export; prototype routing, deep links, asset resolution, startup, and offline shell under an application protocol.
- Use a TypeScript package structure separating desktop host/preload, renderer, domain services, shared contracts, and test fixtures. These are proposed boundaries, not folders to scaffold in this planning session.
- Keep domain functions independent of Electron to support deterministic unit tests. Validate all privileged command payloads and bind requests to a workspace/session on the service side.
- Decide whether the local service uses Electron utilityProcess or a managed child process. Document startup, readiness, heartbeat, crash, and shutdown behavior. A separate process improves fault containment but is not an OS sandbox.
- Select the SQLite binding after checking Electron ABI packaging and target architectures; prove reopen/migration on a disposable file. Distinguish canonical documents, durable metadata, and rebuildable indexes.
- Define adapters for clock/power, credentials, dialogs, file system, model transport, clipboard, browser sessions, and speech. Test substitutions exist only in controlled builds/configurations and do not create production privilege bypasses.
- Prototype embedded browser and artifact surfaces early to establish Playwright observability. P08 remains responsible for full product features.
- Lock compatible versions and record a repeatable dependency/build strategy when implementation starts. Choose pnpm provisionally; avoid a version promise before running the build matrix.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P00-01: Open the desktop shell | 5 | Q02/Q03 | Built static UI opens in Electron without a development server, navigates between placeholder routes, and resolves local assets after restart |
| P00-02: Establish process contracts | 5 | P00-01 | Validated request reaches service and returns a correlated result; malformed request is rejected; service crash produces a recoverable UI state |
| P00-03: Create unit/storage harness | 3 | P00-02 | Unit suite runs without Electron; storage integration fixture uses a real temp database; teardown leaves no process or file locks |
| P00-04: Create Electron Playwright harness | 8 | P00-01/02 | Playwright launches real Electron, drives UI through preload/service, resets profile/storage, and captures useful failure evidence |
| P00-05: Define build/release test compatibility | 5 | P00-04, Q03/Q13 | Documented test configuration and release configuration differences; actual release artifact has a smoke-validation path without weakening its protections |

For P00-01, specify accessible navigation, keyboard focus, and the window/menu-bar lifecycle before styling. For P00-02, define stable error categories and event sequence numbers; renderer subscriptions recover after reconnect. For P00-04, prove a folder-picker stub passes a real temporary path into production directory validation.

## Unit and integration tests

- Contract parsing rejects unknown operations, invalid workspace IDs, and malformed paths; returning an error does not expose internal credentials.
- Service supervisor transitions through starting/ready/crashed/stopping without duplicate children or unhandled pending requests.
- Event handling ignores duplicates and detects gaps; teardown cancels outstanding listeners.
- Real SQLite fixture survives close/reopen and rejects incompatible schema versions without destructive reset.
- Configuration supplies test adapters only in the dedicated test environment. A production build cannot activate privileged test hooks through ordinary untrusted content.

## Playwright E2E

1. Launch built Electron with a fresh temporary profile; navigate, relaunch, and verify shell state.
2. Stub native folder selection in main; choose temp folder, cancel another selection, and observe the correct UI outcomes.
3. Trigger a controlled service failure; assert the UI reports it, recovers, and does not duplicate events.
4. Open local browser/preview fixtures and record whether they are directly automatable pages. Establish alternative boundary assertions if not.
5. Assert remote/preview content lacks the privileged bridge while the application renderer can perform an allowed action.

Playwright's Electron support is experimental, native Electron dialogs require boundary stubs, and the documented launch fuse can affect automation. Record these constraints rather than claiming all native behavior is covered. [Official Electron testing API](https://playwright.dev/docs/api/class-electron).

## Failure, migration, and recovery

An unavailable local service must show retry/diagnostics, not a blank workspace or fabricated success. Startup must not reset user data after a migration error. Use bounded restart attempts and preserve the previous diagnostic cause. Dispose database connections, child processes, streams, and temporary profiles on shutdown.

## Exit criteria

- Architecture decisions, package boundaries, and version compatibility matrix are recorded.
- Unit and real-storage fixtures pass; Electron E2E runs against built UI.
- Browser/artifact automation coverage boundaries are known.
- Selected Mac architecture(s) can build and launch; CI scope reflects Q13.
- No domain feature is allowed to depend on a renderer-only mock as proof of a native capability.

References: [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [utility processes](https://www.electronjs.org/docs/latest/api/utility-process), [Next.js export](https://nextjs.org/docs/app/guides/static-exports), [Vitest](https://vitest.dev/guide/).
