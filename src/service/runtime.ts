import { realpath, stat } from "node:fs/promises";
import { serviceRequestSchema, publicError, type ServiceRequest, type ServiceResponse } from "../shared/contracts";
import { z } from "zod";
import type { ServiceDatabase } from "./database";
import { ManualHandoffManager } from "./handoffs";
import { AgentTaskManager } from "./agents";
import { OpenRouterAdapter } from "./openrouter";
import { InstructionResolver } from "./instructions";
import { KnowledgeManager } from "./knowledge";
import { NoteCoordinator } from "./notes";
import { DomainError, WorkspaceManager } from "./workspaces";

export class ServiceRuntime {
  readonly #workspaces: WorkspaceManager;
  readonly #instructions = new InstructionResolver();
  readonly #notes = new NoteCoordinator();
  readonly #knowledge: KnowledgeManager;
  readonly #handoffs: ManualHandoffManager;
  readonly #agents: AgentTaskManager;

  constructor(private readonly database: ServiceDatabase) {
    this.#workspaces = new WorkspaceManager(database);
    this.#knowledge = new KnowledgeManager(database, this.#notes);
    this.#handoffs = new ManualHandoffManager(this.#workspaces, this.#instructions, this.#knowledge);
    this.#agents = new AgentTaskManager(new OpenRouterAdapter({
      baseUrl: process.env.VOIDRA_OPENROUTER_BASE_URL,
      apiKey: () => process.env.VOIDRA_OPENROUTER_TEST_KEY ?? process.env.OPENROUTER_API_KEY ?? null,
    }), {
      afterToolEffect: process.env.VOIDRA_E2E_AGENT_POST_EFFECT_DELAY_MS ? async () => { await new Promise((resolve) => setTimeout(resolve, Number(process.env.VOIDRA_E2E_AGENT_POST_EFFECT_DELAY_MS))); } : undefined,
    });
  }

  close() {
    this.#notes.close();
  }

  async handle(input: unknown): Promise<ServiceResponse> {
    const parsed = serviceRequestSchema.safeParse(input);
    const requestId = typeof input === "object" && input !== null && "requestId" in input && typeof input.requestId === "string"
      ? input.requestId
      : "00000000-0000-0000-0000-000000000000";

    if (!parsed.success) {
      return publicError(requestId, "INVALID_REQUEST", "The request did not match the service contract.");
    }

    try {
      return await this.#dispatch(parsed.data);
    } catch (error) {
      if (error instanceof DomainError) {
        return publicError(parsed.data.requestId, error.code, error.message, error.retryable);
      }
      if (error instanceof z.ZodError) {
        return publicError(parsed.data.requestId, "INVALID_REQUEST", "The settings payload did not match the supported schema.");
      }
      if (parsed.data.operation === "workspace.validateDirectory") {
        return publicError(parsed.data.requestId, "DIRECTORY_UNAVAILABLE", "The selected directory is unavailable or inaccessible.");
      }
      return publicError(parsed.data.requestId, "INTERNAL_ERROR", "The local service could not complete the request.", true);
    }
  }

  async #dispatch(request: ServiceRequest): Promise<ServiceResponse> {
    if (request.operation === "system.ping") {
      this.database.setMetadata("last_ping_workspace", request.workspaceId);
      return {
        requestId: request.requestId,
        ok: true,
        data: { service: "voidra-local", schemaVersion: 2, workspaceId: request.workspaceId },
      };
    }

    if (request.operation === "workspace.validateDirectory") {
      const canonicalPath = await realpath(request.payload.path);
      const details = await stat(canonicalPath);
      if (!details.isDirectory()) throw new Error("Not a directory");
      return { requestId: request.requestId, ok: true, data: { canonicalPath } };
    }

    if (request.operation === "workspace.list") {
      return { requestId: request.requestId, ok: true, data: await this.#workspaces.list() };
    }
    if (request.operation === "workspace.create") {
      const workspace = await this.#workspaces.create(request.payload.name, request.payload.path);
      return { requestId: request.requestId, ok: true, data: { workspace } };
    }
    if (request.operation === "workspace.open") {
      const workspace = await this.#workspaces.open(request.payload.path);
      return { requestId: request.requestId, ok: true, data: { workspace } };
    }
    if (request.operation === "workspace.select") {
      const workspace = this.#workspaces.select(request.payload.workspaceId);
      return { requestId: request.requestId, ok: true, data: { workspace } };
    }
    if (request.operation === "workspace.locate") {
      const workspace = await this.#workspaces.locate(request.payload.workspaceId, request.payload.path);
      return { requestId: request.requestId, ok: true, data: { workspace } };
    }
    if (request.operation === "workspace.remove") {
      this.#workspaces.remove(request.payload.workspaceId);
      return { requestId: request.requestId, ok: true, data: { removed: true } };
    }
    if (request.operation === "workspace.setPreferences") {
      this.#workspaces.setPreferences(request.payload);
      return { requestId: request.requestId, ok: true, data: await this.#workspaces.list() };
    }
    if (request.operation === "workspace.contextProbe") {
      const owningWorkspace = await this.#workspaces.requireAvailableWorkspace(request.workspaceId);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, request.payload.delayMs));
      return { requestId: request.requestId, ok: true, data: { workspaceId: owningWorkspace.id, workspaceName: owningWorkspace.name } };
    }
    if (request.operation === "settings.get") {
      return { requestId: request.requestId, ok: true, data: await this.#workspaces.getSettings(request.workspaceId) };
    }
    if (request.operation === "settings.updateGlobal") {
      this.#workspaces.updateGlobalSettings(request.payload.overrides);
      return { requestId: request.requestId, ok: true, data: await this.#workspaces.getSettings(request.workspaceId) };
    }
    if (request.operation === "settings.updateWorkspace") {
      return { requestId: request.requestId, ok: true, data: await this.#workspaces.updateWorkspaceSettings(request.workspaceId, request.payload.overrides) };
    }
    if (request.operation === "instructions.createScope") {
      const workspace = await this.#workspaces.requireAvailableWorkspace(request.workspaceId);
      return { requestId: request.requestId, ok: true, data: await this.#instructions.createScope(workspace.canonicalPath, request.payload.relativeDirectory, request.payload.content) };
    }
    if (request.operation === "instructions.resolve") {
      const workspace = await this.#workspaces.requireAvailableWorkspace(request.workspaceId);
      return { requestId: request.requestId, ok: true, data: { results: await this.#instructions.resolve(workspace.canonicalPath, request.payload.relativeTargets) } };
    }
    if (request.operation === "account.bindReference") {
      this.#workspaces.bindAccountReference(request.workspaceId, request.payload);
      return { requestId: request.requestId, ok: true, data: { bound: true } };
    }
    if (request.operation === "account.listReferences") {
      const references = this.#workspaces.listAccountReferences(request.workspaceId).map(({ accountId, provider }) => ({ accountId, provider, connected: true }));
      return { requestId: request.requestId, ok: true, data: { references } };
    }
    if (request.operation.startsWith("knowledge.") || request.operation.startsWith("memory.")) {
      const workspace = await this.#workspaces.requireAvailableWorkspace(request.workspaceId);
      if (request.operation === "knowledge.attach") return { requestId: request.requestId, ok: true, data: await this.#knowledge.attach(workspace, request.payload) };
      if (request.operation === "knowledge.listAttachments") return { requestId: request.requestId, ok: true, data: { attachments: await this.#knowledge.list(workspace.id) } };
      if (request.operation === "knowledge.setAccess") return { requestId: request.requestId, ok: true, data: await this.#knowledge.setAccess(workspace.id, request.payload.baseId, request.payload.access) };
      if (request.operation === "knowledge.detach") return { requestId: request.requestId, ok: true, data: this.#knowledge.detach(workspace.id, request.payload.baseId) };
      if (request.operation === "knowledge.locate") return { requestId: request.requestId, ok: true, data: await this.#knowledge.locate(workspace.id, request.payload.baseId, request.payload.path) };
      if (request.operation === "knowledge.search") return { requestId: request.requestId, ok: true, data: { results: await this.#knowledge.search(workspace, request.payload.query, request.payload.tag, request.payload.delayMs) } };
      if (request.operation === "knowledge.read") return { requestId: request.requestId, ok: true, data: await this.#knowledge.read(workspace, request.payload.baseId, request.payload.documentId) };
      if (request.operation === "knowledge.create") return { requestId: request.requestId, ok: true, data: await this.#knowledge.create(workspace.id, request.payload.baseId, request.payload.path, request.payload.content) };
      if (request.operation === "knowledge.save") return { requestId: request.requestId, ok: true, data: await this.#knowledge.save(workspace.id, request.payload.baseId, request.payload.documentId, request.payload.content, request.payload.expectedRevision) };
      if (request.operation === "knowledge.graph") return { requestId: request.requestId, ok: true, data: await this.#knowledge.graph(workspace, request.payload) };
      if (request.operation === "memory.list") return { requestId: request.requestId, ok: true, data: { memories: await this.#knowledge.listMemories(workspace, request.payload.includeExpired) } };
      if (request.operation === "memory.create") return { requestId: request.requestId, ok: true, data: await this.#knowledge.createMemory(workspace, request.payload) };
      if (request.operation === "memory.update") return { requestId: request.requestId, ok: true, data: await this.#knowledge.updateMemory(workspace, request.payload.memoryId, request.payload) };
      if (request.operation === "memory.delete") return { requestId: request.requestId, ok: true, data: await this.#knowledge.deleteMemory(workspace, request.payload.memoryId) };
      if (request.operation === "memory.context") return { requestId: request.requestId, ok: true, data: { memories: await this.#knowledge.memoryContext(workspace, request.payload.query) } };
    }
    if (request.operation.startsWith("skill.") || request.operation.startsWith("routine.") || request.operation.startsWith("handoff.")) {
      const workspace = await this.#workspaces.requireAvailableWorkspace(request.workspaceId);
      if (request.operation === "skill.list") return { requestId: request.requestId, ok: true, data: { skills: await this.#handoffs.listSkills(workspace) } };
      if (request.operation === "skill.create") return { requestId: request.requestId, ok: true, data: await this.#handoffs.createSkill(workspace, request.payload) };
      if (request.operation === "skill.update") return { requestId: request.requestId, ok: true, data: await this.#handoffs.updateSkill(workspace, request.payload.skillId, request.payload) };
      if (request.operation === "skill.duplicate") return { requestId: request.requestId, ok: true, data: await this.#handoffs.duplicateSkill(workspace, request.payload.skillId, request.payload.name) };
      if (request.operation === "routine.list") return { requestId: request.requestId, ok: true, data: { routines: await this.#handoffs.listRoutines(workspace) } };
      if (request.operation === "routine.create") return { requestId: request.requestId, ok: true, data: await this.#handoffs.createRoutine(workspace, request.payload) };
      if (request.operation === "routine.duplicate") return { requestId: request.requestId, ok: true, data: await this.#handoffs.duplicateRoutine(workspace, request.payload.routineId, request.payload) };
      if (request.operation === "handoff.list") return { requestId: request.requestId, ok: true, data: { runs: await this.#handoffs.listRuns(workspace) } };
      if (request.operation === "handoff.compile") return { requestId: request.requestId, ok: true, data: await this.#handoffs.compile(workspace, request.payload) };
      if (request.operation === "handoff.prepareScheduled") return { requestId: request.requestId, ok: true, data: await this.#handoffs.compile(workspace, { ...request.payload, trigger: "scheduled" }) };
      if (request.operation === "handoff.updatePrompt") return { requestId: request.requestId, ok: true, data: await this.#handoffs.updatePrompt(workspace, request.payload.runId, request.payload.prompt) };
      if (request.operation === "handoff.markCopied") return { requestId: request.requestId, ok: true, data: await this.#handoffs.markCopied(workspace, request.payload.runId) };
      if (request.operation === "handoff.previewResult") return { requestId: request.requestId, ok: true, data: await this.#handoffs.previewResult(workspace, request.payload.runId, request.payload.resultText, request.payload.outputPath, request.payload.outputContent) };
      if (request.operation === "handoff.applyResult") return { requestId: request.requestId, ok: true, data: await this.#handoffs.applyResult(workspace, request.payload.runId) };
      if (request.operation === "handoff.complete") return { requestId: request.requestId, ok: true, data: await this.#handoffs.complete(workspace, request.payload.runId) };
      if (request.operation === "handoff.cancel") return { requestId: request.requestId, ok: true, data: await this.#handoffs.cancel(workspace, request.payload.runId) };
    }
    if (request.operation.startsWith("agent.")) {
      const workspace = await this.#workspaces.requireAvailableWorkspace(request.workspaceId);
      if (request.operation === "agent.list") return { requestId: request.requestId, ok: true, data: await this.#agents.list(workspace) };
      if (request.operation === "agent.start") return { requestId: request.requestId, ok: true, data: await this.#agents.start(workspace, request.payload) };
      if (request.operation === "agent.approve") return { requestId: request.requestId, ok: true, data: await this.#agents.approve(workspace, request.payload.taskId, request.payload.expiresAt) };
      if (request.operation === "agent.cancel") return { requestId: request.requestId, ok: true, data: await this.#agents.cancel(workspace, request.payload.taskId) };
      if (request.operation === "agent.revokeGrant") return { requestId: request.requestId, ok: true, data: await this.#agents.revoke(workspace, request.payload.grantId) };
    }
    if (request.operation.startsWith("notes.")) {
      const workspace = await this.#workspaces.requireAvailableWorkspace(request.workspaceId);
      if (request.operation === "notes.indexStatus") return { requestId: request.requestId, ok: true, data: this.#notes.status(workspace.id) };
      return this.#notes.run(workspace, async (notes) => {
        if (request.operation === "notes.list") return { requestId: request.requestId, ok: true, data: { documents: await notes.list() } };
        if (request.operation === "notes.create") return { requestId: request.requestId, ok: true, data: await notes.create(request.payload.path, request.payload.content) };
        if (request.operation === "notes.read") return { requestId: request.requestId, ok: true, data: await notes.read(request.payload.documentId) };
        if (request.operation === "notes.save") return { requestId: request.requestId, ok: true, data: await notes.save(request.payload.documentId, request.payload.content, request.payload.expectedRevision) };
        if (request.operation === "notes.resolveConflict") return { requestId: request.requestId, ok: true, data: await notes.resolveConflict(request.payload.documentId, request.payload.strategy, request.payload.expectedDiskRevision, request.payload.editorContent, request.payload.mergedContent) };
        if (request.operation === "notes.rename") return { requestId: request.requestId, ok: true, data: await notes.rename(request.payload.documentId, request.payload.newPath) };
        if (request.operation === "notes.search") return { requestId: request.requestId, ok: true, data: { results: await notes.search(request.payload.query, request.payload.tag) } };
        if (request.operation === "notes.backlinks") return { requestId: request.requestId, ok: true, data: { backlinks: await notes.backlinks(request.payload.documentId) } };
        if (request.operation === "notes.history") return { requestId: request.requestId, ok: true, data: { revisions: await notes.history(request.payload.documentId) } };
        if (request.operation === "notes.restore") return { requestId: request.requestId, ok: true, data: await notes.restore(request.payload.documentId, request.payload.revisionId) };
        if (request.operation === "notes.rebuildIndex") return { requestId: request.requestId, ok: true, data: await notes.rebuildIndex() };
        throw new Error("Unhandled note operation after contract validation.");
      });
    }

    throw new Error("Unhandled service request after contract validation.");
  }
}
