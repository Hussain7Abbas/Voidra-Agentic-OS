# Voidra V2 component-artifact authoring contract

[V2 index](main.md) · [Runtime phase](phase-09-nextjs-artifact-runtime.md) · [Security phase](phase-10-artifact-security-review.md)

Status: implemented contract, version `artifactUiVersion: "1"` / `sdkVersion: "1"`. This document describes the package accepted by the current runtime. It does not grant capabilities or certify an artifact as safe.

## Package

```text
artifact.json
src/Artifact.tsx
assets/*                 optional, declared and hashed
dist/artifact.js         host-built; never accepted as source authority
dist/artifact.css        host-built facade
dist/index.html          host-built CSP shell
```

The source package is a React Client Component, not an HTML application. New HTML artifacts are not generated. Legacy HTML remains a separate read-only format; guided conversion creates a new quarantined component package and preserves the legacy source unchanged.

## Manifest v1

```json
{
  "schemaVersion": 1,
  "id": "UUID",
  "name": "Artifact name",
  "version": "1.0.0",
  "entry": "src/Artifact.tsx",
  "artifactUiVersion": "1",
  "sdkVersion": "1",
  "producer": { "kind": "agent", "name": "producer", "model": null },
  "inputs": { "noteIds": [], "runIds": [], "workspacePaths": [] },
  "output": { "kind": "component", "entryFile": "dist/index.html" },
  "assets": [],
  "layout": { "minWidth": 320, "idealWidth": 720, "minHeight": 320 },
  "accessibility": {
    "requiredStates": ["empty", "error", "stale", "permission", "review"],
    "keyboardActions": []
  },
  "networkPolicy": "broker-only",
  "requestedCapabilities": []
}
```

Unknown fields, unsupported versions, absolute/traversing paths, undeclared assets, invalid digests, and more than 20 capabilities fail closed. The runtime also bounds source count and bytes before compilation.

## Allowed imports and UI

Artifact source may import only:

```tsx
import React from "react";
import {
  Canvas,
  Module,
  Metric,
  Status,
  Action,
  EmptyState,
  ErrorState,
  StaleState,
  PermissionPrompt,
  ReviewAction,
} from "@voidra/artifact-ui";
import { requestCapability } from "@voidra/artifact-sdk";
```

The host owns tokens, typography, spacing, focus, reduced motion, state colors, and the runtime frame. Artifacts do not import host CSS or private `--cc-*`, `--kg-*`, or `--v2-*` tokens. They must expose meaningful headings, labels, keyboard actions, and honest empty/error/stale/permission/review states. They must never imitate Voidra approval, permission, authentication, or Stop All chrome.

Forbidden behavior includes arbitrary packages, Node/Electron globals, dynamic code, direct network APIs, ambient browser storage, workers/WebAssembly, navigation/popups, raw HTML injection, global CSS, forged message channels, perpetual loops/timers, fixed host-covering overlays, credential-shaped literals, and obfuscated executable content.

## Capabilities

Approval gives an artifact permission to render only. Every effect is separately declared and granted for the exact workspace and source digest.

```json
{
  "id": "read-report",
  "operation": "fs.readText",
  "reason": "Read the selected workspace report",
  "scope": { "path": "reports/status.md", "maxBytes": 100000 },
  "userPresence": false
}
```

Supported operations are `fs.readText`, `fs.list`, `fs.writeStagedText`, `mcp.callTool`, and `mcp.readResource`. File paths are workspace-relative logical handles. Writes always enter host staging and require canonical writeback review. MCP scopes include `connectionId`, operation name, the current 64-character `serverFingerprint`, and 64-character `schemaDigest`; drift suspends the grant. The artifact never receives filesystem handles, MCP credentials, process handles, generic IPC, or direct network access.

Capability use is:

```tsx
const result = await requestCapability("read-report", { path: "reports/status.md" });
```

The broker revalidates sender, artifact/source digest, workspace, declaration, grant, expiry/revocation, scope, schema pins, source revisions, size/rate limits, and user-presence requirements on every call.

## Build, review, and version lifecycle

1. Voidra copies the bounded source inventory into a disposable temporary root and verifies its digest.
2. A directly spawned worker compiles against the pinned host facades with a 256 MB Node heap, 20-second timeout, minimal environment, bounded output, and no canonical workspace writes. Compilation does not execute artifact code. This is resource/process isolation, not a claim of a kernel-enforced network sandbox.
3. Static policy checks run before and after build. A deterministic failure cannot be overridden.
4. A separate credential-free local reviewer process examines the exact inventory. A distinct semantic reviewer then produces a schema-validated verdict for the exact source/bundle digests. Automated tests label their semantic verdict `test-fixture`; production requires an OpenRouter credential and records `live-model` evidence.
5. The final decision is HMAC-signed, chained to the previous decision, expires after 30 days, and binds artifact, workspace, source, bundle, policy, and semantic-review IDs.
6. Approved source and bundle bytes are copied to an immutable content-addressed snapshot. Editing, rollback, policy expiry, capability drift, or source/bundle mismatch quarantines the active artifact and clears grants.
7. Rollback restores an immutable snapshot as a new quarantined working version. It never silently restores an old approval.

Normal preview uses a sandboxed Electron view with context isolation, no Node integration, no direct network, restrictive CSP, blocked navigation/popups/downloads, and a narrow artifact preload. No single layer is described as a complete sandbox.

## Required acceptance fixtures

- Safe metric/report component with every required state.
- One declared bounded read and one staged write requiring review.
- One MCP call pinned to server and schema digests, plus drift/revocation denial.
- Source edit and immutable rollback, both requiring re-review.
- Legacy conversion proving the original HTML/script bytes are neither executed nor overwritten.
- Forbidden imports, traversal/symlinks, dynamic code, raw HTML, direct network/storage, secret literals, message forgery, host impersonation, resource abuse, oversized inputs/output, malformed reviewer output, missing inventory, signature tamper, and wrong-workspace calls.

The executable implementation is in `src/domain/artifact-security.ts`, `src/shared/design-system.ts`, `src/service/artifact-builder-process.ts`, `src/service/artifact-semantic-review.ts`, and `src/electron/browser-manager.ts`.
