# ADR 0007: Workspace-scoped MCP connections and reviewed capability execution

- Status: accepted for P06
- Date: 2026-09-20
- Prerequisites: ADR 0002 workspace context, ADR 0006 agent grants and recovery
- Inputs: P06, the MCP Registry API, and the maintained TypeScript SDK v2 client

## Decision

Voidra uses the official MCP TypeScript SDK v2 client for local stdio and remote Streamable HTTP connections. Each configured server belongs to exactly one workspace and is persisted in that workspace's `.voidra/mcp.json`. A connection owns its process/session, lifecycle, capabilities, actions, configuration history, and credential reference; neither processes nor capabilities are shared across workspaces.

The desktop exposes the official Registry as descriptive discovery metadata. Search results retain source and exact version and are labeled `declared-unverified`. Supported npm declarations are converted into a pinned, reviewable executable/argument proposal, but Registry prose is never executed. The user must explicitly add and connect the resulting configuration. Cached metadata is labeled stale when the Registry is offline, and custom configuration remains available.

This follows the Registry's documented `/v0.1` API and the SDK's documented client transports and package split: [Registry API](https://registry.modelcontextprotocol.io/docs), [Registry aggregator guidance](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/registry-aggregators.mdx), and [TypeScript client connection guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/connect.md).

## Transport and credential boundary

Local servers are spawned directly without a shell. The child receives the SDK's minimal default environment plus validated, explicitly configured non-secret values, and its working directory must resolve inside the owning workspace. A workspace root is a scope hint, not an operating-system sandbox; the UI does not claim that an arbitrary executable is prevented from accessing other user files.

Remote connections require HTTPS except for loopback test/development endpoints. Credentials in URLs are rejected. P06 supports an optional bearer token stored by Electron main as encrypted `safeStorage` bytes under an opaque connection ID with mode `0600`; the renderer can set, delete, and query presence but cannot read the token. The supervised service receives it only in memory, including after a service restart. Configuration updates preserve the connection identity and credential; removal deletes the credential through the main-process bridge.

Arbitrary secret environment variables, OAuth browser flows, and custom secret headers are not silently approximated. The current form rejects secret-like environment keys and supports the tested bearer flow only. A provider-specific account flow depends on Q04 and requires its own compatibility and live-account verification.

## Capabilities, grants, and effects

Tools, resources, and prompts are discovered and invoked as separate protocol features. The SDK handles paginated lists, while Voidra refreshes the relevant list before every read, prompt retrieval, or tool authorization. A prepared manual tool action stores the exact arguments and a hash of the advertised tool definition; a changed or removed tool invalidates the review.

Automatic tasks receive only tools from currently ready connections in their owning workspace. An MCP standing grant is scoped to the exact connection ID, tool name, and SHA-256 hash of the arguments. Changed arguments require a new review. Immediately before execution the MCP manager refreshes the tool list again, so stale UI, disabled connections, revoked accounts, workspace-ID manipulation, or changed capabilities fail closed.

Known MCP `isError` results are recorded as failed. Once an approved call has started, a timeout, transport crash, or unknown exception is recorded as `uncertain`, because the remote effect may have happened. Neither the manual action path nor the automatic agent path replays that effect.

## Lifecycle and recovery

Connections move through configured, starting, ready, authorization-required, degraded, stopped, and failed states. Connect, refresh, stop, enable/disable, remove, and update/rollback all converge on the same manager. Update stops the prior session and retains one previous configuration until a successful connection; rollback restores it without changing the connection ID or credential.

Unexpected closure moves a live connection to degraded. Service restart converts persisted live states to stopped and requires explicit reconnection. Saves are atomic and serialized per workspace; corrupt or incompatible metadata fails visibly. Diagnostics are bounded and redact configured environment values.

## Unsupported protocol surface

P06 does not negotiate server-initiated sampling, elicitation, roots, legacy SSE, or background package installation. These require separate product policy and tests. Registry presence does not mean a server is compatible or safe. The Q04 real calendar/email/task connector remains unselected, so P06 has protocol fixture evidence but no live third-party account claim.
