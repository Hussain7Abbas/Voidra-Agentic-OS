import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let temporaryRoot: string;
let application: ElectronApplication | undefined;

async function launch(profile: string, folderResults: Array<string | null> = []) {
  return electron.launch({ args: [process.cwd()], env: { ...process.env, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile, VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify(folderResults) } });
}

async function onboard(window: Page, name = "Work") {
  await expect(window.getByTestId("workspace-dialog")).toBeVisible();
  await window.getByLabel("Workspace name").fill(name);
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await expect(window.getByTestId("workspace-dialog")).toBeHidden();
}

async function createRoutine(window: Page, client: "Claude" | "Codex" = "Claude", model = "use current client model") {
  await window.getByRole("link", { name: "Jobs" }).click();
  await window.getByRole("button", { name: "Create skill" }).click();
  await expect(window.getByLabel("Saved skills")).toContainText("Daily brief");
  await window.getByLabel("Subscription client").selectOption(client.toLowerCase());
  await window.getByLabel("Preferred model").fill(model);
  await window.getByRole("button", { name: "Create routine" }).click();
  await expect(window.getByLabel("Saved routines")).toContainText(model);
}

async function compileAndCopy(window: Page) {
  await window.getByRole("button", { name: "Compile prompt" }).click();
  await expect(window.getByLabel("Compiled prompt")).toBeVisible();
  const prompt = await window.getByLabel("Compiled prompt").inputValue();
  await window.getByRole("button", { name: "Copy Prompt" }).click();
  await expect(window.getByRole("status")).toContainText("Awaiting a result");
  return prompt;
}

test.beforeEach(async () => { temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-handoff-e2e-")); });
test.afterEach(async () => { if (application) await application.close().catch(() => undefined); application = undefined; await rm(temporaryRoot, { recursive: true, force: true }); });

test("creates a Claude routine without API keys and copies the exact reviewed prompt", async () => {
  const root = join(temporaryRoot, "Work");
  await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), [root]);
  const window = await application.firstWindow();
  await onboard(window);
  await createRoutine(window, "Claude", "claude-user-choice");
  const prompt = await compileAndCopy(window);
  const clipboard = await window.evaluate(() => globalThis.window.voidra!.diagnostics!.readTestClipboard());
  expect(clipboard).toBe(prompt);
  await expect(window.getByLabel("Handoff runs")).toContainText("awaiting-result");
  expect(prompt).toContain("The user must select this model in the destination client");
});

test("duplicates a routine for Codex and preserves both preferences across restart", async () => {
  const root = join(temporaryRoot, "Work");
  const profile = join(temporaryRoot, "profile");
  await mkdir(root);
  application = await launch(profile, [root]);
  let window = await application.firstWindow();
  await onboard(window);
  await createRoutine(window, "Claude", "claude-opus-user-choice");
  await window.getByRole("button", { name: "Duplicate for other client" }).last().click();
  await expect(window.getByLabel("Saved routines")).toContainText("Codex");
  await application.evaluate(({ app }) => app.quit());
  await application.close();
  application = await launch(profile);
  window = await application.firstWindow();
  await window.getByRole("link", { name: "Jobs" }).click();
  await expect(window.getByLabel("Saved routines")).toContainText("claude-opus-user-choice");
  await expect(window.getByLabel("Saved routines")).toContainText("codex");
  await expect(window.getByLabel("Current workspace").locator("option:checked")).toHaveText("Work");
});

test("compiled context includes root and child rules but excludes sibling instructions", async () => {
  const root = join(temporaryRoot, "Work");
  await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), [root]);
  const window = await application.firstWindow();
  await onboard(window);
  await Promise.all([mkdir(join(root, "project")), mkdir(join(root, "sibling"))]);
  await Promise.all([
    writeFile(join(root, "project", "AGENTS.md"), "Child target rule."), writeFile(join(root, "project", "CLAUDE.md"), "@AGENTS.md\n"),
    writeFile(join(root, "sibling", "AGENTS.md"), "Sibling private sentinel."), writeFile(join(root, "sibling", "CLAUDE.md"), "@AGENTS.md\n"),
    writeFile(join(root, "project", "today.md"), "target"),
  ]);
  await createRoutine(window);
  await window.getByLabel("Target path").fill("project/today.md");
  await window.getByRole("button", { name: "Compile prompt" }).click();
  const prompt = await window.getByLabel("Compiled prompt").inputValue();
  expect(prompt).toContain("Voidra workspace instructions");
  expect(prompt).toContain("Child target rule");
  expect(prompt).not.toContain("Sibling private sentinel");
});

test("scheduled manual preparation leaves the clipboard sentinel untouched", async () => {
  const root = join(temporaryRoot, "Work");
  await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), [root]);
  const window = await application.firstWindow();
  await onboard(window);
  await createRoutine(window);
  await window.evaluate(() => globalThis.window.voidra!.diagnostics!.setTestClipboard("sentinel-do-not-overwrite"));
  await window.getByRole("button", { name: "Prepare scheduled handoff" }).click();
  await expect(window.getByRole("status")).toContainText("Clipboard was not changed");
  expect(await window.evaluate(() => globalThis.window.voidra!.diagnostics!.readTestClipboard())).toBe("sentinel-do-not-overwrite");
  await expect(window.getByLabel("Handoff runs")).toContainText("ready-to-copy");
});

test("launches a pinned skill through a supervised Codex routine without creating a manual handoff", async () => {
  const root = join(temporaryRoot, "Work");
  const bin = join(temporaryRoot, "bin");
  await Promise.all([mkdir(root), mkdir(bin)]);
  const executable = join(bin, "codex");
  await writeFile(executable, `#!/usr/bin/env node\nif(process.argv.includes("--version")){console.log("codex e2e fixture 1.0");process.exit(0)}let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>console.log(JSON.stringify({type:"result",prompt:input})))\n`);
  await chmod(executable, 0o755);
  application = await launch(join(temporaryRoot, "profile"), [root]);
  const window = await application.firstWindow();
  await onboard(window);
  await window.getByRole("link", { name: "Jobs" }).click();
  await window.getByRole("button", { name: "Create skill" }).click();
  await window.getByLabel("Subscription client").selectOption("codex");
  await window.getByLabel("Routine execution profile").selectOption("headless");
  await window.getByLabel("Routine headless executable").fill(executable);
  await window.getByLabel("Routine headless filesystem profile").selectOption("read-only");
  await window.getByRole("button", { name: "Create routine" }).click();
  await expect(window.getByLabel("Saved routines")).toContainText("headless · codex");
  await window.getByRole("button", { name: "Run supervised headless" }).click();
  await expect(window.getByRole("status").last()).toContainText("started from the pinned skill snapshot");
  await expect(window.getByLabel("Headless run history")).toContainText("codex · completed", { timeout: 15_000 });
  await expect(window.getByLabel("Unified run timeline")).toContainText("completed · Routine", { timeout: 10_000 });
  const registry = JSON.parse(await readFile(join(root, ".voidra", "headless-runs.json"), "utf8")) as Array<{ status: string; provenance: { routineId: string; trigger: string; skillBundleDigest: string; contextManifestDigest: string } }>;
  expect(registry[0]).toMatchObject({ status: "completed", provenance: { trigger: "manual" } });
  expect(registry[0]!.provenance.skillBundleDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(registry[0]!.provenance.contextManifestDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.parse(await readFile(join(root, ".voidra", "handoffs.json"), "utf8"))).toMatchObject({ runs: [] });
});

test("reviews and applies a returned note while rejecting output traversal", async () => {
  const root = join(temporaryRoot, "Work");
  await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), [root]);
  const window = await application.firstWindow();
  await onboard(window);
  await createRoutine(window);
  await compileAndCopy(window);
  await window.getByLabel("Returned result").fill("The subscription client returned a brief.");
  await window.getByLabel("Result output path").fill("../outside.md");
  await window.getByRole("button", { name: "Preview local changes" }).click();
  await expect(window.getByRole("status")).toContainText("escapes the granted output directory");
  await window.getByLabel("Result output path").fill("daily.md");
  await window.getByLabel("Result output content").fill("# Applied brief\n\nReviewed by the user.\n");
  await window.getByRole("button", { name: "Preview local changes" }).click();
  await expect(window.getByLabel("Result change preview")).toContainText("(new file)");
  await window.getByRole("button", { name: "Apply reviewed output" }).click();
  await expect(window.getByRole("status")).toContainText("Reviewed output applied");
  await expect(window.getByLabel("Cataloged outputs")).toContainText("markdown · manual-claude");
  expect(await readFile(join(root, "outputs", "daily.md"), "utf8")).toContain("Applied brief");
  await window.getByRole("button", { name: "Mark externally complete" }).click();
  await expect(window.getByLabel("Handoff runs")).toContainText("completed");
});
