import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let temporaryRoot: string;
let application: ElectronApplication | undefined;

async function launch(profile: string, folderResults: Array<string | null> = []) {
  return electron.launch({
    args: [process.cwd()],
    env: { ...process.env, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile, VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify(folderResults) },
  });
}

async function quit(app: ElectronApplication) {
  await app.evaluate(({ app }) => app.quit());
  await app.close();
}

async function onboard(window: Page, name = "Notes") {
  await window.getByLabel("Workspace name").fill(name);
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await expect(window.getByTestId("workspace-dialog")).toBeHidden();
  await window.getByRole("link", { name: "Notes" }).click();
  await expect(window.locator(".notes-workbench")).toBeVisible();
}

async function createNote(window: Page, path: string) {
  await window.getByLabel("New note path").fill(path);
  await window.locator(".note-toolbar").getByRole("button", { name: "+" }).click();
  await expect(window.getByLabel("Note path", { exact: true })).toHaveValue(path.endsWith(".md") ? path : `${path}.md`);
}

async function setEditor(window: Page, content: string) {
  const editor = window.locator(".cm-content");
  await editor.fill(content);
  await expect(window.getByTestId("save-state")).toHaveText("Unsaved");
}

async function save(window: Page) {
  await window.getByRole("button", { name: "Save", exact: true }).click();
  await expect(window.getByTestId("save-state")).toHaveText("Saved");
}

test.beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-notes-e2e-"));
});

test.afterEach(async () => {
  if (application) await application.close().catch(() => undefined);
  application = undefined;
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("creates, previews, follows, and reopens canonical Markdown", async () => {
  const profile = join(temporaryRoot, "profile");
  const root = join(temporaryRoot, "Workspace");
  await mkdir(root);
  application = await launch(profile, [root]);
  let window = await application.firstWindow();
  await onboard(window);
  await createNote(window, "Target.md");
  await setEditor(window, "# Target\n\nDestination text.");
  await save(window);
  await createNote(window, "Home.md");
  await setEditor(window, "# Home\n\n[[Target]] and **bold**.\n\n<script>window.pwned=true</script>");
  await save(window);
  await expect(window.locator(".markdown-preview h1")).toHaveText("Home");
  await expect(window.locator(".markdown-preview strong")).toHaveText("bold");
  await expect(window.locator(".markdown-preview script")).toHaveCount(0);
  await window.locator('.markdown-preview a[data-note-target="Target"]').click();
  await expect(window.getByLabel("Note path", { exact: true })).toHaveValue("Target.md");
  await expect(readFile(join(root, "knowledge", "Home.md"), "utf8")).resolves.toContain("[[Target]]");
  await quit(application);

  application = await launch(profile);
  window = await application.firstWindow();
  await window.getByRole("link", { name: "Notes" }).click();
  await window.locator(".note-list").getByRole("button", { name: /Home/ }).click();
  await expect(window.locator(".markdown-preview h1")).toHaveText("Home");
});

test("rename updates resolved links and backlinks without rewriting prose", async () => {
  const root = join(temporaryRoot, "Workspace");
  await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), [root]);
  const window = await application.firstWindow();
  await onboard(window);
  await createNote(window, "Target.md");
  await setEditor(window, "# Target\n");
  await save(window);
  await createNote(window, "Source.md");
  await setEditor(window, "Target prose remains. [[Target|linked target]].");
  await save(window);
  await window.locator(".note-list").getByRole("button", { name: /Target/ }).click();
  await expect(window.locator(".note-context details").first()).toContainText("Source");
  await window.getByLabel("Note path", { exact: true }).fill("projects/Renamed.md");
  const renameButton = window.getByRole("button", { name: "Rename", exact: true });
  await renameButton.click();
  await expect(renameButton).toBeDisabled();
  await expect(window.getByLabel("Note path", { exact: true })).toHaveValue("projects/Renamed.md");
  expect(await readFile(join(root, "knowledge", "Source.md"), "utf8")).toBe("Target prose remains. [[projects/Renamed|linked target]].");
  await window.locator(".note-list").getByRole("button", { name: /Source/ }).click();
  const outgoing = window.locator(".note-context details").filter({ hasText: "Outgoing links" });
  await outgoing.locator("summary").click();
  await expect(outgoing).toContainText("linked target · resolved");
  await outgoing.getByRole("button", { name: /linked target/ }).click();
  await expect(window.getByLabel("Note path", { exact: true })).toHaveValue("projects/Renamed.md");
  await expect(window.locator(".note-context details").first()).toContainText("Source");
});

test("external edits open a recoverable conflict without discarding either version", async () => {
  const root = join(temporaryRoot, "Workspace");
  await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), [root]);
  const window = await application.firstWindow();
  await onboard(window);
  await createNote(window, "Conflict.md");
  await setEditor(window, "Original");
  await save(window);
  await setEditor(window, "Editor version");
  await writeFile(join(root, "knowledge", "Conflict.md"), "External version");
  await window.getByRole("button", { name: "Save", exact: true }).click();
  const conflict = window.getByRole("dialog", { name: "This note changed on disk" });
  await expect(conflict).toContainText("External version");
  await expect(conflict).toContainText("Editor version");
  expect(await readFile(join(root, "knowledge", "Conflict.md"), "utf8")).toBe("External version");
  await conflict.getByRole("button", { name: "Keep my version" }).click();
  await expect(conflict).toBeHidden();
  expect(await readFile(join(root, "knowledge", "Conflict.md"), "utf8")).toBe("Editor version");
  await window.getByText(/History \(/).click();
  await expect(window.locator(".note-context")).toContainText("conflict-disk");
  await expect(window.locator(".note-context")).toContainText("conflict-editor");
});

test("revision restore survives restart and index deletion rebuilds search", async () => {
  const profile = join(temporaryRoot, "profile");
  const root = join(temporaryRoot, "Workspace");
  await mkdir(root);
  application = await launch(profile, [root]);
  let window = await application.firstWindow();
  await onboard(window);
  await createNote(window, "History.md");
  await setEditor(window, "Version one searchable");
  await save(window);
  await setEditor(window, "Version two current");
  await save(window);
  const historyDetails = window.locator(".note-context details").filter({ hasText: "History" });
  await historyDetails.locator("summary").click();
  await historyDetails.getByRole("button").first().click();
  await expect(window.locator(".cm-content")).toContainText("Version one searchable");
  await quit(application);
  await Promise.all(["index.sqlite", "index.sqlite-wal", "index.sqlite-shm"].map((name) => rm(join(root, ".voidra", name), { force: true })));

  application = await launch(profile);
  window = await application.firstWindow();
  await window.getByRole("link", { name: "Notes" }).click();
  await window.getByLabel("Search notes").fill("searchable");
  await window.getByRole("button", { name: "Search" }).click();
  await expect(window.locator(".note-list")).toContainText("History");
  await window.locator(".note-list").getByRole("button", { name: /History/ }).click();
  await expect(window.locator(".cm-content")).toContainText("Version one searchable");
});
