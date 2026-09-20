# ADR 0012: Paired, workspace-scoped companion with the awake Mac as host

- Status: accepted for P11 automated implementation
- Date: 2026-09-20
- Prerequisites: durable automatic tasks, awake-only scheduler, manual handoffs, and voice sessions
- Inputs: P11 and provisional private-network-first Q11 default

## Decision

The local service may host a responsive companion page and JSON API. It remains disabled unless a production TLS certificate and key are explicitly configured. Production never falls back to cleartext. The automated suite enables a separate loopback-only HTTP fixture; that exception is labelled in host status and is not a release transport.

Pairing starts on the Mac. The user creates a five-minute, one-use six-digit challenge and pre-authorizes an explicit workspace set. Pair claims are rate-limited. A successful claim returns a random 256-bit bearer credential once; the host persists only its SHA-256 digest. Devices and their workspace allowlists are durable and independently revocable.

Every companion API call authenticates the device and then checks its workspace allowlist. A supplied workspace ID is never sufficient. The companion receives summaries only for authorized workspaces. Cross-origin requests are denied, responses are non-cacheable, and the page uses a restrictive content security policy with no Electron preload or Node integration.

## Delivery and replay semantics

Automatic, voice, and manual-handoff submissions include a device-scoped idempotency key. The first request stores a payload hash before execution; a retry with the same key maps to the original submission, while reuse with a different payload fails. Device/workspace events have monotonically increasing cursors for reconnect.

When the runtime is unavailable, a request receives an explicit unavailable response and no submission record is created. Nothing is implicitly replayed on wake. Remote automatic tasks are ordinary P05 tasks and retain the same tool approvals, grants, cancellation, and uncertain-effect behavior. Remote voice uses the P10 session boundary and exposes separate speech interruption. Remote manual handoff compiles a prompt on the Mac, displays it, and copies it only from an explicit companion button; it never submits to Claude or Codex.

Revocation blocks all subsequent status, task, voice, handoff, event, and cancellation calls. It does not pretend an already committed effect was undone.

## Transport boundary

Production configuration uses `VOIDRA_REMOTE_TLS_CERT`, `VOIDRA_REMOTE_TLS_KEY`, `VOIDRA_REMOTE_HOST`, `VOIDRA_REMOTE_PORT`, and optionally `VOIDRA_REMOTE_PUBLIC_URL`. Certificate provisioning and trust are deployment concerns and real-network acceptance must verify them. No internet relay is implemented under the private-network-first provisional decision.

The host process disappears during system sleep or full Quit, which naturally makes the endpoint unavailable. A deterministic availability switch tests reject-without-queue behavior but is not evidence of real sleep/network behavior.

## Consequences

- A stolen device token is limited to its explicit workspace set and can be revoked, but remains a sensitive bearer credential on that companion.
- The local HTTP fixture proves authentication/routing/UI behavior only. It does not prove TLS trust, firewall discovery, phone reachability, router isolation, sleep/wake, or internet access.
- Event history currently covers companion-originated lifecycle events; it is not a general remote mirror of all private workspace activity.
