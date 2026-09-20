# P07 — Plan the Day and awake-only scheduling

[Plan index](main.md) · Previous: [P06](phase-06-mcp-marketplace.md) · Next: [P08](phase-08-browser-artifacts.md)

Implementation status: automated implementation completed on 2026-09-20. Local/manual and automatic planning, fixture calendar application, awake-only schedules, catch-up, and notification dispatch have automated evidence. A live Q04 provider and physical Mac sleep/resume/notification observations remain pending and are not claimed as passed exit evidence.

## Outcome and prerequisites

Plan the Day is an editable default routine. Users create other on-demand/scheduled routines and receive meaningful results while the Mac is awake. Manual routines remain usable without model API credentials.

Prerequisites: P04 routine/manual model, P05 task execution, P06 selected integrations. The local-only/manual planner can be delivered earlier after P04. Q04 determines the calendar/task adapters; Q12 determines autonomy defaults.

## Planner behavior

- Inputs: selected workspace goals, local tasks, unfinished work, attached knowledge relevant to planning, configured availability/preferences, and chosen calendar/task sources.
- Separate hard calendar commitments, suggested blocks, deadlines, and optional tasks. Preserve timezone and source IDs; do not invent missing availability or conflicting event details.
- Outputs: editable Markdown daily plan, structured task references, suggested blocks, sources, and unresolved conflicts. Changing the plan is distinct from changing an external calendar.
- Apply to Calendar previews concrete changes and uses the current grant. A trusted routine may apply within an explicitly selected calendar/time window. Never infer permission to send invitations from "plan my day."
- Local tasks work with no connected accounts. Explicit combined planning may select sources across workspaces through authorized attachments/account bindings; no implicit global aggregation.
- The same skill supports manual export. Any fresh connector read requires the user's configured connection; no model call is required to compile the prompt.

## Scheduler and lifecycle

Store schedule ID, routine/version policy, workspace, timezone, trigger, next occurrence, last occurrence identity, missed-run policy, and enablement. Persist occurrence identity before dispatch; recheck grants/account availability at run time.

Default daily-plan catch-up: run once for the current day after waking, skip older days. Custom routines select skip/run-once/review. Resolve daylight-saving gaps/duplicates and timezone changes explicitly. Manual occurrences create draft handoffs and notifications, never clipboard writes or client submissions.

Closing the main window leaves the menu-bar runtime; full Quit exits it. Use a power/clock adapter to handle suspension, resume, and timer drift. Resuming an interrupted external action invokes P05 reconciliation rather than blind retry. Notification deduplication uses occurrence/run identity.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P07-01: Generate/edit today's plan | 5 | P04, P05 automatic | Local-only and connected inputs produce a sourced editable plan; missing sources are disclosed |
| P07-02: Apply authorized calendar changes | 5 | P06, Q04/Q12 | Review lists exact changes; permitted application preserves source IDs and avoids duplicates on retry |
| P07-03: Schedule a routine | 5 | P04/P05 | Schedule persists, binds its workspace/timezone, and can be enabled/edited/disabled with visible next run |
| P07-04: Recover wake/restart/missed occurrences | 8 | P07-03 | Simulated suspend/restart follows chosen catch-up behavior and creates no duplicate side effects or notifications |
| P07-05: Inspect manual and automatic run history | 3 | P07-01/03 | Manual run awaits copy/result; automatic status follows runtime; users can inspect outcomes and cancel future runs |

## Unit and integration tests

- Time calculations cover daylight-saving forward/backward transitions, timezone changes, leap dates, overdue tasks, and duplicate timer events.
- Occurrence identity/journal tests race two scheduler ticks and restart between persistence and dispatch.
- Planner normalization distinguishes all-day events, timed events, deadlines, recurring source events, unavailable integrations, and overlapping blocks.
- Calendar write/reconciliation tests verify an unknown network outcome does not create a second event.
- Manual mode triggers no inference/embedding or clipboard adapter call; revoked routine permissions prevent auto-dispatch.

## Playwright E2E

1. Open Today with local tasks and no API key; customize daily routine, choose Codex, and copy the local prompt.
2. Switch to automatic mode with fixture calendar/model; generate a plan, edit blocks, review Apply, and verify calendar fixture state.
3. Create Work and Personal schedules; change the active UI workspace and verify both remain correctly owned.
4. Advance the test clock across sleep/resume and restart; check one current-day catch-up and skipped old days.
5. Prepare scheduled manual handoff while clipboard holds a sentinel; only notification/draft changes.
6. Disable a schedule immediately before its occurrence; no new task starts and next-run UI clears.

## Native acceptance and exit criteria

Fake power events prove scheduler policy but not macOS delivery. On a physical Mac, test close-to-menu-bar, full Quit, actual sleep/resume, notification delivery, and prevention of duplicate catch-up. Record observed timing separately from policy tests. Exit requires local/manual and automatic daily planning, supported Q04 integration evidence, and awake-only behavior.
