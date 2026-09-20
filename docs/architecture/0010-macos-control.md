# ADR 0010: Reviewed file actions and a single device-wide Mac lease

- Status: accepted for P09 automated implementation
- Date: 2026-09-20
- Prerequisites: reviewed automatic tasks, MCP lifecycle, and browser takeover boundary
- Inputs: P09, provisional Q02/Q03/Q12 defaults

## Decision

Voidra exposes typed file and Mac actions instead of a renderer shell. A workspace explicitly attaches file roots. File list/copy/move/recoverable-trash/create operations resolve only below those canonical roots, reject traversal and symbolic links, and produce durable action records. Effects remain in `awaiting-approval` until exact review. Completed changes retain an operation-specific undo route; trash moves content into the owning workspace's `.voidra/automation-trash` rather than permanently deleting it.

Automatic OpenRouter tasks see only attached root identities and the typed `file_action` schema. Their P05 grants are scoped to the root ID. The automation journal is still written when an approved agent action executes, so provider intent, authorization, observed result, and recovery state remain distinct.

## Native action boundary

Electron main owns a narrow native adapter for `open-path`, `open-app`, `inspect-target`, and `activate-control`. Production path/application opening uses Electron's `shell.openPath`; named applications are restricted to explicit `.app` bundles under the standard system or user application directories. The renderer and service never receive a general command executor.

Accessibility targeting is not claimed as production-ready in the unsigned development build. Main reports observed Accessibility and screen-capture states without prompting or looping. Inspect/control operations fail with an actionable unsupported-helper result unless the deterministic test adapter is enabled. The future signed native helper must preserve this command catalog, caller validation, target revision check, and authorization correlation.

Native automatic-task grants include the operation and exact path/application identity. Instruction text cannot widen them.

## Device lease and target freshness

All native actions share one FIFO lease in Electron main, regardless of workspace. Status exposes the current workspace/action owner and queue depth. File operations in independent attached roots do not use this lease.

Target activation requires the same application, window, control, and revision observed during inspection. A mismatch fails before activation. User takeover increments a lease epoch: the active fixture operation and all operations queued under the older epoch finish as interrupted, and no queued target is automatically replayed. Production effects that may already have occurred must be reconciled rather than assumed failed.

## Consequences

- Work and Personal can schedule native actions, but cannot concurrently control the shared desktop.
- Permission denial, helper absence, stale targets, takeover, and runtime restart are durable states rather than fabricated completion.
- The deterministic adapter proves protocol, queue, ownership, and UI behavior only. It is not evidence of macOS Accessibility, Screen Recording, Apple Events, multi-display input, or third-party application compatibility.
- Stable macOS consent depends on a stable signed bundle/helper identity. Q03 is unresolved, so signing and helper installation remain acceptance blockers.

## References

- [Apple UI scripting guide](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html)
- [Electron systemPreferences](https://www.electronjs.org/docs/latest/api/system-preferences)
- [Electron shell](https://www.electronjs.org/docs/latest/api/shell)
