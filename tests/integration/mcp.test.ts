import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceDatabase } from "../../src/service/database";
import { McpManager } from "../../src/service/mcp";
import { WorkspaceManager } from "../../src/service/workspaces";

const fixtureServer = fileURLToPath(new URL("../fixtures/mcp-server.mjs", import.meta.url));
const temporaryDirectories: string[] = [];
const servers: Server[] = [];

async function fixture(fetchImpl: typeof fetch = fetch, timeouts = { connect: 5_000, discovery: 5_000, request: 15_000 }) {
  const directory = await mkdtemp(join(tmpdir(), "voidra-mcp-"));
  temporaryDirectories.push(directory);
  const database = new ServiceDatabase(join(directory, "state.sqlite"));
  const workspaces = new WorkspaceManager(database);
  const workRoot = join(directory, "Work");
  const personalRoot = join(directory, "Personal");
  await Promise.all([mkdir(workRoot), mkdir(personalRoot)]);
  const work = await workspaces.create("Work", workRoot);
  const personal = await workspaces.create("Personal", personalRoot);
  const manager = new McpManager(database, fetchImpl, () => null, "https://registry.modelcontextprotocol.io", timeouts);
  return { database, work, personal, manager };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("McpManager", () => {
  it("normalizes official catalog metadata and labels cached offline results", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        servers: [{ server: { name: "io.example/fixture", title: "Fixture", description: "Declared server", version: "1.2.3", packages: [{ registryType: "npm", identifier: "fixture", version: "1.2.3", runtimeHint: "npx", transport: { type: "stdio" }, runtimeArguments: [{ value: "-y" }, { value: "" }], environmentVariables: [{ name: "LABEL", isRequired: true }, { name: "API_SECRET", isSecret: true }], packageArguments: [{ name: "root", isRequired: true }] }, { registryType: "pypi", identifier: "ignored", version: "1.0.0", transport: { type: "stdio" } }], remotes: [{ type: "streamable-http", url: "https://example.test/mcp", headers: [{ name: "Authorization", isSecret: true, isRequired: true }] }, { type: "sse", url: "https://example.test/sse" }] } }],
        metadata: {},
      }), { status: 200 }))
      .mockRejectedValueOnce(new Error("offline"));
    const { database, manager } = await fixture(fetchImpl as typeof fetch);
    const online = await manager.catalog("fixture");
    expect(online).toMatchObject({ stale: false, entries: [{ id: "io.example/fixture", version: "1.2.3", reviewStatus: "declared-unverified", transports: ["stdio", "streamable-http", "sse"] }] });
    expect(online.entries[0]?.launchOptions).toEqual([
      { kind: "stdio", command: "npx", args: ["-y", "fixture@1.2.3"], requirements: [{ kind: "environment", name: "LABEL", secret: false, required: true }, { kind: "environment", name: "API_SECRET", secret: true, required: false }, { kind: "argument", name: "root", secret: false, required: true }] },
      { kind: "streamable-http", url: "https://example.test/mcp", requirements: [{ kind: "header", name: "Authorization", secret: true, required: true }] },
    ]);
    const cached = await manager.catalog("fixture");
    expect(cached).toMatchObject({ stale: true, source: "cached", entries: [{ name: "Fixture" }] });
    const minimalFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ servers: [{ server: { name: "io.example/minimal", version: "0.1.0" } }] }), { status: 200 }));
    const minimal = new McpManager(database, minimalFetch as typeof fetch);
    expect(await minimal.catalog("")).toMatchObject({ entries: [{ name: "io.example/minimal", description: "No description supplied.", transports: [], setup: [] }] });
    database.close();
  });

  it("returns an explicit offline catalog when no cache exists", async () => {
    const { database, manager } = await fixture(vi.fn().mockResolvedValue(new Response("failure", { status: 503 })) as typeof fetch);
    expect(await manager.catalog("")).toMatchObject({ entries: [], stale: true, source: "offline", fetchedAt: null });
    database.close();
  });

  it("connects a real disposable stdio server and revalidates tools, resources, and prompts", async () => {
    const { database, work, personal, manager } = await fixture();
    const configured = await manager.addStdio(work, { name: "Fixture", command: process.execPath, args: [fixtureServer], env: { VOIDRA_FIXTURE_LABEL: "work-only" } });
    const connected = await manager.connect(work, configured.id);
    expect(connected).toMatchObject({ status: "ready", serverInfo: { name: "voidra-fixture", version: "1.0.0" } });
    expect(connected.capabilities.tools.map((tool) => tool.name)).toEqual(["echo", "crash", "hang", "fail"]);
    expect(connected.capabilities.resources.map((resource) => resource.uri)).toEqual(["fixture://workspace"]);
    expect(connected.capabilities.prompts.map((prompt) => prompt.name)).toEqual(["summarize"]);

    const prepared = await manager.prepareTool(work, configured.id, "echo", { text: "hello" });
    expect(prepared.state).toBe("awaiting-approval");
    const completed = await manager.approveTool(work, prepared.id);
    expect(completed).toMatchObject({ state: "completed", result: { content: [{ type: "text", text: "work-only:hello" }] } });
    await expect(manager.approveTool(work, prepared.id)).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });

    expect(await manager.readResource(work, configured.id, "fixture://workspace")).toMatchObject({ contents: [{ text: "work-only" }] });
    expect(await manager.getPrompt(work, configured.id, "summarize", { topic: "MCP" })).toMatchObject({ messages: [{ content: { text: "Summarize MCP" } }] });
    expect(await manager.agentTools(work)).toEqual(expect.arrayContaining([expect.objectContaining({ connectionId: configured.id, connectionName: "Fixture", name: "echo" })]));
    expect(await manager.callForAgent(work, configured.id, "echo", { text: "agent" })).toMatchObject({ content: [{ text: "work-only:agent" }] });
    await expect(manager.readResource(work, configured.id, "fixture://missing")).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    await expect(manager.getPrompt(work, configured.id, "missing", {})).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    await expect(manager.prepareTool(work, configured.id, "missing", {})).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    await expect(manager.connect(personal, configured.id)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });

    expect(await manager.refresh(work, configured.id)).toMatchObject({ status: "ready" });
    const cancelled = await manager.prepareTool(work, configured.id, "echo", { text: "cancelled" });
    expect(await manager.setEnabled(work, configured.id, false)).toMatchObject({ enabled: false, status: "stopped" });
    await expect(manager.approveTool(work, cancelled.id)).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    expect(await manager.setEnabled(work, configured.id, true)).toMatchObject({ enabled: true, status: "configured" });
    await manager.connect(work, configured.id);
    const knownFailure = await manager.prepareTool(work, configured.id, "fail", {});
    expect(await manager.approveTool(work, knownFailure.id)).toMatchObject({ state: "failed", error: "The MCP tool reported an error." });

    const crash = await manager.prepareTool(work, configured.id, "crash", {});
    expect(await manager.approveTool(work, crash.id)).toMatchObject({ state: "uncertain" });
    await expect.poll(async () => (await manager.list(work)).connections[0]?.status).toBe("degraded");

    await manager.stop(work, configured.id);
    expect((await manager.list(work)).connections[0]?.status).toBe("stopped");
    expect(await manager.remove(work, configured.id)).toEqual({ removed: true });
    expect(await manager.list(work)).toMatchObject({ connections: [], actions: expect.arrayContaining([expect.objectContaining({ id: cancelled.id, state: "cancelled" })]) });
    await manager.close();
    database.close();
  });

  it("marks a timed-out tool call uncertain instead of replaying it", async () => {
    const { database, work, manager } = await fixture(fetch, { connect: 1_000, discovery: 1_000, request: 50 });
    const configured = await manager.addStdio(work, { name: "Timeout fixture", command: process.execPath, args: [fixtureServer] });
    expect(await manager.connect(work, configured.id)).toMatchObject({ status: "ready" });
    const action = await manager.prepareTool(work, configured.id, "hang", {});
    expect(await manager.approveTool(work, action.id)).toMatchObject({ state: "uncertain", error: expect.stringMatching(/timed out/i) });
    expect((await manager.list(work)).actions.find(({ id }) => id === action.id)?.state).toBe("uncertain");
    await manager.close();
    database.close();
  });

  it("connects Streamable HTTP with a workspace connection credential", async () => {
    const token = "remote-fixture-token";
    let toolVersion = 1;
    let authorized = true;
    const remote = createServer((request, response) => {
      if (!authorized || request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401, { "WWW-Authenticate": "Bearer" }); response.end("Unauthorized"); return; }
      if (request.method !== "POST") { response.writeHead(204); response.end(); return; }
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        const message = JSON.parse(raw) as { id?: number; method: string; params?: Record<string, unknown> };
        if (message.method === "notifications/initialized") { response.writeHead(202); response.end(); return; }
        const results: Record<string, unknown> = {
          initialize: { protocolVersion: String(message.params?.protocolVersion), capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "remote-fixture", version: "1.0.0" } },
          "tools/list": message.params?.cursor === "page-two"
            ? { tools: [{ name: "second_page", description: "Paginated tool", inputSchema: { type: "object" } }] }
            : { tools: [{ name: "remote_echo", description: `Remote echo v${toolVersion}`, inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }], nextCursor: "page-two" },
          "resources/list": { resources: [] },
          "prompts/list": { prompts: [] },
          "tools/call": { content: [{ type: "text", text: `remote:${String((message.params?.arguments as Record<string, unknown>)?.text)}` }] },
        };
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: results[message.method] }));
      });
    });
    servers.push(remote);
    await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
    const address = remote.address();
    if (!address || typeof address === "string") throw new Error("Remote fixture did not bind.");

    const credentials = new Map<string, string>();
    const { database, work } = await fixture();
    const manager = new McpManager(database, fetch, (connectionId) => credentials.get(connectionId) ?? null);
    const configured = await manager.addRemote(work, { name: "Remote", url: `http://127.0.0.1:${address.port}/mcp` });
    expect(await manager.connect(work, configured.id)).toMatchObject({ status: "authorization-required" });
    credentials.set(configured.id, token);
    expect(await manager.connect(work, configured.id)).toMatchObject({ status: "ready", serverInfo: { name: "remote-fixture" }, capabilities: { tools: [{ name: "remote_echo" }, { name: "second_page" }] } });
    const updated = await manager.update(work, configured.id, { transport: "stdio", name: "Broken update", command: join(work.canonicalPath, "missing-update"), args: [] });
    expect(updated.previousConfig).toMatchObject({ transport: "streamable-http", url: `http://127.0.0.1:${address.port}/mcp` });
    expect(await manager.connect(work, configured.id)).toMatchObject({ status: "failed" });
    expect(await manager.rollback(work, configured.id)).toMatchObject({ transport: "streamable-http", name: "Broken update", status: "configured", previousConfig: null });
    expect(await manager.connect(work, configured.id)).toMatchObject({ status: "ready" });
    const action = await manager.prepareTool(work, configured.id, "remote_echo", { text: "hello" });
    expect(await manager.approveTool(work, action.id)).toMatchObject({ state: "completed", result: { content: [{ text: "remote:hello" }] } });
    const stale = await manager.prepareTool(work, configured.id, "remote_echo", { text: "stale" });
    toolVersion = 2;
    await expect(manager.approveTool(work, stale.id)).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    authorized = false;
    expect(await manager.refresh(work, configured.id)).toMatchObject({ status: "authorization-required" });
    await manager.close();
    database.close();
  });

  it("rejects secret-like environment keys, out-of-workspace cwd, and insecure remote URLs", async () => {
    const { database, work, manager } = await fixture();
    await expect(manager.addStdio(work, { name: "Empty", command: "", args: [] })).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    await expect(manager.addStdio(work, { name: "Null", command: "node\0bad", args: [] })).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    await expect(manager.addStdio(work, { name: "Secret", command: process.execPath, args: [fixtureServer], env: { API_TOKEN: "must-not-persist" } })).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    await expect(manager.addStdio(work, { name: "Invalid env", command: process.execPath, args: [fixtureServer], env: { "bad-key": "value" } })).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    await expect(manager.addStdio(work, { name: "Outside", command: process.execPath, args: [fixtureServer], cwd: "../Personal" })).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    await expect(manager.addStdio(work, { name: "Missing cwd", command: process.execPath, args: [fixtureServer], cwd: "missing" })).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    await expect(manager.addRemote(work, { name: "Unsafe", url: "http://example.com/mcp" })).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    await expect(manager.addRemote(work, { name: "Inline secret", url: "https://user:password@example.com/mcp" })).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    const rollbackMissing = await manager.addRemote(work, { name: "No history", url: "https://example.com/mcp" });
    await expect(manager.rollback(work, rollbackMissing.id)).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });
    expect(await manager.update(work, rollbackMissing.id, { transport: "streamable-http", name: "Updated remote", url: "https://example.org/mcp" })).toMatchObject({ url: "https://example.org/mcp", previousConfig: { url: "https://example.com/mcp" } });

    const failed = await manager.addStdio(work, { name: "Missing executable", command: join(work.canonicalPath, "not-installed"), args: [] });
    expect(await manager.connect(work, failed.id)).toMatchObject({ status: "failed" });
    await manager.setEnabled(work, failed.id, false);
    await expect(manager.connect(work, failed.id)).rejects.toMatchObject({ code: "MCP_STATE_CONFLICT" });

    const noisy = await manager.addStdio(work, { name: "Redacted startup", command: process.execPath, args: ["-e", "console.error(process.env.LABEL);process.exit(1)"], env: { LABEL: "private-workspace-label" } });
    expect(await manager.connect(work, noisy.id)).toMatchObject({ status: "failed" });
    expect((await manager.list(work)).connections.find(({ id }) => id === noisy.id)?.diagnostic).not.toContain("private-workspace-label");

    const invalidRemote = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("not-json");
    });
    servers.push(invalidRemote);
    await new Promise<void>((resolve) => invalidRemote.listen(0, "127.0.0.1", resolve));
    const address = invalidRemote.address();
    if (!address || typeof address === "string") throw new Error("Invalid-response fixture did not bind.");
    const invalid = await manager.addRemote(work, { name: "Invalid response", url: `http://127.0.0.1:${address.port}/mcp` });
    expect(await manager.connect(work, invalid.id)).toMatchObject({ status: "failed", diagnostic: expect.any(String) });

    await manager.close();
    database.close();
  });

  it("recovers persisted live states as stopped and rejects corrupt metadata", async () => {
    const { database, work, manager } = await fixture();
    const configured = await manager.addRemote(work, { name: "Persisted", url: "https://example.test/mcp" });
    const path = join(work.canonicalPath, ".voidra", "mcp.json");
    const registry = JSON.parse(await readFile(path, "utf8")) as { connections: Array<{ id: string; status: string }> };
    registry.connections.find(({ id }) => id === configured.id)!.status = "ready";
    await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`);
    const reopened = new McpManager(database);
    expect((await reopened.list(work)).connections[0]).toMatchObject({ status: "stopped", diagnostic: "Reconnect after local service restart." });
    await reopened.close();

    await writeFile(path, "corrupt");
    const corrupt = new McpManager(database);
    await expect(corrupt.list(work)).rejects.toMatchObject({ code: "INCOMPATIBLE_SCHEMA" });
    await manager.close();
    database.close();
  });
});
