# P12 — Release, recovery, and full-system verification

[Plan index](main.md) · Previous: [P11](phase-11-remote.md)

## Outcome and prerequisites

Produce a reproducible macOS release and evidence that the full selected scope works together. Earlier phase tests remain required; this phase validates their composition, packaging, migration, and real-device behavior.

Prerequisites: P00–P11 selected-scope exit criteria. Resolve Q01 release timing, Q02 architectures, Q03 distribution, Q07 scale, Q09 history, Q10 language, Q11 networking, and Q13 CI. Do not call a partial checkpoint the complete v1 if selected features are still missing.

## Release and recovery design

- Package the built Next.js assets, preload, service, native helper, database bindings, and required runtime assets. Verify operation without the repository or development server present.
- Decide updater/signing/notarization behavior according to Q03. A personal unsigned build is not evidence that a signed installer passes Gatekeeper or keeps permission identity across updates.
- Record build version, schema versions, compatible OS/architecture range, dependency lock, and artifact digest. Preserve rollback instructions.
- Back up canonical Markdown, workspace settings/persona/rules, histories/conversations, job definitions/state, and shared-base attachment references. Indexes can be rebuilt. Secrets are reauthorized or migrated through an explicitly designed credential path, never exported casually into Markdown.
- Shared base backup operates once per base and preserves identity; workspace backup must not accidentally duplicate or delete another workspace's shared source.
- Migrations use preflight checks/backups and transactional durable metadata changes. Failed migration offers recovery; downgrade across incompatible schemas does not attempt silent data conversion.
- Performance measures cover startup, editing/search, graph interaction, index rescan, idle memory/CPU, speech latency, and concurrent tasks on the target hardware/corpus.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P12-01: Reproducible selected-platform package | 5 | P00–P11, Q02/Q03 | Fresh machine/test account launches artifact without dev server; architecture and native modules match release claims |
| P12-02: Backup/restore and schema migration | 8 | P01–P07, Q09 | Restore preserves IDs/rules/history/shared references; interrupted migration recovers without source loss |
| P12-03: Compose full-system regression suite | 5 | Every phase | Requirement matrix maps each requirement to passing unit/E2E/native evidence with real/mock boundary labeled |
| P12-04: Validate performance and native acceptance | 5 | P02/03/09/10/11, Q07/Q10 | Measured budgets and physical Mac/phone checks meet agreed thresholds; unresolved limits are documented |
| P12-05: Release operations and user documentation | 3 | P12-01–04 | Installation, onboarding, backup, troubleshooting, permissions, manual mode, and known limitations are accurate |

## Unit and integration regression

- Re-run settings/rules/grants/path access/scheduler/prompt-compilation domains and real storage migration fixtures.
- Exercise supported schema upgrade chains, insufficient disk, corrupted disposable index, missing shared source, and revoked credentials.
- Validate exported backup manifest does not include plaintext secrets and can distinguish missing optional shared sources from corrupted private data.
- Ensure production configuration cannot expose test-only adapter routes or an unprotected remote/debug endpoint.
- Coverage floors apply alongside scenario coverage; do not hide missing access/recovery scenarios behind high line coverage.

## Playwright release journeys

1. Fresh start: choose default folder, create second workspace, override model/persona, attach one shared base, restart, and verify all ownership.
2. Knowledge: edit linked notes, search/highlight tags, rename target, resolve external conflict, and restore revision across workspaces.
3. Manual: select Claude then Codex routines, compile/copy without keys, import result, and verify scoped instructions and zero inference calls.
4. Automatic: use fixture OpenRouter plus real fixture MCP process, prepare daily plan, review/apply one calendar change, restart after uncertain response, and verify no duplicate effect.
5. Browser/artifact: verify separate signed-in fixture sessions, agent takeover, interactive artifact/relative assets, and denied privilege/file escape.
6. Lifecycle: simultaneous workspace jobs, desktop lease, cancel/revoke, scheduler resume, and manual notification with unchanged clipboard.
7. Voice/remote: fixture interruption, workspace change, paired companion task, revocation, and unavailable Mac without stale replay.
8. Recovery: export/restore into clean roots, rebuild indexes, reconnect missing bases, and compare durable IDs/history/source bytes.

Run full journeys on built Electron. If production fuse settings prevent Playwright attachment, maintain the documented test build for automation and perform real distributable acceptance separately; record the exact difference rather than falsely claiming the signed artifact ran under Playwright.

## Proposed CI layers

Subject to Q13: pull requests run type checking, lint, unit/domain tests, and storage/protocol integration tests. macOS jobs run Electron Playwright smoke on relevant changes; the full suite runs before release. Browser companion tests may run on a separate runner. Cache dependencies without caching mutable user fixtures.

Use a deterministic seed/profile per test and bounded retries only for diagnosed infrastructure failures. A pass on retry is surfaced as flaky; required functional tests cannot be permanently skipped to obtain a green build. Failure artifacts contain synthetic fixture data and are access-controlled/retained deliberately.

Live provider/connector smoke uses designated test accounts and opt-in credentials. Unit and default E2E suites remain independent of paid APIs. CI never points at the user's real workspace or personal browser profile.

## Native acceptance matrix

| Area | Real-system evidence needed |
| --- | --- |
| Installation/update | Selected CPU(s), OS versions, distribution channel, signing/notarization where applicable |
| Permissions | Native folder/keychain/microphone/accessibility/screen flows, including denial and revocation |
| Mac actions | Two representative app/file workflows, physical user takeover, shared-device queue |
| Power/lifecycle | Close window, menu bar, full Quit, actual sleep/wake, notification/catch-up |
| Voice | Actual selected voice/languages, microphone/headset, echo/interruption/wake-word measurements |
| Remote | Physical phone/client on chosen network, reconnect, revocation, sleeping Mac |
| Storage | Restore/move/unavailable volume, concurrent edits, no loss after interrupted operations |

## Final exit checklist

- Every confirmed requirement in main.md has a test/evidence link and no undisclosed missing implementation.
- All phase unit/E2E suites and required real-device checks pass on declared configurations.
- Backup/migration/rollback instructions were exercised against representative fixture data.
- Manual mode is independently usable with no OpenRouter key or hidden inference calls.
- Workspace/shared knowledge/rules/permissions remain correct across the combined journeys.
- Release notes distinguish supported behavior, limitations, optional features, and remaining future work.
- No deployment/publication is implied by this planning document; implementation/release actions follow later user instructions.
