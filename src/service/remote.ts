import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AgentTaskManager } from "./agents";
import type { ServiceDatabase, WorkspaceRecord } from "./database";
import { DomainError, type WorkspaceManager } from "./workspaces";

const deviceSchema = z.object({ id: z.uuid(), name: z.string(), tokenHash: z.string().length(64), workspaceIds: z.array(z.uuid()), createdAt: z.iso.datetime(), lastSeenAt: z.iso.datetime(), revokedAt: z.iso.datetime().nullable() }).strict();
const challengeSchema = z.object({ id: z.uuid(), name: z.string(), codeHash: z.string().length(64), workspaceIds: z.array(z.uuid()), expiresAt: z.iso.datetime(), createdAt: z.iso.datetime() }).strict();
const submissionSchema = z.object({ deviceId: z.uuid(), workspaceId: z.uuid(), kind: z.enum(["task", "voice", "manual"]).default("task"), idempotencyKey: z.string(), payloadHash: z.string().length(64), taskId: z.uuid().nullable(), state: z.enum(["accepted", "completed", "failed"]), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict();
const eventSchema = z.object({ sequence: z.number().int().positive(), deviceId: z.uuid(), workspaceId: z.uuid(), type: z.string(), payload: z.record(z.string(), z.unknown()), at: z.iso.datetime() }).strict();
const registrySchema = z.object({ schemaVersion: z.literal(1), nextSequence: z.number().int().positive(), available: z.boolean(), devices: z.array(deviceSchema), challenges: z.array(challengeSchema), submissions: z.array(submissionSchema), events: z.array(eventSchema) }).strict();
const claimSchema = z.object({ code: z.string().regex(/^\d{6}$/), deviceName: z.string().trim().min(1).max(120) }).strict();
const remoteSubmissionInputSchema = z.object({ workspaceId: z.uuid(), idempotencyKey: z.string().min(1).max(200), objective: z.string().trim().min(1).max(100_000), model: z.string().trim().min(1).max(200) }).strict();
const remoteManualInputSchema = z.object({ workspaceId: z.uuid(), idempotencyKey: z.string().min(1).max(200), routineId: z.uuid(), objective: z.string().trim().min(1).max(100_000) }).strict();
const remoteVoiceInputSchema = z.object({ workspaceId: z.uuid(), idempotencyKey: z.string().min(1).max(200), text: z.string().trim().min(1).max(100_000), model: z.string().trim().min(1).max(200) }).strict();
type Registry = z.infer<typeof registrySchema>;
type GatewayStatus = { enabled: boolean; url: string | null; secure: boolean; reason: string | null };

const METADATA_KEY = "remote_registry_v1";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const publicDevice = (device: z.infer<typeof deviceSchema>) => ({ id: device.id, name: device.name, workspaceIds: device.workspaceIds, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt, revokedAt: device.revokedAt });

export class RemoteManager {
  readonly #registry: Registry;
  #gateway: GatewayStatus = { enabled: false, url: null, secure: false, reason: "Remote gateway has not started." };

  constructor(private readonly database: ServiceDatabase, private readonly workspaces: WorkspaceManager, private readonly agents: AgentTaskManager, private readonly options: {
    listRoutines?: (workspace: WorkspaceRecord) => Promise<Array<Record<string, unknown>>>;
    compileManual?: (workspace: WorkspaceRecord, input: { routineId: string; objective: string }) => Promise<Record<string, unknown>>;
    runVoice?: (workspace: WorkspaceRecord, input: { text: string; model: string }) => Promise<Record<string, unknown>>;
    voicePlayed?: (workspace: WorkspaceRecord, sessionId: string, utteranceId: string) => Promise<unknown>;
    interruptVoice?: (workspace: WorkspaceRecord, sessionId: string, cancelTask: boolean) => Promise<unknown>;
  } = {}) {
    const stored = database.getMetadata(METADATA_KEY);
    try { this.#registry = stored ? registrySchema.parse(JSON.parse(stored)) : { schemaVersion: 1, nextSequence: 1, available: true, devices: [], challenges: [], submissions: [], events: [] }; }
    catch { throw new DomainError("INCOMPATIBLE_SCHEMA", "Remote pairing metadata requires recovery."); }
    this.#expire();
  }

  setGateway(status: GatewayStatus) { this.#gateway = status; }
  status() { this.#expire(); return { ...this.#gateway, available: this.#registry.available, devices: this.#registry.devices.map(publicDevice), pendingChallenges: this.#registry.challenges.map(({ id, name, workspaceIds, expiresAt }) => ({ id, name, workspaceIds, expiresAt })) }; }

  async createChallenge(name: string, workspaceIds: string[], ttlMs = 5 * 60_000) {
    const unique = [...new Set(workspaceIds)];
    if (!unique.length) throw new DomainError("REMOTE_CONFLICT", "Authorize at least one workspace.");
    for (const workspaceId of unique) await this.workspaces.requireAvailableWorkspace(workspaceId);
    this.#expire();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0"); const now = new Date();
    const challenge = { id: randomUUID(), name, codeHash: digest(code), workspaceIds: unique, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + Math.min(ttlMs, 10 * 60_000)).toISOString() };
    this.#registry.challenges.push(challenge); this.#save();
    return { id: challenge.id, name, code, workspaceIds: unique, expiresAt: challenge.expiresAt };
  }

  claim(code: string, deviceName: string) {
    ({ code, deviceName } = claimSchema.parse({ code, deviceName }));
    this.#expire(); const codeHash = Buffer.from(digest(code));
    const index = this.#registry.challenges.findIndex((candidate) => timingSafeEqual(Buffer.from(candidate.codeHash), codeHash));
    if (index < 0) throw new DomainError("REMOTE_AUTH_FAILED", "The pairing code is invalid or expired.");
    const challenge = this.#registry.challenges.splice(index, 1)[0]!; const token = randomBytes(32).toString("base64url"); const now = new Date().toISOString();
    const device = { id: randomUUID(), name: deviceName || challenge.name, tokenHash: digest(token), workspaceIds: challenge.workspaceIds, createdAt: now, lastSeenAt: now, revokedAt: null };
    this.#registry.devices.push(device); this.#save();
    return { token, device: publicDevice(device) };
  }

  revoke(deviceId: string) { const device = this.#registry.devices.find(({ id }) => id === deviceId); if (!device) throw new DomainError("REMOTE_CONFLICT", "Paired device was not found."); device.revokedAt = new Date().toISOString(); this.#save(); return publicDevice(device); }
  setAvailable(value: boolean) { this.#registry.available = value; this.#save(); return this.status(); }

  async companionStatus(token: string) {
    const device = this.#authorize(token);
    const summaries = await this.workspaces.list();
    return { available: this.#registry.available, device: publicDevice(device), workspaces: summaries.workspaces.filter(({ id }) => device.workspaceIds.includes(id)).map(({ id, name, available }) => ({ id, name, available })) };
  }

  async submit(token: string, input: { workspaceId: string; idempotencyKey: string; objective: string; model: string }) {
    input = remoteSubmissionInputSchema.parse(input);
    const device = this.#authorize(token, input.workspaceId);
    if (!this.#registry.available) throw new DomainError("REMOTE_UNAVAILABLE", "The Mac is unavailable. The request was not queued.", true);
    const payloadHash = digest(JSON.stringify({ kind: "task", workspaceId: input.workspaceId, objective: input.objective, model: input.model }));
    const existing = this.#existing(device.id, input.idempotencyKey, payloadHash);
    if (existing) return { duplicate: true, ...existing };
    const workspace = await this.workspaces.requireAvailableWorkspace(input.workspaceId); const now = new Date().toISOString();
    const submission: z.infer<typeof submissionSchema> = { deviceId: device.id, workspaceId: workspace.id, kind: "task", idempotencyKey: input.idempotencyKey, payloadHash, taskId: null, state: "accepted", createdAt: now, updatedAt: now };
    this.#registry.submissions.push(submission); this.#event(device.id, workspace.id, "task.accepted", { idempotencyKey: input.idempotencyKey }); this.#save();
    const task = await this.agents.start(workspace, { objective: input.objective, model: input.model, maxSteps: 8, maxTokens: 50_000, maxRuntimeMs: 300_000, onTaskCreated: (taskId) => { submission.taskId = taskId; submission.updatedAt = new Date().toISOString(); this.#event(device.id, workspace.id, "task.started", { taskId }); this.#save(); } });
    submission.state = task.status === "completed" ? "completed" : "failed"; submission.updatedAt = new Date().toISOString(); this.#event(device.id, workspace.id, "task.updated", { taskId: task.id, status: task.status, output: task.output, error: task.error }); this.#save();
    return { duplicate: false, ...submission, task };
  }

  async routines(token: string, workspaceId: string) { this.#authorize(token, workspaceId); if (!this.options.listRoutines) throw new DomainError("REMOTE_CONFLICT", "Remote manual handoffs are unavailable."); const workspace = await this.workspaces.requireAvailableWorkspace(workspaceId); return { routines: await this.options.listRoutines(workspace) }; }

  async compileManual(token: string, input: { workspaceId: string; idempotencyKey: string; routineId: string; objective: string }) {
    input = remoteManualInputSchema.parse(input);
    const device = this.#authorize(token, input.workspaceId); if (!this.#registry.available) throw new DomainError("REMOTE_UNAVAILABLE", "The Mac is unavailable. The request was not queued.", true); if (!this.options.compileManual) throw new DomainError("REMOTE_CONFLICT", "Remote manual handoffs are unavailable.");
    const payloadHash = digest(JSON.stringify({ kind: "manual", workspaceId: input.workspaceId, routineId: input.routineId, objective: input.objective })); const existing = this.#existing(device.id, input.idempotencyKey, payloadHash); if (existing) return { duplicate: true, ...existing };
    const workspace = await this.workspaces.requireAvailableWorkspace(input.workspaceId); const now = new Date().toISOString(); const submission: z.infer<typeof submissionSchema> = { deviceId: device.id, workspaceId: workspace.id, kind: "manual", idempotencyKey: input.idempotencyKey, payloadHash, taskId: null, state: "accepted", createdAt: now, updatedAt: now }; this.#registry.submissions.push(submission); this.#save();
    const run = await this.options.compileManual(workspace, { routineId: input.routineId, objective: input.objective }); submission.taskId = String(run.id ?? "") || null; submission.state = "completed"; submission.updatedAt = new Date().toISOString(); this.#event(device.id, workspace.id, "handoff.ready-to-copy", { runId: submission.taskId, client: run.client, preferredModel: run.preferredModel }); this.#save(); return { duplicate: false, ...submission, run };
  }

  async submitVoice(token: string, input: { workspaceId: string; idempotencyKey: string; text: string; model: string }) {
    input = remoteVoiceInputSchema.parse(input);
    const device = this.#authorize(token, input.workspaceId); if (!this.#registry.available) throw new DomainError("REMOTE_UNAVAILABLE", "The Mac is unavailable. The request was not queued.", true); if (!this.options.runVoice) throw new DomainError("REMOTE_CONFLICT", "Remote voice is unavailable.");
    const payloadHash = digest(JSON.stringify({ kind: "voice", workspaceId: input.workspaceId, text: input.text, model: input.model })); const existing = this.#existing(device.id, input.idempotencyKey, payloadHash); if (existing) return { duplicate: true, ...existing };
    const workspace = await this.workspaces.requireAvailableWorkspace(input.workspaceId); const now = new Date().toISOString(); const submission: z.infer<typeof submissionSchema> = { deviceId: device.id, workspaceId: workspace.id, kind: "voice", idempotencyKey: input.idempotencyKey, payloadHash, taskId: null, state: "accepted", createdAt: now, updatedAt: now }; this.#registry.submissions.push(submission); this.#save();
    const result = await this.options.runVoice(workspace, { text: input.text, model: input.model }); const task = result.task as Record<string, unknown> | undefined; submission.taskId = typeof task?.id === "string" ? task.id : null; submission.state = task?.status === "completed" ? "completed" : "failed"; submission.updatedAt = new Date().toISOString(); this.#event(device.id, workspace.id, "voice.updated", { taskId: submission.taskId, status: task?.status ?? "unknown" }); this.#save(); return { duplicate: false, ...submission, result };
  }

  async voicePlayed(token: string, workspaceId: string, sessionId: string, utteranceId: string) { this.#authorize(token, workspaceId); if (!this.options.voicePlayed) throw new DomainError("REMOTE_CONFLICT", "Remote voice completion is unavailable."); const workspace = await this.workspaces.requireAvailableWorkspace(workspaceId); return this.options.voicePlayed(workspace, sessionId, utteranceId); }
  async interruptVoice(token: string, workspaceId: string, sessionId: string, cancelTask: boolean) { this.#authorize(token, workspaceId); if (!this.options.interruptVoice) throw new DomainError("REMOTE_CONFLICT", "Remote voice interruption is unavailable."); const workspace = await this.workspaces.requireAvailableWorkspace(workspaceId); return this.options.interruptVoice(workspace, sessionId, cancelTask); }

  events(token: string, workspaceId: string, cursor: number) { const device = this.#authorize(token, workspaceId); const events = this.#registry.events.filter((event) => event.deviceId === device.id && event.workspaceId === workspaceId && event.sequence > cursor).slice(0, 200); return { events, nextCursor: events.at(-1)?.sequence ?? cursor }; }
  async cancelTask(token: string, workspaceId: string, taskId: string) { const device = this.#authorize(token, workspaceId); const workspace = await this.workspaces.requireAvailableWorkspace(workspaceId); const task = await this.agents.cancel(workspace, taskId); this.#event(device.id, workspace.id, "task.cancelled", { taskId, status: task.status }); this.#save(); return task; }

  #existing(deviceId: string, idempotencyKey: string, payloadHash: string) { const existing = this.#registry.submissions.find((entry) => entry.deviceId === deviceId && entry.idempotencyKey === idempotencyKey); if (existing && existing.payloadHash !== payloadHash) throw new DomainError("REMOTE_CONFLICT", "This idempotency key was already used for a different request."); return existing; }

  #authorize(token: string, workspaceId?: string) {
    const tokenHash = Buffer.from(digest(token));
    const device = this.#registry.devices.find((candidate) => !candidate.revokedAt && timingSafeEqual(Buffer.from(candidate.tokenHash), tokenHash));
    if (!device) throw new DomainError("REMOTE_AUTH_FAILED", "The companion credential is invalid or revoked.");
    if (workspaceId && !device.workspaceIds.includes(workspaceId)) throw new DomainError("REMOTE_AUTH_FAILED", "This device is not authorized for that workspace.");
    device.lastSeenAt = new Date().toISOString(); this.#save(); return device;
  }
  #event(deviceId: string, workspaceId: string, type: string, payload: Record<string, unknown>) { this.#registry.events.push({ sequence: this.#registry.nextSequence++, deviceId, workspaceId, type, payload, at: new Date().toISOString() }); if (this.#registry.events.length > 5_000) this.#registry.events.splice(0, this.#registry.events.length - 5_000); }
  #expire() { const now = new Date().toISOString(); const before = this.#registry.challenges.length; this.#registry.challenges = this.#registry.challenges.filter(({ expiresAt }) => expiresAt > now); if (before !== this.#registry.challenges.length) this.#save(); }
  #save() { this.database.setMetadata(METADATA_KEY, JSON.stringify(this.#registry)); }
}
