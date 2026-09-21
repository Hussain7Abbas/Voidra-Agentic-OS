import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

let temporaryRoot: string; let application: ElectronApplication | undefined; let provider: Server | undefined;
const mcpFixture = fileURLToPath(new URL("../fixtures/mcp-server.mjs", import.meta.url));
test.beforeEach(async () => { temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-planner-e2e-")); });
test.afterEach(async () => { if (application) await application.close().catch(() => undefined); application = undefined; if (provider) await new Promise<void>((resolve) => provider!.close(() => resolve())); provider = undefined; await rm(temporaryRoot, { recursive: true, force: true }); });

async function launch(profile: string, folders: string[] = [], env: Record<string, string> = {}) { return electron.launch({ args: [process.cwd()], env: { ...process.env, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile, VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify(folders), ...env } }); }
async function onboard(window: Page, name: string) { await window.getByLabel("Workspace name").fill(name); await window.getByRole("button", { name: "Choose workspace folder" }).click(); await window.getByRole("button", { name: "Create workspace" }).click(); }

test("builds and edits a sourced local plan and prepares a manual handoff without credentials", async () => {
  const root = join(temporaryRoot, "Work"); await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), [root]); const window = await application.firstWindow(); await onboard(window, "Work");
  await expect(window.getByText("Default routine: Plan the Day")).toBeVisible();
  await window.getByLabel("Local task title").fill("Finish launch brief"); await window.getByLabel("Local task due date").fill("2026-09-20"); await window.getByRole("button", { name: "Add task" }).click();
  await window.getByLabel("Local task title").fill("Optional reading"); await window.getByLabel("Optional local task").check(); await window.getByRole("button", { name: "Add task" }).click();
  await window.getByLabel("Plan date").fill("2026-09-20"); await window.getByLabel("Plan timezone").fill("UTC");
  await window.getByLabel("Planning commitments").fill(JSON.stringify([{ sourceId: "calendar:event-1", title: "Project review", start: "2026-09-20T10:00:00.000Z", end: "2026-09-20T11:00:00.000Z" }]));
  await window.getByLabel("Unavailable planning sources").fill("Personal calendar"); await window.getByRole("button", { name: "Generate locally" }).click();
  await expect(window.getByLabel("Daily plan Markdown")).toContainText("Finish launch brief"); await expect(window.getByLabel("Daily plan Markdown")).toContainText("calendar:event-1"); await expect(window.getByLabel("Daily plan Markdown")).toContainText("Personal calendar is unavailable");
  await window.getByLabel("Daily plan Markdown").fill("# Edited plan\n\nUser-controlled order.\n"); await window.getByRole("button", { name: "Save plan" }).click(); await expect(window.getByRole("status")).toContainText("saved");
  expect(await readFile(join(root, "Daily Plans", "2026-09-20.md"), "utf8")).toContain("User-controlled order");
  const calendarState = join(root, "calendar-fixture.json"); await window.getByRole("link", { name: "Settings" }).click(); await window.getByLabel("MCP connection name").fill("Fixture calendar"); await window.getByLabel("MCP executable").fill(process.execPath); await window.getByLabel("MCP arguments").fill(JSON.stringify([mcpFixture])); await window.getByLabel("MCP environment").fill(JSON.stringify({ VOIDRA_CALENDAR_STATE_PATH: calendarState })); await window.getByRole("button", { name: "Add custom connection" }).click(); await expect(window.getByLabel("MCP connections")).toContainText("Fixture calendar · configured"); await window.getByLabel("MCP connections").getByRole("button", { name: "Connect" }).click(); await expect(window.getByLabel("MCP connections")).toContainText("Fixture calendar · ready");
  await window.getByRole("link", { name: "Today", exact: true }).click(); await window.getByLabel("Plan date").fill("2026-09-20"); await expect(window.getByLabel("Calendar apply tool")).toContainText("Apply calendar changes"); const change = [{ sourceId: "suggested:block-1", title: "Focus block", start: "2026-09-20T09:00:00.000Z", end: "2026-09-20T10:00:00.000Z" }]; await window.getByLabel("Calendar changes").fill(JSON.stringify(change)); await window.getByRole("button", { name: "Review calendar changes" }).click(); await expect(window.getByLabel("Calendar change review")).toContainText("Focus block"); await window.getByRole("button", { name: "Approve exact calendar changes" }).click(); await expect(window.getByRole("status")).toContainText("completed");
  await window.getByRole("button", { name: "Review calendar changes" }).click(); await window.getByRole("button", { name: "Approve exact calendar changes" }).click(); const calendar = JSON.parse(await readFile(calendarState, "utf8")) as { events: unknown[]; keys: string[] }; expect(calendar.events).toHaveLength(1); expect(calendar.keys).toHaveLength(1);
  await window.evaluate(() => globalThis.window.voidra!.diagnostics!.setTestClipboard("planner-sentinel")); await window.getByRole("button", { name: "Prepare Codex handoff" }).click(); await expect(window.getByRole("status")).toContainText("clipboard was not changed");
  expect(await window.evaluate(() => globalThis.window.voidra!.diagnostics!.readTestClipboard())).toBe("planner-sentinel");
  await window.getByRole("link", { name: "Jobs" }).click(); await expect(window.getByLabel("Handoff runs")).toContainText("ready-to-copy");
  await window.getByLabel("Saved routines").getByRole("button", { name: "Edit routine" }).first().click(); await window.getByLabel("Preferred model").fill("user-selected-codex-model"); await window.getByRole("button", { name: "Update routine" }).click(); await expect(window.getByLabel("Saved routines")).toContainText("user-selected-codex-model");
});

test("runs automatic planning through the reviewed file grant", async () => {
  let calls = 0;
  provider = createServer((request, response) => { let raw = ""; request.on("data", (chunk) => { raw += chunk; }); request.on("end", () => { calls += 1; JSON.parse(raw); const event = calls === 1 ? { model: "fixture/planner", choices: [{ delta: { tool_calls: [{ index: 0, id: "plan-write", function: { name: "write_file", arguments: JSON.stringify({ path: "Daily Plans/2026-09-20.md", content: "# Automatic plan\n\n- Reviewed output\n" }) } }] }, finish_reason: "tool_calls" }] } : { model: "fixture/planner", choices: [{ delta: { content: "The daily plan is ready." }, finish_reason: "stop" }] }; response.writeHead(200, { "Content-Type": "text/event-stream" }); response.end(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`); }); });
  await new Promise<void>((resolve) => provider!.listen(0, "127.0.0.1", resolve)); const address = provider.address(); if (!address || typeof address === "string") throw new Error("Provider fixture did not bind.");
  const root = join(temporaryRoot, "Work"); await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), [root], { VOIDRA_OPENROUTER_BASE_URL: `http://127.0.0.1:${address.port}`, VOIDRA_OPENROUTER_TEST_KEY: "fixture-key" }); const window = await application.firstWindow(); await onboard(window, "Work");
  await window.getByLabel("Plan date").fill("2026-09-20"); await window.getByLabel("Plan timezone").fill("UTC"); await window.getByLabel("Planning model").fill("fixture/planner"); await window.getByRole("button", { name: "Run automatic planner" }).click(); await expect(window.getByRole("status")).toContainText("started");
  await window.getByRole("link", { name: "Assistant" }).click(); await expect(window.getByLabel("Pending tool action")).toContainText("Daily Plans/2026-09-20.md"); await window.getByRole("button", { name: "Approve exact action" }).click(); await expect(window.getByLabel("Automatic tasks")).toContainText("completed"); await expect(window.getByLabel("Automatic task output")).toContainText("daily plan is ready");
  expect(await readFile(join(root, "Daily Plans", "2026-09-20.md"), "utf8")).toContain("Reviewed output"); expect(calls).toBe(2);
  await window.getByRole("link", { name: "Jobs" }).click(); await expect(window.getByLabel("Cataloged outputs")).toContainText("2026-09-20.md"); await expect(window.getByLabel("Cataloged outputs")).toContainText("markdown · openrouter");
});

test("keeps workspace schedules independent and deduplicates awake catch-up", async () => {
  const workRoot = join(temporaryRoot, "Work"); const personalRoot = join(temporaryRoot, "Personal"); const profile = join(temporaryRoot, "profile"); await Promise.all([mkdir(workRoot), mkdir(personalRoot)]);
  application = await launch(profile, [workRoot, personalRoot]); let window = await application.firstWindow(); await onboard(window, "Work"); await window.getByRole("link", { name: "Jobs" }).click();
  await window.getByLabel("Schedule name").fill("Work morning"); await window.getByLabel("Schedule timezone").fill("UTC"); await window.getByRole("button", { name: "Create schedule" }).click(); await expect(window.getByLabel("Routine schedules")).toContainText("Work morning");
  await window.getByRole("button", { name: "Add workspace" }).click(); await onboard(window, "Personal"); await window.getByRole("link", { name: "Jobs" }).click(); await window.getByLabel("Schedule name").fill("Personal morning"); await window.getByLabel("Schedule timezone").fill("UTC"); await window.getByRole("button", { name: "Create schedule" }).click(); await expect(window.getByLabel("Routine schedules")).toContainText("Personal morning");
  const workRegistry = JSON.parse(await readFile(join(workRoot, ".voidra", "planner.json"), "utf8")) as { schedules: Array<{ nextOccurrence: string }> }; const personalRegistry = JSON.parse(await readFile(join(personalRoot, ".voidra", "planner.json"), "utf8")) as { schedules: Array<{ nextOccurrence: string }> };
  const due = new Date(Math.max(new Date(workRegistry.schedules[0]!.nextOccurrence).getTime(), new Date(personalRegistry.schedules[0]!.nextOccurrence).getTime()) + 60_000).toISOString();
  await window.evaluate(() => globalThis.window.voidra!.diagnostics!.setTestClipboard("schedule-sentinel"));
  const tick = async () => window.evaluate(async (now) => globalThis.window.voidra!.service.request({ requestId: crypto.randomUUID(), workspaceId: (document.querySelector('[aria-label="Current workspace"]') as HTMLSelectElement).value, sessionId: crypto.randomUUID(), operation: "schedule.tick", payload: { now } }), due);
  expect((await tick()).ok).toBe(true); await expect(window.getByLabel("Scheduled run history")).toContainText("ready-to-copy"); expect(await window.evaluate(() => globalThis.window.voidra!.diagnostics!.readTestClipboard())).toBe("schedule-sentinel");
  const afterFirst = JSON.parse(await readFile(join(workRoot, ".voidra", "planner.json"), "utf8")) as { occurrences: unknown[] }; expect(afterFirst.occurrences).toHaveLength(1); await tick(); const afterDuplicate = JSON.parse(await readFile(join(workRoot, ".voidra", "planner.json"), "utf8")) as { occurrences: unknown[] }; expect(afterDuplicate.occurrences).toHaveLength(1);
  await window.getByLabel("Current workspace").selectOption({ label: "Work" }); await expect(window.getByLabel("Routine schedules")).toContainText("Work morning"); await expect(window.getByLabel("Routine schedules")).not.toContainText("Personal morning"); await expect(window.getByLabel("Scheduled run history")).toContainText("ready-to-copy");
  await window.getByLabel("Routine schedules").getByRole("button", { name: "Disable" }).click(); await expect(window.getByLabel("Routine schedules")).toContainText("Work morning · disabled"); const disabled = JSON.parse(await readFile(join(workRoot, ".voidra", "planner.json"), "utf8")) as { schedules: Array<{ nextOccurrence: string | null }> }; expect(disabled.schedules[0]!.nextOccurrence).toBeNull();
  await application.close(); application = await launch(profile); window = await application.firstWindow(); await window.getByRole("link", { name: "Jobs" }).click(); await expect(window.getByLabel("Routine schedules")).toContainText("Work morning · disabled"); await expect(window.getByLabel("Scheduled run history")).toContainText("ready-to-copy");
});
