"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RequestService } from "./service-types";

type Attachment = { baseId: string; name: string; canonicalPath: string; access: "read" | "write"; available: boolean };
type SearchResult = { id: string; baseId: string; baseName: string; path: string; title: string; access: "read" | "write"; snippet: string };
type GraphNode = { id: string; documentId: string; baseId: string; baseName: string; path: string; title: string; tags: string[]; access: "read" | "write"; highlighted: boolean };
type GraphEdge = { id: string; source: string; target: string };
type OpenKnowledge = SearchResult & { content: string; revision: string };

export function KnowledgePanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [filterOnly, setFilterOnly] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [current, setCurrent] = useState<OpenKnowledge | null>(null);
  const [content, setContent] = useState("");
  const [newBaseId, setNewBaseId] = useState("");
  const [newPath, setNewPath] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [attachmentResult, graphResult] = await Promise.all([
      request("knowledge.listAttachments", {}, workspaceId),
      request("knowledge.graph", { ...(tag ? { tag } : {}), filterOnly }, workspaceId),
    ]);
    if (attachmentResult.ok) {
      const next = (attachmentResult.data.attachments as Attachment[]) ?? [];
      setAttachments(next);
      setNewBaseId((prior) => prior || next.find(({ access, available }) => access === "write" && available)?.baseId || "");
    }
    if (graphResult.ok) {
      setNodes((graphResult.data.nodes as GraphNode[]) ?? []);
      setEdges((graphResult.data.edges as GraphEdge[]) ?? []);
    }
  }, [filterOnly, request, tag, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const search = async () => {
    const result = await request("knowledge.search", { query, ...(tag ? { tag } : {}) }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    setResults((result.data.results as SearchResult[]) ?? []);
  };

  const open = async (baseId: string, documentId: string) => {
    const result = await request("knowledge.read", { baseId, documentId }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    const document = result.data as unknown as OpenKnowledge;
    setCurrent(document);
    setContent(document.content);
  };

  const create = async () => {
    if (!newBaseId || !newPath.trim()) return;
    const path = newPath.toLocaleLowerCase().endsWith(".md") ? newPath : `${newPath}.md`;
    const result = await request("knowledge.create", { baseId: newBaseId, path, content: `# ${path.split("/").at(-1)!.replace(/\.md$/i, "")}\n\n` }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    setNewPath("");
    await load();
    await open(newBaseId, String(result.data.id));
  };

  const save = async () => {
    if (!current || current.baseId === "private" || current.access !== "write") return;
    const result = await request("knowledge.save", { baseId: current.baseId, documentId: current.id, content, expectedRevision: current.revision }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    if (result.data.status === "conflict") { setMessage("The shared note changed on disk. Neither version was overwritten; reopen it to review the disk version."); return; }
    const document = { ...(result.data.document as unknown as OpenKnowledge), baseName: current.baseName, access: current.access };
    setCurrent(document);
    setContent(document.content);
    setMessage("Shared note saved.");
    await load();
  };

  const positions = useMemo(() => new Map(nodes.slice(0, 120).map((node, index, visible) => {
    const angle = (index / Math.max(visible.length, 1)) * Math.PI * 2;
    const ring = 110 + (index % 3) * 42;
    return [node.id, { x: 260 + Math.cos(angle) * ring, y: 190 + Math.sin(angle) * ring }];
  })), [nodes]);

  return (
    <div className="knowledge-layout">
      <section className="graph-card">
        <div className="knowledge-controls">
          <input aria-label="Search accessible knowledge" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all accessible bases" />
          <input aria-label="Graph tag" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="#tag" />
          <button onClick={search}>Search</button>
          <label><input type="checkbox" checked={filterOnly} onChange={(event) => setFilterOnly(event.target.checked)} /> Filter graph to tag</label>
        </div>
        <div className="source-legend"><span>Private workspace</span>{attachments.map((attachment) => <span key={attachment.baseId}>{attachment.name} · {attachment.access}{attachment.available ? "" : " · unavailable"}</span>)}</div>
        <svg className="knowledge-graph" viewBox="0 0 520 380" role="img" aria-label={`Knowledge graph with ${nodes.length} notes and ${edges.length} links`}>
          {edges.slice(0, 500).map((edge) => { const source = positions.get(edge.source); const target = positions.get(edge.target); return source && target ? <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} /> : null; })}
          {nodes.slice(0, 120).map((node) => { const point = positions.get(node.id)!; return <g key={node.id} role="button" tabIndex={0} aria-label={`${node.title}, ${node.baseName}`} onClick={() => void open(node.baseId, node.documentId)} onKeyDown={(event) => { if (event.key === "Enter") void open(node.baseId, node.documentId); }}><circle cx={point.x} cy={point.y} r={node.highlighted ? 9 : 6} className={node.highlighted ? "highlighted" : node.baseId === "private" ? "private" : "shared"} /><title>{node.title} · {node.baseName}</title></g>; })}
        </svg>
        <div className="graph-list" aria-label="Accessible graph notes">
          {nodes.slice(0, 250).map((node) => <button key={node.id} className={node.highlighted ? "highlighted" : ""} onClick={() => void open(node.baseId, node.documentId)}><strong>{node.title}</strong><span>{node.baseName} · {node.path}</span></button>)}
        </div>
      </section>

      <aside className="knowledge-side">
        <div className="shared-create">
          <select aria-label="Writable shared base" value={newBaseId} onChange={(event) => setNewBaseId(event.target.value)}><option value="">Choose writable base</option>{attachments.filter(({ access, available }) => access === "write" && available).map((attachment) => <option key={attachment.baseId} value={attachment.baseId}>{attachment.name}</option>)}</select>
          <input aria-label="New shared note path" value={newPath} onChange={(event) => setNewPath(event.target.value)} placeholder="Shared note.md" />
          <button onClick={create} disabled={!newBaseId || !newPath.trim()}>Create shared note</button>
        </div>
        {results.length > 0 && <div className="knowledge-results" aria-label="Knowledge search results">{results.map((result) => <button key={`${result.baseId}:${result.id}`} onClick={() => void open(result.baseId, result.id)}><strong>{result.title}</strong><span>{result.baseName} · {result.path}</span><small>{result.snippet}</small></button>)}</div>}
        {current ? <div className="shared-editor">
          <header><strong>{current.title}</strong><span>{current.baseName} · {current.path} · {current.access}</span></header>
          <textarea aria-label="Knowledge note content" value={content} onChange={(event) => setContent(event.target.value)} readOnly={current.baseId === "private" || current.access !== "write"} />
          <button onClick={save} disabled={current.baseId === "private" || current.access !== "write" || content === current.content}>Save shared note</button>
        </div> : <p className="empty-knowledge">Select a graph node or search result.</p>}
        {message && <p role="status" className="save-message">{message}</p>}
      </aside>
    </div>
  );
}
