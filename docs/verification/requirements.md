# Requirement traceability matrix

Date: 2026-09-20

| Requirement | Automated evidence | Real-system boundary |
| --- | --- | --- |
| Next.js/Electron macOS shell and local service | [P00](p00.md), P12 package smoke and release manifest | Signing, notarization, clean-account install, update |
| Independent/default workspace directories | [P01](p01.md), P12 clean-profile restore | Unavailable/removable physical volumes |
| Global/workspace settings and personas | [P01](p01.md), [P03](p03.md) | None beyond supported OS filesystem behavior |
| Paired root/scoped AGENTS and CLAUDE rules | [P01](p01.md), [P04](p04.md), P12 backup recovery | External subscription clients enforce their own permissions |
| Canonical Markdown, index, links, tags, graph, history | [P02](p02.md), [P03](p03.md), P12 index-omitting restore | Kernel watcher overflow and representative long-running corpus |
| Explicit shared knowledge and private memory | [P03](p03.md), P12 missing-source reconnect state | Removable/network-volume behavior |
| Manual Claude/Codex subscription handoff | [P04](p04.md), [P07](p07.md), [P11](p11.md) | User pastes and selects the destination model |
| OpenRouter automatic agent and grants | [P05](p05.md) | Opt-in live provider/account smoke |
| MCP marketplace/custom connections | [P06](p06.md) | Opt-in live third-party servers and auth |
| Plan the Day, routines, schedules, awake-only | [P07](p07.md), [P11](p11.md) | Physical sleep/wake and notification delivery |
| Ordinary/agent browser and HTML artifacts | [P08](p08.md) | Packaged human browsing/session smoke |
| Mac file and native control | [P09](p09.md) | Signed helper, Accessibility consent, physical workflows |
| ElevenLabs voice, interruption, wake flow | [P10](p10.md) | Real microphones/headsets, selected voice/languages, production wake recognition |
| Paired awake-Mac remote companion | [P11](p11.md), P12 production-mode fixture lockout | Physical phone, trusted TLS, LAN/firewall, reconnect and sleep |
| Backup, migration, package, and full regression | [P12](p12.md), [release checklist](../release-checklist.md) | Distribution and native matrix remain pending |

Automated fixture evidence is intentionally not labeled as live-provider, native-permission, physical-device, signing, notarization, or network acceptance.
