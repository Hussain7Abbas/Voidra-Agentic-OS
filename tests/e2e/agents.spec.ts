import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let temporaryRoot: string;
let application: ElectronApplication | undefined;
let server: Server | undefined;

async function fixture(handler: (body: Record<string, unknown>, response: import("node:http").ServerResponse) => void) {
  server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => handler(JSON.parse(raw) as Record<string, unknown>, response));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind.");
  return `http://127.0.0.1:${address.port}`;
}

function sse(response: import("node:http").ServerResponse, events: unknown[]) {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end("data: [DONE]\n\n");
}

async function launch(profile: string, workspace: string, baseUrl: string, extraEnv: Record<string, string> = {}) {
  return electron.launch({ args: [process.cwd()], env: { ...process.env, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile, VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify([workspace]), VOIDRA_OPENROUTER_BASE_URL: baseUrl, VOIDRA_OPENROUTER_TEST_KEY: "fixture-key", ...extraEnv } });
}

async function onboard(window: Page) {
  await window.getByLabel("Workspace name").fill("Work");
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await expect(window.getByTestId("workspace-dialog")).toBeHidden();
  await window.getByRole("link", { name: "Assistant" }).click();
}

test.beforeEach(async () => { temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-agent-e2e-")); });
test.afterEach(async () => {
  if (application) await application.close().catch(() => undefined);
  application = undefined;
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("streams through an OpenRouter-shaped fixture, approves one exact write, and records usage", async () => {
  let calls = 0;
  const baseUrl = await fixture((body, response) => {
    calls += 1;
    expect(body).toMatchObject({ model: "fixture/tool-model", stream: true, parallel_tool_calls: false });
    if (calls === 1) sse(response, [{ model: "fixture/tool-model", choices: [{ delta: { content: "Preparing. ", tool_calls: [{ index: 0, id: "write-1", function: { name: "write_file", arguments: '{"path":"outputs/agent.md","content":"# Agent output\\n"}' } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }]);
    else sse(response, [{ model: "fixture/tool-model", choices: [{ delta: { content: "Saved the reviewed output." }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }]);
  });
  const root = join(temporaryRoot, "Work");
  await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), root, baseUrl);
  const window = await application.firstWindow();
  await onboard(window);
  await window.getByLabel("Automatic task model").fill("fixture/tool-model");
  await window.getByRole("button", { name: "Run automatic task" }).click();
  await expect(window.getByLabel("Automatic tasks")).toContainText("awaiting-approval");
  await expect(window.getByLabel("Pending tool action")).toContainText("outputs/agent.md");
  await window.getByRole("button", { name: "Approve exact action" }).click();
  await expect(window.getByLabel("Automatic tasks")).toContainText("completed");
  await expect(window.getByLabel("Automatic task output")).toContainText("Saved the reviewed output");
  await expect(window.getByLabel("Task event journal")).toContainText("tool.observed-result");
  await expect(window.getByLabel("Automatic tasks")).toContainText("31 tokens");
  expect(await readFile(join(root, "outputs", "agent.md"), "utf8")).toBe("# Agent output\n");
  await expect(window.getByLabel("Agent grants")).toContainText("outputs/agent.md");
});

test("revoked grant blocks the next effect and another workspace cannot see it", async () => {
  let calls = 0;
  const baseUrl = await fixture((_body, response) => {
    calls += 1;
    if (calls === 2) sse(response, [{ model: "fixture/model", choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }]);
    else sse(response, [{ model: "fixture/model", choices: [{ delta: { tool_calls: [{ index: 0, id: `write-${calls}`, function: { name: "write_file", arguments: `{"path":"result.md","content":"value-${calls}"}` } }] }, finish_reason: "tool_calls" }] }]);
  });
  const work = join(temporaryRoot, "Work");
  await mkdir(work);
  application = await launch(join(temporaryRoot, "profile"), work, baseUrl);
  const window = await application.firstWindow();
  await onboard(window);
  await window.getByRole("button", { name: "Run automatic task" }).click();
  await expect(window.getByLabel("Automatic tasks")).toContainText("awaiting-approval");
  await window.getByRole("button", { name: "Approve exact action" }).click();
  await expect(window.getByLabel("Automatic tasks")).toContainText("completed");
  await window.getByLabel("Agent grants").getByRole("button", { name: "Revoke" }).click();
  await window.getByRole("button", { name: "Run automatic task" }).click();
  await expect(window.getByLabel("Automatic tasks")).toContainText("awaiting-approval");
  expect(await readFile(join(work, "result.md"), "utf8")).toBe("value-1");
});

test("cancels a live stream and records a cancelled terminal state", async () => {
  const baseUrl = await fixture((_body, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ model: "fixture/slow", choices: [{ delta: { content: "partial output" } }] })}\n\n`);
    const timer = setInterval(() => response.write(": keepalive\n\n"), 200);
    response.on("close", () => clearInterval(timer));
  });
  const root = join(temporaryRoot, "Work");
  await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), root, baseUrl);
  const window = await application.firstWindow();
  await onboard(window);
  await window.getByLabel("Automatic task model").fill("fixture/slow");
  await window.getByRole("button", { name: "Run automatic task" }).click();
  await expect(window.getByLabel("Automatic tasks")).toContainText("running");
  await expect(window.getByLabel("Automatic task output")).toContainText("partial output");
  await window.getByRole("button", { name: "Stop task" }).click();
  await expect(window.getByLabel("Automatic tasks")).toContainText("cancelled");
  await expect(window.getByLabel("Task event journal")).toContainText("task.cancelled");
});

test("restart after a committed write records an uncertain interruption and never replays it", async () => {
  let calls = 0;
  const baseUrl = await fixture((_body, response) => {
    calls += 1;
    if (calls === 2) sse(response, [{ model: "fixture/model", choices: [{ delta: { content: "first complete" }, finish_reason: "stop" }] }]);
    else sse(response, [{ model: "fixture/model", choices: [{ delta: { tool_calls: [{ index: 0, id: `write-${calls}`, function: { name: "write_file", arguments: `{"path":"effect.md","content":"effect-${calls}"}` } }] }, finish_reason: "tool_calls" }] }]);
  });
  const root = join(temporaryRoot, "Work");
  await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), root, baseUrl, { VOIDRA_E2E_AGENT_POST_EFFECT_DELAY_MS: "3000" });
  const window = await application.firstWindow();
  await onboard(window);
  await window.getByRole("button", { name: "Run automatic task" }).click();
  await expect(window.getByLabel("Automatic tasks")).toContainText("awaiting-approval");
  await window.getByRole("button", { name: "Approve exact action" }).click();
  await expect(window.getByLabel("Automatic tasks")).toContainText("completed", { timeout: 8_000 });
  await window.getByRole("button", { name: "Run automatic task" }).click();
  await expect.poll(async () => readFile(join(root, "effect.md"), "utf8")).toBe("effect-3");
  await window.evaluate(() => globalThis.window.voidra!.diagnostics!.simulateServiceCrash());
  await expect(window.locator(".runtime-card")).toContainText("ready", { timeout: 8_000 });
  await expect(window.getByLabel("Automatic tasks")).toContainText("interrupted", { timeout: 8_000 });
  await window.getByLabel("Automatic tasks").getByRole("button").filter({ hasText: "interrupted" }).click();
  await expect(window.getByLabel("Automatic task output")).toContainText("reconcile it before resuming");
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(calls).toBe(3);
  expect(await readFile(join(root, "effect.md"), "utf8")).toBe("effect-3");
});
