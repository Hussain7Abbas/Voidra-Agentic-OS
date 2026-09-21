import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { WorkspaceRecord } from "./database";
import { DomainError } from "./workspaces";

export type ApplicationRecord = {
  id: string;
  workspaceId: string;
  name: string;
  kind: "mcp" | "local" | "remote" | "artifact-runtime";
  provenance: string;
  scope: "workspace" | "device-wide";
  status: "ready" | "configured" | "auth-required" | "degraded" | "stopped" | "unavailable";
  capabilities: Array<{ id: string; risk: "read" | "write" | "commit" }>;
  diagnostic: string | null;
  updatedAt: string;
};

export type WidgetSnapshot = {
  widgetId: string;
  workspaceId: string;
  sourceId: string;
  generatedAt: string;
  freshness: "fresh" | "stale" | "unavailable" | "auth-required";
  summary: unknown;
  actions: Array<{ id: string; label: string; risk: "read" | "write" | "commit" }>;
  diagnostics: Array<{ code: string; message: string }>;
};

type Dependencies = {
  listMcp: (workspace: WorkspaceRecord) => Promise<{ connections: Array<Record<string, unknown>> }>;
  listVoice: (workspace: WorkspaceRecord) => Promise<Record<string, unknown>>;
  remoteStatus: () => Record<string, unknown>;
  listAgents: (workspace: WorkspaceRecord) => Promise<{ tasks: Array<Record<string, unknown>> }>;
};

const microAppSchema = z.object({ id: z.uuid(), workspaceId: z.uuid(), title: z.string(), icon: z.string(), surfaces: z.array(z.enum(["dashboard", "dock", "detail"])), dataNeeds: z.array(z.string()), storage: z.enum(["none", "workspace-namespaced"]), network: z.literal("broker-only"), actions: z.array(z.object({ id: z.string(), label: z.string(), risk: z.enum(["read", "write", "commit"]) }).strict()), artifactId: z.uuid().nullable(), state: z.enum(["declarative", "reviewed-component", "suspended"]), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict();
const microRegistrySchema = z.object({ schemaVersion: z.literal(1), apps: z.array(microAppSchema) }).strict();
const widgetActionSchema = z.object({ id: z.uuid(), workspaceId: z.uuid(), widgetId: z.string(), actionId: z.string(), risk: z.enum(["read", "write", "commit"]), state: z.enum(["completed", "awaiting-review", "approved", "rejected", "failed"]), payload: z.record(z.string(), z.unknown()), result: z.record(z.string(), z.unknown()).nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict();
const actionRegistrySchema = z.object({ schemaVersion: z.literal(1), actions: z.array(widgetActionSchema) }).strict();

async function atomicWrite(path: string, value: unknown) { const temporary = `${path}.tmp-${randomUUID()}`; await mkdir(dirname(path), { recursive: true }); await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); await rename(temporary, path); }

export class ApplicationManager {
  constructor(private readonly dependencies: Dependencies) {}

  async list(workspace: WorkspaceRecord) {
    const now = new Date().toISOString();
    const [mcp, voice] = await Promise.all([this.dependencies.listMcp(workspace), this.dependencies.listVoice(workspace)]);
    const remote = this.dependencies.remoteStatus();
    const fixed: ApplicationRecord[] = [
      { id: "voidra.browser", workspaceId: workspace.id, name: "Workspace browser", kind: "local", provenance: "Voidra built-in", scope: "workspace", status: "ready", capabilities: [{ id: "browser.read", risk: "read" }, { id: "browser.control", risk: "write" }], diagnostic: null, updatedAt: now },
      { id: "voidra.mac", workspaceId: workspace.id, name: "Mac actions", kind: "local", provenance: "Voidra built-in", scope: "device-wide", status: "configured", capabilities: [{ id: "mac.inspect", risk: "read" }, { id: "mac.action", risk: "commit" }], diagnostic: "macOS consent is checked at action time.", updatedAt: now },
      { id: "voidra.voice", workspaceId: workspace.id, name: "Voice", kind: "local", provenance: "Voidra + ElevenLabs", scope: "workspace", status: voice.muted ? "stopped" : "configured", capabilities: [{ id: "voice.transcribe", risk: "read" }, { id: "voice.speak", risk: "write" }], diagnostic: voice.muted ? "Voice is muted." : null, updatedAt: now },
      { id: "voidra.remote", workspaceId: workspace.id, name: "Awake-Mac remote", kind: "remote", provenance: "Voidra built-in", scope: "device-wide", status: remote.available ? "ready" : "unavailable", capabilities: [{ id: "remote.submit", risk: "commit" }], diagnostic: typeof remote.reason === "string" ? remote.reason : null, updatedAt: now },
      { id: "voidra.artifacts", workspaceId: workspace.id, name: "Component artifacts", kind: "artifact-runtime", provenance: "Voidra reviewed runtime", scope: "workspace", status: "ready", capabilities: [{ id: "artifact.preview", risk: "read" }, { id: "artifact.capability", risk: "write" }], diagnostic: "Generated components remain quarantined until exact-digest review.", updatedAt: now },
    ];
    const connections: ApplicationRecord[] = mcp.connections.map((connection) => ({
      id: `mcp:${String(connection.id)}`, workspaceId: workspace.id, name: String(connection.name ?? "MCP connection"), kind: "mcp", provenance: "MCP configuration", scope: "workspace",
      status: this.#status(connection.status), capabilities: [
        ...((connection.capabilities as { resources?: unknown[] } | undefined)?.resources?.length ? [{ id: "mcp.readResource", risk: "read" as const }] : []),
        ...((connection.capabilities as { tools?: unknown[] } | undefined)?.tools?.length ? [{ id: "mcp.callTool", risk: "commit" as const }] : []),
      ], diagnostic: typeof connection.diagnostic === "string" ? connection.diagnostic : null, updatedAt: String(connection.updatedAt ?? now),
    }));
    const micro = (await this.#microApps(workspace)).apps.map<ApplicationRecord>((item) => ({ id: `micro:${item.id}`, workspaceId: workspace.id, name: item.title, kind: "artifact-runtime", provenance: item.artifactId ? `Reviewed component artifact ${item.artifactId}` : "Declarative micro-app manifest", scope: "workspace", status: item.state === "reviewed-component" ? "ready" : item.state === "suspended" ? "stopped" : "configured", capabilities: item.actions.map(({ id, risk }) => ({ id, risk })), diagnostic: item.artifactId ? null : "Declaration is inert until linked to an approved component artifact.", updatedAt: item.updatedAt }));
    return [...fixed, ...connections, ...micro];
  }

  async listMicroApps(workspace: WorkspaceRecord) { return (await this.#microApps(workspace)).apps; }

  async registerMicroApp(workspace: WorkspaceRecord, input: { title: string; icon: string; surfaces: Array<"dashboard" | "dock" | "detail">; dataNeeds: string[]; storage: "none" | "workspace-namespaced"; actions: Array<{ id: string; label: string; risk: "read" | "write" | "commit" }> }) {
    const registry = await this.#microApps(workspace); const now = new Date().toISOString();
    const app = microAppSchema.parse({ id: randomUUID(), workspaceId: workspace.id, title: input.title.trim(), icon: input.icon, surfaces: [...new Set(input.surfaces)], dataNeeds: [...new Set(input.dataNeeds)], storage: input.storage, network: "broker-only", actions: input.actions, artifactId: null, state: "declarative", createdAt: now, updatedAt: now });
    registry.apps.push(app); await atomicWrite(this.#microPath(workspace), registry); return app;
  }

  async promoteMicroApp(workspace: WorkspaceRecord, appId: string, artifactId: string) {
    const registry = await this.#microApps(workspace); const app = registry.apps.find((item) => item.id === appId && item.workspaceId === workspace.id); if (!app) throw new DomainError("WORKSPACE_CONFLICT", "The micro app does not belong to this workspace.");
    let artifacts: Array<Record<string, unknown>> = []; try { const value = JSON.parse(await readFile(join(workspace.canonicalPath, ".voidra", "artifacts.json"), "utf8")); if (Array.isArray(value)) artifacts = value; } catch { /* No reviewed artifacts. */ }
    const artifact = artifacts.find((item) => item.id === artifactId && item.workspaceId === workspace.id);
    const decision = artifact?.reviewDecision as Record<string, unknown> | undefined;
    if (!artifact || artifact.kind !== "component" || artifact.reviewState !== "approved" || decision?.verdict !== "approved" || Date.parse(String(decision.expiresAt ?? "")) <= Date.now()) throw new DomainError("WORKSPACE_CONFLICT", "Only a current approved component artifact can promote a micro app.");
    app.artifactId = artifactId; app.state = "reviewed-component"; app.updatedAt = new Date().toISOString(); await atomicWrite(this.#microPath(workspace), registry); return app;
  }

  recommend(query: string) {
    const lowered = query.trim().toLowerCase();
    const catalog = [
      { id: "calendar.official", name: "Calendar provider official API", rank: 1, provenance: "official-api", installation: "separate-review-required", capabilities: ["read events", "reviewed event mutation"] },
      { id: "email.official", name: "Email provider official API", rank: 1, provenance: "official-api", installation: "separate-review-required", capabilities: ["read metadata", "reviewed draft/send"] },
      { id: "mcp.official-registry", name: "Official MCP Registry result", rank: 2, provenance: "official-registry", installation: "separate-review-required", capabilities: ["declared server capabilities"] },
      { id: "cli.reviewed", name: "Reviewed local CLI adapter", rank: 3, provenance: "local-reviewed", installation: "separate-review-required", capabilities: ["declared CLI operations"] },
    ];
    return catalog.filter((item) => !lowered || `${item.id} ${item.name} ${item.capabilities.join(" ")}`.toLowerCase().includes(lowered)).sort((a, b) => a.rank - b.rank);
  }

  async prepareWidgetAction(workspace: WorkspaceRecord, widgetId: string, actionId: string, payload: Record<string, unknown>) {
    const widget = (await this.widgets(workspace)).find((item) => item.widgetId === widgetId); const action = widget?.actions.find((item) => item.id === actionId);
    if (!widget || !action) throw new DomainError("WORKSPACE_CONFLICT", "The widget action is not declared for this workspace snapshot.");
    const registry = await this.#actions(workspace); const now = new Date().toISOString(); const immediate = action.risk === "read";
    const record = widgetActionSchema.parse({ id: randomUUID(), workspaceId: workspace.id, widgetId, actionId, risk: action.risk, state: immediate ? "completed" : "awaiting-review", payload, result: immediate ? { destination: actionId === "open-assistant" ? "/assistant/" : "/settings/", sourceId: widget.sourceId } : null, createdAt: now, updatedAt: now });
    registry.actions.push(record); await atomicWrite(this.#actionPath(workspace), registry); return record;
  }

  async approveWidgetAction(workspace: WorkspaceRecord, actionId: string, approved: boolean) {
    const registry = await this.#actions(workspace); const action = registry.actions.find((item) => item.id === actionId && item.workspaceId === workspace.id);
    if (!action || action.state !== "awaiting-review") throw new DomainError("WORKSPACE_CONFLICT", "The widget action is not awaiting review.");
    action.state = approved ? "approved" : "rejected"; action.result = approved ? { reviewed: true, diagnostic: "No external adapter is configured; approval did not create an external effect." } : { reviewed: false }; action.updatedAt = new Date().toISOString(); await atomicWrite(this.#actionPath(workspace), registry); return action;
  }

  async widgets(workspace: WorkspaceRecord): Promise<WidgetSnapshot[]> {
    const generatedAt = new Date().toISOString();
    const [applications, agentState] = await Promise.all([this.list(workspace), this.dependencies.listAgents(workspace)]);
    const active = agentState.tasks.filter((task) => !["completed", "failed", "cancelled", "interrupted"].includes(String(task.status)));
    const ready = applications.filter((application) => application.status === "ready").length;
    const unavailable = applications.filter((application) => application.status === "unavailable" || application.status === "degraded").length;
    return [
      { widgetId: "local-time", workspaceId: workspace.id, sourceId: "system.clock", generatedAt, freshness: "fresh", summary: { iso: generatedAt, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, actions: [], diagnostics: [] },
      { widgetId: "connection-health", workspaceId: workspace.id, sourceId: "application.registry", generatedAt, freshness: unavailable ? "stale" : "fresh", summary: { total: applications.length, ready, unavailable, applications: applications.map(({ id, name, kind, scope, status }) => ({ id, name, kind, scope, status })) }, actions: [{ id: "open-settings", label: "Review connections", risk: "read" }], diagnostics: unavailable ? [{ code: "APPLICATIONS_UNAVAILABLE", message: `${unavailable} application connection(s) are unavailable or degraded.` }] : [] },
      { widgetId: "attention", workspaceId: workspace.id, sourceId: "agent.journal", generatedAt, freshness: "fresh", summary: { active: active.slice(0, 20).map(({ id, objective, status }) => ({ id, objective, status })) }, actions: [{ id: "open-assistant", label: "Review runs", risk: "read" }], diagnostics: [] },
      { widgetId: "calendar", workspaceId: workspace.id, sourceId: "unconfigured.calendar", generatedAt, freshness: "auth-required", summary: { events: [] }, actions: [{ id: "open-settings", label: "Choose a calendar connector", risk: "read" }], diagnostics: [{ code: "NO_CALENDAR_PROVIDER", message: "No calendar provider has been selected for this workspace." }] },
      { widgetId: "creator-metrics", workspaceId: workspace.id, sourceId: "unconfigured.creator", generatedAt, freshness: "unavailable", summary: { metrics: [] }, actions: [{ id: "open-settings", label: "Choose a creator data source", risk: "read" }], diagnostics: [{ code: "NO_CREATOR_PROVIDER", message: "No creator metrics provider has been selected; no values are fabricated." }] },
    ];
  }

  #status(value: unknown): ApplicationRecord["status"] {
    if (value === "ready" || value === "configured" || value === "degraded" || value === "stopped") return value;
    if (value === "authorization-required") return "auth-required";
    return "unavailable";
  }

  #microPath(workspace: WorkspaceRecord) { return join(workspace.canonicalPath, ".voidra", "micro-apps.json"); }
  #actionPath(workspace: WorkspaceRecord) { return join(workspace.canonicalPath, ".voidra", "widget-actions.json"); }
  async #microApps(workspace: WorkspaceRecord) { try { return microRegistrySchema.parse(JSON.parse(await readFile(this.#microPath(workspace), "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new DomainError("INCOMPATIBLE_SCHEMA", "Micro-app metadata requires recovery."); const value = { schemaVersion: 1 as const, apps: [] }; await atomicWrite(this.#microPath(workspace), value); return value; } }
  async #actions(workspace: WorkspaceRecord) { try { return actionRegistrySchema.parse(JSON.parse(await readFile(this.#actionPath(workspace), "utf8"))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new DomainError("INCOMPATIBLE_SCHEMA", "Widget action metadata requires recovery."); const value = { schemaVersion: 1 as const, actions: [] }; await atomicWrite(this.#actionPath(workspace), value); return value; } }
}
