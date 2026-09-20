# V2-04 — Applications and micro apps

[V2 index](main.md) · Previous: [V2-03](phase-03-routines-runs-artifacts.md) · Next: [V2-05](phase-05-command-center.md)

## Outcome

Implement the Applications layer of ARMS without turning the dashboard into a privileged plugin host. Existing MCP, browser, Mac-action, voice, and remote capabilities appear through a unified application registry. Approved connectors can supply normalized widget summaries and reviewed actions. Generated HTML artifacts can be promoted to isolated micro apps through a manifest and permission review.

## Application model

An application record separates:

- Package/adapter identity and provenance.
- Connection/account reference and owning scope.
- Read/query capabilities.
- Mutating action capabilities and review/idempotency metadata.
- Widget data sources, freshness, last success/error, and rate limits.
- Authentication state without credential values.
- Workspace enablement and explicit shared/device-wide classification.

Supported adapter kinds are MCP, HTTPS API, reviewed CLI, local Voidra capability, safe external link, and isolated micro app. Adapter kind does not imply trust. Community software is never installed or executed merely because search found it.

## Widget data contract

Widgets receive normalized snapshots through validated service requests, not direct connector handles:

```ts
type WidgetSnapshot = {
  widgetId: string;
  workspaceId: string;
  sourceId: string;
  generatedAt: string;
  freshness: "fresh" | "stale" | "unavailable" | "auth-required";
  summary: unknown;
  actions: Array<{ id: string; label: string; risk: "read" | "write" | "commit" }>;
  diagnostics: Array<{ code: string; message: string }>;
};
```

Each widget defines and validates its own bounded `summary` schema. Sensitive raw provider responses stay in the service boundary and are not cached in layouts.

## Stories

| Story | Points | Dependencies | Acceptance criteria |
| --- | ---: | --- | --- |
| V2-04-01: Build unified application registry | 5 | V2-00, V1 P06/P08/P09 | Given existing MCP/browser/Mac/voice/remote capabilities, when registered, then each shows provenance, scope, connection state, capabilities, and owning workspaces without exposing credentials |
| V2-04-02: Normalize widget queries | 5 | V2-04-01 | Given successful, stale, rate-limited, logged-out, malformed, and offline fixtures, when a widget refreshes, then it receives a bounded snapshot and an honest freshness state |
| V2-04-03: Route reviewed widget actions | 5 | V1 grant engine | Given read, reversible write, and external commitment actions, when a widget invokes one, then the exact application capability and risk-specific approval flow applies |
| V2-04-04: Create a micro-app manifest | 5 | V1 P08 | Given an HTML artifact, when promotion is requested, then title/icon/routes/data needs/storage/network/action capabilities are previewed and no capability is inferred from its code |
| V2-04-05: Isolate custom micro apps | 8 | V2-04-04 | Given malicious scripts, navigation, storage, popup, download, bridge, and traversal attempts, when the micro app runs, then only declared mediated capabilities work and Electron privilege remains unreachable |
| V2-04-06: Ship built-in app widgets | 8 | V2-04-02 | Given local time/calendar, attention/email, creator metric, and connector-status fixtures, when enabled, then each widget renders data/freshness/errors and an unavailable provider does not fabricate content |
| V2-04-07: Recommend connectors safely | 5 | V2-04-01 | Given an app name, when connector discovery runs, then official API/MCP/CLI sources rank ahead of community options and installation always requires separate review |
| V2-04-08: Accept the first live provider | 5 | User answer to V2-Q02 | Given the selected provider/test account, when read and reviewed-write tests run, then OAuth/revocation/rate/error/idempotency behavior is recorded separately from fixtures |

## Micro-app boundary

- Reuse the isolated artifact renderer: no Node integration, no preload, context isolation, navigation allowlist, permission denial, and constrained protocol/resource resolution.
- A micro app may request data through typed message channels implemented by a host proxy. The proxy checks widget ID, workspace ID, manifest capability, current grant, and payload schema on every call.
- Per-widget storage is namespaced by workspace and micro-app identity. It cannot read browser cookies, connector tokens, another widget's storage, or arbitrary files.
- Network is denied by default. Approved origins/methods and response size/content types are declared in the manifest; secrets are injected only at the connector service, never into page JavaScript.
- Promoting an artifact records its digest. Changed bytes disable execution until reviewed again.

## First built-in widgets

1. **Time and calendar:** local clocks always work; calendar events appear only from a configured connector and include source/freshness.
2. **Attention inbox:** provider-neutral priority groups; “AI flagged” appears only when a named routine/model produced a stored classification with evidence.
3. **Creator metrics:** fixture contract first; real YouTube or other provider requires explicit user selection/auth.
4. **Connection health:** active application connections, authorization needs, last sync, and errors.
5. **Micro-app dock:** reviewed micro apps and safe external links with visible scope.

No personal provider is silently selected. The live acceptance story remains blocked until the user chooses V2-Q02, but all provider-neutral work can proceed.

## Unit and integration tests

- Registry identity, workspace enablement, device-wide labels, credential-reference redaction, and revocation.
- Widget schema and payload size limits; stale cache, clock skew, rate limits, partial responses, and reconnect.
- Mutating action review, idempotency, timeout after possible effect, and reconciliation.
- CSP/navigation/protocol/download/popup/storage/message-origin tests for micro apps.
- Connector discovery fixtures distinguish official documentation/repositories from community claims and never auto-install.

## Playwright Electron

1. Enable fixture calendar/email/creator applications in Work only; Personal widgets remain disconnected.
2. Refresh through success, stale, auth-required, malformed, and offline states without crashing the dashboard.
3. Invoke a read action and a write/commit action; verify the latter shows exact target/account/payload before approval.
4. Promote an HTML artifact to a micro app, use an approved read channel, then modify its bytes and verify it is disabled pending review.
5. Attempt bridge access, file escape, external navigation, undeclared network, cross-widget storage, and spoofed messages.
6. Revoke an application while a routine/widget is active and verify the next call fails closed.

## Exit criteria

- Existing capabilities appear in one registry without broadening their grants.
- Widgets show bounded, source-labeled, freshness-aware data.
- Micro apps are useful without privileged renderer access.
- Connector discovery never equals installation or authorization.
- The first selected live provider has separate evidence, or V2 release clearly labels provider widgets as fixture/provider-neutral only.

