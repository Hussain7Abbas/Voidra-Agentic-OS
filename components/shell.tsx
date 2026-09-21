"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServiceRequest } from "@/src/shared/contracts";
import { sectionIds, type SectionId } from "@/src/shared/navigation";
import type { RequestService } from "@/components/service-types";
import { KnowledgePanel } from "@/components/knowledge-panel";
import { MemoryPanel } from "@/components/memory-panel";
import { NotesPanel } from "@/components/notes-panel";
import { HandoffPanel } from "@/components/handoff-panel";
import { AgentPanel } from "@/components/agent-panel";
import { McpPanel } from "@/components/mcp-panel";
import { ApplicationsPanel } from "@/components/applications-panel";
import { PlannerPanel } from "@/components/planner-panel";
import { SchedulePanel } from "@/components/schedule-panel";
import { BrowserPanel } from "@/components/browser-panel";
import { AutomationPanel } from "@/components/automation-panel";
import { VoicePanel } from "@/components/voice-panel";
import { RemotePanel } from "@/components/remote-panel";
import { CommandCenter } from "@/components/command-center";
import { SystemCanvasBar } from "@/components/system-canvas-bar";
import { HeadlessPanel } from "@/components/headless-panel";
import { RunTimelinePanel } from "@/components/run-timeline-panel";
import { OutputCatalogPanel } from "@/components/output-catalog-panel";
import { FeatureFlagsPanel } from "@/components/feature-flags-panel";

const FALLBACK_WORKSPACE_ID = "018f0f73-89db-7a63-a1b2-5d46f598ed01";

type WorkspaceSummary = {
  id: string;
  name: string;
  canonicalPath: string;
  available: boolean;
  instructionIssues?: Array<{ path: string; code: string }>;
};

type RegistryState = {
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string | null;
  defaultWorkspaceId: string | null;
  askOnStartup: boolean;
};

type ServiceStatus = "starting" | "ready" | "crashed" | "stopping" | "stopped";

const copy: Record<SectionId, { eyebrow: string; title: string; body: string }> = {
  today: { eyebrow: "Your local day", title: "Plan the day.", body: "Build an editable, sourced plan from this workspace's local tasks, availability, and explicitly supplied commitments." },
  assistant: { eyebrow: "Quick assistant", title: "What can I help with?", body: "Every request carries its owning workspace even if the visible workspace changes before it completes." },
  notes: { eyebrow: "Private knowledge", title: "Notes", body: "Canonical Markdown, backlinks, revision recovery, and local indexing stay inside this workspace." },
  graph: { eyebrow: "Accessible knowledge", title: "Knowledge graph", body: "Private notes and explicitly attached bases retain visible source and access boundaries." },
  browser: { eyebrow: "Workspace session", title: "Browser", body: "Ordinary tabs, agent-controlled tabs, and isolated artifact previews will use separate security boundaries." },
  mac: { eyebrow: "Shared device", title: "Mac control", body: "Scoped file actions and serialized desktop control remain visible, reviewable, and interruptible." },
  jobs: { eyebrow: "Awake-Mac runtime", title: "Jobs", body: "Manual and automatic routines remain bound to their workspace, timezone, and awake-only schedule." },
  remote: { eyebrow: "Paired companion", title: "Remote access", body: "Authorized devices can reach selected workspaces only while this Mac is awake and connected." },
  settings: { eyebrow: "Global and workspace", title: "Settings", body: "Workspace overrides show their effective value and origin without merging private context." },
};

function routeFor(section: SectionId) {
  return section === "today" ? "/" : `/${section}/`;
}

function WorkspaceLauncher({ registry, choose, add }: { registry: RegistryState; choose: (workspaceId: string) => Promise<void>; add: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="launcher-title" data-testid="workspace-launcher">
        <p className="card-label">CHOOSE CONTEXT</p>
        <h2 id="launcher-title">Where are you working?</h2>
        <div className="workspace-list">
          {registry.workspaces.map((workspace) => <button key={workspace.id} onClick={() => void choose(workspace.id)}><span><strong>{workspace.name}</strong><small>{workspace.canonicalPath}</small></span><span>{workspace.available ? "→" : "Locate"}</span></button>)}
        </div>
        <button className="folder-picker" onClick={add}>Add another workspace</button>
      </section>
    </div>
  );
}

function WorkspaceDialog({
  required,
  request,
  onComplete,
  onClose,
}: {
  required: boolean;
  request: RequestService;
  onComplete: () => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"create" | "open" | "restore">("create");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [backupPath, setBackupPath] = useState("");
  const [restoreParent, setRestoreParent] = useState("");
  const [message, setMessage] = useState(required ? "Choose a folder to create your first workspace." : "Choose an independent workspace folder.");
  const [busy, setBusy] = useState(false);

  const chooseFolder = async () => {
    const result = await window.voidra?.shell.chooseDirectory();
    if (!result || result.canceled) {
      setMessage("Folder selection canceled. No workspace was created.");
      return;
    }
    setPath(result.path ?? "");
    setMessage(result.path ?? "Folder selected.");
  };

  const chooseRestoreFolder = async (kind: "backup" | "parent") => {
    const result = await window.voidra?.shell.chooseDirectory();
    if (!result || result.canceled || !result.path) { setMessage("Folder selection canceled."); return; }
    if (kind === "backup") setBackupPath(result.path);
    else setRestoreParent(result.path);
    setMessage(result.path);
  };

  const submit = async () => {
    if ((mode !== "restore" && !path) || ((mode === "create" || mode === "restore") && !name.trim()) || (mode === "restore" && (!backupPath || !restoreParent))) return;
    setBusy(true);
    const result = mode === "restore"
      ? await request("backup.restore", { backupPath, destinationParent: restoreParent, folderName: name.trim() })
      : await request(mode === "create" ? "workspace.create" : "workspace.open", mode === "create" ? { name: name.trim(), path } : { path });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    await onComplete();
    onClose();
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title" data-testid="workspace-dialog">
        <div className="dialog-heading">
          <div><p className="card-label">LOCAL WORKSPACE</p><h2 id="workspace-dialog-title">{required ? "Welcome to Voidra" : "Add workspace"}</h2></div>
          {!required && <button className="icon-button" aria-label="Close workspace dialog" onClick={onClose}>×</button>}
        </div>
        <div className="segmented" aria-label="Workspace action">
          <button className={mode === "create" ? "selected" : ""} onClick={() => setMode("create")}>Create new</button>
          <button className={mode === "open" ? "selected" : ""} onClick={() => setMode("open")}>Open existing</button>
          <button className={mode === "restore" ? "selected" : ""} onClick={() => setMode("restore")}>Restore backup</button>
        </div>
        {(mode === "create" || mode === "restore") && <label>{mode === "restore" ? "Restored folder name" : "Workspace name"}<input aria-label={mode === "restore" ? "Restored folder name" : "Workspace name"} value={name} onChange={(event) => setName(event.target.value)} placeholder="Work" autoFocus /></label>}
        {mode === "restore" ? <>
          <button className="folder-picker" onClick={() => void chooseRestoreFolder("backup")}>Choose .voidra-backup folder</button>
          <small>{backupPath || "No backup selected."}</small>
          <button className="folder-picker" onClick={() => void chooseRestoreFolder("parent")}>Choose restore parent folder</button>
          <small>{restoreParent || "No restore destination selected."}</small>
        </> : <button className="folder-picker" onClick={chooseFolder}>Choose workspace folder</button>}
        <p className="path-message" data-testid="workspace-folder-result">{message}</p>
        <button className="primary" onClick={submit} disabled={busy || (mode !== "restore" && !path) || ((mode === "create" || mode === "restore") && !name.trim()) || (mode === "restore" && (!backupPath || !restoreParent))}>{busy ? "Saving…" : mode === "create" ? "Create workspace" : mode === "open" ? "Open workspace" : "Verify and restore"}</button>
      </section>
    </div>
  );
}

function SettingsPanel({ workspace, registry, request, reloadRegistry }: { workspace: WorkspaceSummary; registry: RegistryState; request: RequestService; reloadRegistry: () => Promise<void> }) {
  const [settings, setSettings] = useState<Record<string, any> | null>(null);
  const [globalModel, setGlobalModel] = useState("");
  const [globalPersona, setGlobalPersona] = useState("");
  const [globalVoice, setGlobalVoice] = useState(false);
  const [globalVoiceId, setGlobalVoiceId] = useState("");
  const [workspaceModelEnabled, setWorkspaceModelEnabled] = useState(false);
  const [workspaceModel, setWorkspaceModel] = useState("");
  const [workspacePersonaEnabled, setWorkspacePersonaEnabled] = useState(false);
  const [workspacePersona, setWorkspacePersona] = useState("");
  const [workspaceVoiceEnabled, setWorkspaceVoiceEnabled] = useState(false);
  const [workspaceVoice, setWorkspaceVoice] = useState(false);
  const [workspaceVoiceIdEnabled, setWorkspaceVoiceIdEnabled] = useState(false);
  const [workspaceVoiceId, setWorkspaceVoiceId] = useState("");
  const [scopeDirectory, setScopeDirectory] = useState("");
  const [scopeContent, setScopeContent] = useState("");
  const [resolveTarget, setResolveTarget] = useState("");
  const [instructionResult, setInstructionResult] = useState("");
  const [message, setMessage] = useState("");
  const [askOnStartup, setAskOnStartup] = useState(registry.askOnStartup);
  const [attachments, setAttachments] = useState<Array<Record<string, any>>>([]);
  const [baseName, setBaseName] = useState("");
  const [basePath, setBasePath] = useState("");
  const [baseAccess, setBaseAccess] = useState<"read" | "write">("read");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [openRouterStatus, setOpenRouterStatus] = useState<{ configured: boolean; secureStorageAvailable: boolean } | null>(null);
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [elevenLabsStatus, setElevenLabsStatus] = useState<{ configured: boolean; secureStorageAvailable: boolean } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await request("settings.get", {}, workspace.id);
    if (!result.ok) { setMessage(result.error.message); return; }
    const data = result.data as Record<string, any>;
    setSettings(data);
    setGlobalModel(data.global.execution?.preferredModel ?? "");
    setGlobalPersona(data.global.assistant?.persona ?? "");
    setGlobalVoice(data.global.voice?.enabled ?? false);
    setGlobalVoiceId(data.global.voice?.voiceId ?? "");
    setWorkspaceModelEnabled(data.workspace.execution?.preferredModel !== undefined);
    setWorkspaceModel(data.workspace.execution?.preferredModel ?? data.effective.execution.preferredModel);
    setWorkspacePersonaEnabled(data.workspace.assistant?.persona !== undefined);
    setWorkspacePersona(data.workspace.assistant?.persona ?? data.effective.assistant.persona);
    setWorkspaceVoiceEnabled(data.workspace.voice?.enabled !== undefined);
    setWorkspaceVoice(data.workspace.voice?.enabled ?? data.effective.voice.enabled);
    setWorkspaceVoiceIdEnabled(data.workspace.voice?.voiceId !== undefined);
    setWorkspaceVoiceId(data.workspace.voice?.voiceId ?? data.effective.voice.voiceId ?? "");
  }, [request, workspace.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setAskOnStartup(registry.askOnStartup); }, [registry.askOnStartup]);

  const loadAttachments = useCallback(async () => {
    const result = await request("knowledge.listAttachments", {}, workspace.id);
    if (result.ok) setAttachments((result.data.attachments as Array<Record<string, any>>) ?? []);
  }, [request, workspace.id]);

  useEffect(() => { void loadAttachments(); }, [loadAttachments]);
  useEffect(() => { void window.voidra?.secrets.openRouterStatus().then(setOpenRouterStatus); }, []);
  useEffect(() => { void window.voidra?.secrets.elevenLabsStatus().then(setElevenLabsStatus); }, []);

  const chooseBaseFolder = async () => {
    const result = await window.voidra?.shell.chooseDirectory();
    if (result?.path) setBasePath(result.path);
  };

  const attachBase = async () => {
    const result = await request("knowledge.attach", { name: baseName, path: basePath, access: baseAccess }, workspace.id);
    if (!result.ok) { setMessage(result.error.message); return; }
    setBaseName("");
    setBasePath("");
    setMessage("Shared knowledge attached.");
    await loadAttachments();
  };

  const saveGlobal = async () => {
    const overrides = {
      ...settings?.global,
      execution: { ...settings?.global.execution, preferredModel: globalModel },
      voice: { ...settings?.global.voice, enabled: globalVoice, voiceId: globalVoiceId.trim() || null },
      assistant: { ...settings?.global.assistant, persona: globalPersona },
    };
    const result = await request("settings.updateGlobal", { overrides }, workspace.id);
    setMessage(result.ok ? "Global settings saved." : result.error.message);
    if (result.ok) await load();
  };

  const saveWorkspace = async () => {
    const overrides = { ...settings?.workspace } as Record<string, any>;
    overrides.execution = { ...(overrides.execution ?? {}) };
    if (workspaceModelEnabled) overrides.execution.preferredModel = workspaceModel;
    else delete overrides.execution.preferredModel;
    if (!Object.keys(overrides.execution).length) delete overrides.execution;
    overrides.assistant = { ...(overrides.assistant ?? {}) };
    if (workspacePersonaEnabled) overrides.assistant.persona = workspacePersona;
    else delete overrides.assistant.persona;
    if (!Object.keys(overrides.assistant).length) delete overrides.assistant;
    overrides.voice = { ...(overrides.voice ?? {}) };
    if (workspaceVoiceEnabled) overrides.voice.enabled = workspaceVoice;
    else delete overrides.voice.enabled;
    if (workspaceVoiceIdEnabled) overrides.voice.voiceId = workspaceVoiceId.trim() || null;
    else delete overrides.voice.voiceId;
    if (!Object.keys(overrides.voice).length) delete overrides.voice;
    const result = await request("settings.updateWorkspace", { overrides }, workspace.id);
    setMessage(result.ok ? `${workspace.name} overrides saved.` : result.error.message);
    if (result.ok) await load();
  };

  const createScope = async () => {
    const result = await request("instructions.createScope", { relativeDirectory: scopeDirectory, content: scopeContent }, workspace.id);
    setInstructionResult(result.ok ? `Created ${scopeDirectory || "."}/AGENTS.md + CLAUDE.md` : result.error.message);
  };

  const resolveRules = async () => {
    const result = await request("instructions.resolve", { relativeTargets: [resolveTarget] }, workspace.id);
    if (!result.ok) { setInstructionResult(result.error.message); return; }
    const resolved = (result.data.results as Array<Record<string, any>>)[0];
    setInstructionResult(resolved.rules.map((rule: Record<string, string>) => `${rule.scope}: ${rule.path}`).join("\n") || "No applicable rules.");
  };

  if (!settings) return <article className="panel settings-card">Loading effective settings…</article>;

  return (
    <div className="settings-grid">
      <article className="panel settings-card">
        <p className="card-label">GLOBAL DEFAULTS</p>
        <label>Preferred model<input aria-label="Global preferred model" value={globalModel} onChange={(event) => setGlobalModel(event.target.value)} /></label>
        <label className="check-label"><input type="checkbox" aria-label="Global voice enabled" checked={globalVoice} onChange={(event) => setGlobalVoice(event.target.checked)} /> Voice enabled</label>
        <label>ElevenLabs voice ID<input aria-label="Global ElevenLabs voice ID" value={globalVoiceId} onChange={(event) => setGlobalVoiceId(event.target.value)} placeholder="Voice ID" /></label>
        <label>Base persona<textarea aria-label="Global persona" value={globalPersona} onChange={(event) => setGlobalPersona(event.target.value)} /></label>
        <button onClick={saveGlobal}>Save global defaults</button>
      </article>

      <article className="panel settings-card">
        <p className="card-label">{workspace.name.toUpperCase()} OVERRIDES</p>
        <label className="check-label"><input type="checkbox" aria-label="Override workspace model" checked={workspaceModelEnabled} onChange={(event) => setWorkspaceModelEnabled(event.target.checked)} /> Override model</label>
        <input aria-label="Workspace preferred model" value={workspaceModel} onChange={(event) => setWorkspaceModel(event.target.value)} disabled={!workspaceModelEnabled} />
        <small>Effective: <strong data-testid="effective-model">{settings.effective.execution.preferredModel}</strong> · {settings.origins.execution.preferredModel}</small>
        <label className="check-label"><input type="checkbox" aria-label="Override workspace voice" checked={workspaceVoiceEnabled} onChange={(event) => setWorkspaceVoiceEnabled(event.target.checked)} /> Override voice enabled</label>
        <label className="check-label nested"><input type="checkbox" aria-label="Workspace voice value" checked={workspaceVoice} onChange={(event) => setWorkspaceVoice(event.target.checked)} disabled={!workspaceVoiceEnabled} /> Enabled</label>
        <label className="check-label"><input type="checkbox" aria-label="Use workspace-specific voice ID" checked={workspaceVoiceIdEnabled} onChange={(event) => setWorkspaceVoiceIdEnabled(event.target.checked)} /> Override voice ID</label>
        <input aria-label="Workspace ElevenLabs voice ID" value={workspaceVoiceId} onChange={(event) => setWorkspaceVoiceId(event.target.value)} disabled={!workspaceVoiceIdEnabled} />
        <small>Effective voice ID: <strong data-testid="effective-voice-id">{settings.effective.voice.voiceId ?? "Not selected"}</strong> · {settings.origins.voice.voiceId}</small>
        <label className="check-label"><input type="checkbox" aria-label="Override workspace persona" checked={workspacePersonaEnabled} onChange={(event) => setWorkspacePersonaEnabled(event.target.checked)} /> Override persona</label>
        <textarea aria-label="Workspace persona" value={workspacePersona} onChange={(event) => setWorkspacePersona(event.target.value)} disabled={!workspacePersonaEnabled} />
        <button onClick={saveWorkspace}>Save workspace overrides</button>
      </article>

      <article className="panel settings-card">
        <p className="card-label">WORKSPACE BEHAVIOR</p>
        <small>Startup selection is global-only; content and persona overrides remain workspace-owned.</small>
        <label className="check-label"><input type="checkbox" aria-label="Ask on startup" checked={askOnStartup} onChange={async (event) => { const checked = event.target.checked; setAskOnStartup(checked); await request("workspace.setPreferences", { askOnStartup: checked }, workspace.id); await reloadRegistry(); }} /> Ask which workspace on startup</label>
        <button onClick={async () => { await request("workspace.setPreferences", { defaultWorkspaceId: workspace.id }, workspace.id); await reloadRegistry(); }}>Make default workspace</button>
        <small>{registry.defaultWorkspaceId === workspace.id ? "This is the default workspace." : "Another workspace is the default."}</small>
        <button className="danger-button" onClick={async () => { if (!window.confirm(`Remove ${workspace.name} from Voidra? Source files will not be deleted.`)) return; await request("workspace.remove", { workspaceId: workspace.id }, workspace.id); await reloadRegistry(); }}>Remove from Voidra</button>
      </article>

      <article className="panel settings-card">
        <p className="card-label">BACKUP & RECOVERY</p>
        <small>Exports canonical workspace files and durable state with integrity hashes. Search indexes and credentials are excluded; shared sources remain external references.</small>
        <button disabled={backupBusy} onClick={async () => {
          const selection = await window.voidra?.shell.chooseDirectory();
          if (!selection?.path) return;
          setBackupBusy(true);
          const result = await request("backup.export", { destinationDirectory: selection.path }, workspace.id);
          setBackupBusy(false);
          setMessage(result.ok ? `Backup created at ${String(result.data.path)}` : result.error.message);
        }}>{backupBusy ? "Creating verified backup…" : "Export workspace backup"}</button>
        <small>Restore from the Add workspace dialog. Credentials must be reauthorized after restore.</small>
      </article>

      <article className="panel settings-card">
        <p className="card-label">SCOPED INSTRUCTIONS</p>
        <label>Existing directory<input aria-label="Instruction scope directory" value={scopeDirectory} onChange={(event) => setScopeDirectory(event.target.value)} placeholder="projects/example" /></label>
        <label>Rules<textarea aria-label="Instruction scope content" value={scopeContent} onChange={(event) => setScopeContent(event.target.value)} /></label>
        <button onClick={createScope} disabled={!scopeContent}>Create instruction pair</button>
        <label>Target path<input aria-label="Instruction target path" value={resolveTarget} onChange={(event) => setResolveTarget(event.target.value)} placeholder="projects/example/note.md" /></label>
        <button onClick={resolveRules} disabled={!resolveTarget}>Resolve applicable rules</button>
        <pre data-testid="instruction-result">{instructionResult}</pre>
      </article>
      <article className="panel settings-card shared-bases-card">
        <p className="card-label">SHARED KNOWLEDGE</p>
        <small>Folders are attached explicitly. Read-only is the default; write access is granted per workspace.</small>
        <label>Base name<input aria-label="Shared base name" value={baseName} onChange={(event) => setBaseName(event.target.value)} placeholder="Learning" /></label>
        <button onClick={chooseBaseFolder}>Choose shared knowledge folder</button>
        <p className="path-message">{basePath || "No shared folder selected."}</p>
        <label>Access<select aria-label="Shared base access" value={baseAccess} onChange={(event) => setBaseAccess(event.target.value as "read" | "write")}><option value="read">Read only</option><option value="write">Read and write</option></select></label>
        <button onClick={attachBase} disabled={!baseName.trim() || !basePath}>Attach base</button>
        <div className="attachment-list">{attachments.map((attachment) => <div key={attachment.baseId}><span><strong>{attachment.name}</strong><small>{attachment.canonicalPath}<br />{attachment.available ? attachment.access : "unavailable"}</small></span><select aria-label={`${attachment.name} access`} value={attachment.access} onChange={async (event) => { const result = await request("knowledge.setAccess", { baseId: attachment.baseId, access: event.target.value }, workspace.id); setMessage(result.ok ? "Attachment access updated." : result.error.message); await loadAttachments(); }}><option value="read">Read</option><option value="write">Write</option></select>{!attachment.available && <button onClick={async () => { const folder = await window.voidra?.shell.chooseDirectory(); if (folder?.path) { await request("knowledge.locate", { baseId: attachment.baseId, path: folder.path }, workspace.id); await loadAttachments(); } }}>Locate</button>}<button onClick={async () => { await request("knowledge.detach", { baseId: attachment.baseId }, workspace.id); await loadAttachments(); }}>Detach</button></div>)}</div>
      </article>
      <article className="panel settings-card">
        <p className="card-label">OPENROUTER CREDENTIAL</p>
        <small>The key is encrypted through macOS secure storage and is never returned to this page or written into workspace task journals.</small>
        <label>API key<input aria-label="OpenRouter API key" type="password" autoComplete="off" value={openRouterKey} onChange={(event) => setOpenRouterKey(event.target.value)} placeholder={openRouterStatus?.configured ? "Configured — enter a replacement" : "sk-or-…"} /></label>
        <div className="button-row"><button disabled={!openRouterKey || !openRouterStatus?.secureStorageAvailable} onClick={async () => { try { const status = await window.voidra?.secrets.setOpenRouter(openRouterKey); setOpenRouterKey(""); if (status) setOpenRouterStatus({ ...status, secureStorageAvailable: true }); setMessage("OpenRouter credential stored securely."); } catch { setMessage("OpenRouter credential could not be stored securely."); } }}>Save credential</button>{openRouterStatus?.configured && <button className="danger-button" onClick={async () => { const status = await window.voidra?.secrets.deleteOpenRouter(); if (status) setOpenRouterStatus({ ...status, secureStorageAvailable: openRouterStatus.secureStorageAvailable }); setMessage("OpenRouter credential removed."); }}>Remove credential</button>}</div>
        <small data-testid="openrouter-credential-status">{openRouterStatus?.configured ? "Configured" : openRouterStatus?.secureStorageAvailable ? "Not configured" : "Secure storage unavailable"}</small>
      </article>
      <article className="panel settings-card">
        <p className="card-label">ELEVENLABS CREDENTIAL</p>
        <small>The key is encrypted through macOS secure storage and supplied only to the local speech adapter.</small>
        <label>API key<input aria-label="ElevenLabs API key" type="password" autoComplete="off" value={elevenLabsKey} onChange={(event) => setElevenLabsKey(event.target.value)} placeholder={elevenLabsStatus?.configured ? "Configured — enter a replacement" : "ElevenLabs API key"} /></label>
        <div className="button-row"><button disabled={!elevenLabsKey || !elevenLabsStatus?.secureStorageAvailable} onClick={async () => { try { const status = await window.voidra?.secrets.setElevenLabs(elevenLabsKey); setElevenLabsKey(""); if (status) setElevenLabsStatus({ ...status, secureStorageAvailable: true }); setMessage("ElevenLabs credential stored securely."); } catch { setMessage("ElevenLabs credential could not be stored securely."); } }}>Save ElevenLabs credential</button>{elevenLabsStatus?.configured && <button className="danger-button" onClick={async () => { const status = await window.voidra?.secrets.deleteElevenLabs(); if (status) setElevenLabsStatus({ ...status, secureStorageAvailable: elevenLabsStatus.secureStorageAvailable }); setMessage("ElevenLabs credential removed."); }}>Remove ElevenLabs credential</button>}</div>
        <small data-testid="elevenlabs-credential-status">{elevenLabsStatus?.configured ? "Configured" : elevenLabsStatus?.secureStorageAvailable ? "Not configured" : "Secure storage unavailable"}</small>
      </article>
      <McpPanel workspaceId={workspace.id} request={request} />
      <ApplicationsPanel workspaceId={workspace.id} request={request} />
      <FeatureFlagsPanel workspaceId={workspace.id} request={request} />
      {message && <p className="save-message" role="status">{message}</p>}
    </div>
  );
}

export function Shell({ section }: { section: SectionId }) {
  const content = copy[section];
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>("starting");
  const [latency, setLatency] = useState<number | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [diagnosticsAvailable, setDiagnosticsAvailable] = useState(false);
  const [isolationMessage, setIsolationMessage] = useState("Not checked");
  const [registry, setRegistry] = useState<RegistryState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const startupEvaluated = useRef(false);
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const selectedWorkspaceId = registry?.selectedWorkspaceId ?? registry?.defaultWorkspaceId ?? registry?.workspaces[0]?.id ?? null;
  const selectedWorkspace = registry?.workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const activeWorkspaceId = selectedWorkspaceId ?? FALLBACK_WORKSPACE_ID;
  const bridgeAvailable = typeof window !== "undefined" && Boolean(window.voidra);

  const request = useCallback<RequestService>(async (operation, payload, workspaceId) => {
    if (!window.voidra) throw new Error("The desktop bridge is unavailable.");
    const requestValue = { requestId: crypto.randomUUID(), workspaceId: workspaceId ?? activeWorkspaceId, sessionId, operation, payload } as ServiceRequest;
    return window.voidra.service.request(requestValue);
  }, [activeWorkspaceId, sessionId]);

  const loadRegistry = useCallback(async () => {
    const result = await request("workspace.list", {});
    if (!result.ok) { setWorkspaceError(result.error.message); return; }
    const next = result.data as RegistryState;
    if (!startupEvaluated.current && next.workspaces.length > 0 && sessionStorage.getItem("voidra.startupChoiceMade") !== "true") {
      startupEvaluated.current = true;
      if (next.askOnStartup) {
        setLauncherOpen(true);
      } else if (next.defaultWorkspaceId && next.selectedWorkspaceId !== next.defaultWorkspaceId) {
        await request("workspace.select", { workspaceId: next.defaultWorkspaceId }, next.defaultWorkspaceId);
        next.selectedWorkspaceId = next.defaultWorkspaceId;
      }
      sessionStorage.setItem("voidra.startupChoiceMade", "true");
    }
    setRegistry(next);
    if (next.workspaces.length === 0) setDialogOpen(true);
  }, [request]);

  useEffect(() => {
    if (sessionStorage.getItem("voidra.routeRestored") !== "true") {
      sessionStorage.setItem("voidra.routeRestored", "true");
      const prior = localStorage.getItem("voidra.lastSectionBeforeLaunch");
      if (section === "today" && prior && prior !== "today" && sectionIds.includes(prior as SectionId)) {
        window.location.replace(routeFor(prior as SectionId));
        return;
      }
    }
    localStorage.setItem("voidra.lastSection", section);
  }, [section]);

  useEffect(() => {
    if (!window.voidra) return;
    setDiagnosticsAvailable(Boolean(window.voidra.diagnostics));
    let sawCrash = false;
    const dispose = window.voidra.events.onServiceState((event) => {
      setServiceStatus(event.state);
      if (event.state === "crashed") sawCrash = true;
      if (event.state === "ready" && sawCrash) setRecovered(true);
    });
    window.voidra.service.status().then((status) => setServiceStatus(status.state));
    return dispose;
  }, []);

  useEffect(() => {
    const saveForRestart = () => localStorage.setItem("voidra.lastSectionBeforeLaunch", section);
    window.addEventListener("beforeunload", saveForRestart);
    return () => window.removeEventListener("beforeunload", saveForRestart);
  }, [section]);

  useEffect(() => {
    if (!selectedWorkspaceId) return;
    const key = `voidra.routeState.${selectedWorkspaceId}.${section}`;
    let savedY = 0;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as { scrollY?: number } | null;
      savedY = Number.isFinite(saved?.scrollY) ? Math.max(0, Number(saved?.scrollY)) : 0;
    } catch {
      sessionStorage.removeItem(key);
    }
    const restore = window.requestAnimationFrame(() => window.scrollTo({ top: savedY, behavior: "auto" }));
    let pending = 0;
    const save = () => {
      if (pending) window.cancelAnimationFrame(pending);
      pending = window.requestAnimationFrame(() => sessionStorage.setItem(key, JSON.stringify({ scrollY: window.scrollY, updatedAt: new Date().toISOString() })));
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      window.cancelAnimationFrame(restore);
      if (pending) window.cancelAnimationFrame(pending);
      sessionStorage.setItem(key, JSON.stringify({ scrollY: window.scrollY, updatedAt: new Date().toISOString() }));
      window.removeEventListener("scroll", save);
    };
  }, [section, selectedWorkspaceId]);

  const ping = useCallback(async () => {
    const started = performance.now();
    const result = await request("system.ping", {});
    if (result.ok) setLatency(Math.max(1, Math.round(performance.now() - started)));
  }, [request]);

  useEffect(() => {
    if (serviceStatus === "ready") {
      void ping();
      void loadRegistry();
    }
  }, [loadRegistry, ping, serviceStatus]);

  useEffect(() => {
    if (!selectedWorkspaceId || serviceStatus !== "ready") return;
    let current = true;
    void request("feature.list", {}, selectedWorkspaceId).then((result) => { if (current && result.ok) setFeatures(Object.fromEntries(((result.data.features as Array<{ id: string; enabled: boolean }>) ?? []).map((feature) => [feature.id, feature.enabled]))); });
    return () => { current = false; };
  }, [request, selectedWorkspaceId, serviceStatus]);

  const switchWorkspace = async (workspaceId: string) => {
    const result = await request("workspace.select", { workspaceId }, workspaceId);
    if (!result.ok) setWorkspaceError(result.error.message);
    else await loadRegistry();
  };

  const chooseStartupWorkspace = async (workspaceId: string) => {
    await switchWorkspace(workspaceId);
    sessionStorage.setItem("voidra.startupChoiceMade", "true");
    setLauncherOpen(false);
  };

  const locateWorkspace = async () => {
    if (!selectedWorkspace) return;
    const selection = await window.voidra?.shell.chooseDirectory();
    if (!selection || selection.canceled || !selection.path) return;
    const result = await request("workspace.locate", { workspaceId: selectedWorkspace.id, path: selection.path }, selectedWorkspace.id);
    if (!result.ok) setWorkspaceError(result.error.message);
    else await loadRegistry();
  };

  const runIsolationProbe = async () => {
    const result = await window.voidra?.diagnostics?.runIsolationProbe();
    setIsolationMessage(result && !result.hasBridge ? "Privileged bridge blocked" : "Isolation failed");
  };

  const stopAll = async () => {
    if (!selectedWorkspace) return;
    const result = await request("agent.stopAll", {}, selectedWorkspace.id);
    setWorkspaceError(result.ok ? `Stopped ${(result.data.stopped as string[]).length} active task(s).` : result.error.message);
  };

  return (
    <main className="app-shell v2-shell">
      <SystemCanvasBar
        section={section}
        workspaces={registry?.workspaces ?? []}
        selectedWorkspaceId={selectedWorkspaceId}
        serviceStatus={serviceStatus}
        recovered={recovered}
        latency={latency}
        onSwitchWorkspace={(workspaceId) => void switchWorkspace(workspaceId)}
        onAddWorkspace={() => setDialogOpen(true)}
        onStopAll={() => void stopAll()}
        request={request}
      />

      <section className="workspace v2-workspace">
        <div className={section === "today" ? "content content-command" : "content v2-content"}>
          {selectedWorkspace && !selectedWorkspace.available && <div className="warning-banner" role="alert"><span><strong>{selectedWorkspace.name} is unavailable.</strong> Its identity and settings are preserved.</span><button onClick={locateWorkspace}>Locate folder</button></div>}
          {selectedWorkspace?.instructionIssues?.length ? <div className="warning-banner" role="alert"><span><strong>Instruction files need review.</strong> {selectedWorkspace.instructionIssues.map((issue) => issue.code).join(", ")}</span><a href="/settings/">Review settings</a></div> : null}
          {workspaceError && <div className="warning-banner" role="alert"><span>{workspaceError}</span><button onClick={() => setWorkspaceError("")}>Dismiss</button></div>}
          {section !== "today" && <header className="v2-page-heading"><div><p className="eyebrow">{content.eyebrow}</p><h1>{content.title}</h1></div><p className="lede">{content.body}</p><span>{section.toUpperCase()} / {selectedWorkspace?.name ?? "SETUP"}</span></header>}

          <div className="v2-route-body" key={`${section}:${selectedWorkspace?.id ?? "setup"}`}>
          {section === "today" && selectedWorkspace ? (
            <div className="command-stack">
              {features["command-center"] !== false ? <CommandCenter
                workspace={selectedWorkspace}
                workspaces={registry?.workspaces ?? [selectedWorkspace]}
                request={request}
                serviceStatus={serviceStatus}
                latency={latency}
                recovered={recovered}
                diagnosticsAvailable={diagnosticsAvailable}
                isolationMessage={isolationMessage}
                onPing={() => void ping()}
                onSwitchWorkspace={(workspaceId) => void switchWorkspace(workspaceId)}
                onAddWorkspace={() => setDialogOpen(true)}
                onIsolationProbe={() => void runIsolationProbe()}
                onSimulateCrash={() => window.voidra?.diagnostics?.simulateServiceCrash()}
              /> : <article className="panel v2-feature-disabled"><p className="card-label">COMMAND CENTER DISABLED</p><h2>V2 dashboard rollback is active.</h2><p>Canonical workspace data remains intact. Re-enable the command-center bundle in Settings when you are ready.</p><a href="/settings/">Open feature controls →</a></article>}
              <section id="today-planner" className="today-planner-section" aria-labelledby="today-planner-title">
                <div className="today-planner-heading"><p className="eyebrow">Your local day</p><h2 id="today-planner-title">Plan the day</h2><p>{content.body}</p></div>
                <PlannerPanel workspaceId={selectedWorkspace.id} request={request} />
              </section>
            </div>
          ) : section === "settings" && selectedWorkspace ? (
            <SettingsPanel workspace={selectedWorkspace} registry={registry!} request={request} reloadRegistry={loadRegistry} />
          ) : section === "notes" && selectedWorkspace ? (
            <NotesPanel workspaceId={selectedWorkspace.id} request={request} />
          ) : section === "graph" && selectedWorkspace ? (
            <KnowledgePanel workspaceId={selectedWorkspace.id} request={request} />
          ) : section === "assistant" && selectedWorkspace ? (
            <div className="assistant-stack"><VoicePanel workspaceId={selectedWorkspace.id} request={request} /><AgentPanel workspaceId={selectedWorkspace.id} request={request} /><MemoryPanel workspaceId={selectedWorkspace.id} request={request} /></div>
          ) : section === "jobs" && selectedWorkspace ? (
            <div className="assistant-stack"><RunTimelinePanel workspaceId={selectedWorkspace.id} request={request} />{features.catalog !== false && <OutputCatalogPanel workspaceId={selectedWorkspace.id} request={request} />}{features.headless !== false && <HeadlessPanel workspaceId={selectedWorkspace.id} request={request} />}<SchedulePanel workspaceId={selectedWorkspace.id} request={request} />{features.skills !== false && <HandoffPanel workspaceId={selectedWorkspace.id} request={request} />}</div>
          ) : section === "browser" && selectedWorkspace ? (
            <BrowserPanel workspace={selectedWorkspace} request={request} />
          ) : section === "mac" && selectedWorkspace ? (
            <AutomationPanel workspaceId={selectedWorkspace.id} request={request} />
          ) : section === "remote" && selectedWorkspace ? (
            <RemotePanel workspaceId={selectedWorkspace.id} workspaceName={selectedWorkspace.name} request={request} />
          ) : (
            <div className="grid">
              <article className="panel"><p className="card-label">{selectedWorkspace ? "WORKSPACE CONTEXT" : "DESKTOP SHELL"}</p><h2>{selectedWorkspace ? selectedWorkspace.name : "Choose your workspace."}</h2><p>{selectedWorkspace ? selectedWorkspace.canonicalPath : "Voidra keeps each assistant context in a directory you choose."}</p><button className="primary" onClick={ping} disabled={!bridgeAvailable || serviceStatus !== "ready"}>Check runtime</button></article>
              <article className="panel" aria-live="polite"><p className="card-label">FOUNDATION DIAGNOSTICS</p><dl>
                <div><dt>Renderer bridge</dt><dd>{bridgeAvailable ? "Connected" : "Web preview"}</dd></div>
                <div><dt>Service</dt><dd data-testid="settings-service-status">{recovered ? "Recovered" : serviceStatus}</dd></div>
                <div><dt>Workspace identity</dt><dd data-testid="workspace-id">{selectedWorkspace?.id ?? "Awaiting setup"}</dd></div>
                <div><dt>Content isolation</dt><dd data-testid="isolation-result">{isolationMessage}</dd></div>
              </dl><div className="button-row">{diagnosticsAvailable && <button onClick={runIsolationProbe}>Test isolation</button>}{diagnosticsAvailable && <button onClick={() => window.voidra?.diagnostics?.simulateServiceCrash()}>Simulate crash</button>}</div></article>
            </div>
          )}
          </div>
        </div>
      </section>
      {dialogOpen && <WorkspaceDialog required={!registry?.workspaces.length} request={request} onComplete={async () => { sessionStorage.setItem("voidra.startupChoiceMade", "true"); await loadRegistry(); }} onClose={() => setDialogOpen(false)} />}
      {launcherOpen && registry && <WorkspaceLauncher registry={registry} choose={chooseStartupWorkspace} add={() => { setLauncherOpen(false); setDialogOpen(true); }} />}
    </main>
  );
}
