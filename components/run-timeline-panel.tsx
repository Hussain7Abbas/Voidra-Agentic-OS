"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RequestService } from "@/components/service-types";

type TimelineEvent = { sequence: number; type: string; at: string; data: Record<string, unknown> };
type TimelineRun = {
  id: string; mode: "manual" | "openrouter" | "headless"; provider: string; title: string; status: string; createdAt: string; updatedAt: string;
  provenance: { routineId?: string | null; trigger?: string; skillVersion?: number | null; skillBundleDigest?: string | null; contextManifestDigest?: string | null } | null;
  events: TimelineEvent[];
};

const terminal = new Set(["completed", "failed", "cancelled", "interrupted"]);

export function RunTimelinePanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [runs, setRuns] = useState<TimelineRun[]>([]);
  const [mode, setMode] = useState<"all" | TimelineRun["mode"]>("all");
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const result = await request("run.timeline", { limit: 200 }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    setRuns((result.data.runs as TimelineRun[]) ?? []);
  }, [request, workspaceId]);
  useEffect(() => { setSelectedId(""); void load(); }, [load, workspaceId]);
  useEffect(() => { const timer = window.setInterval(() => void load(), runs.some((run) => !terminal.has(run.status)) ? 800 : 4_000); return () => window.clearInterval(timer); }, [load, runs]);
  const visible = useMemo(() => runs.filter((run) => mode === "all" || run.mode === mode), [mode, runs]);
  const selected = visible.find(({ id }) => id === selectedId) ?? visible[0] ?? null;

  return <section className="panel agent-card agent-history" aria-label="Unified run timeline">
    <header><div><p className="card-label">OWNED RUN TIMELINE</p><h2>Every execution mode, one journal</h2></div><span>{runs.length} recorded</span></header>
    <div className="segmented" aria-label="Timeline execution mode">{(["all", "manual", "openrouter", "headless"] as const).map((value) => <button key={value} className={mode === value ? "selected" : ""} onClick={() => setMode(value)}>{value}</button>)}</div>
    <div className="agent-history-layout">
      <div className="compact-list" aria-label="Timeline runs">{visible.map((run) => <button className="list-choice" key={`${run.mode}:${run.id}`} onClick={() => setSelectedId(run.id)}><strong>{run.status} · {run.title}</strong><small>{run.mode} · {run.provider} · {new Date(run.updatedAt).toLocaleString()}</small></button>)}</div>
      {selected ? <div className="agent-inspector"><dl><div><dt>Owner</dt><dd>{selected.mode}</dd></div><div><dt>Provider</dt><dd>{selected.provider}</dd></div><div><dt>Trigger</dt><dd>{selected.provenance?.trigger ?? "direct"}</dd></div><div><dt>Context</dt><dd>{selected.provenance?.contextManifestDigest?.slice(0, 12) ?? "not recorded"}</dd></div><div><dt>Skill</dt><dd>{selected.provenance?.skillBundleDigest?.slice(0, 12) ?? "not pinned"}</dd></div></dl><ol aria-label="Unified event journal">{[...selected.events].sort((left, right) => left.at.localeCompare(right.at) || left.sequence - right.sequence).slice(-100).map((event, index) => <li key={`${event.sequence}:${event.type}:${index}`}><strong>{event.type}</strong> <time>{new Date(event.at).toLocaleTimeString()}</time><small>{Object.keys(event.data ?? {}).length ? JSON.stringify(event.data) : ""}</small></li>)}</ol></div> : <p className="empty-copy">No runs match this execution mode.</p>}
    </div>
    {message && <p className="save-message" role="status">{message}</p>}
  </section>;
}
