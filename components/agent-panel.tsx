"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RequestService } from "@/components/service-types";

type Tool = { id: string; name: string; argumentsText: string; state: string };
type Task = { id: string; objective: string; model: string; status: string; step: number; maxSteps: number; runtimeMs: number; maxRuntimeMs: number; output: string; error: string | null; pendingTool: Tool | null; usage: { promptTokens: number; completionTokens: number; totalTokens: number }; events: Array<{ sequence: number; type: string; at: string; data: Record<string, unknown> }> };
type Grant = { id: string; tool: string; pathPrefix: string; expiresAt: string | null };

export function AgentPanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [objective, setObjective] = useState("Draft a concise workspace update.");
  const [model, setModel] = useState("openai/gpt-5.4");
  const [maxSteps, setMaxSteps] = useState(8);
  const [maxTokens, setMaxTokens] = useState(50_000);
  const [maxRuntimeSeconds, setMaxRuntimeSeconds] = useState(300);
  const [targetPath, setTargetPath] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceResults, setSourceResults] = useState<Array<{ baseId: string; documentId: string; label: string }>>([]);
  const [selectedSources, setSelectedSources] = useState<Array<{ baseId: string; documentId: string; label: string }>>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;
  const selected = tasks.find(({ id }) => id === selectedId) ?? tasks[0] ?? null;

  const load = useCallback(async () => {
    const result = await request("agent.list", {}, workspaceId);
    if (workspaceRef.current !== workspaceId) return;
    if (!result.ok) { setMessage(result.error.message); return; }
    setTasks((result.data.tasks as Task[]) ?? []);
    setGrants((result.data.grants as Grant[]) ?? []);
  }, [request, workspaceId]);

  useEffect(() => { setSelectedId(""); void load(); }, [load, workspaceId]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 500);
    return () => window.clearInterval(timer);
  }, [load]);

  const start = () => {
    setMessage("Automatic task started.");
    void request("agent.start", { objective, model, maxSteps, maxTokens, maxRuntimeMs: maxRuntimeSeconds * 1000, targetPaths: targetPath ? [targetPath] : [], sources: selectedSources.map(({ baseId, documentId }) => ({ baseId, documentId })) }, workspaceId).then(async (result) => {
      if (!result.ok) setMessage(result.error.message);
      else { setSelectedId(String(result.data.id)); setMessage(`Task ${String(result.data.status).replaceAll("-", " ")}.`); }
      await load();
    });
  };

  return <section className="agent-grid">
    <article className="panel agent-card">
      <p className="card-label">OPENROUTER AUTOMATIC TASK</p>
      <label>Objective<textarea aria-label="Automatic task objective" value={objective} onChange={(event) => setObjective(event.target.value)} /></label>
      <label>Model<input aria-label="Automatic task model" value={model} onChange={(event) => setModel(event.target.value)} /></label>
      <label>Step limit<input aria-label="Automatic task step limit" type="number" min={1} max={25} value={maxSteps} onChange={(event) => setMaxSteps(Number(event.target.value))} /></label>
      <label>Token budget<input aria-label="Automatic task token budget" type="number" min={1} value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} /></label>
      <label>Runtime limit (seconds)<input aria-label="Automatic task runtime limit" type="number" min={1} max={3600} value={maxRuntimeSeconds} onChange={(event) => setMaxRuntimeSeconds(Number(event.target.value))} /></label>
      <label>Target path for scoped rules<input aria-label="Automatic task target path" value={targetPath} onChange={(event) => setTargetPath(event.target.value)} placeholder="projects/today.md" /></label>
      <div className="inline-fields"><input aria-label="Automatic task source query" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} /><button onClick={async () => { const result = await request("knowledge.search", { query: sourceQuery }, workspaceId); if (result.ok) setSourceResults((result.data.results as Array<Record<string, unknown>>).map((entry) => ({ baseId: String(entry.baseId), documentId: String(entry.id), label: `${String(entry.baseName)} / ${String(entry.path)}` }))); else setMessage(result.error.message); }}>Find context</button></div>
      <div aria-label="Automatic task context sources" className="compact-list">{sourceResults.map((source) => { const selectedSource = selectedSources.some((entry) => entry.baseId === source.baseId && entry.documentId === source.documentId); return <button key={`${source.baseId}:${source.documentId}`} className={selectedSource ? "selected-source" : ""} onClick={() => setSelectedSources((current) => selectedSource ? current.filter((entry) => entry.baseId !== source.baseId || entry.documentId !== source.documentId) : [...current, source])}>{selectedSource ? "✓ " : "+ "}{source.label}</button>; })}</div>
      <button className="primary" onClick={start}>Run automatic task</button>
      <button className="danger-button" onClick={async () => { const result = await request("agent.stopAll", {}, workspaceId); setMessage(result.ok ? `Stopped ${(result.data.stopped as string[]).length} active task(s).` : result.error.message); await load(); }}>Stop all automatic tasks</button>
      <small>Automatic mode requires a configured OpenRouter credential. Manual Claude/Codex handoffs remain separate.</small>
    </article>
    <article className="panel agent-card">
      <p className="card-label">STANDING GRANTS</p>
      <div className="compact-list" aria-label="Agent grants">{grants.length ? grants.map((grant) => <div key={grant.id}><span><strong>{grant.tool}</strong><small>{grant.pathPrefix}{grant.expiresAt ? ` · expires ${grant.expiresAt}` : ""}</small></span><button onClick={async () => { await request("agent.revokeGrant", { grantId: grant.id }, workspaceId); await load(); }}>Revoke</button></div>) : <small>No active grants.</small>}</div>
    </article>
    <article className="panel agent-card agent-history">
      <p className="card-label">TASK HISTORY</p>
      <div className="agent-history-layout"><div className="compact-list" aria-label="Automatic tasks">{tasks.map((task) => <button className="list-choice" key={task.id} onClick={() => setSelectedId(task.id)}><strong>{task.status} · {task.objective}</strong><small>{task.id} · {task.model} · step {task.step}/{task.maxSteps} · {task.usage.totalTokens} tokens · {(task.runtimeMs / 1000).toFixed(1)}s/{task.maxRuntimeMs / 1000}s</small></button>)}</div>{selected && <div className="agent-inspector"><div className="button-row">{!["completed", "failed", "cancelled", "interrupted"].includes(selected.status) && <button onClick={async () => { await request("agent.cancel", { taskId: selected.id }, workspaceId); await load(); }}>Stop task</button>}{selected.status === "awaiting-approval" && <button className="primary" onClick={async () => { await request("agent.approve", { taskId: selected.id }, workspaceId); await load(); }}>Approve exact action</button>}{selected.status === "interrupted" && !selected.pendingTool && <button onClick={async () => { const result = await request("agent.resume", { taskId: selected.id }, workspaceId); setMessage(result.ok ? "Task resumed." : result.error.message); await load(); }}>Resume safely</button>}</div>{selected.pendingTool && <pre aria-label="Pending tool action">{selected.pendingTool.name}\n{selected.pendingTool.argumentsText}</pre>}<pre aria-label="Automatic task output">{selected.output || selected.error || "Waiting for provider output…"}</pre><ol aria-label="Task event journal">{selected.events.slice(-30).map((event) => <li key={event.sequence}><strong>{event.type}</strong> <small>{JSON.stringify(event.data)}</small></li>)}</ol></div>}</div>
    </article>
    {message && <p className="save-message" role="status">{message}</p>}
  </section>;
}
