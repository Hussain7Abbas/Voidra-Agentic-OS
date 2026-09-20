# P09 — Mac files, applications, and desktop control

[Plan index](main.md) · Previous: [P08](phase-08-browser-artifacts.md) · Next: [P10](phase-10-voice.md)

## Outcome and prerequisites

The assistant performs useful Mac workflows through files, supported app interfaces, and desktop interaction, with visible actions and user takeover. Separate workspaces share one physical desktop and must not fight for it.

Prerequisites: P05 grants/journal/cancellation, P06 external tool lifecycle, P00 native helper design. P08 handles browser-specific actions. Q02/Q03 affect native build/distribution constraints; Q12 selects default permissions. Exact target apps should follow Q04 and any subsequent workflow answers.

## Capability layers

1. Files: scoped list/read/write/move/copy/trash, using validated roots and recoverable revisions where applicable.
2. Applications: open/focus applications and documents; use app APIs or supported scripting for named actions.
3. Accessibility: inspect accessible windows/controls and perform targeted interaction where app APIs are insufficient.
4. Visual fallback: use consented screen context and bounded input actions when accessibility information is insufficient.

Define a typed operation catalog rather than a generic unrestricted shell exposed to the renderer. If shell-based routines are later enabled, represent them as a separately granted capability with an explicit execution boundary. MCP roots are not a substitute for filesystem confinement.

Use one device-wide action lease for desktop UI tasks, with workspace/task ownership, expiry, cancellation, and user takeover. File operations in independent roots may run concurrently, but native UI sequences cannot. Check target app/window immediately before an action; focus may have changed since planning.

## Permission and helper lifecycle

Expose capability status for accessibility, automation, screen capture, and selected file access. Permission denial/revocation is an actionable state, not a retry loop. Ask through the appropriate OS/user flow when the capability is enabled.

Keep the native helper's command surface narrow, validate callers/payloads, and bind every action to a runtime authorization. Record bundle identity and signing implications for stable macOS consent across builds. Re-evaluate distribution restrictions if Q03 selects Mac App Store.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P09-01: Perform scoped file actions | 5 | P02, P05 | Routine organizes a fixture folder; outside-root operations fail; recoverable changes have an undo/revision route |
| P09-02: Open/control supported apps | 5 | P05, native adapter | Named app/document workflow completes and verifies observable result; unsupported app actions are reported |
| P09-03: Add accessibility/screen interaction | 8 | P09-02, permissions | Capability status and target inspection work; denied/revoked permission prevents action without a crash |
| P09-04: Serialize and interrupt desktop tasks | 5 | P09-02/03 | Work/Personal tasks queue for one desktop; takeover and Stop All prevent subsequent actions |
| P09-05: Verify representative native routines | 5 | P09-01–04 | Two chosen real Mac workflows pass on target hardware with documented supported apps/versions |

Provisional representative routines are preparing a project workspace (open folder/documents/apps) and organizing a chosen Downloads subfolder. These examples do not promise arbitrary control of every Mac application.

## Unit and integration tests

- Action lease tests cover competing workspaces, process death, cancellation, expiry, and user takeover.
- Target validation rejects stale window/control IDs and mismatched application identity before dispatch.
- File tests cover symlink/path escape, conflict, trash versus permanent deletion, failure midway through a batch, and recovery journal.
- Permission adapter tests cover denied, restricted, granted, and revoked states without simulating success as an OS fact.
- Helper protocol rejects malformed commands, unauthorized callers, duplicate invocation IDs, and data beyond the granted scope.

## Playwright E2E

1. Configure a file-organizing job in the UI against a real temporary folder; verify resulting files and action log.
2. Use a deterministic Mac adapter fixture to open/focus a target and inject permission denial; UI offers a useful resolution and no fabricated completion.
3. Start two desktop jobs from different workspaces; verify one lease holder, queue visibility, cancellation, and correct ownership.
4. Revoke permission during a paused sequence; next action is rejected and task reports the actual state.
5. Simulate a target window changing between observation and action; runtime reinspects instead of clicking the stale target.

## Native acceptance and failure behavior

On a dedicated physical Mac, verify actual app automation, accessibility consent, screen permission, focus changes, multi-display coordinates where supported, and takeover. Playwright UI tests with a fake adapter do not prove native control works. Record OS/app/build identifiers and run in test folders/accounts only.

No automatic retry of an uncertain destructive action. If an app closes or moves, reinspect state; unsupported controls yield a clear interruption. User input/takeover relinquishes the device lease promptly.

## Exit criteria

Scoped file actions pass real filesystem tests, native helper is validated for selected distribution, two representative workflows succeed on target hardware, and permission/takeover/cross-workspace lease scenarios pass.

Reference: [Apple Mac UI automation](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html).
