# V2-06 — Hardening and release

[V2 index](main.md) · Previous: [V2-05](phase-05-command-center.md)

## Outcome

Prove that V2 can upgrade real V1 data, operate at the selected scale, contain hostile workspaces/skills/provider streams/micro apps, run both real CLIs when explicitly authorized, and ship a reproducible Apple Silicon release candidate without overstating pending native/live boundaries.

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-06-01: Complete migration/regression matrix | 5 | V2-00–05 | Given clean V1, populated V1, interrupted V2, and current V2 fixtures, when upgrade/backup/restore/feature rollback runs, then canonical data and V1 workflows remain intact |
| V2-06-02: Run adversarial security suite | 8 | V2-01–05 | Given hostile bundles, routers, provider config/output, staged files, widgets, micro apps, and connectors, when exercised, then no secret, external path, privilege, or unreviewed effect crosses its boundary |
| V2-06-03: Meet measured scale budgets | 5 | V2-Q06 | Given 60,000 files, dense relationships, 10,000 artifacts, and long journals, when representative operations run, then recorded budgets pass or scope is revised explicitly before release |
| V2-06-04: Accept real Claude and Codex separately | 5 | V2-02 | Given explicit user authorization and authenticated supported CLIs, when bounded read/write/cancel smokes run, then evidence is recorded per provider without credentials or cross-provider inference |
| V2-06-05: Complete selected live/native gates | 5 | V1 pending gates | Given target hardware/accounts, when release checks run, then sleep/wake, notifications, browser, Mac helper, voice, remote network, signing, and provider results retain separate pass/pending status |
| V2-06-06: Document operations and recovery | 3 | V2-06-01/02 | Given install, CLI change, auth expiry, stuck run, staged cleanup, corrupt layout, connector revocation, backup, and downgrade cases, when followed, then a user can recover without deleting canonical data |
| V2-06-07: Produce release evidence | 3 | V2-06-01–06 | Given the final commit and lockfile, when release runs, then package digest, dependency inputs, tests, migrations, live-boundary matrix, and known limitations are reproducible |

## Security matrix

Required adversarial cases:

- Workspace/project files that attempt to load hooks, plugins, MCP servers, browser integration, environment secrets, or external instructions.
- Skill bundles with traversal, nested archives, decompression bombs, symlink/hardlink escapes, scripts disguised as assets, and credential-shaped files.
- Router cycles, poisoned source material, oversized context, prompt-injection text, and revocation during compilation/execution.
- CLI binaries replaced after approval, PATH hijacking, malicious wrappers, invalid JSONL, terminal escapes, output floods, child daemons, and refusal to terminate.
- Staged outputs that delete/rename instructions, modify executable/config files, exceed grants, race canonical revisions, or escape through links.
- Widgets/micro apps that spoof origins/messages, navigate, pop up, download, read other storage, request undeclared network, or probe the Electron bridge.
- Connector responses/actions with stale account identity, ambiguous timeout, duplicate idempotency keys, rate limits, and revoked auth.

No single layer is declared a complete sandbox. Release requires defense in depth: staged inputs, provider-native restrictions, minimal environment, broker grants, bounded output, reviewed writeback, renderer isolation, and honest residual-risk documentation.

## Performance gates

V2-00 records baseline hardware and proposes budgets; V2-06 locks them before release. Measure at minimum:

- Cold start and dashboard interactive time with empty and large workspaces.
- Initial/incremental 60,000-file index and router graph build.
- Search latency, one-hop and multi-hop graph expansion, and renderer node count.
- Context-pack compilation for small/large skills.
- CLI launch-to-first-event, cancellation-to-process-exit, output parsing throughput, and staged diff/apply.
- Artifact search with 10,000 records and preview load by type.
- Widget refresh CPU/network behavior when visible, hidden, offline, or rate-limited.
- Aggregate Electron/service/provider memory under one active run and a populated dashboard.

Publish raw measurements, fixture shapes, and host details. A single observation is not a universal percentile claim. If a target fails, reduce the documented supported scope or fix the implementation; do not silently weaken the gate.

## Automated release gate

The release command must compose:

1. Type checking and lint/static validation selected by the repository.
2. Unit/integration tests with coverage and V1 regressions.
3. Migration/rollback matrix.
4. CLI fixture and adversarial process suites.
5. Production-built Electron Playwright journeys for V1 and V2.
6. 60,000-file/10,000-artifact measured suite on the declared profile.
7. Apple Silicon packaging, hardened configuration checks, artifact manifest, and packaged smoke.
8. Documentation link and requirement-traceability validation.

Live-provider and physical/native tests remain opt-in or manual where credentials/hardware/OS consent are required. The release report must show their state rather than treating omission as success.

## Real CLI evidence

For Claude Code and Codex independently, record:

- Executable path identity, version, fingerprint, and negotiated capabilities.
- Authentication status category without credential contents.
- Exact Voidra access profile, selected model/effort if known, and limits.
- Synthetic workspace/context manifest digest.
- Read-only result, staged diff, reviewed apply, cancellation, and cleanup outcome.
- Provider usage/cost fields only if emitted; otherwise “unavailable.”

If a provider changes flags/semantics after planning, update its adapter and re-run the complete provider matrix. Do not silently substitute OpenRouter or the other CLI and call the missing provider accepted.

## Remaining V1 acceptance

V2 does not erase V1's pending boundaries. The final matrix must still name:

- Physical sleep/wake and Notification Center delivery.
- Packaged human browser/artifact session smoke.
- Signed native helper, Accessibility consent, and representative Mac workflows.
- Live ElevenLabs microphone/headset/voice/language behavior and production wake recognition.
- Physical phone, trusted TLS, LAN/firewall, reconnect, and awake/offline remote behavior.
- Provider-specific accounts and signing/notarization/update path selected by the user.

These may be completed alongside V2-06, but a fixture or unsigned local package is never relabeled as real acceptance.

## Playwright Electron release journeys

1. Upgrade a populated V1 profile, enable V2, use every ARMS layer, restart, back up, restore to a new path, and repeat representative reads/runs.
2. Complete the command-center golden path: choose workspace → inspect widget freshness → run a skill headlessly → review output → open artifact → navigate lineage/graph → schedule the routine.
3. Complete the denial path: malicious bundle → unsupported CLI → revoked source → attempted cross-workspace read → attempted unsafe writeback → Stop All.
4. Disable V2 flags after use; V1 notes, graph, manual handoff, OpenRouter, jobs, browser, voice, remote, and settings remain usable.
5. Launch the packaged app with production fixture escape hatches disabled and verify no test adapter or secret appears.

## Exit criteria

- The full automated release gate passes from a clean checkout.
- Real Claude and Codex are each passed or prominently marked unverified with the exact missing condition.
- Migration/backup/restore/feature rollback has no known data-loss path.
- Security and scale results are attached with residual risks and honest test boundaries.
- User/operator/recovery documentation is complete.
- The release manifest and requirement matrix identify every automated, live, native, network, audio, signing, and pending item separately.
