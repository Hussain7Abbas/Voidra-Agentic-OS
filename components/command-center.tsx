"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ArtifactState } from "@/src/shared/browser-contracts";
import type { RequestService } from "@/components/service-types";

type Workspace = { id: string; name: string; canonicalPath: string };
type Skill = { id: string; name: string; description: string; version: number };
type Routine = { id: string; name: string; skillId: string; client: "claude" | "codex"; preferredModel: string };
type HandoffRun = { id: string; status: string; client: string; objective: string; updatedAt: string };
type Schedule = { id: string; name: string; mode: "manual" | "automatic"; localTime: string; timezone: string; enabled: boolean; nextOccurrence: string | null };
type LocalTask = { id: string; title: string; completed: boolean; dueDate: string | null; optional: boolean };
type AgentTask = { id: string; objective: string; status: string; model: string; updatedAt?: string; output: string };
type GraphNode = { id: string; title: string; baseName: string; path: string; highlighted: boolean };
type GraphEdge = { id: string; source: string; target: string };

const terminalStates = new Set(["completed", "failed", "cancelled", "interrupted"]);
const commandNavigation = [
  { label: "Today", href: "/", glyph: "◫" },
  { label: "Assistant", href: "/assistant/", glyph: "✦" },
  { label: "Notes", href: "/notes/", glyph: "◇" },
  { label: "Graph", href: "/graph/", glyph: "⌘" },
  { label: "Browser", href: "/browser/", glyph: "◎" },
  { label: "Mac", href: "/mac/", glyph: "⌁" },
  { label: "Jobs", href: "/jobs/", glyph: "↻" },
  { label: "Remote", href: "/remote/", glyph: "⇄" },
  { label: "Settings", href: "/settings/", glyph: "⚙" },
];

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
  const [artifacts, setArtifacts] = useState<ArtifactState[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const workspaceRef = useRef(workspace.id);
  workspaceRef.current = workspace.id;

  const load = useCallback(async () => {
    const workspaceId = workspace.id;
    const [skillResult, routineResult, handoffResult, plannerResult, agentResult, graphResult] = await Promise.all([
      request("skill.list", {}, workspaceId),
      request("routine.list", {}, workspaceId),
      request("handoff.list", {}, workspaceId),
      request("planner.list", {}, workspaceId),
      request("agent.list", {}, workspaceId),
      request("knowledge.graph", { filterOnly: false }, workspaceId),
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
    }
    try {
      const artifactState = await window.voidra?.artifacts.list(workspaceId, workspace.canonicalPath);
      if (workspaceRef.current === workspaceId && artifactState) setArtifacts(artifactState);
    } catch {
      if (workspaceRef.current === workspaceId) setArtifacts([]);
    }
  }, [request, workspace.canonicalPath, workspace.id]);

  useEffect(() => {
    setSkills([]); setRoutines([]); setHandoffs([]); setSchedules([]); setLocalTasks([]); setAgentTasks([]); setNodes([]); setEdges([]); setArtifacts([]);
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

  const routineBySkill = useMemo(() => new Map(routines.map((routine) => [routine.skillId, routine])), [routines]);
  const visibleSkills = skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase())).slice(0, 4);
  const visibleArtifacts = artifacts.filter((artifact) => artifact.name.toLowerCase().includes(query.toLowerCase())).slice(0, 7);
  const attention = [
    ...activeTasks.map((task) => ({ id: task.id, title: task.objective, detail: `Agent · ${statusLabel(task.status)}`, href: "/assistant/", tone: "active" })),
    ...pendingHandoffs.slice(0, 3).map((run) => ({ id: run.id, title: run.objective || `${run.client} handoff`, detail: `Handoff · ${statusLabel(run.status)}`, href: "/jobs/", tone: "pending" })),
    ...openLocalTasks.slice(0, 3).map((task) => ({ id: task.id, title: task.title, detail: task.dueDate ? `Due ${task.dueDate}` : task.optional ? "Optional task" : "Local task", href: "#today-planner", tone: "task" })),
  ].slice(0, 5);

  const orbitItems = [
    { label: "Skills", value: skills.length, href: "/jobs/", glyph: "⚡", accessibleName: "Open skill library" },
    { label: "Memory", value: nodes.length, href: "/graph/", glyph: "◈", accessibleName: "Open knowledge map" },
    { label: "Routines", value: enabledSchedules.length, href: "/jobs/", glyph: "↻", accessibleName: "Open scheduled routines" },
    { label: "Apps", value: 4, href: "/settings/", glyph: "⌘", accessibleName: "Configure connected applications" },
    { label: "Artifacts", value: artifacts.length, href: "/browser/", glyph: "◇", accessibleName: "Open generated output library" },
    { label: "Notes", value: nodes.length, href: "/notes/", glyph: "▤", accessibleName: "Open document workspace" },
    { label: "Runs", value: agentTasks.length + handoffs.length, href: "/assistant/", glyph: "▷", accessibleName: "Inspect agent runs" },
    { label: "Browser", value: 1, href: "/browser/", glyph: "◎", accessibleName: "Open web sessions" },
  ];

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
        <div className="cc-header-center">
          <div className="cc-workspace-control">
            <span className="cc-workspace-live" aria-hidden="true" />
            <label><small>Workspace</small><select aria-label="Current workspace" value={workspace.id} onChange={(event) => onSwitchWorkspace(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <button aria-label="Add workspace" onClick={onAddWorkspace}>+</button>
          </div>
          <nav className="cc-system-nav" aria-label="Primary navigation">{commandNavigation.map((item) => <a key={item.label} href={item.href} aria-label={item.label} aria-current={item.label === "Today" ? "page" : undefined}><span aria-hidden="true">{item.glyph}</span></a>)}</nav>
        </div>
        <div className="cc-header-actions">
          <label className="cc-search"><span aria-hidden="true">⌕</span><input aria-label="Search command center" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills and artifacts" /></label>
          <button className="cc-icon-button" aria-label="Refresh command center" onClick={() => void load()}>↻</button>
          <button className="cc-stop" disabled={!activeTasks.length} onClick={() => void stopAll()}>Stop all</button>
        </div>
      </header>

      <div className="cc-grid">
        <aside className="cc-column cc-column-left">
          <article className="cc-widget cc-micro-apps" style={{ "--delay": "40ms" } as CSSProperties}>
            <div className="cc-widget-heading"><span>Micro apps</span><small>{4} ready</small></div>
            <div className="cc-app-list">
              {[
                ["Notes", "Knowledge workspace", "/notes/", "▤", "Open writing workspace"],
                ["Second brain", "Visual context map", "/graph/", "◉", "Open visual context map"],
                ["Browser", "Sessions + artifacts", "/browser/", "◎", "Open web workspace"],
                ["Voice", "Talk to Voidra", "/assistant/", "◌", "Start a voice interaction"],
              ].map(([name, description, href, glyph, accessibleName]) => <a key={name} href={href} aria-label={accessibleName}><i aria-hidden="true">{glyph}</i><span><strong>{name}</strong><small>{description}</small></span><b aria-hidden="true">→</b></a>)}
            </div>
          </article>

          <article className="cc-widget cc-clock-widget" style={{ "--delay": "100ms" } as CSSProperties}>
            <div className="cc-widget-heading"><span>Local calendar</span><a href="#today-planner">Open plan</a></div>
            <div className="cc-clock-row"><div className="cc-analog" aria-hidden="true"><span className="cc-hand-hour" /><span className="cc-hand-minute" /><i /></div><div><small>{date}</small><strong>{time}</strong><em>{zone}</em></div></div>
            <div className="cc-next-event"><span>What&apos;s next</span><strong>{nextSchedule?.name ?? "No routine scheduled"}</strong><small>{relativeTime(nextSchedule?.nextOccurrence ?? null, now)}</small></div>
          </article>

          <article className="cc-widget cc-pulse-widget" style={{ "--delay": "160ms" } as CSSProperties}>
            <div className="cc-widget-heading"><span>System pulse</span><small>local-first</small></div>
            <div className="cc-pulse-number"><strong>{nodes.length}</strong><span>knowledge nodes</span></div>
            <div className="cc-dot-matrix" aria-label={`${nodes.length} indexed knowledge nodes`}>{Array.from({ length: 32 }, (_, index) => <i key={index} className={index < Math.min(32, Math.max(4, Math.round(nodes.length / Math.max(1, nodes.length / 22)))) ? "lit" : ""} />)}</div>
            <div className="cc-metric-strip"><span><b>{edges.length}</b> links</span><span><b>{artifacts.length}</b> artifacts</span><span><b>{openLocalTasks.length}</b> open</span></div>
          </article>
        </aside>

        <article className="cc-brain" style={{ "--delay": "90ms" } as CSSProperties}>
          <div className="cc-brain-toolbar"><span>Second brain</span><small>{nodes.length} nodes · {edges.length} links</small><a href="/graph/" aria-label="Explore knowledge map">Explore graph ↗</a></div>
          <div className="cc-constellation" aria-label="ARMS constellation">
            <div className="cc-grid-plane" aria-hidden="true" />
            <div className="cc-particles" aria-hidden="true">{Array.from({ length: 54 }, (_, index) => <i key={index} style={{ "--x": `${12 + ((index * 37) % 76)}%`, "--y": `${12 + ((index * 53) % 74)}%`, "--size": `${1 + (index % 3)}px`, "--particle-delay": `${(index % 12) * -0.32}s` } as CSSProperties} />)}</div>
            <div className="cc-orbit cc-orbit-a" aria-hidden="true" />
            <div className="cc-orbit cc-orbit-b" aria-hidden="true" />
            <div className="cc-orbit cc-orbit-c" aria-hidden="true" />
            <div className="cc-network" aria-hidden="true">{Array.from({ length: 14 }, (_, index) => <i key={index} style={{ "--line-angle": `${index * 25.7}deg`, "--line-length": `${35 + (index % 4) * 11}%` } as CSSProperties} />)}</div>
            <a className="cc-core" href="/graph/" aria-label="Open workspace knowledge map"><span className="cc-core-glow" aria-hidden="true" /><b>V</b><strong>{workspace.name}</strong><small>Open second brain</small></a>
            <div className="cc-orbit-items">{orbitItems.map((item, index) => <a key={item.label} href={item.href} aria-label={item.accessibleName} className="cc-orbit-node" style={{ "--orbit-index": index } as CSSProperties}><i aria-hidden="true">{item.glyph}</i><span>{item.label}</span><small>{item.value}</small></a>)}</div>
            <div className="cc-brain-caption"><span><i /> private workspace</span><span><i /> explicit links</span><span><i /> live runs</span></div>
          </div>
        </article>

        <aside className="cc-column cc-column-right">
          <article className="cc-widget cc-attention" style={{ "--delay": "70ms" } as CSSProperties}>
            <div className="cc-widget-heading"><span>Attention</span><strong>{attention.length}</strong></div>
            {attention.length ? <div className="cc-attention-list">{attention.map((item) => <a key={`${item.tone}:${item.id}`} href={item.href}><i className={item.tone} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.detail}</small></span><b aria-hidden="true">›</b></a>)}</div> : <div className="cc-empty"><span>✓</span><strong>All clear</strong><small>No run or task needs attention.</small></div>}
            <div className="cc-connector-note"><span>Mail connector</span><a href="/settings/" aria-label="Configure mail connector">Connect in Settings</a></div>
          </article>

          <article className="cc-widget cc-skills" style={{ "--delay": "130ms" } as CSSProperties}>
            <div className="cc-widget-heading"><span>Skills deck</span><a href="/jobs/">Manage</a></div>
            {visibleSkills.length ? <div className="cc-skill-grid">{visibleSkills.map((skill) => { const routine = routineBySkill.get(skill.id); return <article key={skill.id}><div><i aria-hidden="true">⚡</i><span><strong>/{skill.name.toLowerCase().replaceAll(" ", "-")}</strong><small>v{skill.version} · {routine?.client ?? "unassigned"}</small></span></div><p>{skill.description}</p><footer><span>{shortModel(routine?.preferredModel ?? "")}</span><a href="/jobs/" aria-label={`Review and run ${skill.name}`}>▷</a></footer></article>; })}</div> : <div className="cc-empty"><span>⚡</span><strong>No matching skills</strong><small>Create or pin a skill in Jobs.</small><a href="/jobs/">Open skill library</a></div>}
          </article>

          <article className="cc-widget cc-routines" style={{ "--delay": "190ms" } as CSSProperties}>
            <div className="cc-widget-heading"><span>Routines</span><small>{enabledSchedules.length}/{schedules.length} active</small></div>
            <div className="cc-routine-list">{enabledSchedules.slice(0, 5).map((schedule) => <a key={schedule.id} href="/jobs/"><time>{schedule.localTime}</time><span><strong>{schedule.name}</strong><small>{schedule.mode} · {relativeTime(schedule.nextOccurrence, now)}</small></span><i className={schedule.mode} aria-hidden="true" /></a>)}</div>
            {!enabledSchedules.length && <div className="cc-empty compact"><strong>No active routines</strong><a href="/jobs/">Create schedule</a></div>}
          </article>
        </aside>
      </div>

      <footer className="cc-artifact-bar">
        <div className="cc-artifact-title"><span>Artifact ring</span><small>{artifacts.length} generated bundles</small></div>
        <div className="cc-artifacts">{visibleArtifacts.map((artifact, index) => <a href="/browser/" key={artifact.id} style={{ "--artifact-index": index } as CSSProperties}><i aria-hidden="true">◇</i><span><strong>{artifact.name}</strong><small>{artifact.files.length} files</small></span></a>)}{!visibleArtifacts.length && <a href="/browser/" className="cc-add-artifact"><i aria-hidden="true">+</i><span><strong>Create an artifact</strong><small>Open isolated HTML studio</small></span></a>}</div>
        <a className="cc-artifact-open" href="/browser/">Open library →</a>
      </footer>

      <div className="cc-runtime-strip" aria-live="polite">
        <span className={`status-light ${serviceStatus}`} /><strong>Local runtime</strong><small data-testid="service-status">{recovered ? "Recovered" : serviceStatus}</small>{latency !== null && <small>{latency} ms</small>}<span className="cc-runtime-divider" /><strong>Workspace</strong><small data-testid="workspace-id">{workspace.id}</small><span className="cc-runtime-divider" /><strong>Isolation</strong><small data-testid="isolation-result">{isolationMessage}</small><button onClick={onPing}>Check runtime</button>{diagnosticsAvailable && <button onClick={onIsolationProbe}>Test isolation</button>}{diagnosticsAvailable && <button onClick={onSimulateCrash}>Simulate crash</button>}
      </div>
      {message && <button className="cc-toast" role="status" onClick={() => setMessage("")}>{message}</button>}
    </section>
  );
}
