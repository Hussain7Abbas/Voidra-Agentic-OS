# ADR 0008: Sourced daily plans and an awake-only occurrence scheduler

- Status: accepted for P07 automated implementation
- Date: 2026-09-20
- Prerequisites: ADR 0005 manual handoffs, ADR 0006 automatic tasks, ADR 0007 MCP actions
- Inputs: P07 and the confirmed awake-Mac execution constraint

## Decision

Every new workspace receives an editable `Plan the Day` skill and Codex manual routine. The Today surface can also create local tasks, select private or attached knowledge, disclose unavailable integrations, normalize explicitly supplied calendar commitments, and generate an editable Markdown plan without any model credential. Plans are persisted in the workspace registry and as ordinary `Daily Plans/YYYY-MM-DD.md` files.

The deterministic planner separates hard/all-day commitments, deadlines and overdue work, suggested blocks, optional tasks, source identifiers, recurrence identifiers, and unresolved overlaps or missing sources. It never invents availability. A user edit is revision-checked before atomic save.

Manual planning compiles through the P04 handoff boundary and does not write the clipboard. Automatic planning starts a P05 task with the exact selected model, current workspace context, selected knowledge, and `Daily Plans` target; writing the plan still requires the normal file grant.

## Calendar application boundary

Generating or editing a plan does not mutate a calendar. Apply to Calendar requires a currently ready MCP tool whose advertised name identifies a calendar/event capability. Voidra previews the exact change array and an idempotency key derived from the plan identity and revision, then creates a separate P06 action for explicit approval. Capability revalidation, credential status, uncertain outcomes, and workspace ownership remain enforced by the MCP manager.

The generic fixture proves exact application and duplicate suppression. Q04 has not selected a real calendar provider, so Voidra does not claim that every provider accepts this shape or that live OAuth/revocation has been tested.

## Schedule and occurrence model

Schedules persist workspace ID, mode, pinned-routine policy, selected automatic model, objective, IANA timezone, local daily time, next occurrence, last occurrence identity, missed-run policy, and enablement in `.voidra/planner.json`. Occurrence identity is `schedule-id:local-date` and is saved as claimed before dispatch. Concurrent ticks, service restart, and repeated timer delivery therefore cannot dispatch the same occurrence twice.

Local-time resolution searches actual instants in the requested IANA zone. A daylight-saving gap shifts to the first representable local minute after the requested time. A duplicated local time selects the first occurrence. Changing timezone or local time recalculates the next occurrence explicitly.

Missed policies are:

- `run-once`: dispatch once for the current local day after the runtime wakes;
- `skip`: record the missed occurrence without dispatch;
- `review`: record and notify an occurrence that requires user review.

Manual dispatch creates a ready-to-copy handoff and never copies or submits it. Automatic dispatch starts a normal bounded agent task. The schedule history follows later handoff or agent terminal states. Disabling clears the next occurrence and stops future dispatch; it does not pretend to undo an already started effect.

## Awake runtime and notifications

The local service evaluates schedules on startup and on a drift-tolerant interval. It runs only while Electron and the supervised child are alive. macOS window close hides the window while the existing tray/menu-bar runtime stays alive; full Quit stops the child and scheduler.

Actionable occurrences emit a stable occurrence ID to Electron main. Main deduplicates that ID and uses the native Notification API; clicking a notification reopens Voidra. The scheduler journal remains authoritative if native delivery fails. No cloud queue stores work for execution while the Mac is asleep or fully quit.

## Consequences

- Planner input and schedule state remain private to their owning workspace; visible-workspace changes cannot reassign dispatch.
- External calendar reads/writes require an explicit configured connector and current authorization.
- A native notification is a convenience, not proof that a run completed.
- Actual sleep/resume timing and Notification Center delivery require physical-Mac acceptance; deterministic clock and process tests establish policy, not operating-system delivery behavior.
