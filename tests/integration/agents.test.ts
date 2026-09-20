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

function tool(name: "read_file" | "write_file", args: Record<string, unknown>) {
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

  it("stops at the configured step limit instead of reporting success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(tool("read_file", { path: "input.md" }));
    const { database, work, manager } = await fixture(fetchImpl as typeof fetch);
    await import("node:fs/promises").then(({ writeFile }) => writeFile(join(work.canonicalPath, "input.md"), "input"));
    const first = await manager.start(work, { objective: "Loop", model: "fixture/model", maxSteps: 1 });
    const limited = await manager.approve(work, first.id);
    expect(limited).toMatchObject({ status: "interrupted", error: "Step limit 1 reached." });
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
});
