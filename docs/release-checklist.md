# P12 release checklist

## Automated release gate

- [x] Frozen dependency install is available through `make install-frozen`.
- [x] Type checking, coverage floors, production-built Electron E2E, packaging, manifest generation, and packaged smoke are composed by `make ci`.
- [x] The package manifest records application/schema versions, pnpm and Node inputs, lockfile digest, arm64 executable evidence, file count, byte count, and artifact tree digest.
- [x] Two consecutive unsigned builds with the same source and `SOURCE_DATE_EPOCH` produce the same complete app-tree digest.
- [x] Packaged smoke launches without a development server or repository renderer and confirms diagnostic IPC is absent.
- [x] Production runtime mode prevents legacy test flags from enabling fixture-only remote, wake, clock, or delayed-effect behavior.
- [x] Workspace backup/restore verifies hashes, preserves durable IDs/content/state/shared references, excludes credentials/indexes, and rejects corruption/newer schema/insufficient space.
- [x] The recovery E2E uses a fresh application profile and new root, then rebuilds the omitted note index and surfaces a missing shared source.
- [x] Existing application databases pass `quick_check`, receive a private pre-migration snapshot, and upgrade through one transaction; an interrupted later step leaves the source schema and data unchanged.

## Before sharing any build

- [ ] Decide Q02 architecture support and build every declared CPU target.
- [ ] Decide Q03 distribution, sign with the selected identity, notarize where applicable, and verify Gatekeeper on a clean supported macOS account.
- [ ] Exercise install/update/rollback while confirming bundle identity and permission continuity.
- [ ] Run the native acceptance matrix in `plan/phase-12-release-verification.md` on declared hardware.
- [ ] Configure and test trusted TLS from a physical phone on the intended LAN; verify firewall, reconnect, revoke, sleep, and wake behavior.
- [ ] Use designated provider accounts for opt-in OpenRouter, ElevenLabs, and MCP live smoke; never use personal workspaces in CI.
- [ ] Record measured startup, idle CPU/memory, editing/search/graph/index, speech, and concurrent-task results for each declared configuration.

## Backup rehearsal

1. Export each representative workspace to a destination outside that workspace.
2. Save `manifest.json` and its bundle together; do not edit or partially copy the bundle.
3. Restore into a new folder and clean application profile.
4. Compare workspace ID, representative canonical source bytes, history, routines/schedules, and task state.
5. Open Notes to rebuild the omitted index and test search.
6. Mount or locate every shared base; confirm each original identity and grant.
7. Reauthorize credentials and revoke obsolete credentials/devices.
8. Keep the prior workspace and backup until acceptance is complete.

## Application database migration rehearsal

1. Quit Voidra and make a separate backup of the application profile before replacing the app.
2. Launch the new build once. An existing supported `foundation.sqlite` receives a sibling `*.pre-migration-v<from>-to-v<current>-<uuid>.sqlite` snapshot with owner-only permissions before any schema change.
3. Confirm the upgraded profile and representative workspaces, shared references, jobs, and devices before removing that snapshot.
4. If startup reports an integrity or migration failure, quit Voidra and preserve both files. The failed transactional upgrade leaves the source schema unchanged; diagnose or restore a copied snapshot rather than overwriting either original.

## Rollback

The current build has no updater. Quit Voidra fully, retain the application data profile and workspace folders, replace the `.app` with the previously verified version, and relaunch. Do not open an application database whose `user_version` is newer than the old application supports; restore a copy of the matching pre-migration snapshot or application-profile backup as `foundation.sqlite` instead. Keep the upgraded database until rollback is verified. Workspace backup restore never downgrades schemas silently.

## Stop-ship conditions

- A digest mismatch, partial restore, unreported missing shared reference, credential material in a manifest, or cross-workspace data leak.
- Test-only diagnostics or plaintext remote transport accessible in a production runtime.
- An unsigned/notarized artifact represented as signed, a fixture represented as physical-device evidence, or a retry represented as proof that an uncertain external effect did not occur.
