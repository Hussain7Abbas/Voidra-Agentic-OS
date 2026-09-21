"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ArtifactState } from "@/src/shared/browser-contracts";
import type { RequestService } from "@/components/service-types";
import { KnowledgeGlobe } from "@/components/knowledge-globe";

type Workspace = { id: string; name: string; canonicalPath: string };
type Skill = { id: string; name: string; description: string; version: number };
type Routine = { id: string; name: string; skillId: string; client: "claude" | "codex"; preferredModel: string };
type HandoffRun = { id: string; status: string; client: string; objective: string; updatedAt: string };
type Schedule = { id: string; name: string; mode: "manual" | "automatic"; routineId: string | null; localTime: string; timezone: string; enabled: boolean; nextOccurrence: string | null };
type LocalTask = { id: string; title: string; completed: boolean; dueDate: string | null; optional: boolean };
type AgentTask = { id: string; objective: string; status: string; model: string; updatedAt?: string; output: string };
type GraphNode = { id: string; title: string; baseName: string; path: string; highlighted: boolean };
type GraphEdge = { id: string; source: string; target: string };
type Application = { id: string; name: string; kind: string; scope: string; status: string; diagnostic: string | null };
type WidgetSnapshot = { widgetId: string; freshness: string; summary: Record<string, unknown>; diagnostics: Array<{ code: string; message: string }> };
type GraphTotals = { nodes: number; markdownNodes: number; otherEntities: number; edges: number };
type DashboardArtifact = Pick<ArtifactState, "id" | "name" | "files" | "kind" | "reviewState" | "sourceNoteIds"> & { href?: string };
type CatalogOutput = { id: string; runId: string | null; routineId: string | null; title: string; path: string; kind: string; previewState: string; updatedAt: string };
type TimelineRun = { id: string; mode: "manual" | "openrouter" | "headless"; status: string; updatedAt: string; provenance: { routineId?: string | null } | null };
type LayoutItem = { id: "applications" | "calendar" | "pulse" | "attention" | "skills" | "routines"; zone: "left" | "right"; order: number; size: "compact" | "standard" | "expanded"; visible: boolean };
type DashboardLayout = { revision: string; preset: string; items: LayoutItem[] };

const terminalStates = new Set(["completed", "failed", "cancelled", "interrupted"]);
function shortModel(model: string) {
  if (!model || model === "use current client model") return "CURRENT";
  return model.split("/").at(-1)?.replaceAll("-", " ").toUpperCase() ?? model.toUpperCase();
}

function relativeTime(value: string | null, now: Date) {
  if (!value) return "Not scheduled";
  const delta = new Date(value).getTime() - now.getTime();
  if (!Number.isFinite(delta)) return "Schedule unavailable";
  if (delta <= 0) return "Due now";
  const minutes = Math.max(1, Math.round(delta / 60_000));
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

function statusLabel(value: string) {
  return value.replaceAll("-", " ");
}

export function CommandCenter({
  workspace,
  workspaces,
  request,
  serviceStatus,
  latency,
  recovered,
  diagnosticsAvailable,
  isolationMessage,
  onPing,
  onSwitchWorkspace,
  onAddWorkspace,
  onIsolationProbe,
  onSimulateCrash,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  request: RequestService;
  serviceStatus: string;
  latency: number | null;
  recovered: boolean;
  diagnosticsAvailable: boolean;
  isolationMessage: string;
  onPing: () => void;
  onSwitchWorkspace: (workspaceId: string) => void;
  onAddWorkspace: () => void;
  onIsolationProbe: () => void;
  onSimulateCrash: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [skills, setSkills] = useState<Skill[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffRun[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [localTasks, setLocalTasks] = useState<LocalTask[]>([]);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [graphTotals, setGraphTotals] = useState<GraphTotals | null>(null);
  const [graphRevision, setGraphRevision] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<DashboardArtifact[]>([]);
  const [outputs, setOutputs] = useState<CatalogOutput[]>([]);
  const [timeline, setTimeline] = useState<TimelineRun[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [widgets, setWidgets] = useState<WidgetSnapshot[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [editingLayout, setEditingLayout] = useState(false);
  const workspaceRef = useRef(workspace.id);
  workspaceRef.current = workspace.id;

  const load = useCallback(async () => {
    const workspaceId = workspace.id;
    const [skillResult, routineResult, handoffResult, plannerResult, agentResult, graphResult, applicationResult, widgetResult, outputResult, layoutResult, timelineResult] = await Promise.all([
      request("skill.list", {}, workspaceId),
      request("routine.list", {}, workspaceId),
      request("handoff.list", {}, workspaceId),
      request("planner.list", {}, workspaceId),
      request("agent.list", {}, workspaceId),
      request("knowledge.graph", { filterOnly: false, limit: 250, offset: 0 }, workspaceId),
      request("application.list", {}, workspaceId),
      request("widget.list", {}, workspaceId),
      request("output.search", { query: "", kind: null, provider: null, tags: [], limit: 100 }, workspaceId),
      request("layout.get", {}, workspaceId),
      request("run.timeline", { limit: 200 }, workspaceId),
    ]);
    if (workspaceRef.current !== workspaceId) return;
    if (skillResult.ok) setSkills((skillResult.data.skills as Skill[]) ?? []);
    if (routineResult.ok) setRoutines((routineResult.data.routines as Routine[]) ?? []);
    if (handoffResult.ok) setHandoffs((handoffResult.data.runs as HandoffRun[]) ?? []);
    if (plannerResult.ok) {
      setSchedules((plannerResult.data.schedules as Schedule[]) ?? []);
      setLocalTasks((plannerResult.data.tasks as LocalTask[]) ?? []);
    }
    if (agentResult.ok) setAgentTasks((agentResult.data.tasks as AgentTask[]) ?? []);
    if (graphResult.ok) {
      setNodes((graphResult.data.nodes as GraphNode[]) ?? []);
      setEdges((graphResult.data.edges as GraphEdge[]) ?? []);
      setGraphTotals((graphResult.data.totals as GraphTotals) ?? null);
      setGraphRevision(String(graphResult.data.graphRevision ?? "") || null);
    }
    if (applicationResult.ok) setApplications((applicationResult.data.applications as Application[]) ?? []);
    if (widgetResult.ok) setWidgets((widgetResult.data.widgets as WidgetSnapshot[]) ?? []);
    if (layoutResult.ok) setLayout(layoutResult.data as DashboardLayout);
    const outputRecords = outputResult.ok ? ((outputResult.data.outputs as CatalogOutput[]) ?? []) : [];
    setOutputs(outputRecords);
    if (timelineResult.ok) setTimeline((timelineResult.data.runs as TimelineRun[]) ?? []);
    const safeOutputs: DashboardArtifact[] = outputRecords.filter(({ previewState }) => previewState === "safe").map((output) => ({ id: `output:${output.id}`, name: output.title, files: [output.path], kind: "component", reviewState: "approved", sourceNoteIds: [], href: `/jobs/?entity=output:${output.id}` }));
    try {
      const artifactState = await window.voidra?.artifacts.list(workspaceId, workspace.canonicalPath);
      if (workspaceRef.current === workspaceId) setArtifacts([...(artifactState ?? []).map((artifact) => ({ ...artifact, href: "/browser/" })), ...safeOutputs]);
    } catch {
      if (workspaceRef.current === workspaceId) setArtifacts(safeOutputs);
    }
  }, [request, workspace.canonicalPath, workspace.id]);

  useEffect(() => {
    setSkills([]); setRoutines([]); setHandoffs([]); setSchedules([]); setLocalTasks([]); setAgentTasks([]); setNodes([]); setEdges([]); setGraphTotals(null); setGraphRevision(null); setArtifacts([]); setOutputs([]); setTimeline([]); setApplications([]); setWidgets([]);
    void load();
    const refresh = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(refresh);
  }, [load, workspace.id]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(clock);
  }, []);

  const activeTasks = agentTasks.filter((task) => !terminalStates.has(task.status));
  const pendingHandoffs = handoffs.filter((run) => !["completed", "cancelled"].includes(run.status));
  const openLocalTasks = localTasks.filter((task) => !task.completed);
  const enabledSchedules = schedules.filter((schedule) => schedule.enabled);
  const nextSchedule = [...enabledSchedules].filter((schedule) => schedule.nextOccurrence).sort((a, b) => a.nextOccurrence!.localeCompare(b.nextOccurrence!))[0] ?? null;
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
  const date = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(now);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const calendarWidget = widgets.find((widget) => widget.widgetId === "calendar");
  const layoutItem = (id: LayoutItem["id"]) => layout?.items.find((item) => item.id === id);
  const layoutStyle = (id: LayoutItem["id"], delay: string) => ({ "--delay": delay, order: layoutItem(id)?.order ?? 0, display: layoutItem(id)?.visible === false ? "none" : undefined } as CSSProperties);
  const layoutClass = (id: LayoutItem["id"]) => `layout-${layoutItem(id)?.size ?? "standard"}`;
  const updateLayoutItem = (id: LayoutItem["id"], action: "up" | "down" | "toggle" | "resize") => setLayout((current) => {
    if (!current) return current; const items = current.items.map((item) => ({ ...item })); const item = items.find((candidate) => candidate.id === id)!;
    if (action === "toggle") item.visible = !item.visible;
    else if (action === "resize") item.size = item.size === "compact" ? "standard" : item.size === "standard" ? "expanded" : "compact";
    else { const ordered = items.filter((candidate) => candidate.zone === item.zone).sort((a, b) => a.order - b.order); const index = ordered.findIndex((candidate) => candidate.id === id); const swap = ordered[action === "up" ? index - 1 : index + 1]; if (swap) { const prior = item.order; item.order = swap.order; swap.order = prior; } }
    return { ...current, items };
  });

  const routineBySkill = useMemo(() => new Map(routines.map((routine) => [routine.skillId, routine])), [routines]);
  const activeQueue = timeline.filter((run) => !terminalStates.has(run.status));
  const latestRunFor = (routineId: string | null) => routineId ? timeline.find((run) => run.provenance?.routineId === routineId) : undefined;
  const latestOutputFor = (routineId: string | null) => routineId ? outputs.find((output) => output.routineId === routineId) : undefined;
  const visibleSkills = skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase())).slice(0, 4);
  const visibleArtifacts = artifacts.filter((artifact) => artifact.name.toLowerCase().includes(query.toLowerCase())).slice(0, 7);
  const attention = [
    ...activeTasks.map((task) => ({ id: task.id, title: task.objective, detail: `Agent · ${statusLabel(task.status)}`, href: "/assistant/", tone: "active" })),
    ...pendingHandoffs.slice(0, 3).map((run) => ({ id: run.id, title: run.objective || `${run.client} handoff`, detail: `Handoff · ${statusLabel(run.status)}`, href: "/jobs/", tone: "pending" })),
    ...openLocalTasks.slice(0, 3).map((task) => ({ id: task.id, title: task.title, detail: task.dueDate ? `Due ${task.dueDate}` : task.optional ? "Optional task" : "Local task", href: "#today-planner", tone: "task" })),
  ].slice(0, 5);

  const stopAll = async () => {
    const result = await request("agent.stopAll", {}, workspace.id);
    setMessage(result.ok ? `Stopped ${(result.data.stopped as string[]).length} active task(s).` : result.error.message);
    await load();
  };

  return (
    <section className="command-center" aria-label={`${workspace.name} command center`}>
      <div className="cc-atmosphere" aria-hidden="true"><span /><span /><span /></div>
      <header className="cc-header">
        <div className="cc-brand-block">
          <p className="cc-kicker"><span /> VOIDRA AGENTIC OS</p>
          <h1>{workspace.name}</h1>
          <p>One view across your skills, memory, routines, apps, and outputs.</p>
        </div>
        <div className="cc-header-actions">
          <label className="cc-search"><span aria-hidden="true">⌕</span><input aria-label="Search command center" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills and artifacts" /></label>
          <button className="cc-icon-button" aria-label="Refresh command center" onClick={() => void load()}>↻</button>
          <button className="cc-icon-button" aria-label="Edit dashboard layout" aria-pressed={editingLayout} onClick={() => setEditingLayout((value) => !value)}>⌗</button>
          <button className="cc-stop" disabled={!activeTasks.length} onClick={() => void stopAll()}>Stop all</button>
        </div>
      </header>

      {editingLayout && layout && <section className="cc-layout-editor" aria-label="Dashboard layout editor"><header><strong>Workspace layout</strong><small>Keyboard-accessible move, resize, hide, save, and preset reset.</small></header>{layout.items.slice().sort((a, b) => a.zone.localeCompare(b.zone) || a.order - b.order).map((item) => <div key={item.id}><span><strong>{item.id}</strong><small>{item.zone} · {item.size} · {item.visible ? "visible" : "hidden"}</small></span><button aria-label={`Move ${item.id} up`} onClick={() => updateLayoutItem(item.id, "up")}>↑</button><button aria-label={`Move ${item.id} down`} onClick={() => updateLayoutItem(item.id, "down")}>↓</button><button aria-label={`Resize ${item.id}`} onClick={() => updateLayoutItem(item.id, "resize")}>↔</button><button aria-label={`${item.visible ? "Hide" : "Show"} ${item.id}`} onClick={() => updateLayoutItem(item.id, "toggle")}>{item.visible ? "Hide" : "Show"}</button></div>)}<footer><button onClick={async () => { const result = await request("layout.update", { expectedRevision: layout.revision, items: layout.items }, workspace.id); if (result.ok) { setLayout(result.data as DashboardLayout); setMessage("Workspace dashboard layout saved."); setEditingLayout(false); } else setMessage(result.error.message); }}>Save layout</button><button onClick={async () => { const result = await request("layout.reset", {}, workspace.id); if (result.ok) { setLayout(result.data as DashboardLayout); setMessage("Command-center preset restored."); } else setMessage(result.error.message); }}>Reset preset</button></footer></section>}

      <div className="cc-grid">
        <aside className="cc-column cc-column-left">
          <article className={`cc-widget cc-micro-apps ${layoutClass("applications")}`} style={layoutStyle("applications", "40ms")}>
            <div className="cc-widget-heading"><span>Applications</span><small>{applications.filter((application) => application.status === "ready").length}/{applications.length} ready</small></div>
            <div className="cc-app-list">
              {applications.slice(0, 5).map((application) => <a key={application.id} href={application.kind === "mcp" ? "/settings/" : application.id.includes("browser") || application.id.includes("artifact") ? "/browser/" : application.id.includes("voice") ? "/assistant/" : application.id.includes("remote") ? "/remote/" : "/mac/"} aria-label={`Open ${application.name}`}><i aria-hidden="true">{application.status === "ready" ? "●" : "○"}</i><span><strong>{application.name}</strong><small>{application.kind} · {application.scope} · {application.status}</small></span><b aria-hidden="true">→</b></a>)}
            </div>
          </article>

          <article className={`cc-widget cc-clock-widget ${layoutClass("calendar")}`} style={layoutStyle("calendar", "100ms")}>
            <div className="cc-widget-heading"><span>Local calendar</span><small>{calendarWidget?.freshness ?? "loading"}</small><a href="#today-planner">Open plan</a></div>
            <div className="cc-clock-row"><div className="cc-analog" aria-hidden="true"><span className="cc-hand-hour" /><span className="cc-hand-minute" /><i /></div><div><small>{date}</small><strong>{time}</strong><em>{zone}</em></div></div>
            <div className="cc-next-event"><span>What&apos;s next</span><strong>{nextSchedule?.name ?? "No routine scheduled"}</strong><small>{relativeTime(nextSchedule?.nextOccurrence ?? null, now)}</small></div>
          </article>

          <article className={`cc-widget cc-pulse-widget ${layoutClass("pulse")}`} style={layoutStyle("pulse", "160ms")}>
            <div className="cc-widget-heading"><span>System pulse</span><small>local-first</small></div>
            <div className="cc-pulse-number"><strong>{nodes.length}</strong><span>knowledge nodes</span></div>
            <div className="cc-dot-matrix" aria-label={`${nodes.length} indexed knowledge nodes`}>{Array.from({ length: 32 }, (_, index) => <i key={index} className={index < Math.min(32, Math.max(4, Math.round(nodes.length / Math.max(1, nodes.length / 22)))) ? "lit" : ""} />)}</div>
            <div className="cc-metric-strip"><span><b>{edges.length}</b> links</span><span><b>{artifacts.length}</b> artifacts</span><span><b>{openLocalTasks.length}</b> open</span></div>
          </article>
        </aside>

        <article className="cc-brain" style={{ "--delay": "90ms" } as CSSProperties}>
          <div className="cc-brain-toolbar"><span>Second brain</span><small>{graphTotals?.nodes ?? nodes.length} nodes · {graphTotals?.edges ?? edges.length} links</small><a href="/graph/" aria-label="Explore knowledge map">Explore graph ↗</a></div>
          <KnowledgeGlobe workspaceId={workspace.id} graphRevision={graphRevision} nodes={nodes} edges={edges} artifacts={artifacts} query={query} />
        </article>

        <aside className="cc-column cc-column-right">
          <article className={`cc-widget cc-attention ${layoutClass("attention")}`} style={layoutStyle("attention", "70ms")}>
            <div className="cc-widget-heading"><span>Attention</span><strong>{attention.length}</strong></div>
            {attention.length ? <div className="cc-attention-list">{attention.map((item) => <a key={`${item.tone}:${item.id}`} href={item.href}><i className={item.tone} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.detail}</small></span><b aria-hidden="true">›</b></a>)}</div> : <div className="cc-empty"><span>✓</span><strong>All clear</strong><small>No run or task needs attention.</small></div>}
            <div className="cc-connector-note"><span>Mail connector</span><a href="/settings/" aria-label="Configure mail connector">Connect in Settings</a></div>
          </article>

          <article className={`cc-widget cc-skills ${layoutClass("skills")}`} style={layoutStyle("skills", "130ms")}>
            <div className="cc-widget-heading"><span>Skills deck</span><a href="/jobs/">Manage</a></div>
            {visibleSkills.length ? <div className="cc-skill-grid">{visibleSkills.map((skill) => { const routine = routineBySkill.get(skill.id); return <article key={skill.id}><div><i aria-hidden="true">⚡</i><span><strong>/{skill.name.toLowerCase().replaceAll(" ", "-")}</strong><small>v{skill.version} · {routine?.client ?? "unassigned"}</small></span></div><p>{skill.description}</p><footer><span>{shortModel(routine?.preferredModel ?? "")}</span><a href={`/jobs/?entity=skill:${skill.id}`} aria-label={`Review and run ${skill.name}`}>▷</a></footer></article>; })}</div> : <div className="cc-empty"><span>⚡</span><strong>No matching skills</strong><small>Create or pin a skill in Jobs.</small><a href="/jobs/">Open skill library</a></div>}
          </article>

          <article className={`cc-widget cc-routines ${layoutClass("routines")}`} style={layoutStyle("routines", "190ms")}>
            <div className="cc-widget-heading"><span>Routines</span><small>{enabledSchedules.length}/{schedules.length} active</small></div>
            <div className="cc-routine-list">{enabledSchedules.slice(0, 5).map((schedule) => { const run = latestRunFor(schedule.routineId); const output = latestOutputFor(schedule.routineId); const queueIndex = run ? activeQueue.findIndex(({ id }) => id === run.id) : -1; return <a key={schedule.id} href={schedule.routineId ? `/jobs/?entity=routine:${schedule.routineId}` : "/jobs/"}><time>{schedule.localTime}</time><span><strong>{schedule.name}</strong><small>{run ? `${run.mode} · ${run.status}` : schedule.mode} · {relativeTime(schedule.nextOccurrence, now)}{queueIndex >= 0 ? ` · queue ${queueIndex + 1}/${activeQueue.length}` : ""}{output ? ` · ${output.title}` : ""}</small></span><i className={run?.mode ?? schedule.mode} aria-hidden="true" /></a>; })}</div>
            {!enabledSchedules.length && <div className="cc-empty compact"><strong>No active routines</strong><a href="/jobs/">Create schedule</a></div>}
          </article>
        </aside>
      </div>

      <footer className="cc-artifact-bar">
        <div className="cc-artifact-title"><span>Artifact ring</span><small>{artifacts.filter((artifact) => artifact.reviewState === "approved").length} approved components</small></div>
        <div className="cc-artifacts">{visibleArtifacts.map((artifact, index) => <a href={artifact.href ?? "/browser/"} key={artifact.id} style={{ "--artifact-index": index } as CSSProperties}><i aria-hidden="true">◇</i><span><strong>{artifact.name}</strong><small>{artifact.id.startsWith("output:") ? "safe run output" : artifact.kind === "component" ? artifact.reviewState : "legacy HTML"} · {artifact.files.length} file{artifact.files.length === 1 ? "" : "s"}</small></span></a>)}{!visibleArtifacts.length && <a href="/browser/" className="cc-add-artifact"><i aria-hidden="true">+</i><span><strong>Create an artifact</strong><small>Generate reviewed component</small></span></a>}</div>
        <a className="cc-artifact-open" href="/browser/">Open library →</a>
      </footer>

      <div className="cc-runtime-strip" aria-live="polite">
        <span className={`status-light ${serviceStatus}`} /><strong>Local runtime</strong><small data-testid="command-service-status">{recovered ? "Recovered" : serviceStatus}</small>{latency !== null && <small>{latency} ms</small>}<span className="cc-runtime-divider" /><strong>Workspace</strong><small data-testid="workspace-id">{workspace.id}</small><span className="cc-runtime-divider" /><strong>Isolation</strong><small data-testid="isolation-result">{isolationMessage}</small><button onClick={onPing}>Check runtime</button>{diagnosticsAvailable && <button onClick={onIsolationProbe}>Test isolation</button>}{diagnosticsAvailable && <button onClick={onSimulateCrash}>Simulate crash</button>}
      </div>
      {message && <button className="cc-toast" role="status" onClick={() => setMessage("")}>{message}</button>}
    </section>
  );
}
