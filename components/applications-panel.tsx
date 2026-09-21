"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestService } from "@/components/service-types";

type MicroApp = { id: string; title: string; icon: string; surfaces: string[]; dataNeeds: string[]; storage: string; network: string; actions: Array<{ id: string; label: string; risk: string }>; artifactId: string | null; state: string };

export function ApplicationsPanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [apps, setApps] = useState<MicroApp[]>([]); const [query, setQuery] = useState(""); const [recommendations, setRecommendations] = useState<Array<Record<string, unknown>>>([]); const [title, setTitle] = useState("Project pulse"); const [dataNeeds, setDataNeeds] = useState("workspace summary"); const [artifactId, setArtifactId] = useState(""); const [message, setMessage] = useState("");
  const load = useCallback(async () => { const result = await request("microapp.list", {}, workspaceId); if (result.ok) setApps((result.data.apps as MicroApp[]) ?? []); else setMessage(result.error.message); }, [request, workspaceId]);
  useEffect(() => { void load(); }, [load]);
  return <article className="panel settings-card" aria-label="Applications and micro apps">
    <p className="card-label">APPLICATIONS & MICRO APPS</p><small>Declarations are inert. Executable UI must be an approved component artifact, and connector installation remains a separate review.</small>
    <label>Connector need<input aria-label="Connector recommendation query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="calendar, email, creator…" /></label><button onClick={async () => { const result = await request("application.recommend", { query }, workspaceId); if (result.ok) setRecommendations((result.data.recommendations as Array<Record<string, unknown>>) ?? []); else setMessage(result.error.message); }}>Recommend reviewed route</button>
    <div className="compact-list" aria-label="Connector recommendations">{recommendations.map((item) => <div key={String(item.id)}><span><strong>{String(item.name)}</strong><small>{String(item.provenance)} · {String(item.installation)}</small></span></div>)}</div>
    <label>Micro-app title<input aria-label="Micro app title" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Declared data needs<input aria-label="Micro app data needs" value={dataNeeds} onChange={(event) => setDataNeeds(event.target.value)} /></label><button onClick={async () => { const result = await request("microapp.register", { title, icon: "◇", surfaces: ["dashboard", "detail"], dataNeeds: dataNeeds.split(",").map((item) => item.trim()).filter(Boolean), storage: "workspace-namespaced", actions: [{ id: "refresh", label: "Refresh snapshot", risk: "read" }] }, workspaceId); setMessage(result.ok ? "Inert micro-app declaration registered." : result.error.message); if (result.ok) await load(); }}>Register declaration</button>
    <label>Approved artifact ID<input aria-label="Micro app artifact ID" value={artifactId} onChange={(event) => setArtifactId(event.target.value)} placeholder="Component artifact UUID" /></label>
    <div className="compact-list" aria-label="Micro app declarations">{apps.map((app) => <div key={app.id}><span><strong>{app.icon} {app.title}</strong><small>{app.state} · {app.network} · {app.storage}</small><small>{app.dataNeeds.join(", ") || "No data requested"}</small></span><button disabled={!artifactId || app.state === "reviewed-component"} onClick={async () => { const result = await request("microapp.promote", { appId: app.id, artifactId }, workspaceId); setMessage(result.ok ? "Micro app linked to the current approved component decision." : result.error.message); if (result.ok) await load(); }}>Link approved component</button></div>)}</div>
    {message && <p className="save-message" role="status">{message}</p>}
  </article>;
}
