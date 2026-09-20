"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestService } from "@/components/service-types";

type Tool = { id: string; name: string; argumentsText: string; state: string };
type Task = { id: string; objective: string; model: string; status: string; step: number; maxSteps: number; output: string; error: string | null; pendingTool: Tool | null; usage: { promptTokens: number; completionTokens: number; totalTokens: number }; events: Array<{ sequence: number; type: string; at: string; data: Record<string, unknown> }> };
type Grant = { id: string; tool: string; pathPrefix: string; expiresAt: string | null };

export function AgentPanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [objective, setObjective] = useState("Draft a concise workspace update.");
  const [model, setModel] = useState("openai/gpt-5.4");
  const [maxSteps, setMaxSteps] = useState(8);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const selected = tasks.find(({ id }) => id === selectedId) ?? tasks[0] ?? null;

  const load = useCallback(async () => {
    const result = await request("agent.list", {}, workspaceId);
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
    void request("agent.start", { objective, model, maxSteps }, workspaceId).then(async (result) => {
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
      <button className="primary" onClick={start}>Run automatic task</button>
      <small>Automatic mode requires a configured OpenRouter credential. Manual Claude/Codex handoffs remain separate.</small>
    </article>
    <article className="panel agent-card">
      <p className="card-label">STANDING GRANTS</p>
      <div className="compact-list" aria-label="Agent grants">{grants.length ? grants.map((grant) => <div key={grant.id}><span><strong>{grant.tool}</strong><small>{grant.pathPrefix}{grant.expiresAt ? ` · expires ${grant.expiresAt}` : ""}</small></span><button onClick={async () => { await request("agent.revokeGrant", { grantId: grant.id }, workspaceId); await load(); }}>Revoke</button></div>) : <small>No active grants.</small>}</div>
    </article>
    <article className="panel agent-card agent-history">
      <p className="card-label">TASK HISTORY</p>
      <div className="agent-history-layout"><div className="compact-list" aria-label="Automatic tasks">{tasks.map((task) => <button className="list-choice" key={task.id} onClick={() => setSelectedId(task.id)}><strong>{task.status} · {task.objective}</strong><small>{task.model} · step {task.step}/{task.maxSteps} · {task.usage.totalTokens} tokens</small></button>)}</div>{selected && <div className="agent-inspector"><div className="button-row">{!["completed", "failed", "cancelled"].includes(selected.status) && <button onClick={async () => { await request("agent.cancel", { taskId: selected.id }, workspaceId); await load(); }}>Stop task</button>}{selected.status === "awaiting-approval" && <button className="primary" onClick={async () => { await request("agent.approve", { taskId: selected.id }, workspaceId); await load(); }}>Approve exact action</button>}</div>{selected.pendingTool && <pre aria-label="Pending tool action">{selected.pendingTool.name}\n{selected.pendingTool.argumentsText}</pre>}<pre aria-label="Automatic task output">{selected.output || selected.error || "Waiting for provider output…"}</pre><ol aria-label="Task event journal">{selected.events.slice(-30).map((event) => <li key={event.sequence}><strong>{event.type}</strong> <small>{JSON.stringify(event.data)}</small></li>)}</ol></div>}</div>
    </article>
    {message && <p className="save-message" role="status">{message}</p>}
  </section>;
}
