# ADR 0001: Foundation process, storage, and test boundaries

- Status: accepted for P00
- Date: 2026-09-20
- Inputs: P00 and provisional defaults Q01–Q03, Q10, Q13, Q14

## Decision

Voidra uses a statically exported Next.js renderer loaded from the secure custom `app://voidra` protocol. Electron owns lifecycle, native dialogs, and a narrow IPC boundary. Domain work runs in a managed child process launched with Electron's embedded Node runtime. The service owns the initial SQLite database and accepts only schema-validated, workspace- and session-bound requests.

This P00 implementation targets Apple Silicon and an unsigned personal-development directory build. It treats all text as Unicode, uses the planned sidebar/tabs shell, and runs local verification plus a macOS GitHub Actions job. These are implementation assumptions based on the plan's provisional defaults, not recorded answers to its refinement questions.

## Why static export

The current interface does not need a local HTTP server, Server Actions, or server-side rendering. Static export reduces startup and shutdown state, works offline, and keeps local operations behind the same preload/service contracts used by future desktop features. The protocol handler resolves route indexes and assets inside the export root and rejects traversal outside it.

Reconsider this decision only if a later requirement demonstrably needs a bundled Next.js server. Remote companions must use the authenticated gateway planned for P11, not the renderer bridge.

## Why a managed child process

A child process provides failure containment and makes the service lifecycle explicit while keeping the domain runtime testable without Electron. The supervisor owns readiness, correlation, timeouts, bounded restart attempts, crash diagnostics, and shutdown. It launches the child with the Electron executable in run-as-Node mode so native modules use the same Electron ABI.

The process boundary is not an operating-system sandbox. Workspace grants, directory checks, and capability enforcement remain mandatory in later phases.

Lifecycle states are `stopped → starting → ready`, `ready → crashed → starting`, and `ready → stopping → stopped`. Invalid duplicate transitions are rejected. A crash can restart at most three times in a rolling 30-second window. Pending calls resolve as stable `SERVICE_UNAVAILABLE` errors rather than hanging.

## Contract and event rules

Requests include a UUID request ID, workspace ID, and session ID. Unknown operations, unknown fields, invalid IDs, and relative directory paths are rejected. Public errors use stable categories and omit internal paths, credentials, stack traces, and provider payloads.

Service events carry monotonically increasing sequence numbers. Consumers ignore duplicates and report gaps so a later phase can request a state snapshot after reconnect. A renderer's active workspace is never authority for a background request; the request's validated identity is.

## Storage choice

P00 uses `better-sqlite3` 13.0.3 with WAL mode. The package is rebuilt for Electron during packaging and unpacked from ASAR so its native binary can load. The integration suite creates a real temporary database, closes and reopens it, and verifies that an unknown newer schema is rejected without reset.

SQLite stores durable metadata and later indexes, but it will not replace canonical Markdown files. Rebuildable indexes and durable state will use different migration/recovery policies in P01 and P02.

## Renderer and untrusted-content isolation

The application window has context isolation and sandboxing enabled, Node integration disabled, denied popup creation, a restrictive content policy, and a fixed preload API. IPC rejects calls from origins other than `app://voidra`.

The P00 isolation probe creates a `WebContentsView` with no preload and confirms that it cannot see the privileged bridge. The view can be inspected from the Electron main-process test boundary; Playwright does not treat this as proof of complete P08 browser/artifact behavior. P08 must test navigation, sessions, downloads, relative assets, and takeover using its real surfaces, plus release acceptance on macOS.

## Test and release configurations

| Concern | Test configuration | Release configuration |
| --- | --- | --- |
| Folder picker | Main-process boundary consumes an explicit queue of real temporary paths | Native Electron directory dialog |
| Service failure | Non-packaged E2E build exposes crash control | No crash IPC handler or diagnostics preload API |
| Content isolation | Hidden one-pixel `WebContentsView`, inspected through main | Same production web preferences; no test handler |
| Profile/data | Fresh temporary directories | macOS Application Support directory |
| Provider/native capabilities | Local process and filesystem only | No provider credentials or OS automation yet |
| Packaging | Electron launched from the source directory for Playwright | ASAR directory build, then launch-and-marker smoke test |

Test hooks require both `VOIDRA_E2E=1` and `app.isPackaged === false`. Web content cannot opt a production package into them. Native dialog UX, Gatekeeper/notarization, menu-bar appearance, and future macOS permissions still need real-system acceptance; mocks are not evidence for them.

## Version matrix

Versions were locked from the npm registry on 2026-09-20 and verified by the repository commands rather than assumed compatible.

| Component | Locked version | Boundary exercised |
| --- | --- | --- |
| Node.js | 24.x | Build, type checks, unit/integration tests |
| pnpm | 10.30.3 | Reproducible install and scripts |
| Next.js / React | 16.3.5 / 19.3.0 | Static export and local asset routing |
| Electron | 44.4.3 | Host, preload, child process, isolated view |
| better-sqlite3 | 13.0.3 | Native ABI, reopen, schema guard |
| Vitest | 5.0.1 | Unit and real-storage integration suites |
| Playwright | 1.63.0 | Built Electron renderer and IPC flows |
| electron-builder | 26.15.3 | Apple Silicon directory artifact |

## Consequences and follow-up

- P01 can build workspace registration and settings on stable service contracts instead of renderer mocks.
- The service is tied to the Electron lifecycle: closing the window may leave it active in the menu bar, while full Quit stops it.
- The directory package is intentionally unsigned. Signing, notarization, Intel coverage, and distributable verification remain refinement/P12 work.
- A service crash is recoverable; a migration error must remain non-destructive and will need a dedicated diagnostics UI before user data exists.
