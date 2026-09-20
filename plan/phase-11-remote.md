# P11 — Remote companion for the awake Mac

[Plan index](main.md) · Previous: [P10](phase-10-voice.md) · Next: [P12](phase-12-release-verification.md)

## Outcome and prerequisites

A paired phone/browser client selects an authorized workspace, starts or inspects tasks, and receives results from the local Mac runtime. The Mac remains the execution host and must be awake and connected.

Prerequisites: P05 durable jobs/grants, P07 awake-only lifecycle. P10 enables remote voice. Q11 selects private-network-first or internet access in the earliest usable release; internet relay is not assumed to exist already.

## Transport and identity design

- Provide a responsive companion surface using shared presentation/contracts where useful, with no Electron preload dependency.
- Pair through a local Mac-confirmed flow with short-lived challenge, device identity, revocable credentials, and explicit workspace access. Do not expose unauthenticated command endpoints.
- Use encrypted transport. Private network does not remove authentication requirements. If an internet relay is selected, design its identity, message retention, and encryption boundary; the relay carries messages and does not own agent execution.
- Gate all commands on paired-device identity, workspace authorization, routine grants, and Mac availability. A request workspace ID is not sufficient by itself.
- Use idempotency keys for submissions and event cursors/sequence numbers for reconnect. Remote UI reflects running/awaiting approval/manual handoff/completed/failed/offline truthfully.
- No stale queued action runs on wake by default. A task submitted while unavailable receives an explicit unavailable result; optional queued behavior would require a separate user-selected policy.
- Show remote access sessions on the Mac with revoke and Stop All. Revoke stops future commands/events immediately; in-flight side effects follow ordinary cancellation/reconciliation semantics.
- Manual handoffs remain copy-and-paste: a phone may copy a prompt locally, but the Mac must not silently submit it elsewhere. Report whether required local attachments are available to the selected client.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P11-01: Pair and revoke a companion | 5 | P01/P05 | Pairing requires Mac confirmation; approved workspace set persists; revoked device loses access |
| P11-02: Submit and observe remote tasks | 5 | P11-01, P07 | Task runs once under selected workspace; reconnect resumes event history without duplicate submissions |
| P11-03: Handle asleep/offline Mac | 3 | P11-02 | Unavailable host is clear; reconnect does not run stale unsent actions automatically |
| P11-04: Deliver selected network mode | 8 | P11-01–03, Q11 | Private-network and/or internet path required by Q11 works under authenticated encrypted transport |
| P11-05: Support remote voice and manual handoffs | 5 | P10, P04, P11-02 | Voice retains workspace identity; manual prompt copy stays manual; revocation/cancellation work in either mode |

## Unit and integration tests

- Pairing challenges expire and cannot be replayed; device tokens are scoped/revocable and not leaked in logs.
- Gateway authorization rejects wrong device, workspace, account binding, and grant even when renderer sends a forged payload.
- Event cursor tests handle duplicate/out-of-order events and recover after service restart.
- Submission idempotency maps reconnect/retry to the original task; a reused key with different payload is rejected.
- Offline/sleep state rejects new actions and does not accumulate implicit run-on-wake work.
- Credential rotation and relay disconnect preserve task ownership and revoke paths.

## Playwright E2E

Run a real Electron host fixture plus a separate Playwright browser context for the companion. Use a local transport/relay fixture where internet infrastructure is not present.

1. Pair phone-sized browser from Mac, authorize only Personal, and verify Work is unavailable through UI and direct request attempts.
2. Submit a task, disconnect/reconnect companion, and verify one host task plus continuous event history.
3. Revoke device on Mac while its page is open; further commands and private updates stop.
4. Put the host power adapter into asleep/unavailable state; remote request reports unavailable and is not replayed on wake.
5. Complete a manual handoff on companion and verify no automatic subscription submission.
6. Feed voice fixture via companion and verify correct host workspace and cancellation.

## Real-network acceptance and exit criteria

Test an actual phone on the selected network path, including reconnect and Mac sleep. If internet access is selected, verify the deployed transport configuration separately from local relay simulations. A web preview alone does not prove remote connectivity. Exit requires pairing, scope enforcement, status recovery, and awake-only semantics on the selected path.
