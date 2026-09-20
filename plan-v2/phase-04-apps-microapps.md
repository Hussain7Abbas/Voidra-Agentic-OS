# V2-04 — Applications and micro apps

[V2 index](main.md) · Previous: [V2-03](phase-03-routines-runs-artifacts.md) · Next: [V2-05](phase-05-command-center.md)

## Outcome

Implement the Applications layer of ARMS without turning the dashboard into a privileged plugin host. Existing MCP, browser, Mac-action, voice, and remote capabilities appear through a unified application registry. Approved connectors can supply normalized widget summaries and reviewed actions. V2-04 defines the micro-app data/capability contract; executable generated micro apps must use the V2-09 component format and pass V2-10 review rather than promoting HTML.

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
| V2-04-04: Define a micro-app capability contract | 5 | V1 P08 | Given a proposed local app, when registered, then title/icon/surfaces/data needs/storage/network/actions are declared and previewed; no capability is inferred from code or connector authentication |
| V2-04-05: Define the isolation handoff | 5 | V2-04-04 | Given executable custom UI, when promotion is requested, then it is routed to V2-09/V2-10 as a component artifact and cannot run through the connector/widget registry alone |
| V2-04-06: Ship built-in app widgets | 8 | V2-04-02 | Given local time/calendar, attention/email, creator metric, and connector-status fixtures, when enabled, then each widget renders data/freshness/errors and an unavailable provider does not fabricate content |
| V2-04-07: Recommend connectors safely | 5 | V2-04-01 | Given an app name, when connector discovery runs, then official API/MCP/CLI sources rank ahead of community options and installation always requires separate review |
| V2-04-08: Accept the first live provider | 5 | User answer to V2-Q02 | Given the selected provider/test account, when read and reviewed-write tests run, then OAuth/revocation/rate/error/idempotency behavior is recorded separately from fixtures |

## Micro-app boundary

- Built-in host widgets use reviewed application adapters. Generated executable micro apps use the V2-09 host-owned component runtime and V2-10 security/capability gates; V2-04 never creates an alternate executable path.
- A micro app may request data through typed message channels implemented by a host proxy. The proxy checks widget ID, workspace ID, manifest capability, current grant, and payload schema on every call.
- Per-widget storage is namespaced by workspace and micro-app identity. It cannot read browser cookies, connector tokens, another widget's storage, or arbitrary files.
- Direct network is unavailable to generated component artifacts in V2. Network-backed behavior uses a reviewed connector/MCP capability through the V2-10 broker; secrets remain in the service boundary.
- Promoting a component records its exact source/bundle digests and security verdict. Changed bytes disable execution and grants until reviewed again.

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
4. Register a reviewed component artifact as a micro app after V2-10, use one approved read capability, then modify its source and verify it is quarantined with prior grants invalidated.
5. Attempt bridge access, file escape, external navigation, undeclared network, cross-widget storage, and spoofed messages.
6. Revoke an application while a routine/widget is active and verify the next call fails closed.

## Exit criteria

- Existing capabilities appear in one registry without broadening their grants.
- Widgets show bounded, source-labeled, freshness-aware data.
- Micro apps are useful without privileged renderer access.
- Connector discovery never equals installation or authorization.
- The first selected live provider has separate evidence, or V2 release clearly labels provider widgets as fixture/provider-neutral only.
