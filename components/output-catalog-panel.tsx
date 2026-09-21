"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestService } from "@/components/service-types";

type Output = { id: string; title: string; path: string; kind: string; provider: string; providerVersion: string | null; bytes: number; digest: string; tags: string[]; previewState: string; securityReviewState: string; retention: string; runId: string | null; routineId: string | null; createdAt: string };

export function OutputCatalogPanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [registerPath, setRegisterPath] = useState("");
  const [message, setMessage] = useState("");
  const [requestedOutputId, setRequestedOutputId] = useState("");
  const load = useCallback(async () => {
    const result = await request("output.search", { query, kind: kind || null, provider: null, tags: [], limit: 200 }, workspaceId);
    if (result.ok) setOutputs((result.data.outputs as Output[]) ?? []); else setMessage(result.error.message);
  }, [kind, query, request, workspaceId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => void load(), 2_000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { const entity = new URLSearchParams(window.location.search).get("entity") ?? ""; setRequestedOutputId(entity.startsWith("output:") ? entity.slice(7) : ""); }, [workspaceId]);
  useEffect(() => { if (requestedOutputId && outputs.some(({ id }) => id === requestedOutputId)) document.getElementById(`output-${requestedOutputId}`)?.scrollIntoView({ block: "center" }); }, [outputs, requestedOutputId]);

  return <section className="panel agent-card" aria-label="Run output catalog">
    <header><div><p className="card-label">OUTPUT CATALOG</p><h2>Reports, files, and artifact lineage</h2></div><span>{outputs.length} matches</span></header>
    <p className="headless-boundary">Content is sniffed from bytes, hashed, and owned by this workspace. Component packages stay quarantined, legacy HTML stays read-only, and unknown binaries never execute.</p>
    <div className="inline-fields"><input aria-label="Output catalog query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="project, tag, provider, path, run…" /><select aria-label="Output catalog type" value={kind} onChange={(event) => setKind(event.target.value)}><option value="">All types</option>{["markdown", "text", "image", "pdf", "component", "legacy-html", "directory", "binary"].map((value) => <option key={value} value={value}>{value}</option>)}</select><button onClick={() => void load()}>Search</button></div>
    <div className="inline-fields"><input aria-label="Register workspace output path" value={registerPath} onChange={(event) => setRegisterPath(event.target.value)} placeholder="reports/result.md" /><button disabled={!registerPath.trim()} onClick={async () => { const result = await request("output.register", { path: registerPath, title: undefined, tags: [] }, workspaceId); setMessage(result.ok ? `Registered ${String(result.data.kind)} output at an immutable digest.` : result.error.message); if (result.ok) { setRegisterPath(""); await load(); } }}>Register existing output</button></div>
    <div className="compact-list" aria-label="Cataloged outputs">{outputs.map((output) => <details id={`output-${output.id}`} key={output.id} open={requestedOutputId === output.id ? true : undefined}><summary><span><strong>{output.title}</strong><small>{output.kind} · {output.provider} · {output.retention} · {output.bytes} B</small></span><b data-state={output.securityReviewState}>{output.previewState}</b></summary><dl><div><dt>Path</dt><dd>{output.path}</dd></div><div><dt>Digest</dt><dd>{output.digest}</dd></div><div><dt>Run</dt><dd>{output.runId ?? "user registered"}</dd></div><div><dt>Routine</dt><dd>{output.routineId ?? "none"}</dd></div><div><dt>Security</dt><dd>{output.securityReviewState}</dd></div><div><dt>Tags</dt><dd>{output.tags.join(", ") || "none"}</dd></div></dl></details>)}</div>
    {message && <p className="save-message" role="status">{message}</p>}
  </section>;
}
