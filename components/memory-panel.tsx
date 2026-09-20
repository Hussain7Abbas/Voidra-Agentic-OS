"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestService } from "./service-types";

type Memory = { id: string; text: string; source: string; confirmed: boolean; expiresAt: string | null; updatedAt: string };

export function MemoryPanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [text, setText] = useState("");
  const [source, setSource] = useState("user");
  const [confirmed, setConfirmed] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const result = await request("memory.list", {}, workspaceId);
    if (result.ok) setMemories((result.data.memories as Memory[]) ?? []);
    else setMessage(result.error.message);
  }, [request, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const result = await request("memory.create", { text, source, confirmed }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    setText("");
    setMessage("Memory saved to this workspace.");
    await load();
  };

  return (
    <div className="memory-panel">
      <article className="panel settings-card">
        <p className="card-label">NEW MEMORY</p>
        <label>Memory<textarea aria-label="Memory text" value={text} onChange={(event) => setText(event.target.value)} /></label>
        <label>Provenance<input aria-label="Memory source" value={source} onChange={(event) => setSource(event.target.value)} /></label>
        <label className="check-label"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> User-confirmed memory</label>
        <button onClick={create} disabled={!text.trim()}>Add memory</button>
      </article>
      <section className="memory-list" aria-label="Workspace memories">
        {memories.map((memory) => <article key={memory.id}>
          <textarea aria-label={`Memory ${memory.id}`} defaultValue={memory.text} onBlur={async (event) => { if (event.target.value === memory.text) return; await request("memory.update", { memoryId: memory.id, text: event.target.value, source: memory.source, confirmed: memory.confirmed, expiresAt: memory.expiresAt }, workspaceId); await load(); }} />
          <small>{memory.confirmed ? "Confirmed" : "Inferred"} · {memory.source} · {new Date(memory.updatedAt).toLocaleString()}</small>
          <button onClick={async () => { await request("memory.delete", { memoryId: memory.id }, workspaceId); await load(); }}>Delete</button>
        </article>)}
        {!memories.length && <p>No active memories in this workspace.</p>}
      </section>
      {message && <p className="save-message" role="status">{message}</p>}
    </div>
  );
}
