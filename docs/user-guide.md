# Voidra user guide

## Install and launch

The current release target is an unsigned Apple Silicon macOS development build. Build it with `make release`, then open `release/mac-arm64/Voidra.app`. Because it is not signed or notarized, it is intended for local development acceptance rather than general distribution. Do not treat a successful local launch as Gatekeeper, signing, or update acceptance.

For repository development, install Node.js 24 and pnpm 10.30.3, run `make install-frozen`, then `make start`. `make` prints the complete command reference.

## First workspace

On first launch, choose an empty or existing folder and create a workspace. Voidra adds `.voidra/workspace.json`, `.voidra/settings.json`, `AGENTS.md`, `CLAUDE.md`, and `persona.md` without replacing existing user-authored instruction or persona files. Additional workspaces stay independent. Global settings are defaults; explicit workspace values win.

Shared knowledge is attached from Settings. Each workspace gets its own read or write grant. Attaching a folder does not copy it or expose private content from another workspace.

## Credentials and permissions

OpenRouter and ElevenLabs credentials are stored through macOS secure storage and are not returned to the renderer or included in workspace backups. MCP bearer credentials use the same host-secured boundary. After restoring to a new profile or Mac, reauthorize providers.

Voidra asks for microphone access only when voice capture starts. Native Mac actions remain explicit, reviewed, and serialized through the desktop lease. Folder choices grant only the selected workspace or automation root. Denial is recoverable from macOS System Settings; restart Voidra after changing an operating-system permission.

## Manual and automatic work

Manual Claude or Codex routines assemble and preview a prompt locally. Copying is an explicit button action. Voidra never submits the prompt to a subscription client and does not require an OpenRouter key for manual mode.

Automatic work uses OpenRouter and remains tied to the workspace that started it. Tool effects require their configured grants and review boundaries. An uncertain external result is not silently retried as success. Plan the Day is the default editable routine and can run locally, prepare a manual handoff, or use the automatic path.

## Backup

Open Settings and choose **Export workspace backup**. Select a destination outside the workspace. Voidra writes a timestamped `.voidra-backup` directory containing a hashed manifest and the verified workspace snapshot.

The backup includes canonical files, personas, rules, histories, routines, schedules, task state, and shared-base attachment references. It excludes rebuildable indexes, transient files, symlinks, application credentials, and credential references. Shared knowledge sources are referenced once and are not duplicated into every workspace backup. Protect the backup destination: canonical workspace files may contain private information.

## Restore

From **Add workspace** or the first-launch dialog, select **Restore backup**. Choose the `.voidra-backup` directory, choose a parent directory, enter a new folder name, and select **Verify and restore**. Restore requires a destination folder that does not already exist.

Voidra validates every payload digest before copying. The restored workspace keeps its original ID and durable history. Search indexes rebuild when Notes opens. Missing shared sources remain visible as unavailable attachments; use **Locate** in Settings after mounting or moving the source. Reauthorize credentials separately.

If registration fails after files were restored, the error reports the retained destination. Do not delete the source backup until the restored workspace has been opened and checked.

## Application updates and migration recovery

When a newer Voidra build must upgrade an existing application database, it first verifies the database and writes a private `foundation.sqlite.pre-migration-v…sqlite` snapshot beside the original. The complete schema upgrade is transactional, so an interrupted step leaves the original schema and data unchanged. Keep the snapshot until you have opened the upgraded app and checked representative workspaces. If migration startup fails, quit Voidra and preserve both database files; follow the release checklist instead of renaming or deleting either file while the app is running.

## Remote companion

Remote access is awake-Mac only. Production hosting stays disabled until TLS certificate and key paths are configured. Pairing begins on the Mac, uses a short-lived one-use code, and authorizes an explicit workspace list. Revoke a device from Remote settings when it should no longer connect.

There is no background queue while the Mac is asleep or unavailable. Rejected work is not replayed later. The current selected path is private-network-first; no internet relay is included.

## Troubleshooting

- **Workspace unavailable:** reconnect the original folder with Locate. The workspace ID must match.
- **Search looks stale or the index was removed:** use the Notes rebuild action. Markdown remains canonical.
- **Restore reports integrity failure:** keep the source bundle unchanged and create a new backup from the original workspace. Do not copy only part of a bundle.
- **Application migration fails:** quit Voidra, preserve `foundation.sqlite` and its newest `pre-migration` snapshot, and recover from a copy according to the release checklist.
- **Shared base unavailable:** mount the volume or choose Locate; Voidra does not substitute another folder with a different identity.
- **Provider authorization failed:** remove/re-add the secure credential. Restores intentionally require reauthorization.
- **Remote is disabled:** configure trusted TLS material and the intended private-network bind address; plaintext production fallback is not available.
- **Packaged app will not pass Gatekeeper:** the current artifact is unsigned. Signing/notarization is a pending release decision, not a runtime workaround.

## Known limitations

The current artifact is Apple Silicon-only, unsigned, and not notarized. Production Accessibility/visual automation, wake recognition, live ElevenLabs language/device measurements, physical sleep/wake notification behavior, and real phone/TLS/LAN acceptance are pending. Provider-specific account flows beyond bearer authorization and an internet relay are not implemented. See `docs/release-checklist.md` for the exact release boundary.
