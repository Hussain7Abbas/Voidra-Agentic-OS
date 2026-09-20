import { z } from "zod";

export const WORKSPACE_ID_EXAMPLE = "018f0f73-89db-7a63-a1b2-5d46f598ed01";

const requestIdentity = {
  requestId: z.uuid(),
  workspaceId: z.uuid(),
  sessionId: z.uuid(),
};

export const serviceRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    ...requestIdentity,
    operation: z.literal("system.ping"),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("notes.list"),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("notes.create"),
    payload: z.object({ path: z.string().min(1).max(2048), content: z.string().max(10_000_000) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("notes.read"),
    payload: z.object({ documentId: z.uuid() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("notes.save"),
    payload: z.object({ documentId: z.uuid(), content: z.string().max(10_000_000), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("notes.resolveConflict"),
    payload: z.object({ documentId: z.uuid(), strategy: z.enum(["disk", "editor", "merge"]), expectedDiskRevision: z.string().regex(/^[a-f0-9]{64}$/), editorContent: z.string().max(10_000_000).optional(), mergedContent: z.string().max(10_000_000).optional() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("notes.rename"),
    payload: z.object({ documentId: z.uuid(), newPath: z.string().min(1).max(2048) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("notes.search"),
    payload: z.object({ query: z.string().max(1000), tag: z.string().max(200).optional() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("notes.backlinks"),
    payload: z.object({ documentId: z.uuid() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("notes.history"),
    payload: z.object({ documentId: z.uuid() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("notes.restore"),
    payload: z.object({ documentId: z.uuid(), revisionId: z.uuid() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("notes.rebuildIndex"),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("notes.indexStatus"),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("workspace.validateDirectory"),
    payload: z.object({
      path: z.string().min(1).max(4096).refine((value) => value.startsWith("/"), "Path must be absolute"),
    }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("workspace.list"),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("workspace.create"),
    payload: z.object({ name: z.string().trim().min(1).max(80), path: z.string().min(1).max(4096).refine((value) => value.startsWith("/"), "Path must be absolute") }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("workspace.open"),
    payload: z.object({ path: z.string().min(1).max(4096).refine((value) => value.startsWith("/"), "Path must be absolute") }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("workspace.select"),
    payload: z.object({ workspaceId: z.uuid() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("workspace.locate"),
    payload: z.object({ workspaceId: z.uuid(), path: z.string().min(1).max(4096).refine((value) => value.startsWith("/"), "Path must be absolute") }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("workspace.remove"),
    payload: z.object({ workspaceId: z.uuid() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("workspace.setPreferences"),
    payload: z.object({ defaultWorkspaceId: z.uuid().nullable().optional(), askOnStartup: z.boolean().optional() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("workspace.contextProbe"),
    payload: z.object({ delayMs: z.number().int().min(0).max(2_000) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("settings.get"),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("settings.updateGlobal"),
    payload: z.object({ overrides: z.unknown() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("settings.updateWorkspace"),
    payload: z.object({ overrides: z.unknown() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("instructions.createScope"),
    payload: z.object({ relativeDirectory: z.string().max(2048), content: z.string().min(1).max(128_000) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("instructions.resolve"),
    payload: z.object({ relativeTargets: z.array(z.string().min(1).max(2048)).min(1).max(50) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("account.bindReference"),
    payload: z.object({ accountId: z.uuid(), provider: z.string().min(1).max(100), credentialRef: z.string().regex(/^keychain:\/\/[A-Za-z0-9._/-]+$/) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("account.listReferences"),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("knowledge.attach"),
    payload: z.object({ name: z.string().trim().min(1).max(80), path: z.string().min(1).max(4096), access: z.enum(["read", "write"]).default("read") }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("knowledge.listAttachments"),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("knowledge.setAccess"),
    payload: z.object({ baseId: z.uuid(), access: z.enum(["read", "write"]) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("knowledge.detach"),
    payload: z.object({ baseId: z.uuid() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("knowledge.locate"),
    payload: z.object({ baseId: z.uuid(), path: z.string().min(1).max(4096) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("knowledge.search"),
    payload: z.object({ query: z.string().max(1000), tag: z.string().max(200).optional(), delayMs: z.number().int().min(0).max(2_000).optional() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("knowledge.read"),
    payload: z.object({ baseId: z.union([z.literal("private"), z.uuid()]), documentId: z.string().min(1).max(128) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("knowledge.create"),
    payload: z.object({ baseId: z.uuid(), path: z.string().min(1).max(2048), content: z.string().max(10_000_000) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("knowledge.save"),
    payload: z.object({ baseId: z.uuid(), documentId: z.string().min(1).max(128), content: z.string().max(10_000_000), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("knowledge.graph"),
    payload: z.object({ focus: z.object({ baseId: z.union([z.literal("private"), z.uuid()]), documentId: z.string().min(1).max(128) }).strict().optional(), depth: z.number().int().min(0).max(5).optional(), tag: z.string().max(200).optional(), filterOnly: z.boolean().optional() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("memory.list"),
    payload: z.object({ includeExpired: z.boolean().optional() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("memory.create"),
    payload: z.object({ text: z.string().trim().min(1).max(100_000), source: z.string().min(1).max(500), confirmed: z.boolean(), expiresAt: z.iso.datetime().nullable().optional() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("memory.update"),
    payload: z.object({ memoryId: z.uuid(), text: z.string().trim().min(1).max(100_000), source: z.string().min(1).max(500), confirmed: z.boolean(), expiresAt: z.iso.datetime().nullable().optional() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("memory.delete"),
    payload: z.object({ memoryId: z.uuid() }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity,
    operation: z.literal("memory.context"),
    payload: z.object({ query: z.string().max(1000).optional() }).strict(),
  }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("skill.list"), payload: z.object({}).strict() }).strict(),
  z.object({
    ...requestIdentity, operation: z.literal("skill.create"),
    payload: z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000), instructions: z.string().min(1).max(200_000), expectedOutput: z.string().min(1).max(2000), inputs: z.array(z.string().max(120)).max(100) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity, operation: z.literal("skill.update"),
    payload: z.object({ skillId: z.uuid(), name: z.string().trim().min(1).max(120), description: z.string().max(2000), instructions: z.string().min(1).max(200_000), expectedOutput: z.string().min(1).max(2000), inputs: z.array(z.string().max(120)).max(100) }).strict(),
  }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("skill.duplicate"), payload: z.object({ skillId: z.uuid(), name: z.string().trim().min(1).max(120) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("routine.list"), payload: z.object({}).strict() }).strict(),
  z.object({
    ...requestIdentity, operation: z.literal("routine.create"),
    payload: z.object({ name: z.string().trim().min(1).max(120), skillId: z.uuid(), client: z.enum(["claude", "codex"]), preferredModel: z.string().max(200), outputDirectory: z.string().max(2048), inlineInstructions: z.string().max(100_000) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity, operation: z.literal("routine.duplicate"),
    payload: z.object({ routineId: z.uuid(), name: z.string().trim().min(1).max(120), client: z.enum(["claude", "codex"]), preferredModel: z.string().max(200) }).strict(),
  }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("handoff.list"), payload: z.object({}).strict() }).strict(),
  z.object({
    ...requestIdentity, operation: z.literal("handoff.compile"),
    payload: z.object({ routineId: z.uuid(), objective: z.string().min(1).max(100_000), targetPaths: z.array(z.string().max(2048)).max(50), sources: z.array(z.object({ baseId: z.union([z.literal("private"), z.uuid()]), documentId: z.string().min(1).max(128) }).strict()).max(100) }).strict(),
  }).strict(),
  z.object({
    ...requestIdentity, operation: z.literal("handoff.prepareScheduled"),
    payload: z.object({ routineId: z.uuid(), objective: z.string().min(1).max(100_000), targetPaths: z.array(z.string().max(2048)).max(50), sources: z.array(z.object({ baseId: z.union([z.literal("private"), z.uuid()]), documentId: z.string().min(1).max(128) }).strict()).max(100) }).strict(),
  }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("handoff.updatePrompt"), payload: z.object({ runId: z.uuid(), prompt: z.string().min(1).max(250_000) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("handoff.markCopied"), payload: z.object({ runId: z.uuid() }).strict() }).strict(),
  z.object({
    ...requestIdentity, operation: z.literal("handoff.previewResult"),
    payload: z.object({ runId: z.uuid(), resultText: z.string().max(10_000_000), outputPath: z.string().min(1).max(2048), outputContent: z.string().max(10_000_000) }).strict(),
  }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("handoff.applyResult"), payload: z.object({ runId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("handoff.complete"), payload: z.object({ runId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("handoff.cancel"), payload: z.object({ runId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("agent.list"), payload: z.object({}).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("agent.start"), payload: z.object({ objective: z.string().trim().min(1).max(100_000), model: z.string().trim().min(1).max(200), maxSteps: z.number().int().min(1).max(25).default(8) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("agent.approve"), payload: z.object({ taskId: z.uuid(), expiresAt: z.iso.datetime().nullable().optional() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("agent.cancel"), payload: z.object({ taskId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("agent.revokeGrant"), payload: z.object({ grantId: z.uuid() }).strict() }).strict(),
]);

export type ServiceRequest = z.infer<typeof serviceRequestSchema>;

export const errorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "SERVICE_UNAVAILABLE",
  "REQUEST_TIMEOUT",
  "DIRECTORY_UNAVAILABLE",
  "INTERNAL_ERROR",
  "INCOMPATIBLE_SCHEMA",
  "WORKSPACE_NOT_FOUND",
  "WORKSPACE_UNAVAILABLE",
  "DUPLICATE_WORKSPACE",
  "OVERLAPPING_WORKSPACE",
  "WORKSPACE_CONFLICT",
  "INSTRUCTION_CONFLICT",
  "KNOWLEDGE_ACCESS_DENIED",
  "KNOWLEDGE_BASE_UNAVAILABLE",
  "KNOWLEDGE_BASE_BUSY",
  "HANDOFF_STATE_CONFLICT",
  "AGENT_STATE_CONFLICT",
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export type ServiceResponse =
  | {
      requestId: string;
      ok: true;
      data: Record<string, unknown>;
    }
  | {
      requestId: string;
      ok: false;
      error: { code: ErrorCode; message: string; retryable: boolean };
    };

export const serviceMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), pid: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("response"), response: z.custom<ServiceResponse>() }).strict(),
  z.object({
    kind: z.literal("event"),
    event: z.object({
      sequence: z.number().int().positive(),
      type: z.string().min(1),
      workspaceId: z.uuid(),
      runId: z.uuid().optional(),
      payload: z.record(z.string(), z.unknown()),
    }).strict(),
  }).strict(),
]);

export type ServiceMessage = z.infer<typeof serviceMessageSchema>;
export type ServiceEvent = Extract<ServiceMessage, { kind: "event" }>['event'];

export const serviceStateEventSchema = z.object({
  state: z.enum(["starting", "ready", "crashed", "stopping", "stopped"]),
  generation: z.number().int().nonnegative(),
  reason: z.string().optional(),
}).strict();

export type ServiceStateEvent = z.infer<typeof serviceStateEventSchema>;

export const IPC_CHANNELS = {
  serviceRequest: "voidra:service:request",
  serviceStatus: "voidra:service:status",
  serviceState: "voidra:service:state",
  chooseDirectory: "voidra:shell:choose-directory",
  copyText: "voidra:shell:copy-text",
  testCrash: "voidra:test:service-crash",
  isolationProbe: "voidra:test:isolation-probe",
  testReadClipboard: "voidra:test:read-clipboard",
  testSetClipboard: "voidra:test:set-clipboard",
} as const;

export function publicError(
  requestId: string,
  code: ErrorCode,
  message: string,
  retryable = false,
): ServiceResponse {
  return { requestId, ok: false, error: { code, message, retryable } };
}
