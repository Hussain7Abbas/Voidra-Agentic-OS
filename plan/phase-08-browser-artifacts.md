# P08 — Ordinary browsing, agent tabs, and HTML artifacts

[Plan index](main.md) · Previous: [P07](phase-07-day-planning-scheduling.md) · Next: [P09](phase-09-macos-control.md)

## Outcome and prerequisites

The user browses websites in workspace-owned sessions, lets the assistant operate selected tabs, and views generated HTML artifacts beside the conversation without exposing application privileges.

Prerequisites: P00 embedded-surface test spike, P01 workspace/session identity, P02 file storage, P05 task/grant runtime. Q05 determines built-in browser, existing Chrome, or both; the default plan is a built-in browser with separate workspace logins.

## Browser architecture and UX

- Browser tabs have stable tab ID, workspace owner, session/profile ID, URL/title, navigation state, and task assignment. Restore only the owning workspace's tabs after restart.
- Use persistent session partitions for signed-in browsing per workspace. Artifact sessions are separate and do not inherit browser cookies, account tokens, or a privileged preload bridge.
- UI supports address/search input, back/forward/reload, tabs, downloads, normal user interaction, and clear agent-control/takeover state.
- Agent adapter exposes bounded navigate/read/click/type/select/wait actions tied to assigned tabs. Page content is source material rather than authority to change task instructions or grants.
- Redirects/new windows/downloads are checked against current grants and session ownership. A URL's initial origin is insufficient if it redirects somewhere else.
- User takeover pauses further agent actions until explicitly resumed. Navigation and screenshots/DOM snapshots are correlated to a document version so stale targets can be re-evaluated.
- Embedded page failures affect their tab, not the application renderer. Track running tasks independently of whether their tabs are visible.

If existing Chrome is selected in Q05, plan an explicit paired browser extension or other supported connection. Do not assume Electron can inherit Chrome cookies or that enabling a remote-debugging port on a personal profile is an acceptable default. Add profile/account selection, tab ownership, and connection-loss E2E cases before calling this mode complete.

## Artifact model

An artifact records owner workspace/run, entry HTML file, allowed asset root, revision, and source-note links. Support HTML/CSS/JavaScript/images with Source and Preview, reload on saved change, and export of the complete asset bundle.

Resolve local assets through a constrained protocol/router. Reject traversal and symlink escapes. Provisionally deny network and persistent permissions by default, with per-artifact controls where needed; label this design choice for review. Sanitize navigation and never grant preview content arbitrary access to Electron APIs. Interactive scripts may run inside the isolated preview.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P08-01: Browse in workspace sessions | 5 | P01, Q05 | Navigation/tabs/logins persist per workspace; cookies and downloads do not cross Work/Personal |
| P08-02: Operate assigned browser tabs | 8 | P05, P08-01 | Agent completes local site workflow only in assigned tabs; user can observe/take over/cancel |
| P08-03: Preview/export HTML bundles | 5 | P02, P00 surface spike | Relative assets and scripts work inside preview; source switching/reload/export preserve the bundle |
| P08-04: Enforce content/privilege boundaries | 5 | P08-01–03 | Host bridge, unrelated files, other profiles, and unapproved navigation/permissions are inaccessible |
| P08-05: Recover tab crashes and stale actions | 3 | P08-02/03 | Crashed view can reload; stale DOM action rechecks state; interrupted submissions are not blindly replayed |

## Unit and integration tests

- Session/tab ownership rejects cross-workspace handles and tab reassignment during an in-flight action.
- Navigation policy covers redirect chains, unsafe protocols, popup requests, download destinations, and permission requests.
- Artifact resolver tests canonical paths, encoded traversal, symlink escape, missing assets, MIME types, and revisions.
- Browser action state tests user takeover, stale document IDs, timeouts, and uncertain form submission outcomes.
- Run local HTTP site fixtures with cookies/forms/frames/downloads; verify real session separation rather than only mocking a session map.

## Playwright E2E

1. Sign into local fixture site in Work; open same URL in Personal and confirm absence of Work login; restart and recheck.
2. Ask agent to fill a fixture form, take over halfway, change input manually, and confirm no further agent action until resumed.
3. Trigger redirect/popup/download fixtures and verify target permissions and correct workspace storage.
4. Open HTML bundle, exercise a JavaScript interaction, change CSS, reload, export, and reopen the bundle.
5. Artifact attempts bridge access and file escape; assert rejection through observed behavior and service logs, not merely a configuration snapshot.
6. Crash a content renderer, recover it, and verify the main workspace remains usable.

Use the target-discovery strategy demonstrated in P00. If an embedded target requires a test adapter, retain actual renderer/asset loading and document which assertions are indirect. Never classify a plain Chromium page test as proof of privileged Electron isolation.

## Exit criteria

Chosen Q05 browser modes pass their session/ownership scenarios; artifact scripts/relative assets work; privilege isolation and takeover have automated evidence; actual packaged app has a native browsing/preview smoke check.

References: [Electron sessions](https://www.electronjs.org/docs/latest/api/session), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
