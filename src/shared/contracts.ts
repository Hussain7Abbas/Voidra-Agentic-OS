import { z } from "zod";

export const WORKSPACE_ID_EXAMPLE = "018f0f73-89db-7a63-a1b2-5d46f598ed01";

const requestIdentity = {
  requestId: z.uuid(),
  workspaceId: z.uuid(),
  sessionId: z.uuid(),
};
const planningSources = z.array(z.object({ baseId: z.union([z.literal("private"), z.uuid()]), documentId: z.string().min(1).max(128) }).strict()).max(100).optional();

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
    ...requestIdentity, operation: z.literal("routine.update"),
    payload: z.object({ routineId: z.uuid(), name: z.string().trim().min(1).max(120), skillId: z.uuid(), client: z.enum(["claude", "codex"]), preferredModel: z.string().max(200), outputDirectory: z.string().max(2048), inlineInstructions: z.string().max(100_000) }).strict(),
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
  z.object({ ...requestIdentity, operation: z.literal("agent.start"), payload: z.object({ objective: z.string().trim().min(1).max(100_000), model: z.string().trim().min(1).max(200), maxSteps: z.number().int().min(1).max(25).default(8), maxTokens: z.number().int().min(1).max(10_000_000).default(50_000), maxRuntimeMs: z.number().int().min(1_000).max(3_600_000).default(300_000), targetPaths: z.array(z.string().min(1).max(2048)).max(50).default([]), sources: z.array(z.object({ baseId: z.union([z.literal("private"), z.uuid()]), documentId: z.string().min(1).max(128) }).strict()).max(100).default([]), browserTabId: z.uuid().optional() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("agent.approve"), payload: z.object({ taskId: z.uuid(), expiresAt: z.iso.datetime().nullable().optional() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("agent.cancel"), payload: z.object({ taskId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("agent.resume"), payload: z.object({ taskId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("agent.stopAll"), payload: z.object({}).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("agent.revokeGrant"), payload: z.object({ grantId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("automation.list"), payload: z.object({}).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("automation.addRoot"), payload: z.object({ name: z.string().trim().min(1).max(120), path: z.string().min(1).max(4096).refine((value) => value.startsWith("/"), "Path must be absolute") }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("automation.removeRoot"), payload: z.object({ rootId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("automation.listFiles"), payload: z.object({ rootId: z.uuid(), path: z.string().max(2048).default("") }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("automation.prepareFile"), payload: z.object({ rootId: z.uuid(), action: z.enum(["copy", "move", "trash", "write"]), source: z.string().max(2048), destination: z.string().max(2048).optional(), content: z.string().max(5_000_000).optional() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("automation.approveFile"), payload: z.object({ actionId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("automation.undoFile"), payload: z.object({ actionId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("automation.capabilities"), payload: z.object({}).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("automation.prepareNative"), payload: z.object({ operation: z.enum(["open-path", "open-app", "inspect-target", "activate-control"]), target: z.record(z.string(), z.unknown()) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("automation.approveNative"), payload: z.object({ actionId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("automation.takeover"), payload: z.object({}).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("voice.list"), payload: z.object({}).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("voice.configure"), payload: z.object({ wakeWordEnabled: z.boolean().optional(), muted: z.boolean().optional(), retainTranscripts: z.boolean().optional() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("voice.start"), payload: z.object({ mode: z.enum(["push-to-talk", "conversation"]) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("voice.partial"), payload: z.object({ sessionId: z.uuid(), utteranceId: z.uuid(), transcriptId: z.string().min(1).max(200), text: z.string().max(100_000) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("voice.transcribe"), payload: z.object({ sessionId: z.uuid(), utteranceId: z.uuid(), transcriptId: z.string().min(1).max(200), audioBase64: z.string().min(1).max(50_000_000), mimeType: z.string().min(1).max(100) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("voice.finalize"), payload: z.object({ sessionId: z.uuid(), utteranceId: z.uuid(), transcriptId: z.string().min(1).max(200), text: z.string().trim().min(1).max(100_000), model: z.string().min(1).max(200) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("voice.interrupt"), payload: z.object({ sessionId: z.uuid(), cancelTask: z.boolean().default(false) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("voice.played"), payload: z.object({ sessionId: z.uuid(), utteranceId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("voice.wake"), payload: z.object({ phrase: z.string().max(200) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("remote.status"), payload: z.object({}).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("remote.createChallenge"), payload: z.object({ name: z.string().trim().min(1).max(120), workspaceIds: z.array(z.uuid()).min(1).max(100) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("remote.revoke"), payload: z.object({ deviceId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("remote.setAvailabilityFixture"), payload: z.object({ available: z.boolean() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("backup.export"), payload: z.object({ destinationDirectory: z.string().min(1).max(4096).refine((value) => value.startsWith("/"), "Path must be absolute") }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("backup.inspect"), payload: z.object({ backupPath: z.string().min(1).max(4096).refine((value) => value.startsWith("/"), "Path must be absolute") }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("backup.restore"), payload: z.object({
    backupPath: z.string().min(1).max(4096).refine((value) => value.startsWith("/"), "Path must be absolute"),
    destinationParent: z.string().min(1).max(4096).refine((value) => value.startsWith("/"), "Path must be absolute"),
    folderName: z.string().trim().min(1).max(120).refine((value) => value !== "." && value !== ".." && !/[\\/\0]/.test(value), "Folder name must be a single path component"),
  }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.catalog"), payload: z.object({ query: z.string().max(200).default("") }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.list"), payload: z.object({}).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.addStdio"), payload: z.object({ name: z.string().trim().min(1).max(120), command: z.string().trim().min(1).max(2048), args: z.array(z.string().max(4096)).max(100), cwd: z.string().max(2048).nullable().optional(), env: z.record(z.string().max(200), z.string().max(10_000)).optional() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.addRemote"), payload: z.object({ name: z.string().trim().min(1).max(120), url: z.url().max(4096) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.update"), payload: z.object({ connectionId: z.uuid(), configuration: z.discriminatedUnion("transport", [z.object({ transport: z.literal("stdio"), name: z.string().trim().min(1).max(120), command: z.string().trim().min(1).max(2048), args: z.array(z.string().max(4096)).max(100), cwd: z.string().max(2048).nullable().optional(), env: z.record(z.string().max(200), z.string().max(10_000)).optional() }).strict(), z.object({ transport: z.literal("streamable-http"), name: z.string().trim().min(1).max(120), url: z.url().max(4096) }).strict()]) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.rollback"), payload: z.object({ connectionId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.connect"), payload: z.object({ connectionId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.refresh"), payload: z.object({ connectionId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.stop"), payload: z.object({ connectionId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.setEnabled"), payload: z.object({ connectionId: z.uuid(), enabled: z.boolean() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.remove"), payload: z.object({ connectionId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.readResource"), payload: z.object({ connectionId: z.uuid(), uri: z.string().min(1).max(4096) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.getPrompt"), payload: z.object({ connectionId: z.uuid(), name: z.string().min(1).max(500), arguments: z.record(z.string(), z.string()).default({}) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.prepareTool"), payload: z.object({ connectionId: z.uuid(), name: z.string().min(1).max(500), arguments: z.record(z.string(), z.unknown()).default({}) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("mcp.approveTool"), payload: z.object({ actionId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("planner.list"), payload: z.object({}).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("planner.task.add"), payload: z.object({ title: z.string().trim().min(1).max(500), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), optional: z.boolean().optional() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("planner.task.update"), payload: z.object({ taskId: z.uuid(), title: z.string().trim().min(1).max(500).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), optional: z.boolean().optional(), completed: z.boolean().optional() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("planner.task.remove"), payload: z.object({ taskId: z.uuid() }).strict() }).strict(),
  z.object({
    ...requestIdentity, operation: z.literal("planner.generateLocal"), payload: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timezone: z.string().min(1).max(200), availability: z.object({ start: z.string(), end: z.string() }).strict().nullable().optional(),
      events: z.array(z.object({ sourceId: z.string().min(1).max(500), title: z.string().min(1).max(1000), start: z.iso.datetime(), end: z.iso.datetime(), allDay: z.boolean().optional(), recurringId: z.string().max(500).optional() }).strict()).max(500).optional(), unavailableSources: z.array(z.string().min(1).max(500)).max(100).optional(),
      sources: planningSources,
    }).strict(),
  }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("planner.save"), payload: z.object({ planId: z.uuid(), markdown: z.string().max(2_000_000), expectedRevision: z.string().length(64) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("planner.prepareManual"), payload: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timezone: z.string().min(1).max(200), availability: z.object({ start: z.string(), end: z.string() }).strict().nullable().optional(), events: z.array(z.object({ sourceId: z.string().min(1).max(500), title: z.string().min(1).max(1000), start: z.iso.datetime(), end: z.iso.datetime(), allDay: z.boolean().optional(), recurringId: z.string().max(500).optional() }).strict()).max(500).optional(), unavailableSources: z.array(z.string().min(1).max(500)).max(100).optional(), sources: planningSources }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("planner.generateAutomatic"), payload: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timezone: z.string().min(1).max(200), model: z.string().trim().min(1).max(200), availability: z.object({ start: z.string(), end: z.string() }).strict().nullable().optional(), events: z.array(z.object({ sourceId: z.string().min(1).max(500), title: z.string().min(1).max(1000), start: z.iso.datetime(), end: z.iso.datetime(), allDay: z.boolean().optional(), recurringId: z.string().max(500).optional() }).strict()).max(500).optional(), unavailableSources: z.array(z.string().min(1).max(500)).max(100).optional(), sources: planningSources }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("schedule.create"), payload: z.object({ name: z.string().trim().min(1).max(120), mode: z.enum(["manual", "automatic"]), routineId: z.uuid().nullable().optional(), model: z.string().max(200).nullable().optional(), objective: z.string().trim().min(1).max(100_000), localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), timezone: z.string().min(1).max(200), missedPolicy: z.enum(["skip", "run-once", "review"]), enabled: z.boolean().optional() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("schedule.update"), payload: z.object({ scheduleId: z.uuid(), name: z.string().trim().min(1).max(120), mode: z.enum(["manual", "automatic"]), routineId: z.uuid().nullable().optional(), model: z.string().max(200).nullable().optional(), objective: z.string().trim().min(1).max(100_000), localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), timezone: z.string().min(1).max(200), missedPolicy: z.enum(["skip", "run-once", "review"]) }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("schedule.setEnabled"), payload: z.object({ scheduleId: z.uuid(), enabled: z.boolean() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("schedule.remove"), payload: z.object({ scheduleId: z.uuid() }).strict() }).strict(),
  z.object({ ...requestIdentity, operation: z.literal("schedule.tick"), payload: z.object({ now: z.iso.datetime().optional() }).strict() }).strict(),
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
  "MCP_STATE_CONFLICT",
  "SCHEDULE_STATE_CONFLICT",
  "AUTOMATION_STATE_CONFLICT",
  "VOICE_STATE_CONFLICT",
  "REMOTE_AUTH_FAILED",
  "REMOTE_UNAVAILABLE",
  "REMOTE_CONFLICT",
  "BACKUP_CONFLICT",
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
  z.object({ kind: z.literal("host.request"), requestId: z.uuid(), operation: z.enum(["browser.assign", "browser.list", "browser.action", "native.status", "native.action", "native.takeover"]), workspaceId: z.uuid(), taskId: z.uuid(), payload: z.record(z.string(), z.unknown()) }).strict(),
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
export type HostRequest = Extract<ServiceMessage, { kind: "host.request" }>;
export type HostResponse = { kind: "host.response"; requestId: string; ok: true; data: unknown } | { kind: "host.response"; requestId: string; ok: false; error: string };

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
  openRouterCredentialStatus: "voidra:secrets:openrouter-status",
  setOpenRouterCredential: "voidra:secrets:set-openrouter",
  deleteOpenRouterCredential: "voidra:secrets:delete-openrouter",
  mcpCredentialStatus: "voidra:secrets:mcp-status",
  setMcpCredential: "voidra:secrets:set-mcp",
  deleteMcpCredential: "voidra:secrets:delete-mcp",
  elevenLabsCredentialStatus: "voidra:secrets:elevenlabs-status",
  setElevenLabsCredential: "voidra:secrets:set-elevenlabs",
  deleteElevenLabsCredential: "voidra:secrets:delete-elevenlabs",
  testCrash: "voidra:test:service-crash",
  isolationProbe: "voidra:test:isolation-probe",
  testReadClipboard: "voidra:test:read-clipboard",
  testSetClipboard: "voidra:test:set-clipboard",
  browserList: "voidra:browser:list",
  browserCreate: "voidra:browser:create",
  browserClose: "voidra:browser:close",
  browserActivate: "voidra:browser:activate",
  browserBounds: "voidra:browser:bounds",
  browserNavigate: "voidra:browser:navigate",
  browserBack: "voidra:browser:back",
  browserForward: "voidra:browser:forward",
  browserReload: "voidra:browser:reload",
  browserAssign: "voidra:browser:assign",
  browserTakeover: "voidra:browser:takeover",
  browserResume: "voidra:browser:resume",
  browserAction: "voidra:browser:action",
  browserUpdated: "voidra:browser:updated",
  artifactList: "voidra:artifact:list",
  artifactCreate: "voidra:artifact:create",
  artifactRead: "voidra:artifact:read",
  artifactSave: "voidra:artifact:save",
  artifactPreview: "voidra:artifact:preview",
  artifactBounds: "voidra:artifact:bounds",
  artifactHide: "voidra:artifact:hide",
  artifactExport: "voidra:artifact:export",
} as const;

export function publicError(
  requestId: string,
  code: ErrorCode,
  message: string,
  retryable = false,
): ServiceResponse {
  return { requestId, ok: false, error: { code, message, retryable } };
}
