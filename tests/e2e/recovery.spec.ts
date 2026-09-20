import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let temporaryRoot: string;
let application: ElectronApplication | undefined;

async function launch(profile: string, folderResults: string[] = []) {
  return electron.launch({
    args: [process.cwd()],
    env: { ...process.env, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile, VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify(folderResults) },
  });
}

async function quit(app: ElectronApplication) {
  await app.evaluate(({ app }) => app.quit());
  await app.close();
}

test.beforeEach(async () => { temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-recovery-e2e-")); });
test.afterEach(async () => { if (application) await application.close().catch(() => undefined); application = undefined; await rm(temporaryRoot, { recursive: true, force: true }); });

test("exports a verified workspace and restores durable identity into a clean profile", async () => {
  const sourceProfile = join(temporaryRoot, "source-profile");
  const root = join(temporaryRoot, "Work");
  const shared = join(temporaryRoot, "Shared");
  const backups = join(temporaryRoot, "Backups");
  const restoreParent = join(temporaryRoot, "Restores");
  await Promise.all([mkdir(root), mkdir(shared), mkdir(backups), mkdir(restoreParent)]);
  application = await launch(sourceProfile, [root, shared, backups]);
  let window = await application.firstWindow();
  await window.getByLabel("Workspace name").fill("Work");
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await expect(window.getByTestId("workspace-dialog")).toBeHidden();
  const workspaceId = (await window.getByTestId("workspace-id").textContent())!;
  const createResult = await window.evaluate(async ({ workspaceId }) => globalThis.window.voidra!.service.request({
    requestId: crypto.randomUUID(), workspaceId, sessionId: crypto.randomUUID(), operation: "notes.create", payload: { path: "recovery.md", content: "# Recovery\n\nDurable recovery sentinel.\n" },
  }), { workspaceId });
  expect(createResult.ok).toBe(true);

  await window.getByRole("link", { name: "Settings" }).click();
  await window.getByLabel("Shared base name").fill("Shared");
  await window.getByRole("button", { name: "Choose shared knowledge folder" }).click();
  await window.getByRole("button", { name: "Attach base" }).click();
  await window.getByRole("button", { name: "Export workspace backup" }).click();
  await expect(window.getByRole("status")).toContainText("Backup created at");
  const backupName = (await readdir(backups)).find((name) => name.endsWith(".voidra-backup"));
  expect(backupName).toBeTruthy();
  const backupPath = join(backups, backupName!);
  const manifest = JSON.parse(await readFile(join(backupPath, "manifest.json"), "utf8"));
  expect(manifest.workspace.id).toBe(workspaceId);
  expect(manifest.credentials.exported).toBe(false);
  await quit(application);
  application = undefined;
  await rm(shared, { recursive: true });

  application = await launch(join(temporaryRoot, "restored-profile"), [backupPath, restoreParent]);
  window = await application.firstWindow();
  await window.getByRole("button", { name: "Restore backup" }).click();
  await window.getByLabel("Restored folder name").fill("Restored Work");
  await window.getByRole("button", { name: "Choose .voidra-backup folder" }).click();
  await window.getByRole("button", { name: "Choose restore parent folder" }).click();
  await window.getByRole("button", { name: "Verify and restore" }).click();
  await expect(window.getByTestId("workspace-dialog")).toBeHidden();
  await expect(window.getByTestId("workspace-id")).toHaveText(workspaceId);
  const registry = await window.evaluate(async ({ workspaceId }) => globalThis.window.voidra!.service.request({
    requestId: crypto.randomUUID(), workspaceId, sessionId: crypto.randomUUID(), operation: "workspace.list", payload: {},
  }), { workspaceId });
  const restoredRoot = (registry.ok ? (registry.data as any).workspaces[0].canonicalPath : join(restoreParent, "Restored Work")) as string;
  await expect(readFile(join(restoredRoot, "knowledge", "recovery.md"), "utf8")).resolves.toContain("Durable recovery sentinel");
  const attachments = await window.evaluate(async ({ workspaceId }) => globalThis.window.voidra!.service.request({
    requestId: crypto.randomUUID(), workspaceId, sessionId: crypto.randomUUID(), operation: "knowledge.listAttachments", payload: {},
  }), { workspaceId });
  expect(attachments).toMatchObject({ ok: true, data: { attachments: [{ name: "Shared", available: false }] } });
  await window.getByRole("link", { name: "Notes" }).click();
  await expect(window.getByText("recovery.md", { exact: true })).toBeVisible();
});
