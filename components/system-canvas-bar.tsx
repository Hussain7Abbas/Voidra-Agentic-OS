"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type SectionId } from "@/src/shared/navigation";
import type { RequestService } from "@/components/service-types";

type Workspace = { id: string; name: string; available: boolean };

const destinations: Array<{ id: SectionId; label: string; symbol: string; detail: string }> = [
  { id: "today", label: "Today", symbol: "◫", detail: "Command center" },
  { id: "assistant", label: "Assistant", symbol: "✦", detail: "Runs and voice" },
  { id: "notes", label: "Notes", symbol: "◇", detail: "Markdown workspace" },
  { id: "graph", label: "Graph", symbol: "◎", detail: "Second brain" },
  { id: "browser", label: "Browser", symbol: "◉", detail: "Sessions and artifacts" },
  { id: "mac", label: "Mac", symbol: "⌁", detail: "Device capabilities" },
  { id: "jobs", label: "Jobs", symbol: "↻", detail: "Skills and routines" },
  { id: "remote", label: "Remote", symbol: "⇄", detail: "Awake-Mac gateway" },
  { id: "settings", label: "Settings", symbol: "⚙", detail: "Scope and connections" },
];

function routeFor(section: SectionId) {
  return section === "today" ? "/" : `/${section}/`;
}

export function SystemCanvasBar({
  section,
  workspaces,
  selectedWorkspaceId,
  serviceStatus,
  recovered,
  latency,
  onSwitchWorkspace,
  onAddWorkspace,
  onStopAll,
  request,
}: {
  section: SectionId;
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  serviceStatus: string;
  recovered: boolean;
  latency: number | null;
  onSwitchWorkspace: (workspaceId: string) => void;
  onAddWorkspace: () => void;
  onStopAll: () => void;
  request: RequestService;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const searchSequence = useRef(0);
  const [entities, setEntities] = useState<Array<{ id: string; type: string; title: string; detail: string; scope: string; source: string; href: string }>>([]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? destinations.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(normalized)) : destinations;
  }, [query]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  useEffect(() => {
    if (open) window.requestAnimationFrame(() => searchRef.current?.focus());
    else { setQuery(""); setEntities([]); }
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2 || !selectedWorkspaceId) { setEntities([]); return; }
    const sequence = ++searchSequence.current; const timer = window.setTimeout(async () => { const result = await request("search.global", { query, limit: 30 }, selectedWorkspaceId); if (sequence !== searchSequence.current) return; setEntities(result.ok ? (result.data.results as typeof entities) ?? [] : []); }, 140);
    return () => window.clearTimeout(timer);
  }, [open, query, request, selectedWorkspaceId]);

  return (
    <>
      <div className={`v2-status-rule ${serviceStatus}`} aria-hidden="true" />
      <header className="v2-commandbar">
        <a className="v2-wordmark" href="/" aria-label="Voidra home">
          <span className="v2-wordmark-mark" aria-hidden="true">V</span>
          <span><strong>VOIDRA</strong><small>AGENTIC OS</small></span>
        </a>

        <nav className="v2-destination-strip" aria-label="Primary navigation">
          {destinations.map((item) => (
            <a key={item.id} href={routeFor(item.id)} aria-label={item.label} aria-current={item.id === section ? "page" : undefined} title={item.detail}>
              <span aria-hidden="true">{item.symbol}</span>
              <small>{item.label}</small>
            </a>
          ))}
        </nav>

        <div className="v2-command-actions">
          <label className="v2-workspace-select">
            <i aria-hidden="true" />
            <span><small>Workspace</small><select aria-label="Current workspace" value={selectedWorkspaceId ?? ""} onChange={(event) => onSwitchWorkspace(event.target.value)} disabled={!workspaces.length}>
              {!workspaces.length && <option value="">Not configured</option>}
              {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}{workspace.available ? "" : " — unavailable"}</option>)}
            </select></span>
          </label>
          <button className="v2-square-action" aria-label="Add workspace" onClick={onAddWorkspace}>+</button>
          <button className="v2-command-trigger" aria-label="Open command palette" onClick={() => setOpen(true)}><span>⌘</span> K</button>
          <div className="v2-runtime-state" aria-label={`Local runtime ${recovered ? "recovered" : serviceStatus}`}><i className={serviceStatus} /><span><strong data-testid="service-status">{recovered ? "Recovered" : serviceStatus}</strong><small>{latency === null ? "local" : `${latency} ms`}</small></span></div>
          <button className="v2-stop-action" onClick={onStopAll}>Stop all</button>
        </div>
      </header>

      {open && (
        <div className="v2-palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="v2-palette" role="dialog" aria-modal="true" aria-labelledby="v2-palette-title">
            <header><span id="v2-palette-title">Command the workspace</span><kbd>esc</kbd></header>
            <label><span aria-hidden="true">⌕</span><input ref={searchRef} aria-label="Search destinations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search destinations and actions" /></label>
            <div className="v2-palette-results">
              {visible.map((item) => <a key={item.id} href={routeFor(item.id)}><i aria-hidden="true">{item.symbol}</i><span><strong>{item.label}</strong><small>{item.detail}</small></span><b aria-hidden="true">↗</b></a>)}
              {entities.map((item) => <a key={item.id} href={item.href}><i aria-hidden="true">◇</i><span><strong>{item.title}</strong><small>{item.type} · {item.scope} · {item.detail}</small></span><b aria-label={`Source ${item.source}`}>↗</b></a>)}
              {!visible.length && !entities.length && <p>No matching destination or authorized workspace entity.</p>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
