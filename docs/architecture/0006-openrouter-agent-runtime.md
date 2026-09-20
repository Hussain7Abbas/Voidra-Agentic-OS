# ADR 0006: OpenRouter agent runtime, grants, and recovery

- Status: accepted for P05
- Date: 2026-09-20
- Prerequisites: ADR 0002 workspace context, ADR 0004 scoped knowledge, ADR 0005 manual handoffs
- Inputs: P05 and the confirmed OpenRouter automatic-execution requirement

## Decision

Voidra runs automatic tasks in the supervised local service through an OpenRouter Chat Completions streaming adapter. A task permanently records its originating workspace, selected model, objective, step/token/runtime limits, usage, context manifest, messages, tool state, and append-only event sequence in that workspace's `.voidra/agent-runtime.json`. Manual Claude/Codex handoffs remain a separate state machine and never inherit an automatic task's credential or grants.

Only the explicitly selected model is called. P05 does not silently fall back to another model: this makes retries and billing attribution predictable and avoids moving private context to an unreviewed provider route. Retryable transport/server failures receive at most two retries, only before partial output or a tool effect. Authentication, unsupported-request, malformed-response, and other permanent failures are actionable terminal errors.

## Credential boundary

The renderer can ask whether an OpenRouter credential exists and can set or delete it through dedicated IPC methods. It cannot read the credential. Electron main encrypts the value with `safeStorage`, stores only the encrypted bytes under application support with mode `0600`, and passes the decrypted value directly to the supervised child process. The supervisor retains the in-memory credential long enough to restore it after a child restart. Tasks, events, renderer state, and workspace files never persist the key.

On macOS, Electron `safeStorage` uses the operating system's protected storage facilities. P05 verifies the production Electron boundary and that encrypted fixture bytes do not contain the plaintext key; it does not claim an independent Keychain command-line audit.

## Context and workspace ownership

Every provider step rebuilds its system context from the task's original workspace. It resolves the current effective persona, root-to-target instruction chain, matching active workspace memory, and only the explicitly selected private or currently attached shared documents. Prior system context is removed before resolution. Detaching a shared base or changing memory/instructions therefore takes effect before the next provider request, and a revoked source fails closed instead of replaying stale context.

Selected source content is labeled as data, not instructions, and receives the same defense-in-depth secret redaction used by manual prompt compilation. Instruction or persona text cannot create a grant. Switching the visible workspace does not change a running task's owner, output paths, context, or grant registry.

## Grants and effects

P05 exposes two built-in UTF-8 file tools, `read_file` and `write_file`. Tools execute serially. A grant is owned by one workspace and matches the tool plus an exact relative path or descendant path prefix, with optional expiry and explicit revocation. The runtime canonicalizes and rechecks the path immediately before each effect, rejects traversal, `.voidra` access, directories for reads, and symlink escapes, and uses atomic file replacement for writes.

Tool state is recorded separately as requested, authorized, started, observed-result, denied, or uncertain. Arguments and concise observed results are retained; read-file event summaries store byte counts instead of duplicating file content. A write result records path, byte count, and content hash.

Account and domain scopes are intentionally not invented for file tools. P06 must extend the same enforced grant model when MCP capabilities introduce account- or domain-bearing actions.

## Limits, cancellation, and recovery

Tasks are bounded by configured steps, provider tokens, and cumulative wall-clock runtime; exceeding any bound produces `interrupted`, never `completed`. Provider calls and retry delays share an abort signal. Per-task Stop and device-wide Stop All cancel active work; stopping cannot undo an already committed effect.

After a service restart, a previously running task becomes interrupted. It may resume only when its last event is the recorded service interruption and no tool effect is uncertain. If restart occurred after `tool.started` but before `tool.observed-result`, the tool becomes uncertain and the runtime refuses replay until a future reconciliation workflow handles it. This favors duplicate-effect prevention over optimistic retry.

## Consequences

- P06 can add MCP tools, but must map every capability into explicit grant scopes and preserve the requested/started/observed distinction.
- P07 may schedule automatic tasks only while the local runtime is awake and must retain their workspace identity and limits.
- P08/P09 browser and Mac effects must use the same cancellation and uncertain-effect rules; prompt text alone is never an authorization boundary.
- The JSON registry uses atomic replacement and fails visibly on incompatible/corrupt metadata. A later schema migration should move high-volume journals to a transactional store without weakening workspace ownership.
- Live OpenRouter compatibility remains an opt-in smoke requiring the user's credential. Default CI uses a local protocol-shaped fixture and makes no paid network request.
