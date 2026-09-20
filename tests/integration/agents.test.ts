import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentTaskManager } from "../../src/service/agents";
import { ServiceDatabase } from "../../src/service/database";
import { OpenRouterAdapter } from "../../src/service/openrouter";
import { WorkspaceManager } from "../../src/service/workspaces";

const temporaryDirectories: string[] = [];

function response(lines: unknown[]) {
  const body = lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function tool(name: "read_file" | "write_file" | "mcp_call", args: Record<string, unknown>) {
  return response([{ model: "fixture/model", choices: [{ delta: { tool_calls: [{ index: 0, id: "tool-1", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }] }]);
}

function complete(text = "Completed") {
  return response([{ model: "fixture/model", choices: [{ delta: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }]);
}

async function fixture(fetchImpl: typeof fetch, key = "fixture-key") {
  const directory = await mkdtemp(join(tmpdir(), "voidra-agents-"));
  temporaryDirectories.push(directory);
  const database = new ServiceDatabase(join(directory, "state.sqlite"));
  const workspaces = new WorkspaceManager(database);
  const workRoot = join(directory, "Work");
  const personalRoot = join(directory, "Personal");
  await Promise.all([mkdir(workRoot), mkdir(personalRoot)]);
  const work = await workspaces.create("Work", workRoot);
  const personal = await workspaces.create("Personal", personalRoot);
  const manager = new AgentTaskManager(new OpenRouterAdapter({ baseUrl: "http://fixture", apiKey: () => key || null, fetch: fetchImpl }));
  return { directory, database, work, personal, manager };
}

afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("AgentTaskManager", () => {
  it("records an actionable missing-key failure without changing manual handoff state", async () => {
    const { database, work, manager } = await fixture(vi.fn() as typeof fetch, "");
    const task = await manager.start(work, { objective: "Automatic task", model: "fixture/model", maxSteps: 3 });
    expect(task).toMatchObject({ status: "failed", error: expect.stringContaining("OpenRouter API key") });
    expect(task.events.map(({ type }) => type)).toEqual(["task.queued", "task.running", "task.failed"]);
    database.close();
  });

  it("requires approval, records one observed write, and reuses then revokes the exact grant", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(tool("write_file", { path: "outputs/result.md", content: "first" }))
      .mockResolvedValueOnce(complete("Done once"))
      .mockResolvedValueOnce(tool("write_file", { path: "outputs/result.md", content: "second" }))
      .mockResolvedValueOnce(complete("Done twice"))
      .mockResolvedValueOnce(tool("write_file", { path: "outputs/result.md", content: "third" }));
    const { database, work, manager } = await fixture(fetchImpl as typeof fetch);
    const first = await manager.start(work, { objective: "Write result", model: "fixture/model", maxSteps: 4 });
    expect(first).toMatchObject({ status: "awaiting-approval", pendingTool: { state: "requested", name: "write_file" } });
    const completed = await manager.approve(work, first.id);
    expect(completed).toMatchObject({ status: "completed", output: "Done once" });
    expect(await readFile(join(work.canonicalPath, "outputs", "result.md"), "utf8")).toBe("first");
    expect(completed.events.filter(({ type }) => type === "tool.started")).toHaveLength(1);
    expect(completed.events.filter(({ type }) => type === "tool.observed-result")).toHaveLength(1);

    const second = await manager.start(work, { objective: "Update result", model: "fixture/model", maxSteps: 4 });
    expect(second.status).toBe("completed");
    expect(await readFile(join(work.canonicalPath, "outputs", "result.md"), "utf8")).toBe("second");
    const grant = (await manager.list(work)).grants[0]!;
    await manager.revoke(work, grant.id);
    const third = await manager.start(work, { objective: "Try after revoke", model: "fixture/model", maxSteps: 4 });
    expect(third.status).toBe("awaiting-approval");
    expect(await readFile(join(work.canonicalPath, "outputs", "result.md"), "utf8")).toBe("second");
    database.close();
  });

  it("keeps task and grant ownership separate between workspaces", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(tool("write_file", { path: "same.md", content: "work" })).mockResolvedValueOnce(complete()).mockResolvedValueOnce(tool("write_file", { path: "same.md", content: "personal" }));
    const { database, work, personal, manager } = await fixture(fetchImpl as typeof fetch);
    const workTask = await manager.start(work, { objective: "Work", model: "fixture/model", maxSteps: 3 });
    await manager.approve(work, workTask.id);
    const personalTask = await manager.start(personal, { objective: "Personal", model: "fixture/model", maxSteps: 3 });
    expect(personalTask.status).toBe("awaiting-approval");
    expect((await manager.list(personal)).grants).toEqual([]);
    expect((await manager.list(work)).tasks).toEqual([expect.objectContaining({ workspaceId: work.id, status: "completed" })]);
    database.close();
  });

  it("rejects traversal after approval and records a failed task without an effect", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(tool("write_file", { path: "../escape.md", content: "bad" }));
    const { directory, database, work, manager } = await fixture(fetchImpl as typeof fetch);
    const task = await manager.start(work, { objective: "Escape", model: "fixture/model", maxSteps: 2 });
    await expect(manager.approve(work, task.id)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    expect((await manager.list(work)).grants).toEqual([]);
    await expect(readFile(join(directory, "escape.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    database.close();
  });

  it("cancels an in-flight provider stream and persists cancellation", async () => {
    const fetchImpl = vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
    }));
    const { database, work, manager } = await fixture(fetchImpl as typeof fetch);
    const pending = manager.start(work, { objective: "Wait", model: "fixture/model", maxSteps: 3 });
    while (fetchImpl.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const id = (await manager.list(work)).tasks[0]!.id;
    await manager.cancel(work, id);
    expect(await pending).toMatchObject({ status: "cancelled" });
    expect((await manager.list(work)).tasks[0]).toMatchObject({ status: "cancelled" });
    database.close();
  });

  it("cancels a pending action without an effect and does not reuse an expired grant", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(tool("write_file", { path: "pending.md", content: "cancelled" }))
      .mockResolvedValueOnce(tool("write_file", { path: "expired.md", content: "blocked" }));
    const { database, work, manager } = await fixture(fetchImpl as typeof fetch);
    const pending = await manager.start(work, { objective: "Cancel pending", model: "fixture/model", maxSteps: 2 });
    expect((await manager.cancel(work, pending.id)).status).toBe("cancelled");
    await expect(readFile(join(work.canonicalPath, "pending.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const expired = await manager.start(work, { objective: "Expired approval", model: "fixture/model", maxSteps: 2 });
    const stillPending = await manager.approve(work, expired.id, "2000-01-01T00:00:00.000Z");
    expect(stillPending.status).toBe("awaiting-approval");
    expect((await manager.list(work)).grants).toEqual([]);
    await expect(readFile(join(work.canonicalPath, "expired.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    database.close();
  });

  it("stops active tasks across loaded workspaces and ignores finished tasks", async () => {
    const fetchImpl = vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
    }));
    const { database, work, personal, manager } = await fixture(fetchImpl as typeof fetch);
    const workPending = manager.start(work, { objective: "Wait in Work", model: "fixture/model", maxSteps: 3 });
    const personalPending = manager.start(personal, { objective: "Wait in Personal", model: "fixture/model", maxSteps: 3 });
    while (fetchImpl.mock.calls.length < 2) await new Promise((resolve) => setTimeout(resolve, 1));

    const stopped = await manager.stopAll();
    const [workTask, personalTask] = await Promise.all([workPending, personalPending]);
    expect(new Set(stopped.stopped)).toEqual(new Set([workTask.id, personalTask.id]));
    expect(workTask.status).toBe("cancelled");
    expect(personalTask.status).toBe("cancelled");
    expect(await manager.stopAll()).toEqual({ stopped: [] });
    database.close();
  });

  it("stops at the configured step limit instead of reporting success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(tool("read_file", { path: "input.md" }));
    const { database, work, manager } = await fixture(fetchImpl as typeof fetch);
    await import("node:fs/promises").then(({ writeFile }) => writeFile(join(work.canonicalPath, "input.md"), "input"));
    const first = await manager.start(work, { objective: "Loop", model: "fixture/model", maxSteps: 1 });
    const limited = await manager.approve(work, first.id);
    expect(limited).toMatchObject({ status: "interrupted", error: "Step limit 1 reached." });
    database.close();
  });

  it("interrupts a stalled provider at the durable runtime limit", async () => {
    const fetchImpl = vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")));
    }));
    const { database, work, manager } = await fixture(fetchImpl as typeof fetch);
    const limited = await manager.start(work, { objective: "Bound runtime", model: "fixture/model", maxSteps: 3, maxRuntimeMs: 10 });
    expect(limited).toMatchObject({ status: "interrupted", error: "Runtime limit 10 ms reached.", maxRuntimeMs: 10 });
    expect(limited.runtimeMs).toBeGreaterThanOrEqual(9);
    expect(limited.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "task.limited", data: expect.objectContaining({ maxRuntimeMs: 10 }) })]));
    database.close();
  });

  it("rejects invalid state, malformed tools, missing grants, directories, and symlinked parents", async () => {
    const malformed = response([{ model: "fixture/model", choices: [{ delta: { tool_calls: [{ index: 0, id: "bad", function: { name: "write_file", arguments: "{" } }] }, finish_reason: "tool_calls" }] }]);
    const fetchImpl = vi.fn().mockResolvedValueOnce(complete()).mockResolvedValueOnce(malformed).mockResolvedValueOnce(tool("read_file", { path: "folder" })).mockResolvedValueOnce(tool("write_file", { path: "link/new/escape.md", content: "bad" }));
    const { directory, database, work, manager } = await fixture(fetchImpl as typeof fetch);
    const done = await manager.start(work, { objective: "Done", model: "fixture/model", maxSteps: 2 });
    await expect(manager.cancel(work, done.id)).rejects.toMatchObject({ code: "AGENT_STATE_CONFLICT" });
    await expect(manager.approve(work, done.id)).rejects.toMatchObject({ code: "AGENT_STATE_CONFLICT" });
    await expect(manager.revoke(work, "018f0f73-89db-7a63-a1b2-5d46f598ed01")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    expect(await manager.start(work, { objective: "Malformed", model: "fixture/model", maxSteps: 2 })).toMatchObject({ status: "failed", error: expect.stringContaining("invalid tool arguments") });
    await mkdir(join(work.canonicalPath, "folder"));
    const directoryRead = await manager.start(work, { objective: "Directory", model: "fixture/model", maxSteps: 2 });
    await expect(manager.approve(work, directoryRead.id)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    const outside = join(directory, "outside");
    await mkdir(outside);
    await symlink(outside, join(work.canonicalPath, "link"));
    const symlinkWrite = await manager.start(work, { objective: "Symlink", model: "fixture/model", maxSteps: 2 });
    await expect(manager.approve(work, symlinkWrite.id)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(readFile(join(outside, "new", "escape.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await manager.list(work)).grants).toEqual([]);
    await writeFile(join(work.canonicalPath, ".voidra", "agent-runtime.json"), "corrupt");
    const uncached = new AgentTaskManager(new OpenRouterAdapter({ apiKey: () => "fixture", fetch: fetchImpl as typeof fetch }));
    await expect(uncached.list(work)).rejects.toMatchObject({ code: "INCOMPATIBLE_SCHEMA" });
    database.close();
  });

  it("re-resolves context before every step and does not replay the prior snapshot", async () => {
    let context = "context version one";
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return requestBodies.length === 1 ? tool("read_file", { path: "input.md" }) : complete("fresh context used");
    });
    const { database, work } = await fixture(fetchImpl as typeof fetch);
    await writeFile(join(work.canonicalPath, "input.md"), "input");
    const manager = new AgentTaskManager(new OpenRouterAdapter({ baseUrl: "http://fixture", apiKey: () => "key", fetch: fetchImpl as typeof fetch }), {
      buildContext: async () => ({ prompt: context, manifest: [{ label: "selected.md", revision: context }] }),
    });
    const task = await manager.start(work, { objective: "Context", model: "fixture/model", maxSteps: 3, targetPaths: ["input.md"], sources: [] });
    expect(task.status).toBe("awaiting-approval");
    context = "context version two";
    const completed = await manager.approve(work, task.id);
    expect(completed.status).toBe("completed");
    const secondMessages = requestBodies[1]!.messages as Array<Record<string, unknown>>;
    expect(secondMessages[0]).toEqual({ role: "system", content: "context version two" });
    expect(JSON.stringify(secondMessages)).not.toContain("context version one");
    expect(completed.contextManifest).toEqual([{ label: "selected.md", revision: "context version two" }]);
    database.close();
  });

  it("retries bounded provider failures without partial output and enforces token budgets", async () => {
    const retryFetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(complete("after retry"));
    const { database, work } = await fixture(retryFetch as typeof fetch);
    const retrying = new AgentTaskManager(new OpenRouterAdapter({ baseUrl: "http://fixture", apiKey: () => "key", fetch: retryFetch as typeof fetch }), { retryDelayMs: 0 });
    const completed = await retrying.start(work, { objective: "Retry", model: "fixture/model", maxSteps: 2 });
    expect(completed.status).toBe("completed");
    expect(completed.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "provider.retry", data: expect.objectContaining({ attempt: 1, category: "offline" }) })]));

    const budgetManager = new AgentTaskManager(new OpenRouterAdapter({ baseUrl: "http://fixture", apiKey: () => "key", fetch: vi.fn().mockResolvedValue(complete("over budget")) as typeof fetch }));
    const limited = await budgetManager.start(work, { objective: "Budget", model: "fixture/model", maxSteps: 2, maxTokens: 5 });
    expect(limited).toMatchObject({ status: "interrupted", error: "Token budget 5 exceeded.", usage: { totalTokens: 6 } });
    database.close();
  });

  it("rechecks a revoked grant before a later tool effect in the same running task", async () => {
    let resolveLater!: (response: Response) => void;
    const later = new Promise<Response>((resolve) => { resolveLater = resolve; });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(tool("write_file", { path: "race.md", content: "initial" }))
      .mockResolvedValueOnce(complete("grant established"))
      .mockResolvedValueOnce(tool("write_file", { path: "race.md", content: "first in running task" }))
      .mockReturnValueOnce(later);
    const { database, work, manager } = await fixture(fetchImpl as typeof fetch);
    const setup = await manager.start(work, { objective: "Setup", model: "fixture/model", maxSteps: 3 });
    await manager.approve(work, setup.id);
    const grant = (await manager.list(work)).grants[0]!;
    const pending = manager.start(work, { objective: "Race", model: "fixture/model", maxSteps: 4 });
    while (fetchImpl.mock.calls.length < 4) await new Promise((resolve) => setTimeout(resolve, 1));
    await manager.revoke(work, grant.id);
    resolveLater(tool("write_file", { path: "race.md", content: "must not run" }));
    const task = await pending;
    expect(task.status).toBe("awaiting-approval");
    expect(await readFile(join(work.canonicalPath, "race.md"), "utf8")).toBe("first in running task");
    expect(task.events.filter(({ type }) => type === "tool.observed-result")).toHaveLength(1);
    database.close();
  });

  it("reviews an exact workspace MCP call and records ambiguous transport loss as uncertain", async () => {
    const connectionId = "018f0f73-89db-7a63-a1b2-5d46f598ed02";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(tool("mcp_call", { connectionId, tool: "echo", arguments: { text: "hello" } }))
      .mockResolvedValueOnce(complete("MCP complete"))
      .mockResolvedValueOnce(tool("mcp_call", { connectionId, tool: "unstable", arguments: {} }));
    const callMcpTool = vi.fn().mockResolvedValueOnce({ content: [{ type: "text", text: "echo:hello" }] }).mockRejectedValueOnce(new Error("connection lost"));
    const { database, work } = await fixture(fetchImpl as typeof fetch);
    const manager = new AgentTaskManager(new OpenRouterAdapter({ baseUrl: "http://fixture", apiKey: () => "key", fetch: fetchImpl as typeof fetch }), {
      listMcpTools: async () => [{ connectionId, connectionName: "Fixture", name: "echo", description: "Echo", inputSchema: { type: "object" } }],
      callMcpTool,
    });

    const first = await manager.start(work, { objective: "Use MCP", model: "fixture/model", maxSteps: 3 });
    expect(first).toMatchObject({ status: "awaiting-approval", pendingTool: { name: "mcp_call" } });
    const completed = await manager.approve(work, first.id);
    expect(completed).toMatchObject({ status: "completed", output: "MCP complete" });
    expect(callMcpTool).toHaveBeenCalledWith(work, connectionId, "echo", { text: "hello" });
    expect((await manager.list(work)).grants[0]).toMatchObject({ tool: "mcp_call", pathPrefix: expect.stringMatching(new RegExp(`^${connectionId}:echo:[a-f0-9]{64}$`)) });

    const unstable = await manager.start(work, { objective: "Uncertain MCP", model: "fixture/model", maxSteps: 2 });
    expect(unstable.status).toBe("awaiting-approval");
    const interrupted = await manager.approve(work, unstable.id);
    expect(interrupted).toMatchObject({ status: "interrupted", error: expect.stringContaining("outcome is uncertain"), pendingTool: { state: "uncertain" } });
    database.close();
  });
});
