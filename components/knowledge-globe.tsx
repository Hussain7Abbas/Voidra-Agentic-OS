"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type KnowledgeNode = { id: string; title: string; baseName: string; path: string; highlighted: boolean };
type KnowledgeEdge = { id: string; source: string; target: string; status?: string; type?: string; reason?: string; sourceRecord?: string; revision?: string | null; scope?: string; inferred?: boolean };
type OrbitArtifact = { id: string; name: string; files: string[]; reviewState?: string; sourceNoteIds?: string[]; href?: string };

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function pointFor(node: KnowledgeNode, index: number, total: number, isRoot: boolean, rotation: number, zoom: number) {
  if (isRoot) return { x: 50, y: 50, depth: 0 };
  const seed = hash(node.id);
  const angle = ((index / Math.max(1, total)) * Math.PI * 2) + ((seed % 31) / 31) * .45 + rotation * Math.PI / 180;
  const layer = (17 + (seed % 3) * 8 + ((seed >> 5) % 7)) * zoom;
  const squash = .76 + ((seed >> 9) % 15) / 100;
  return {
    x: 50 + Math.cos(angle) * layer,
    y: 50 + Math.sin(angle) * layer * squash,
    depth: (seed % 100) / 100,
  };
}

export function KnowledgeGlobe({ workspaceId, graphRevision, nodes, edges, artifacts, query = "" }: { workspaceId: string; graphRevision?: string | null; nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; artifacts: OrbitArtifact[]; query?: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listMode, setListMode] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const normalizedQuery = query.trim().toLowerCase();
  const eligibleArtifacts = artifacts.filter((artifact) => artifact.reviewState === "approved").sort((left, right) => `${left.sourceNoteIds?.[0] ?? "~"}:${left.id}`.localeCompare(`${right.sourceNoteIds?.[0] ?? "~"}:${right.id}`));

  useEffect(() => {
    try { const stored = JSON.parse(sessionStorage.getItem(`voidra.globe.${workspaceId}`) ?? "null") as { rotation?: unknown; zoom?: unknown; selectedId?: unknown; listMode?: unknown } | null; setRotation(typeof stored?.rotation === "number" ? stored.rotation : 0); setZoom(typeof stored?.zoom === "number" ? Math.min(1.3, Math.max(.72, stored.zoom)) : 1); setSelectedId(typeof stored?.selectedId === "string" ? stored.selectedId : null); setListMode(stored?.listMode === true); } catch { setRotation(0); setZoom(1); setSelectedId(null); setListMode(false); }
  }, [workspaceId]);
  useEffect(() => { sessionStorage.setItem(`voidra.globe.${workspaceId}`, JSON.stringify({ rotation, zoom, selectedId, listMode, graphRevision: graphRevision ?? null })); }, [graphRevision, listMode, rotation, selectedId, workspaceId, zoom]);

  const graph = useMemo(() => {
    const ranked = [...nodes].sort((left, right) => {
      const leftRoot = /(^|\/)agents\.md$/i.test(left.path) ? 1 : 0;
      const rightRoot = /(^|\/)agents\.md$/i.test(right.path) ? 1 : 0;
      return rightRoot - leftRoot || Number(right.highlighted) - Number(left.highlighted) || left.title.localeCompare(right.title);
    });
    const visible = ranked.slice(0, 42);
    const root = visible[0] ?? null;
    const positioned = visible.map((node, index) => ({ ...node, ...pointFor(node, index, visible.length, node.id === root?.id, rotation, zoom) }));
    const byId = new Map(positioned.map((node) => [node.id, node]));
    return { nodes: positioned, edges: edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target)).slice(0, 90), byId, root };
  }, [edges, nodes, rotation, zoom]);

  const selected = selectedId ? graph.byId.get(selectedId) ?? null : graph.root;
  const related = selected ? graph.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];

  if (listMode) {
    return (
      <div className="kg-list" aria-label="Knowledge graph list view">
        <header><span>Markdown knowledge</span><small>{graph.nodes.length} shown / {nodes.length} indexed</small><button onClick={() => setListMode(false)}>Globe view</button></header>
        <div className="kg-list-grid">
          <ol>{graph.nodes.map((node) => <li key={node.id}><button className={node.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(node.id)}><span><strong>{node.title}</strong><small>{node.baseName} · {node.path}</small></span><b>{graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id).length}</b></button></li>)}</ol>
          <aside aria-live="polite"><p>Focused record</p><h3>{selected?.title ?? "No Markdown indexed"}</h3><small>{selected?.path ?? "Create or index Markdown to build the second brain."}</small><dl><div><dt>Scope</dt><dd>{selected?.baseName ?? "private"}</dd></div><div><dt>Relations</dt><dd>{related.length}</dd></div><div><dt>Artifacts</dt><dd>{eligibleArtifacts.length}</dd></div></dl>{related.slice(0, 12).map((edge) => <details key={edge.id}><summary>{edge.type ?? edge.status ?? "relationship"}</summary><small>{edge.reason ?? `${edge.source} links to ${edge.target}.`}<br />{edge.sourceRecord ?? "canonical graph"} · {edge.scope ?? "workspace"}</small></details>)}<a href="/graph/">Open full graph →</a></aside>
        </div>
      </div>
    );
  }

  return (
    <div className="kg-stage" aria-label="Markdown knowledge globe">
      <div className="kg-camera-controls" aria-label="Knowledge globe camera"><button aria-label="Rotate knowledge globe left" onClick={() => setRotation((value) => value - 12)}>←</button><button aria-label="Rotate knowledge globe right" onClick={() => setRotation((value) => value + 12)}>→</button><button aria-label="Zoom knowledge globe out" disabled={zoom <= .72} onClick={() => setZoom((value) => Math.max(.72, Number((value - .12).toFixed(2))))}>−</button><button aria-label="Zoom knowledge globe in" disabled={zoom >= 1.3} onClick={() => setZoom((value) => Math.min(1.3, Number((value + .12).toFixed(2))))}>+</button><button aria-label="Reset knowledge globe view" onClick={() => { setRotation(0); setZoom(1); setSelectedId(null); }}>Reset</button></div>
      <svg className="kg-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><radialGradient id="kg-fade"><stop offset="0" stopColor="#ff6a1a" stopOpacity=".52"/><stop offset="1" stopColor="#f1e8d6" stopOpacity=".08"/></radialGradient></defs>
        {graph.edges.map((edge) => {
          const source = graph.byId.get(edge.source)!;
          const target = graph.byId.get(edge.target)!;
          const active = selected ? edge.source === selected.id || edge.target === selected.id : false;
          return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={active ? "active" : ""} />;
        })}
        <circle cx="50" cy="50" r="30" className="kg-sphere-line" />
        <ellipse cx="50" cy="50" rx="38" ry="15" className="kg-sphere-line orbit" />
      </svg>

      <div className="kg-cloud" aria-hidden="true">{Array.from({ length: 72 }, (_, index) => <i key={index} style={{ "--kg-dot-x": `${25 + ((index * 37) % 51)}%`, "--kg-dot-y": `${25 + ((index * 53) % 51)}%`, "--kg-dot-delay": `${-1 * (index % 11) * .37}s` } as CSSProperties} />)}</div>

      {graph.nodes.map((node, index) => {
        const matches = !normalizedQuery || `${node.title} ${node.path} ${node.baseName}`.toLowerCase().includes(normalizedQuery);
        const relationCount = graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id).length;
        return <button key={node.id} className={`kg-node ${node.id === graph.root?.id ? "root" : ""} ${node.id === selected?.id ? "selected" : ""} ${matches ? "matches" : "dimmed"}`} style={{ "--kg-x": `${node.x}%`, "--kg-y": `${node.y}%`, "--kg-depth": node.depth, "--kg-order": index } as CSSProperties} onClick={() => setSelectedId(node.id)} aria-label={`${node.title}, ${relationCount} relationships`} title={`${node.path} · ${relationCount} relationships`}><i /><span>{node.id === graph.root?.id ? "ROOT" : node.title.slice(0, 18)}</span></button>;
      })}

      <div className="kg-artifact-orbit" aria-label="Approved artifact ring">
        {eligibleArtifacts.slice(0, 10).map((artifact, index) => { const matches = !normalizedQuery || artifact.name.toLowerCase().includes(normalizedQuery); return <a key={artifact.id} className={matches ? "" : "dimmed"} href={artifact.href ?? "/browser/"} style={{ "--kg-artifact-angle": `${index * (360 / Math.max(1, Math.min(10, eligibleArtifacts.length)))}deg` } as CSSProperties} aria-label={`Open approved artifact ${artifact.name}`}><i>◇</i><span>{artifact.name}</span></a>; })}
      </div>

      <div className="kg-inspector" aria-live="polite"><p>{selected?.id === graph.root?.id ? "Root router" : "Markdown record"}</p><strong>{selected?.title ?? "Awaiting knowledge"}</strong><small>{selected?.path ?? "Index Markdown to populate this globe."}</small><span>{related.length} explicit relationships · {eligibleArtifacts.length} approved artifacts · {Math.round(zoom * 100)}% zoom</span>{related[0]?.reason && <small>{related[0].reason}</small>}</div>
      <button className="kg-list-toggle" onClick={() => setListMode(true)}>List view</button>
    </div>
  );
}
