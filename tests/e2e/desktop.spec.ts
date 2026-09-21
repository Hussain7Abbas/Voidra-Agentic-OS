import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let temporaryRoot: string;
let application: ElectronApplication | undefined;

async function launch(profile: string, folderResults: Array<string | null> = []) {
  return electron.launch({
    args: [process.cwd()],
    env: {
      ...process.env,
      VOIDRA_E2E: "1",
      VOIDRA_USER_DATA_DIR: profile,
      VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify(folderResults),
    },
  });
}

async function quit(app: ElectronApplication) {
  await app.evaluate(({ app }) => app.quit());
  await app.close();
}

async function createWorkspace(window: Page, name: string) {
  await expect(window.getByTestId("workspace-dialog")).toBeVisible();
  await window.getByLabel("Workspace name").fill(name);
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await expect(window.getByTestId("workspace-dialog")).toBeHidden();
  await expect(window.getByLabel("Current workspace")).toHaveValue(/.+/);
}

async function addWorkspace(window: Page, name: string) {
  await window.getByRole("button", { name: "Add workspace" }).click();
  await createWorkspace(window, name);
}

test.beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-e2e-"));
});

test.afterEach(async () => {
  if (application) await application.close().catch(() => undefined);
  application = undefined;
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("command center preserves the ARMS overview and respects reduced motion", async () => {
  const profile = join(temporaryRoot, "profile");
  const work = join(temporaryRoot, "Work");
  await mkdir(work);
  application = await launch(profile, [work]);
  const window = await application.firstWindow();
  await createWorkspace(window, "Work");

  const commandCenter = window.getByRole("region", { name: "Work command center" });
  await expect(commandCenter).toBeVisible();
  await expect(window.locator(".sidebar")).toHaveCount(0);
  await expect(window.locator(".topbar")).toHaveCount(0);
  await expect(window.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(commandCenter.getByText("VOIDRA AGENTIC OS")).toBeVisible();
  await expect(commandCenter.locator(".cc-brain-toolbar").getByText("Second brain", { exact: true })).toBeVisible();
  await expect(commandCenter.locator(".cc-skills").getByText("Skills deck", { exact: true })).toBeVisible();
  await expect(commandCenter.locator(".cc-routines").getByText("Routines", { exact: true })).toBeVisible();
  await expect(commandCenter.locator(".cc-artifact-title").getByText("Artifact ring", { exact: true })).toBeVisible();
  await expect(commandCenter.getByLabel("Search command center")).toBeVisible();

  const core = commandCenter.locator(".kg-cloud");
  await expect.poll(() => core.evaluate((element) => getComputedStyle(element).animationName)).toContain("kg-cloud-drift");
  await window.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => core.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});

test("persists keyboard layout edits, searches across domains, supports zoom, and rolls V2 UI back without deleting data", async () => {
  const profile = join(temporaryRoot, "profile"); const work = join(temporaryRoot, "Work"); await mkdir(work); application = await launch(profile, [work]); let window = await application.firstWindow(); await createWorkspace(window, "Work");
  await window.getByRole("link", { name: /Review and run/ }).first().click(); await expect(window).toHaveURL(/\/jobs\/\?entity=skill:/); await expect(window.getByLabel("Compile routine")).toHaveValue(/.+/); await window.getByRole("link", { name: "Today" }).click();
  await window.getByRole("button", { name: "Edit dashboard layout" }).click(); await window.getByRole("button", { name: "Hide pulse" }).click(); await window.getByRole("button", { name: "Save layout" }).click(); await expect(window.locator(".cc-pulse-widget")).toBeHidden();
  await window.keyboard.press("Meta+K"); const palette = window.getByRole("dialog", { name: "Command the workspace" }); await expect(palette).toBeVisible(); await palette.getByLabel("Search destinations").fill("Plan the Day"); await expect(palette).toContainText(/skill · workspace|routine · workspace/); await window.keyboard.press("Escape");
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2)); await expect(window.getByRole("navigation", { name: "Primary navigation" })).toBeVisible(); await expect(window.locator(".sidebar")).toHaveCount(0); await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1));
  await window.getByRole("link", { name: "Settings" }).click(); const flags = window.getByLabel("V2 feature rollback controls"); await flags.getByRole("checkbox", { name: /command-center/ }).click(); await expect(flags.getByRole("checkbox", { name: /command-center/ })).not.toBeChecked(); await window.getByRole("link", { name: "Today" }).click(); await expect(window.getByText("V2 dashboard rollback is active.")).toBeVisible(); expect(await readFile(join(work, ".voidra", "dashboard-layout.json"), "utf8")).toContain('"pulse"');
  await window.getByRole("link", { name: "Settings" }).click(); const commandFlag = window.getByLabel("V2 feature rollback controls").getByRole("checkbox", { name: /command-center/ }); await commandFlag.click(); await expect(commandFlag).toBeChecked(); await quit(application); application = await launch(profile); window = await application.firstWindow(); await window.getByRole("link", { name: "Today" }).click(); await expect(window.getByRole("region", { name: "Work command center" })).toBeVisible(); await expect(window.locator(".cc-pulse-widget")).toBeHidden();
});

test("first launch creates two roots and restores selection and route", async () => {
  const profile = join(temporaryRoot, "profile");
  const work = join(temporaryRoot, "Work");
  const personal = join(temporaryRoot, "Personal");
  await Promise.all([mkdir(work), mkdir(personal)]);
  application = await launch(profile, [work, personal]);
  let window = await application.firstWindow();
  await createWorkspace(window, "Work");
  const workId = await window.getByTestId("workspace-id").textContent();
  await addWorkspace(window, "Personal");
  await window.getByRole("link", { name: "Notes" }).click();
  await expect(window.getByRole("heading", { name: "Notes" })).toBeVisible();
  await quit(application);

  application = await launch(profile);
  window = await application.firstWindow();
  await expect(window.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(window.getByLabel("Current workspace")).toHaveValue(workId!);
  await expect(window.getByLabel("Current workspace").locator("option")).toHaveCount(2);
  await expect(readFile(join(work, "CLAUDE.md"), "utf8")).resolves.toBe("@AGENTS.md\n");
  await expect(readFile(join(personal, ".voidra", "workspace.json"), "utf8")).resolves.toContain("Personal");
});

test("ask-on-startup presents an explicit workspace launcher", async () => {
  const profile = join(temporaryRoot, "profile");
  const work = join(temporaryRoot, "Work");
  const personal = join(temporaryRoot, "Personal");
  await Promise.all([mkdir(work), mkdir(personal)]);
  application = await launch(profile, [work, personal]);
  let window = await application.firstWindow();
  await createWorkspace(window, "Work");
  await addWorkspace(window, "Personal");
  await window.getByRole("link", { name: "Settings" }).click();
  await window.getByLabel("Ask on startup").check();
  await quit(application);

  application = await launch(profile);
  window = await application.firstWindow();
  const launcher = window.getByTestId("workspace-launcher");
  await expect(launcher).toBeVisible();
  await launcher.getByRole("button").filter({ hasText: "Personal" }).click();
  await expect(launcher).toBeHidden();
  await expect(window.getByLabel("Current workspace").locator("option:checked")).toHaveText("Personal");
});

test("folder selection cancellation and duplicate roots leave no partial workspace", async () => {
  const profile = join(temporaryRoot, "profile");
  const work = join(temporaryRoot, "Work");
  await mkdir(work);
  application = await launch(profile, [null, work, work]);
  const window = await application.firstWindow();
  await window.getByLabel("Workspace name").fill("Work");
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await expect(window.getByTestId("workspace-folder-result")).toHaveText(/canceled/i);
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await expect(window.getByTestId("workspace-dialog")).toBeHidden();

  await window.getByRole("button", { name: "Add workspace" }).click();
  await window.getByLabel("Workspace name").fill("Duplicate");
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await expect(window.getByTestId("workspace-folder-result")).toHaveText(/already registered/i);
  await expect(window.getByLabel("Current workspace").locator("option")).toHaveCount(1);
});

test("settings inherit globally and explicit workspace overrides survive changes", async () => {
  const profile = join(temporaryRoot, "profile");
  const work = join(temporaryRoot, "Work");
  const personal = join(temporaryRoot, "Personal");
  await Promise.all([mkdir(work), mkdir(personal)]);
  application = await launch(profile, [work, personal]);
  const window = await application.firstWindow();
  await createWorkspace(window, "Work");
  await addWorkspace(window, "Personal");
  await window.getByLabel("Current workspace").selectOption({ label: "Work" });
  await window.getByRole("link", { name: "Settings" }).click();

  await window.getByLabel("Global preferred model").fill("global/model-a");
  await window.getByLabel("Global persona").fill("Global persona A");
  await window.getByLabel("Global voice enabled").check();
  await window.getByRole("button", { name: "Save global defaults" }).click();
  await expect(window.getByTestId("effective-model")).toHaveText("global/model-a");
  await window.getByLabel("Override workspace model").check();
  await window.getByLabel("Workspace preferred model").fill("work/model");
  await window.getByLabel("Override workspace persona").check();
  await window.getByLabel("Workspace persona", { exact: true }).fill("Work persona");
  await window.getByLabel("Override workspace voice").check();
  await window.getByLabel("Workspace voice value").uncheck();
  await window.getByRole("button", { name: "Save workspace overrides" }).click();
  await expect(window.getByTestId("effective-model")).toHaveText("work/model");

  await window.getByLabel("Current workspace").selectOption({ label: "Personal" });
  await expect(window.getByTestId("effective-model")).toHaveText("global/model-a");
  await window.getByLabel("Global preferred model").fill("global/model-b");
  await window.getByRole("button", { name: "Save global defaults" }).click();
  await expect(window.getByTestId("effective-model")).toHaveText("global/model-b");
  await window.getByLabel("Current workspace").selectOption({ label: "Work" });
  await expect(window.getByTestId("effective-model")).toHaveText("work/model");
  await window.getByLabel("Override workspace model").uncheck();
  await window.getByRole("button", { name: "Save workspace overrides" }).click();
  await expect(window.getByTestId("effective-model")).toHaveText("global/model-b");
  await expect(readFile(join(work, "persona.md"), "utf8")).resolves.toBe("Work persona");
  await expect(readFile(join(personal, "persona.md"), "utf8")).resolves.toContain("inherits the global persona");
});

test("scoped rule UI creates exact pairs and resolves ancestry", async () => {
  const profile = join(temporaryRoot, "profile");
  const root = join(temporaryRoot, "Rules");
  await mkdir(join(root, "project", "child"), { recursive: true });
  await writeFile(join(root, "project", "child", "note.md"), "target");
  application = await launch(profile, [root]);
  const window = await application.firstWindow();
  await createWorkspace(window, "Rules");
  await window.getByRole("link", { name: "Settings" }).click();
  await window.getByLabel("Instruction scope directory").fill("project");
  await window.getByLabel("Instruction scope content").fill("Project-only rules");
  await window.getByRole("button", { name: "Create instruction pair" }).click();
  await expect(window.getByTestId("instruction-result")).toContainText("Created project/AGENTS.md");
  await window.getByLabel("Instruction target path").fill("project/child/note.md");
  await window.getByRole("button", { name: "Resolve applicable rules" }).click();
  await expect(window.getByTestId("instruction-result")).toContainText("project:");
  await expect(readFile(join(root, "project", "AGENTS.md"), "utf8")).resolves.toBe("Project-only rules\n");
  await expect(readFile(join(root, "project", "CLAUDE.md"), "utf8")).resolves.toBe("@AGENTS.md\n");
});

test("an in-flight request retains Work ownership after switching to Personal", async () => {
  const profile = join(temporaryRoot, "profile");
  const work = join(temporaryRoot, "Work");
  const personal = join(temporaryRoot, "Personal");
  await Promise.all([mkdir(work), mkdir(personal)]);
  application = await launch(profile, [work, personal]);
  const window = await application.firstWindow();
  await createWorkspace(window, "Work");
  const workId = await window.getByTestId("workspace-id").textContent();
  await addWorkspace(window, "Personal");
  await window.getByLabel("Current workspace").selectOption({ label: "Work" });
  await window.evaluate((workspaceId) => {
    (globalThis.window as any).__voidraProbe = globalThis.window.voidra!.service.request({
      requestId: crypto.randomUUID(),
      workspaceId,
      sessionId: crypto.randomUUID(),
      operation: "workspace.contextProbe",
      payload: { delayMs: 500 },
    });
  }, workId!);
  await window.getByLabel("Current workspace").selectOption({ label: "Personal" });
  const response = await window.evaluate(() => (globalThis.window as any).__voidraProbe);
  expect(response).toMatchObject({ ok: true, data: { workspaceId: workId, workspaceName: "Work" } });
  await expect(window.getByLabel("Current workspace")).toHaveValue(/.+/);
  await expect(window.getByLabel("Current workspace").locator("option:checked")).toHaveText("Personal");
});

test("moved workspace is unavailable until Locate Folder reconnects the same identity", async () => {
  const profile = join(temporaryRoot, "profile");
  const original = join(temporaryRoot, "Original");
  const moved = join(temporaryRoot, "Moved");
  await mkdir(original);
  application = await launch(profile, [original]);
  let window = await application.firstWindow();
  await createWorkspace(window, "Work");
  const workspaceId = await window.getByTestId("workspace-id").textContent();
  await quit(application);
  await rename(original, moved);

  application = await launch(profile, [moved]);
  window = await application.firstWindow();
  await expect(window.locator(".warning-banner")).toContainText("unavailable");
  await window.getByRole("button", { name: "Locate folder" }).click();
  await expect(window.locator(".warning-banner")).toBeHidden();
  await expect(window.getByTestId("workspace-id")).toHaveText(workspaceId!);
  expect(await realpath(moved)).toContain("Moved");
});

test("service crash is visible and recovers without duplicate state", async () => {
  const root = join(temporaryRoot, "Work");
  await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), [root]);
  const window = await application.firstWindow();
  await createWorkspace(window, "Work");
  await expect(window.getByTestId("service-status")).toHaveText("ready");
  await window.getByRole("button", { name: "Simulate crash" }).click();
  await expect(window.getByTestId("service-status")).toHaveText("Recovered");
});

test("isolated content has no privileged renderer bridge", async () => {
  const root = join(temporaryRoot, "Work");
  await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), [root]);
  const window = await application.firstWindow();
  await createWorkspace(window, "Work");
  await window.getByRole("button", { name: "Test isolation" }).click();
  await expect(window.getByTestId("isolation-result")).toHaveText("Privileged bridge blocked");
});
