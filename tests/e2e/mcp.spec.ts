import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const fixtureServer = fileURLToPath(new URL("../fixtures/mcp-server.mjs", import.meta.url));
let temporaryRoot: string;
let application: ElectronApplication | undefined;
let server: Server | undefined;
let providerServer: Server | undefined;

test.beforeEach(async () => { temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-mcp-e2e-")); });
test.afterEach(async () => {
  if (application) await application.close().catch(() => undefined);
  application = undefined;
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  if (providerServer) await new Promise<void>((resolve) => providerServer!.close(() => resolve()));
  providerServer = undefined;
  await rm(temporaryRoot, { recursive: true, force: true });
});

async function launch(profile: string, workspace: string | string[], extraEnv: Record<string, string> = {}) {
  return electron.launch({ args: [process.cwd()], env: { ...process.env, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile, VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify(Array.isArray(workspace) ? workspace : [workspace]), ...extraEnv } });
}

test("configures a workspace stdio server and reviews tools, resources, and prompts", async () => {
  let providerCalls = 0;
  providerServer = createServer((request, response) => {
    if (request.method === "GET" && request.url?.startsWith("/v0.1/servers")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ servers: [{ server: { name: "io.voidra/fixture", title: "Fixture Catalog Entry", description: "Local catalog fixture", version: "1.0.0", packages: [{ registryType: "npm", identifier: "@voidra/fixture-mcp", version: "1.0.0", runtimeHint: "npx", transport: { type: "stdio" }, runtimeArguments: [{ value: "-y" }] }] } }], metadata: { count: 1 } }));
      return;
    }
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      providerCalls += 1;
      const body = JSON.parse(raw) as { tools: Array<{ function: { name: string; description: string } }> };
      const id = body.tools.find(({ function: definition }) => definition.name === "mcp_call")?.function.description.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0];
      const event = providerCalls === 1
        ? { model: "fixture/model", choices: [{ delta: { tool_calls: [{ index: 0, id: "mcp-1", function: { name: "mcp_call", arguments: JSON.stringify({ connectionId: id, tool: "echo", arguments: { text: "from-agent" } }) } }] }, finish_reason: "tool_calls" }] }
        : { model: "fixture/model", choices: [{ delta: { content: "Agent received the MCP result." }, finish_reason: "stop" }] };
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>((resolve) => providerServer!.listen(0, "127.0.0.1", resolve));
  const providerAddress = providerServer.address();
  if (!providerAddress || typeof providerAddress === "string") throw new Error("Provider fixture did not bind.");
  const root = join(temporaryRoot, "Work");
  const personal = join(temporaryRoot, "Personal");
  const profile = join(temporaryRoot, "profile");
  await Promise.all([mkdir(root), mkdir(personal)]);
  application = await launch(profile, [root, personal], { VOIDRA_OPENROUTER_BASE_URL: `http://127.0.0.1:${providerAddress.port}`, VOIDRA_OPENROUTER_TEST_KEY: "fixture-key", VOIDRA_MCP_REGISTRY_URL: `http://127.0.0.1:${providerAddress.port}` });
  let window = await application.firstWindow();
  await window.getByLabel("Workspace name").fill("Work");
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await window.getByRole("link", { name: "Settings" }).click();

  await window.getByLabel("MCP catalog search").fill("fixture");
  await window.getByRole("button", { name: "Search registry" }).click();
  await expect(window.getByLabel("MCP catalog results")).toContainText("Fixture Catalog Entry");
  await expect(window.getByTestId("mcp-catalog-status")).toContainText("Official Registry");
  await window.getByLabel("MCP catalog results").getByRole("button", { name: "Use declared setup" }).click();
  await expect(window.getByLabel("MCP executable")).toHaveValue("npx");
  await expect(window.getByLabel("MCP arguments")).toContainText("@voidra/fixture-mcp@1.0.0");

  await window.getByLabel("MCP connection name").fill("Fixture");
  await window.getByLabel("MCP executable").fill(process.execPath);
  await window.getByLabel("MCP arguments").fill(JSON.stringify([fixtureServer]));
  await window.getByLabel("MCP environment").fill(JSON.stringify({ VOIDRA_FIXTURE_LABEL: "work-only" }));
  await window.getByRole("button", { name: "Add custom connection" }).click();
  await expect(window.getByLabel("MCP connections")).toContainText("Fixture · configured");
  await window.getByLabel("MCP connections").getByRole("button", { name: "Connect" }).click();
  await expect(window.getByLabel("MCP connections")).toContainText("Fixture · ready", { timeout: 10_000 });
  await expect(window.getByLabel("Fixture tools")).toContainText("Echo");
  await expect(window.getByLabel("Fixture resources")).toContainText("fixture://workspace");
  await expect(window.getByLabel("Fixture prompts")).toContainText("Summarize");

  await window.getByLabel("Fixture tool arguments").fill('{"text":"hello"}');
  await window.getByLabel("Fixture tools").getByRole("button", { name: /Echo/ }).click();
  await expect(window.getByLabel("MCP action reviews")).toContainText('{"text":"hello"}');
  await window.getByRole("button", { name: "Approve exact call" }).click();
  await expect(window.getByLabel("MCP result")).toContainText("work-only:hello");

  await window.getByLabel("Fixture resources").getByRole("button", { name: /Workspace label/ }).click();
  await expect(window.getByLabel("MCP result")).toContainText('"text": "work-only"');
  await window.getByLabel("Fixture tool arguments").fill('{"topic":"MCP"}');
  await window.getByLabel("Fixture prompts").getByRole("button", { name: /Summarize/ }).click();
  await expect(window.getByLabel("MCP result")).toContainText("Summarize MCP");

  await window.getByRole("link", { name: "Assistant" }).click();
  await window.getByRole("button", { name: "Run automatic task" }).click();
  await expect(window.getByLabel("Pending tool action")).toContainText("mcp_call");
  await window.getByRole("button", { name: "Approve exact action" }).click();
  await expect(window.getByLabel("Automatic tasks")).toContainText("completed");
  await expect(window.getByLabel("Automatic task output")).toContainText("Agent received the MCP result");
  await expect(window.getByLabel("Task event journal")).toContainText("tool.observed-result");
  expect(providerCalls).toBe(2);

  const workRegistry = JSON.parse(await readFile(join(root, ".voidra", "mcp.json"), "utf8")) as { connections: Array<{ id: string }> };
  await window.getByRole("button", { name: "Add workspace" }).click();
  await window.getByLabel("Workspace name").fill("Personal");
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await window.getByRole("link", { name: "Settings" }).click();
  await expect(window.getByLabel("MCP connections").locator(".mcp-connection")).toHaveCount(0);
  const personalManifest = JSON.parse(await readFile(join(personal, ".voidra", "workspace.json"), "utf8")) as { workspaceId: string };
  const manipulated = await window.evaluate(async ({ workspaceId, connectionId }) => globalThis.window.voidra!.service.request({ requestId: crypto.randomUUID(), workspaceId, sessionId: crypto.randomUUID(), operation: "mcp.connect", payload: { connectionId } }), { workspaceId: personalManifest.workspaceId, connectionId: workRegistry.connections[0]!.id });
  expect(manipulated).toMatchObject({ ok: false, error: { code: "WORKSPACE_CONFLICT" } });
  await window.getByLabel("Current workspace").selectOption({ label: "Work" });

  await application.close();
  application = await launch(profile, root, { VOIDRA_OPENROUTER_BASE_URL: `http://127.0.0.1:${providerAddress.port}`, VOIDRA_OPENROUTER_TEST_KEY: "fixture-key", VOIDRA_MCP_REGISTRY_URL: `http://127.0.0.1:${providerAddress.port}` });
  window = await application.firstWindow();
  await window.getByRole("link", { name: "Settings" }).click();
  await expect(window.getByLabel("MCP connections")).toContainText("Fixture · stopped");
  await window.getByLabel("MCP connections").getByRole("button", { name: "Edit" }).click();
  await window.getByLabel("MCP executable").fill(join(root, "missing-server"));
  await window.getByRole("button", { name: "Update connection" }).click();
  await window.getByLabel("MCP connections").getByRole("button", { name: "Connect" }).click();
  await expect(window.getByLabel("MCP connections")).toContainText("Fixture · failed");
  await window.getByLabel("MCP connections").getByRole("button", { name: "Rollback" }).click();
  await expect(window.getByLabel("MCP connections")).toContainText("Fixture · configured");
  await window.getByLabel("MCP connections").getByRole("button", { name: "Connect" }).click();
  await expect(window.getByLabel("MCP connections")).toContainText("Fixture · ready", { timeout: 10_000 });
});

test("stores a remote bearer token securely and restores it after service restart", async () => {
  const token = "remote-bearer-secret";
  server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401, { "WWW-Authenticate": "Bearer" }); response.end("Unauthorized"); return; }
    if (request.method !== "POST") { response.writeHead(204); response.end(); return; }
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const message = JSON.parse(raw) as { id?: number; method: string; params?: Record<string, unknown> };
      if (message.method === "notifications/initialized") { response.writeHead(202); response.end(); return; }
      const results: Record<string, unknown> = {
        initialize: { protocolVersion: String(message.params?.protocolVersion), capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "remote-e2e", version: "1.0.0" } },
        "tools/list": { tools: [] }, "resources/list": { resources: [] }, "prompts/list": { prompts: [] },
      };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: results[message.method] }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Remote fixture did not bind.");

  const root = join(temporaryRoot, "Work");
  const profile = join(temporaryRoot, "profile");
  await mkdir(root);
  application = await launch(profile, root);
  const window = await application.firstWindow();
  await window.getByLabel("Workspace name").fill("Work");
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await window.getByRole("link", { name: "Settings" }).click();
  await window.getByLabel("MCP transport").getByRole("button", { name: "Remote HTTP" }).click();
  await window.getByLabel("MCP connection name").fill("Remote");
  await window.getByLabel("MCP remote URL").fill(`http://127.0.0.1:${address.port}/mcp`);
  await window.getByRole("button", { name: "Add custom connection" }).click();
  await window.getByLabel("MCP connections").getByRole("button", { name: "Connect" }).click();
  await expect(window.getByLabel("MCP connections")).toContainText("authorization-required");

  const registry = JSON.parse(await readFile(join(root, ".voidra", "mcp.json"), "utf8")) as { connections: Array<{ id: string }> };
  const connectionId = registry.connections[0]!.id;
  await window.getByLabel("Remote bearer token").fill(token);
  await window.getByRole("button", { name: "Save token" }).click();
  expect((await readFile(join(profile, "secrets", "mcp", `${connectionId}.bin`))).toString("utf8")).not.toContain(token);
  expect(await readFile(join(root, ".voidra", "mcp.json"), "utf8")).not.toContain(token);
  await window.getByLabel("MCP connections").getByRole("button", { name: "Connect" }).click();
  await expect(window.getByLabel("MCP connections")).toContainText("Remote · ready");

  await window.evaluate(() => globalThis.window.voidra!.diagnostics!.simulateServiceCrash());
  await expect(window.getByTestId("service-status")).toContainText("ready", { timeout: 8_000 });
  await expect(window.getByLabel("MCP connections")).toContainText("Remote · stopped", { timeout: 8_000 });
  await window.getByLabel("MCP connections").getByRole("button", { name: "Connect" }).click();
  await expect(window.getByLabel("MCP connections")).toContainText("Remote · ready");
});
