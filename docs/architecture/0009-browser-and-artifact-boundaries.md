# ADR 0009: Workspace browser sessions and isolated HTML artifact previews

- Status: accepted for P08 automated implementation
- Date: 2026-09-20
- Prerequisites: workspace identity, local storage, and the reviewed OpenRouter agent runtime
- Input: P08 and provisional Q05 built-in-browser default

## Decision

Voidra uses Electron `WebContentsView` instances owned exclusively by the main process for ordinary browsing and HTML artifact previews. The application renderer receives a narrow, validated IPC surface for tab commands, bounded agent actions, source editing, and view placement; embedded content receives no preload bridge or Electron APIs.

Each workspace browser uses a persistent Electron session partition named from its stable workspace ID. Tabs persist stable identity, owner, URL, title, navigation state, document version, crash state, and control assignment in the application profile. A workspace path is accepted only when its canonical `.voidra/workspace.json` identity matches. Tab handles are rejected across workspace boundaries, and only the owning workspace's tabs are shown.

The provisional Q05 implementation is the built-in browser only. Voidra does not import Chrome profiles, cookies, extensions, or remote-debugging access. Existing-Chrome support remains unselected and unimplemented.

## Navigation, downloads, and permissions

User navigation accepts HTTP and HTTPS pages, with whitespace queries routed to a normal search URL. Data URLs are reserved for the built-in new-tab document; file, JavaScript, and other privileged schemes are rejected. Popups are denied and surfaced on the owning tab. Browser-session permissions are denied by default.

Downloads resolve to the owning workspace's `Downloads` directory with a sanitized filename. The download handler derives ownership from the initiating `webContents`, not the currently visible workspace. Redirects are checked at every hop. During agent control, navigation is limited to origins explicitly introduced by the approved agent navigation action; a redirect to another origin is stopped and recorded.

## Agent-control boundary

An automatic task may be started with one selected browser tab. The supervised service asks Electron main to assign that tab to the newly created task before the first provider call. Main returns only assigned-tab metadata and executes a bounded action union: navigate, read, click, type, select, or wait.

Browser actions still use the P05 exact-action review and standing-grant journal. Grants are scoped to the stable tab ID. Every action carries workspace ID, task ID, tab ID, and expected document ID. User takeover changes the tab to a paused state; later actions fail until explicit resume. A navigation creates a new document ID, so stale actions fail closed. A click on a form submission is reported as uncertain and interrupts the task rather than being replayed automatically.

Page text is provider input, not authority to change task instructions or grants. Browser host requests cross the child/main process boundary through correlated requests with a timeout; the service never receives a general Electron bridge.

## Artifact boundary

Artifacts are workspace-owned bundles stored below `.voidra/artifacts/<artifact-id>`. Metadata records owner workspace, optional run, entry file, source-note identities, complete file list, content revision, and timestamps. Text assets can be edited with optimistic revision checks. Saving reloads the preview without cache, and export copies the complete bundle to `Artifact Exports` under a revision-derived name.

Each preview uses its own non-persistent Electron session and a per-session `voidra-artifact` protocol handler. The handler decodes paths once, rejects dot segments, verifies canonical containment, denies symbolic links, and supplies explicit MIME types. Preview content has JavaScript enabled for interaction but no preload, Node.js, popup, permission, form-navigation, frame, object, or network capability. A restrictive response CSP and request routing keep asset access inside the artifact root.

## Consequences

- Browser login state persists independently per workspace and never flows into artifact previews.
- Embedded renderer crashes are tab-local; the application renderer and service remain alive and the tab can reload.
- The renderer controls native-view bounds but cannot evaluate arbitrary code or access the session object.
- The test adapter evaluates embedded contents only from Electron main in E2E. This is indirect target discovery around Playwright's `WebContentsView` limitation, while the actual Electron renderer, sessions, downloads, protocol, CSP, and crashes remain real.
- Packaged native interaction still needs a human smoke pass. Automated Electron coverage does not establish compatibility with arbitrary public sites, identity providers, or anti-bot systems.

## References

- [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron web embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds)
- [Electron session API](https://www.electronjs.org/docs/latest/api/session)
- [Electron protocol API](https://www.electronjs.org/docs/latest/api/protocol)
