# V2-11 — Hardening and release

[V2 index](main.md) · Previous: [V2-10](phase-10-artifact-security-review.md)

Status (2026-09-21): **automated release candidate complete; external acceptance pending**. TypeScript, 30-file/161-test unit/integration with the 80% branch gate, 59/59 production Electron journeys, production build, unsigned arm64 packaging, packaged startup/disposable-builder/compiler/isolated-reviewer smoke, the bounded 60,000-file note/graph gate, and bounded 10,000-version catalog gate pass. The 60k cold-index scope is explicitly a roughly 3.2-minute background rebuild on this machine. Real authenticated Claude/Codex, a live semantic reviewer/connector, prolonged human soak, visual/screen-reader review, physical native/audio/network checks, Developer ID signing, and notarization remain Pending rather than Passed.

## Outcome

Prove that V2 can upgrade real V1 data, fully replace the old visual shell, operate at the selected graph/artifact scale, contain hostile workspaces/skills/provider streams/component artifacts/connectors, run both real CLIs when explicitly authorized, and ship a reproducible Apple Silicon release candidate without overstating pending native/live boundaries.

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-11-01: Complete migration/regression matrix | 5 | V2-00–10 | Given clean V1, populated V1, HTML-artifact V1, interrupted V2, and current V2 fixtures, when upgrade/backup/restore/feature rollback runs, then canonical data, legacy read access, review records, and V1 workflows remain intact |
| V2-11-02: Accept design fidelity and accessibility | 5 | V2-06–08 | Given every current route and representative states, when screenshot/motion/keyboard/screen-reader/zoom/reduced-motion review runs, then the no-sidebar reference rubric passes and no legacy visual shell is reachable in V2 |
| V2-11-03: Run adversarial security suite | 8 | V2-01–10 | Given hostile bundles, routers, providers, staged files, component artifacts, reviewers, capability calls, widgets, MCPs, and connectors, when exercised, then no secret, external path, cross-workspace data, privilege, unreviewed code, or ungranted effect crosses its boundary |
| V2-11-04: Meet measured scale/resource budgets | 5 | V2-Q06 | Given 60,000 files, dense relationships, 10,000 artifact versions, long journals, multiple widgets, and malicious resource consumers, when representative operations run, then recorded budgets pass or supported scope is revised explicitly before release |
| V2-11-05: Accept real Claude and Codex separately | 5 | V2-02 | Given explicit user authorization and authenticated supported CLIs, when bounded read/write/cancel smokes run, then evidence is recorded per provider without credentials or cross-provider inference |
| V2-11-06: Accept component artifact pipeline | 8 | V2-09/10 | Given safe, malicious, legacy-converted, changed, revoked, and MCP/filesystem-capable artifacts, when built/reviewed/run, then exact-digest gates, review separation, least privilege, invalidation, audit, and recovery pass in the packaged app |
| V2-11-07: Complete selected live/native gates | 5 | V1 pending gates | Given target hardware/accounts, when release checks run, then sleep/wake, notifications, browser, Mac helper, voice, remote network, signing, and provider results retain separate pass/pending status |
| V2-11-08: Document operations and recovery | 3 | V2-11-01/03/06 | Given install, CLI change, auth expiry, stuck run, staged cleanup, corrupt layout, reviewer failure, artifact incident, grant revocation, connector revocation, backup, and downgrade, when followed, then a user can recover without deleting canonical data |
| V2-11-09: Produce release evidence | 3 | V2-11-01–08 | Given the final commit and lockfile, when release runs, then package digest, dependency inputs, tests, migrations, design evidence, security verdict matrix, live-boundary matrix, and known limitations are reproducible |

All stories are Must. A live/native item may remain explicitly Pending only where hardware, account choice, credentials, or OS consent is genuinely unavailable; the release cannot silently call it Passed.

## Security matrix

Required adversarial cases:

- Workspace/project files that attempt to load hooks, plugins, MCP servers, browser integration, environment secrets, or external instructions.
- Skill bundles with traversal, nested archives, decompression bombs, symlink/hardlink escapes, scripts disguised as assets, and credential-shaped files.
- Router cycles, poisoned source material, oversized context, prompt-injection text, and revocation during compilation/execution.
- CLI binaries replaced after approval, PATH hijacking, malicious wrappers, invalid JSONL, terminal escapes, output floods, child daemons, and refusal to terminate.
- Staged outputs that delete/rename instructions, modify executable/config files, exceed grants, race canonical revisions, or escape through links.
- Generated component source/assets that obfuscate imports, execute strings, hide dependencies, inject global CSS/HTML, spoof host prompts, forge messages, navigate/pop up/download, exhaust resources, or mismatch reviewed source and bundle.
- Security-review inputs that prompt-inject the reviewer, omit files, truncate evidence, manipulate findings, reuse stale verdicts, or attempt self-approval.
- Filesystem capability calls that traverse/race links, exceed byte/path/type grants, target another workspace, or bypass staged writeback.
- MCP calls with changed server/tool/schema identity, misleading annotations, confused-deputy scope, token leakage, oversized results, ambiguous effects/timeouts, duplicate idempotency keys, or revoked auth.
- Widgets/micro apps that spoof origins/messages, read other storage, request undeclared capability, or probe the Electron bridge.

No single layer is declared a complete sandbox. Release requires defense in depth: staged inputs, deterministic builds, provider-native restrictions, minimal environments, independent security review, digest binding, broker grants, bounded output, reviewed writeback, renderer isolation, CSP, sender validation, revocation, and honest residual-risk documentation.

## Design fidelity gate

For every current route and the artifact shell:

- capture default, dense, empty, offline, active, failed, permission-required/quarantined, narrow, 200%-zoom, and reduced-motion evidence where applicable;
- score reference composition/hierarchy/density/type/color-lines/globe/motion/continuity using `research-video-ui.md`;
- verify no permanent sidebar, V1 top bar, old blue/mint theme, generic rounded-card dashboard, or decorative fake graph is reachable in V2;
- verify the inner globe is backed by Markdown records and the outer orbit by approved artifact digests;
- verify missing connectors/data show honest empty states;
- verify route transitions restore context and workspace switches do not crossfade private data;
- run automated accessibility scans plus manual keyboard/screen-reader/focus/reduced-motion review.

Design fidelity does not override accessibility, data truth, security, or original identity.

## Performance gates

V2-00 records baseline hardware and proposes budgets; V2-11 locks them before release. Measure at minimum:

- Cold start and dashboard interactive time with empty and large workspaces.
- Initial/incremental 60,000-file index and router graph build.
- Search latency, one-hop and multi-hop graph expansion, globe frame stability, level-of-detail changes, and renderer node/message count.
- Context-pack compilation for small/large skills.
- CLI launch-to-first-event, cancellation-to-process-exit, output parsing throughput, and staged diff/apply.
- Artifact search with 10,000 records and preview load by legacy/component/file type.
- Component artifact build, static review, agent review, sandbox test, enable, capability call, invalidation, and crash recovery.
- Widget refresh CPU/network behavior when visible, hidden, offline, or rate-limited.
- Aggregate Electron/service/provider/artifact-worker memory under active runs and a populated dashboard.

Publish raw measurements, fixture shapes, and host details. A single observation is not a universal percentile claim. If a target fails, reduce the documented supported scope or fix the implementation; do not silently weaken the gate.

## Automated release gate

The release command must compose:

1. Type checking and lint/static validation selected by the repository, including legacy-style and artifact-policy rules.
2. Unit/integration tests with coverage and V1 regressions.
3. Migration/rollback matrix, including legacy HTML artifact preservation/conversion.
4. CLI fixture and adversarial process suites.
5. Component artifact build/review/broker/adversarial suites.
6. Production-built Electron Playwright journeys for V1 rollback and all V2 routes.
7. Visual/motion/accessibility evidence and no-sidebar/real-graph assertions.
8. 60,000-file/10,000-artifact measured suite on the declared profile.
9. Apple Silicon packaging, hardened configuration checks, artifact manifest, and packaged smoke.
10. Documentation link and requirement-traceability validation.

Live-provider, security-review provider, and physical/native tests remain opt-in or manual where credentials/hardware/OS consent are required. The release report must show their state rather than treating omission as success.

## Real Claude/Codex evidence

For Claude Code and Codex independently, record:

- Executable path identity, version, fingerprint, and negotiated capabilities.
- Authentication status category without credential contents.
- Exact Voidra access profile, selected model/effort if known, and limits.
- Synthetic workspace/context manifest digest.
- Read-only result, staged diff, reviewed apply, cancellation, and cleanup outcome.
- Provider usage/cost fields only if emitted; otherwise “unavailable.”

If a provider changes flags/semantics after planning, update its adapter and re-run the complete provider matrix. Do not silently substitute OpenRouter or the other CLI and call the missing provider accepted.

## Component artifact evidence

For each representative safe/malicious artifact fixture, record:

- source, manifest, assets, toolchain, UI/SDK, lock, bundle, review-policy, and verdict digests;
- deterministic gate results and source-to-bundle mapping;
- security-review agent/provider/model/version when emitted, files examined, findings, decision, and unresolved risks;
- requested versus granted capabilities, user-presence rules, expiry/revocation, and call audit;
- sandbox/CSP/context-isolation/sender/navigation/resource results;
- workspace switch, revocation, source edit, server/tool schema drift, crash, and cleanup outcomes.

Passing one safe component does not establish containment. The adversarial corpus and packaged runtime gates are mandatory.

## Remaining V1 acceptance

V2 does not erase V1's pending boundaries. The final matrix must still name:

- Physical sleep/wake and Notification Center delivery.
- Packaged human browser/artifact session smoke.
- Signed native helper, Accessibility consent, and representative Mac workflows.
- Live ElevenLabs microphone/headset/voice/language behavior and production wake recognition.
- Physical phone, trusted TLS, LAN/firewall, reconnect, and awake/offline remote behavior.
- Provider-specific accounts and signing/notarization/update path selected by the user.

These may be completed alongside V2-11, but a fixture or unsigned local package is never relabeled as real acceptance.

## Playwright Electron release journeys

1. Upgrade a populated V1 profile with HTML artifacts, enable V2, use every ARMS layer, restart, back up, restore to a new path, and repeat representative reads/runs.
2. Complete the new command-center golden path: choose workspace → inspect widget freshness → search/focus Markdown globe → run a skill headlessly → review output → build/review/enable a component artifact → grant one capability → open it from the orbit → schedule the routine.
3. Complete the denial path: malicious bundle → unsupported CLI → revoked source → malicious component → blocked security verdict → attempted cross-workspace file read → drifted MCP tool → attempted unsafe writeback → Stop All.
4. Navigate every redesigned page and return to the same dashboard module/graph camera with no legacy sidebar or stale workspace content.
5. Disable V2 flags after use; V1 notes, graph, manual handoff, OpenRouter, jobs, browser, voice, remote, settings, and legacy artifact reads remain usable.
6. Launch the packaged app with production fixture escape hatches disabled and verify no test adapter, secret, unreviewed component, or debug permission appears.

## Exit criteria

- The full automated release gate passes from a clean checkout.
- Every current page uses the accepted no-sidebar design system in V2.
- The real Markdown globe and approved-artifact orbit meet fidelity, accessibility, isolation, and scale gates.
- Component artifacts are design-system-native, exact-digest reviewed, separately permissioned, sandboxed, and brokered.
- Real Claude and Codex are each Passed or prominently Unverified with the exact missing condition.
- Migration/backup/restore/feature rollback has no known data-loss path.
- Security, design, and scale results are attached with residual risks and honest test boundaries.
- User/operator/recovery documentation is complete.
- The release manifest and requirement matrix identify every automated, visual, artifact-review, live, native, network, audio, signing, and pending item separately.
