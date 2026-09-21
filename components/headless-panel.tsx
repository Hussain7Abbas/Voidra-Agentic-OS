"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestService } from "@/components/service-types";

type Provider = { provider: "claude" | "codex"; path: string; version: string; fingerprint: string };
type StagedChange = { path: string; type: "added" | "modified" | "deleted" | "blocked"; bytes: number; reason?: string };
type Run = { id: string; provider: "claude" | "codex"; executablePath: string; executableFingerprint: string; version: string; model: string | null; queueClass: "interactive" | "scheduled"; provenance: { routineId: string; trigger: string; skillBundleDigest: string; contextManifestDigest: string } | null; accessMode: "read-only" | "staged-write"; status: string; output: string; error: string | null; events: Array<{ sequence: number; type: string; at: string }>; stagedChanges: StagedChange[]; writebackStatus: string; appliedPaths: string[]; createdAt: string };

const terminal = new Set(["completed", "failed", "cancelled", "interrupted"]);

export function HeadlessPanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [provider, setProvider] = useState<"claude" | "codex">("claude");
  const [executablePath, setExecutablePath] = useState("");
  const [model, setModel] = useState("");
  const [accessMode, setAccessMode] = useState<"read-only" | "staged-write">("read-only");
  const [prompt, setPrompt] = useState("Review the staged workspace context and return a concise Markdown report. Do not modify files.");
  const [message, setMessage] = useState("");

  const loadRuns = useCallback(async () => {
    const result = await request("headless.list", {}, workspaceId);
    if (result.ok) setRuns((result.data.runs as Run[]) ?? []);
  }, [request, workspaceId]);

  const discover = useCallback(async () => {
    const result = await request("headless.discover", {}, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    const next = (result.data.providers as Provider[]) ?? []; setProviders(next);
    const match = next.find((item) => item.provider === provider); if (match) setExecutablePath(match.path);
    setMessage(next.length ? `Discovered ${next.map((item) => `${item.provider} ${item.version}`).join(" · ")}. Review the absolute path before running.` : "No supported Claude Code or Codex executable was found on PATH.");
  }, [provider, request, workspaceId]);

  useEffect(() => { void loadRuns(); void discover(); }, [discover, loadRuns]);
  useEffect(() => { const timer = window.setInterval(() => void loadRuns(), runs.some((run) => !terminal.has(run.status)) ? 800 : 4_000); return () => window.clearInterval(timer); }, [loadRuns, runs]);
  useEffect(() => { const match = providers.find((item) => item.provider === provider); if (match) setExecutablePath(match.path); }, [provider, providers]);

  const start = async () => {
    setMessage(`Starting ${provider}. This may consume the subscription or API allowance configured in that CLI.`);
    const result = await request("headless.start", { provider, executablePath, prompt, model: model.trim() || null, accessMode, maxRuntimeMs: 300_000 }, workspaceId);
    setMessage(result.ok ? `${provider} started in a sanitized ${accessMode} snapshot. Canonical files remain unchanged until explicit writeback review.` : result.error.message);
    await loadRuns();
  };

  return (
    <section className="headless-console" aria-label="Headless Claude and Codex">
      <article className="panel headless-launcher">
        <header><div><p className="card-label">LOCAL SUBSCRIPTION RUNNER</p><h2>Claude Code + Codex</h2></div><button onClick={() => void discover()}>Discover CLIs</button></header>
        <p className="headless-boundary">Runs use the selected CLI&apos;s existing authentication, a sanitized staged snapshot, direct argument spawning, stdin prompts, a minimal environment, bounded output, and awake-Mac execution. Staged edits never reach canonical files without a separate review click.</p>
        <div className="segmented" aria-label="Headless provider"><button className={provider === "claude" ? "selected" : ""} onClick={() => setProvider("claude")}>Claude Code</button><button className={provider === "codex" ? "selected" : ""} onClick={() => setProvider("codex")}>Codex</button></div>
        <label>Approved executable path<input aria-label="Headless executable path" value={executablePath} onChange={(event) => setExecutablePath(event.target.value)} placeholder={provider === "claude" ? "/absolute/path/to/claude" : "/absolute/path/to/codex"} /></label>
        <label>Model override <small>(optional; destination CLI validates it)</small><input aria-label="Headless model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="Use CLI default" /></label>
        <label>Filesystem profile<select aria-label="Headless filesystem profile" value={accessMode} onChange={(event) => setAccessMode(event.target.value as "read-only" | "staged-write")}><option value="read-only">Read-only report</option><option value="staged-write">Staged edits — review before apply</option></select></label>
        <label>Prompt<textarea aria-label="Headless prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
        <button className="primary" disabled={!executablePath.startsWith("/") || !prompt.trim() || runs.some((run) => !terminal.has(run.status))} onClick={() => void start()}>Review acknowledged — run headlessly</button>
        {message && <p className="save-message" aria-live="polite">{message}</p>}
      </article>

      <article className="panel headless-history" aria-label="Headless run history">
        <header><p className="card-label">RUN JOURNAL</p><span>{runs.length} recorded</span></header>
        {!runs.length && <p className="empty-copy">No headless run has been started in this workspace.</p>}
        {runs.map((run) => { const applicable = (run.stagedChanges ?? []).filter((change) => change.type !== "blocked" && !(run.appliedPaths ?? []).includes(change.path)); return <details key={run.id} open={!terminal.has(run.status) || run.writebackStatus === "pending-review"}><summary><i data-state={run.status} /><span><strong>{run.provider} · {run.status}</strong><small>{run.queueClass ?? "interactive"} · {run.accessMode} · {run.version} · {run.executableFingerprint.slice(0, 10)} · {new Date(run.createdAt).toLocaleString()}</small></span>{!terminal.has(run.status) && <button onClick={(event) => { event.preventDefault(); void request("headless.cancel", { runId: run.id }, workspaceId).then(() => loadRuns()); }}>Cancel</button>}</summary><dl><div><dt>Executable</dt><dd>{run.executablePath}</dd></div><div><dt>Model</dt><dd>{run.model ?? "CLI default"}</dd></div><div><dt>Events</dt><dd>{run.events.length}</dd></div><div><dt>Writeback</dt><dd>{run.writebackStatus}</dd></div>{run.provenance && <><div><dt>Skill digest</dt><dd>{run.provenance.skillBundleDigest.slice(0, 12)}</dd></div><div><dt>Context digest</dt><dd>{run.provenance.contextManifestDigest.slice(0, 12)}</dd></div></>}</dl>{run.error && <p className="browser-warning">{run.error}</p>}{Boolean(run.stagedChanges?.length) && <section className="headless-changes"><h3>Staged file review</h3><ul>{run.stagedChanges.map((change) => <li key={`${change.type}:${change.path}`}><strong>{change.type}</strong><code>{change.path}</code><small>{change.reason ?? `${change.bytes} bytes`}</small></li>)}</ul>{run.writebackStatus === "pending-review" && applicable.length > 0 && <button className="primary" onClick={() => void request("headless.applyWriteback", { runId: run.id, paths: applicable.map((change) => change.path) }, workspaceId).then(async (result) => { setMessage(result.ok ? `Applied ${applicable.length} reviewed staged change(s).` : result.error.message); await loadRuns(); })}>Apply {applicable.length} reviewed change(s)</button>}</section>}<pre>{run.output || "Waiting for structured provider output…"}</pre></details>; })}
      </article>
    </section>
  );
}
