import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import { z } from "zod";
import type { WorkspaceRecord } from "./database";
import { OpenRouterAdapter, ProviderError, type ProviderUsage } from "./openrouter";
import { DomainError } from "./workspaces";

const grantSchema = z.object({ id: z.uuid(), workspaceId: z.uuid(), tool: z.enum(["read_file", "write_file", "mcp_call"]), pathPrefix: z.string(), expiresAt: z.iso.datetime().nullable(), revokedAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime() }).strict();
const eventSchema = z.object({ sequence: z.number().int().positive(), type: z.string(), at: z.iso.datetime(), data: z.record(z.string(), z.unknown()) }).strict();
const toolSchema = z.object({ id: z.string(), name: z.enum(["read_file", "write_file", "mcp_call"]), argumentsText: z.string(), state: z.enum(["requested", "authorized", "started", "observed-result", "denied", "uncertain"]), result: z.string().nullable() }).strict();
const taskSchema = z.object({
  id: z.uuid(), workspaceId: z.uuid(), objective: z.string(), model: z.string(), status: z.enum(["queued", "running", "awaiting-approval", "cancelling", "cancelled", "completed", "failed", "interrupted"]),
  maxSteps: z.number().int().positive(), maxTokens: z.number().int().positive().default(50_000), maxRuntimeMs: z.number().int().positive().default(300_000), runtimeMs: z.number().int().nonnegative().default(0), step: z.number().int().nonnegative(), output: z.string(), usage: z.object({ promptTokens: z.number(), completionTokens: z.number(), totalTokens: z.number() }).strict(),
  targetPaths: z.array(z.string()).default([]), sources: z.array(z.object({ baseId: z.string(), documentId: z.string() }).strict()).default([]), contextManifest: z.array(z.object({ label: z.string(), revision: z.string() }).strict()).default([]),
  messages: z.array(z.record(z.string(), z.unknown())), events: z.array(eventSchema), pendingTool: toolSchema.nullable(), error: z.string().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
const registrySchema = z.object({ schemaVersion: z.literal(1), grants: z.array(grantSchema), tasks: z.array(taskSchema) }).strict();
type Registry = z.infer<typeof registrySchema>;
type Task = z.infer<typeof taskSchema>;
type Tool = z.infer<typeof toolSchema>;

function json(value: unknown) { return `${JSON.stringify(value, null, 2)}\n`; }
function emptyUsage(): ProviderUsage { return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }; }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function atomicWrite(path: string, content: string) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try { await rename(temporary, path); } catch (error) { await rm(temporary, { force: true }); throw error; }
}

export class AgentTaskManager {
  readonly #controllers = new Map<string, AbortController>();
  readonly #registries = new Map<string, Registry>();
  readonly #saveQueues = new Map<string, Promise<void>>();
  readonly #workspaceRecords = new Map<string, WorkspaceRecord>();

  constructor(private readonly provider: OpenRouterAdapter, private readonly options: {
    afterToolEffect?: (task: Task, tool: Tool) => Promise<void>;
    buildContext?: (workspace: WorkspaceRecord, input: { objective: string; targetPaths: string[]; sources: Array<{ baseId: string; documentId: string }> }) => Promise<{ prompt: string; manifest: Array<{ label: string; revision: string }> }>;
    listMcpTools?: (workspace: WorkspaceRecord) => Promise<Array<{ connectionId: string; connectionName: string; name: string; description: string; inputSchema: Record<string, unknown> }>>;
    callMcpTool?: (workspace: WorkspaceRecord, connectionId: string, name: string, args: Record<string, unknown>) => Promise<unknown>;
    retryDelayMs?: number;
  } = {}) {}

  async list(workspace: WorkspaceRecord) {
    const registry = await this.#registry(workspace);
    const now = new Date().toISOString();
    return { tasks: [...registry.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), grants: registry.grants.filter(({ revokedAt, expiresAt }) => !revokedAt && (!expiresAt || expiresAt > now)) };
  }

  async start(workspace: WorkspaceRecord, input: { objective: string; model: string; maxSteps: number; maxTokens?: number; maxRuntimeMs?: number; targetPaths?: string[]; sources?: Array<{ baseId: string; documentId: string }> }) {
    const registry = await this.#registry(workspace);
    const now = new Date().toISOString();
    const task: Task = { id: randomUUID(), workspaceId: workspace.id, objective: input.objective, model: input.model, status: "queued", maxSteps: input.maxSteps, maxTokens: input.maxTokens ?? 50_000, maxRuntimeMs: input.maxRuntimeMs ?? 300_000, runtimeMs: 0, step: 0, output: "", usage: emptyUsage(), targetPaths: input.targetPaths ?? [], sources: input.sources ?? [], contextManifest: [], messages: [{ role: "user", content: input.objective }], events: [], pendingTool: null, error: null, createdAt: now, updatedAt: now };
    registry.tasks.push(task);
    this.#event(task, "task.queued", { model: task.model, maxSteps: task.maxSteps });
    await this.#save(workspace, registry);
    return this.#run(workspace, registry, task);
  }

  async approve(workspace: WorkspaceRecord, taskId: string, expiresAt?: string | null) {
    const registry = await this.#registry(workspace);
    const task = this.#task(registry, workspace.id, taskId);
    if (task.status !== "awaiting-approval" || !task.pendingTool) throw new DomainError("AGENT_STATE_CONFLICT", "This task has no action awaiting approval.");
    const args = this.#arguments(task.pendingTool);
    const scope = this.#scope(task.pendingTool, args);
    if (task.pendingTool.name !== "mcp_call") await this.#safePath(workspace, scope, task.pendingTool.name === "write_file");
    const grant = { id: randomUUID(), workspaceId: workspace.id, tool: task.pendingTool.name, pathPrefix: scope, expiresAt: expiresAt ?? null, revokedAt: null, createdAt: new Date().toISOString() } as const;
    registry.grants.push(grant);
    this.#event(task, "grant.created", { grantId: grant.id, tool: grant.tool, pathPrefix: grant.pathPrefix });
    await this.#save(workspace, registry);
    return this.#run(workspace, registry, task);
  }

  async revoke(workspace: WorkspaceRecord, grantId: string) {
    const registry = await this.#registry(workspace);
    const grant = registry.grants.find(({ id, workspaceId }) => id === grantId && workspaceId === workspace.id);
    if (!grant) throw new DomainError("WORKSPACE_CONFLICT", "The grant does not exist in this workspace.");
    grant.revokedAt = new Date().toISOString();
    await this.#save(workspace, registry);
    return grant;
  }

  async resume(workspace: WorkspaceRecord, taskId: string) {
    const registry = await this.#registry(workspace);
    const task = this.#task(registry, workspace.id, taskId);
    const lastEvent = task.events.at(-1);
    if (task.status !== "interrupted" || lastEvent?.type !== "task.interrupted") throw new DomainError("AGENT_STATE_CONFLICT", "Only a safely interrupted service task can resume.");
    if (task.pendingTool?.state === "uncertain") throw new DomainError("AGENT_STATE_CONFLICT", "Reconcile the uncertain tool effect before starting another action.");
    task.error = null;
    this.#event(task, "task.resumed", { fromSequence: lastEvent.sequence });
    await this.#save(workspace, registry);
    return this.#run(workspace, registry, task);
  }

  async stopAll() {
    const stopped: string[] = [];
    for (const [workspaceId, registry] of this.#registries) {
      const workspace = this.#workspaceRecords.get(workspaceId);
      if (!workspace) continue;
      for (const task of registry.tasks) {
        if (["running", "queued", "awaiting-approval", "cancelling"].includes(task.status)) {
          task.status = "cancelled";
          task.error = null;
          this.#event(task, "task.cancelled", { reason: "stop-all" });
          this.#controllers.get(task.id)?.abort();
          stopped.push(task.id);
        }
      }
      await this.#save(workspace, registry);
    }
    return { stopped };
  }

  async cancel(workspace: WorkspaceRecord, taskId: string) {
    const registry = await this.#registry(workspace);
    const task = this.#task(registry, workspace.id, taskId);
    if (["completed", "failed", "cancelled"].includes(task.status)) throw new DomainError("AGENT_STATE_CONFLICT", "The task is already finished.");
    task.status = "cancelling";
    this.#event(task, "task.cancelling", {});
    await this.#save(workspace, registry);
    this.#controllers.get(task.id)?.abort();
    if (!this.#controllers.has(task.id)) {
      task.status = "cancelled";
      this.#event(task, "task.cancelled", {});
      await this.#save(workspace, registry);
    }
    return task;
  }

  async #run(workspace: WorkspaceRecord, registry: Registry, task: Task): Promise<Task> {
    if (task.status === "cancelling" || task.status === "cancelled") return task;
    const controller = new AbortController();
    const startedAt = Date.now();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(0, task.maxRuntimeMs - task.runtimeMs));
    this.#controllers.set(task.id, controller);
    task.status = "running";
    this.#event(task, "task.running", { step: task.step });
    await this.#save(workspace, registry);
    try {
      if (task.pendingTool) {
        const result = await this.#executeTool(workspace, registry, task, task.pendingTool);
        if (!result) return task;
      }
      while (task.step < task.maxSteps) {
        if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        task.step += 1;
        task.messages = task.messages.filter((message) => message.role !== "system");
        if (this.options.buildContext) {
          const context = await this.options.buildContext(workspace, { objective: task.objective, targetPaths: task.targetPaths, sources: task.sources });
          task.messages.unshift({ role: "system", content: context.prompt });
          task.contextManifest = context.manifest;
          this.#event(task, "context.resolved", { sources: context.manifest, targetPaths: task.targetPaths });
        }
        const outputLength = task.output.length;
        let attempt = 0;
        let result;
        while (true) {
          try {
            result = await this.provider.chat({ model: task.model, messages: task.messages, tools: await this.#tools(workspace), signal: controller.signal, onText: (delta) => { task.output += delta; this.#event(task, "provider.text", { delta }); } });
            break;
          } catch (error) {
            if (!(error instanceof ProviderError) || !error.retryable || attempt >= 2 || task.output.length !== outputLength || controller.signal.aborted) throw error;
            attempt += 1;
            this.#event(task, "provider.retry", { attempt, category: error.category });
            await this.#save(workspace, registry);
            await new Promise<void>((resolveDelay, rejectDelay) => {
              const timer = setTimeout(resolveDelay, this.options.retryDelayMs ?? 250);
              controller.signal.addEventListener("abort", () => { clearTimeout(timer); rejectDelay(new DOMException("Cancelled", "AbortError")); }, { once: true });
            });
          }
        }
        if (result.usage) task.usage = { promptTokens: task.usage.promptTokens + result.usage.promptTokens, completionTokens: task.usage.completionTokens + result.usage.completionTokens, totalTokens: task.usage.totalTokens + result.usage.totalTokens };
        task.messages.push({ role: "assistant", content: result.text, ...(result.toolCalls.length ? { tool_calls: result.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.argumentsText } })) } : {}) });
        this.#event(task, "provider.finished", { model: result.model || task.model, finishReason: result.finishReason, usage: result.usage });
        await this.#save(workspace, registry);
        if (task.usage.totalTokens > task.maxTokens) {
          task.status = "interrupted";
          task.error = `Token budget ${task.maxTokens} exceeded.`;
          this.#event(task, "task.limited", { maxTokens: task.maxTokens, totalTokens: task.usage.totalTokens });
          await this.#save(workspace, registry);
          return task;
        }
        if (!result.toolCalls.length) {
          task.status = "completed";
          this.#event(task, "task.completed", { steps: task.step });
          await this.#save(workspace, registry);
          return task;
        }
        const requested = result.toolCalls[0]!;
        if (requested.name !== "read_file" && requested.name !== "write_file" && requested.name !== "mcp_call") throw new ProviderError("malformed", "The model requested an unknown tool.", false);
        const tool: Tool = { id: requested.id, name: requested.name, argumentsText: requested.argumentsText, state: "requested", result: null };
        task.pendingTool = tool;
        this.#event(task, "tool.requested", { toolId: tool.id, name: tool.name, argumentsText: tool.argumentsText });
        await this.#save(workspace, registry);
        const executed = await this.#executeTool(workspace, registry, task, tool);
        if (!executed) return task;
      }
      task.status = "interrupted";
      task.error = `Step limit ${task.maxSteps} reached.`;
      this.#event(task, "task.limited", { maxSteps: task.maxSteps });
      await this.#save(workspace, registry);
      return task;
    } catch (error) {
      if (timedOut) {
        task.status = "interrupted";
        task.error = `Runtime limit ${task.maxRuntimeMs} ms reached.`;
        this.#event(task, "task.limited", { maxRuntimeMs: task.maxRuntimeMs, runtimeMs: task.runtimeMs + Date.now() - startedAt });
      } else if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        task.status = "cancelled";
        task.error = null;
        this.#event(task, "task.cancelled", {});
      } else {
        task.status = "failed";
        task.error = error instanceof ProviderError || error instanceof DomainError ? error.message : "The automatic task failed locally.";
        this.#event(task, "task.failed", { category: error instanceof ProviderError ? error.category : error instanceof DomainError ? error.code : "local", retryable: error instanceof ProviderError && error.retryable });
      }
      await this.#save(workspace, registry);
      return task;
    } finally {
      clearTimeout(timeout);
      task.runtimeMs += Date.now() - startedAt;
      this.#controllers.delete(task.id);
      await this.#save(workspace, registry);
    }
  }

  async #executeTool(workspace: WorkspaceRecord, registry: Registry, task: Task, tool: Tool) {
    const args = this.#arguments(tool);
    const relativePath = this.#scope(tool, args);
    const grant = registry.grants.find((candidate) => candidate.workspaceId === workspace.id && candidate.tool === tool.name && !candidate.revokedAt && (!candidate.expiresAt || candidate.expiresAt > new Date().toISOString()) && (relativePath === candidate.pathPrefix || (tool.name !== "mcp_call" && relativePath.startsWith(`${candidate.pathPrefix.replace(/\/$/, "")}/`))));
    if (!grant) {
      task.status = "awaiting-approval";
      tool.state = "requested";
      this.#event(task, "tool.awaiting-approval", { toolId: tool.id, name: tool.name, path: relativePath });
      await this.#save(workspace, registry);
      return false;
    }
    tool.state = "authorized";
    this.#event(task, "tool.authorized", { toolId: tool.id, grantId: grant.id });
    const absolute = tool.name === "mcp_call" ? null : await this.#safePath(workspace, relativePath, tool.name === "write_file");
    tool.state = "started";
    this.#event(task, "tool.started", { toolId: tool.id, name: tool.name, path: relativePath });
    await this.#save(workspace, registry);
    let result: string;
    if (tool.name === "read_file") result = await readFile(absolute!, "utf8");
    else if (tool.name === "write_file") {
      const content = String(args.content ?? "");
      await atomicWrite(absolute!, content);
      await this.options.afterToolEffect?.(task, tool);
      result = JSON.stringify({ path: relativePath, bytes: Buffer.byteLength(content), sha256: hash(content) });
    } else {
      if (!this.options.callMcpTool) throw new DomainError("MCP_STATE_CONFLICT", "MCP tools are unavailable.");
      try { result = JSON.stringify(await this.options.callMcpTool(workspace, String(args.connectionId ?? ""), String(args.tool ?? ""), (args.arguments && typeof args.arguments === "object" ? args.arguments : {}) as Record<string, unknown>)); }
      catch (error) {
        if (error instanceof DomainError) throw error;
        tool.state = "uncertain";
        task.status = "interrupted";
        task.error = "The MCP tool outcome is uncertain; reconcile it before resuming.";
        this.#event(task, "tool.uncertain", { toolId: tool.id, name: tool.name, scope: relativePath });
        await this.#save(workspace, registry);
        return false;
      }
    }
    tool.state = "observed-result";
    tool.result = result;
    task.pendingTool = null;
    task.messages.push({ role: "tool", tool_call_id: tool.id, content: result });
    this.#event(task, "tool.observed-result", { toolId: tool.id, result: tool.name === "read_file" ? `[${Buffer.byteLength(result)} bytes read]` : tool.name === "mcp_call" ? "[MCP result recorded]" : result });
    await this.#save(workspace, registry);
    return true;
  }

  #arguments(tool: Tool) {
    try { const value = JSON.parse(tool.argumentsText); if (!value || typeof value !== "object") throw new Error(); return value as Record<string, unknown>; }
    catch { throw new ProviderError("malformed", "The model supplied invalid tool arguments; no action ran.", false); }
  }

  #scope(tool: Tool, args: Record<string, unknown>) {
    if (tool.name !== "mcp_call") return String(args.path ?? "");
    const toolArguments = args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments) ? args.arguments : {};
    return `${String(args.connectionId ?? "")}:${String(args.tool ?? "")}:${hash(JSON.stringify(toolArguments))}`;
  }

  async #safePath(workspace: WorkspaceRecord, relativePath: string, createParent: boolean) {
    if (!relativePath || isAbsolute(relativePath)) throw new DomainError("WORKSPACE_CONFLICT", "Tool paths must be relative to the task workspace.");
    const normalized = posix.normalize(relativePath);
    if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith(".voidra/")) throw new DomainError("WORKSPACE_CONFLICT", "The tool path escapes its workspace grant.");
    const absolute = resolve(workspace.canonicalPath, ...normalized.split("/"));
    let ancestor = createParent ? dirname(absolute) : absolute;
    while (true) {
      try { ancestor = await realpath(ancestor); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || ancestor === workspace.canonicalPath) throw new DomainError("WORKSPACE_CONFLICT", "The granted tool path is unavailable.");
        ancestor = dirname(ancestor);
      }
    }
    if (ancestor !== workspace.canonicalPath && !ancestor.startsWith(`${workspace.canonicalPath}${sep}`)) throw new DomainError("WORKSPACE_CONFLICT", "The tool path escapes its workspace grant.");
    if (createParent) {
      await mkdir(dirname(absolute), { recursive: true });
      const parent = await realpath(dirname(absolute));
      if (parent !== workspace.canonicalPath && !parent.startsWith(`${workspace.canonicalPath}${sep}`)) throw new DomainError("WORKSPACE_CONFLICT", "The tool path escapes its workspace grant.");
    } else if (!(await stat(ancestor)).isFile()) throw new DomainError("WORKSPACE_CONFLICT", "The granted read target is not a file.");
    return absolute;
  }

  async #tools(workspace: WorkspaceRecord) {
    const tools: Array<Record<string, unknown>> = [
    { type: "function", function: { name: "read_file", description: "Read a UTF-8 file within the task workspace after authorization.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } } },
    { type: "function", function: { name: "write_file", description: "Atomically write a UTF-8 file within the task workspace after authorization.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } } },
    ];
    const mcpTools = await this.options.listMcpTools?.(workspace) ?? [];
    if (mcpTools.length) tools.push({ type: "function", function: { name: "mcp_call", description: `Call one connected workspace MCP tool after authorization. Available tools: ${mcpTools.map((entry) => `${entry.connectionName} (${entry.connectionId}) / ${entry.name}: ${entry.description}`).join("; ")}`, parameters: { type: "object", properties: { connectionId: { type: "string", enum: [...new Set(mcpTools.map(({ connectionId }) => connectionId))] }, tool: { type: "string", enum: [...new Set(mcpTools.map(({ name }) => name))] }, arguments: { type: "object" } }, required: ["connectionId", "tool", "arguments"], additionalProperties: false } } });
    return tools;
  }

  #task(registry: Registry, workspaceId: string, taskId: string) {
    const task = registry.tasks.find(({ id, workspaceId: owner }) => id === taskId && owner === workspaceId);
    if (!task) throw new DomainError("WORKSPACE_CONFLICT", "The automatic task does not exist in this workspace.");
    return task;
  }

  #event(task: Task, type: string, data: Record<string, unknown>) { task.events.push({ sequence: task.events.length + 1, type, at: new Date().toISOString(), data }); task.updatedAt = new Date().toISOString(); }
  #path(workspace: WorkspaceRecord) { return join(workspace.canonicalPath, ".voidra", "agent-runtime.json"); }

  async #registry(workspace: WorkspaceRecord) {
    this.#workspaceRecords.set(workspace.id, workspace);
    const cached = this.#registries.get(workspace.id);
    if (cached) return cached;
    let registry: Registry;
    try { registry = registrySchema.parse(JSON.parse(await readFile(this.#path(workspace), "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new DomainError("INCOMPATIBLE_SCHEMA", "Agent runtime metadata requires recovery.");
      registry = { schemaVersion: 1, grants: [], tasks: [] };
    }
    for (const task of registry.tasks) if (task.status === "running" || task.status === "cancelling") {
      task.status = "interrupted";
      task.error = task.pendingTool?.state === "started" ? "A tool effect may have committed before restart; reconcile it before resuming." : "The service stopped before the task reached a terminal state.";
      if (task.pendingTool?.state === "started") task.pendingTool.state = "uncertain";
      this.#event(task, "task.interrupted", { reconciliationRequired: task.pendingTool?.state === "uncertain" });
    }
    this.#registries.set(workspace.id, registry);
    await this.#save(workspace, registry);
    return registry;
  }

  async #save(workspace: WorkspaceRecord, registry: Registry) {
    const previous = this.#saveQueues.get(workspace.id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => atomicWrite(this.#path(workspace), json(registry)));
    this.#saveQueues.set(workspace.id, current);
    await current;
    if (this.#saveQueues.get(workspace.id) === current) this.#saveQueues.delete(workspace.id);
  }
}
