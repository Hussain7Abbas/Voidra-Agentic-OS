import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let temporaryRoot: string;
let application: ElectronApplication | undefined;

async function launch(profile: string, folderResults: Array<string | null> = []) {
  return electron.launch({ args: [process.cwd()], env: { ...process.env, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile, VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify(folderResults) } });
}

async function onboard(window: Page, rootName = "Work") {
  await window.getByLabel("Workspace name").fill(rootName);
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await expect(window.getByTestId("workspace-dialog")).toBeHidden();
}

async function addWorkspace(window: Page, name: string) {
  await window.getByRole("button", { name: "Add workspace" }).click();
  await window.getByLabel("Workspace name").fill(name);
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await expect(window.getByTestId("workspace-dialog")).toBeHidden();
}

async function attachBase(window: Page, name: string, access: "Read only" | "Read and write") {
  await window.getByRole("link", { name: "Settings" }).click();
  await window.getByLabel("Shared base name").fill(name);
  await window.getByRole("button", { name: "Choose shared knowledge folder" }).click();
  await window.getByLabel("Shared base access").selectOption({ label: access });
  await window.getByRole("button", { name: "Attach base" }).click();
  await expect(window.getByRole("status")).toContainText("Shared knowledge attached");
}

async function createPrivateNote(window: Page, path: string, content: string) {
  await window.getByRole("link", { name: "Notes" }).click();
  await window.getByLabel("New note path").fill(path);
  await window.locator(".note-toolbar").getByRole("button", { name: "+" }).click();
  await window.locator(".cm-content").fill(content);
  await window.getByRole("button", { name: "Save", exact: true }).click();
  await expect(window.getByTestId("save-state")).toHaveText("Saved");
}

test.beforeEach(async () => { temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-knowledge-e2e-")); });
test.afterEach(async () => {
  if (application) await application.close().catch(() => undefined);
  application = undefined;
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("shares one physical base with independent write and read-only grants", async () => {
  const profile = join(temporaryRoot, "profile");
  const work = join(temporaryRoot, "Work");
  const personal = join(temporaryRoot, "Personal");
  const shared = join(temporaryRoot, "Learning");
  await Promise.all([mkdir(work), mkdir(personal), mkdir(shared)]);
  application = await launch(profile, [work, personal, shared, shared]);
  const window = await application.firstWindow();
  await onboard(window);
  await addWorkspace(window, "Personal");
  await window.getByLabel("Current workspace").selectOption({ label: "Work" });
  await attachBase(window, "Learning", "Read and write");

  await window.getByRole("link", { name: "Graph" }).click();
  await window.getByLabel("Writable shared base").selectOption({ label: "Learning" });
  await window.getByLabel("New shared note path").fill("Guides/Shared.md");
  await window.getByRole("button", { name: "Create shared note" }).click();
  await window.getByLabel("Knowledge note content").fill("# Shared Guide\n\nComet shared token #learning");
  await window.getByRole("button", { name: "Save shared note" }).click();
  await expect(window.getByRole("status")).toContainText("Shared note saved");
  expect(await readFile(join(shared, "Guides", "Shared.md"), "utf8")).toContain("Comet shared token");

  await window.getByLabel("Current workspace").selectOption({ label: "Personal" });
  await attachBase(window, "Learning", "Read only");
  await window.getByRole("link", { name: "Graph" }).click();
  await window.getByLabel("Search accessible knowledge").fill("Comet");
  await window.getByRole("button", { name: "Search" }).click();
  await window.getByRole("button", { name: /Shared Guide/ }).last().click();
  await expect(window.getByLabel("Knowledge note content")).toHaveValue(/Comet shared token/);
  await expect(window.getByLabel("Knowledge note content")).toHaveAttribute("readonly", "");
  await expect(window.getByRole("button", { name: "Save shared note" })).toBeDisabled();
});

test("search, graph, and delayed retrieval fail closed after detach", async () => {
  const work = join(temporaryRoot, "Work");
  const shared = join(temporaryRoot, "Learning");
  await Promise.all([mkdir(work), mkdir(shared)]);
  await writeFile(join(shared, "Shared.md"), "# Shared\n\nrevoked-visible #focus");
  application = await launch(join(temporaryRoot, "profile"), [work, shared]);
  const window = await application.firstWindow();
  await onboard(window);
  await createPrivateNote(window, "Private.md", "# Private\n\nprivate-only-sentinel");
  await attachBase(window, "Learning", "Read only");
  const workspaceId = await window.getByLabel("Current workspace").inputValue();
  const pending = window.evaluate(async ({ workspaceId }) => globalThis.window.voidra!.service.request({ requestId: crypto.randomUUID(), sessionId: crypto.randomUUID(), workspaceId, operation: "knowledge.search", payload: { query: "revoked-visible", delayMs: 250 } }), { workspaceId });
  await window.getByRole("button", { name: "Detach" }).click();
  const response = await pending;
  expect(response).toMatchObject({ ok: true, data: { results: [] } });
  await window.getByRole("link", { name: "Graph" }).click();
  await window.getByLabel("Search accessible knowledge").fill("revoked-visible");
  await window.getByRole("button", { name: "Search" }).click();
  await expect(window.getByLabel("Knowledge search results")).toHaveCount(0);
  await expect(window.getByLabel("Accessible graph notes")).not.toContainText("Shared");
});

test("tag filtering keeps duplicate titles attributed to the correct bases", async () => {
  const work = join(temporaryRoot, "Work");
  const learning = join(temporaryRoot, "Learning");
  const reference = join(temporaryRoot, "Reference");
  await Promise.all([mkdir(work), mkdir(learning), mkdir(reference)]);
  await writeFile(join(learning, "Target.md"), "# Target\n\nLearning target #focus");
  await writeFile(join(reference, "Target.md"), "# Target\n\nReference target #focus");
  application = await launch(join(temporaryRoot, "profile"), [work, learning, reference]);
  const window = await application.firstWindow();
  await onboard(window);
  await createPrivateNote(window, "Target.md", "# Target\n\nPrivate target #focus");
  await attachBase(window, "Learning", "Read only");
  await attachBase(window, "Reference", "Read only");
  await window.getByRole("link", { name: "Graph" }).click();
  await window.getByLabel("Graph tag").fill("focus");
  await window.getByText("Filter graph to tag").click();
  const list = window.getByLabel("Accessible graph notes");
  await expect(list.getByRole("button", { name: /Target/ })).toHaveCount(3);
  await expect(list).toContainText("Learning");
  await expect(list).toContainText("Reference");
  await expect(list).toContainText("Work");
});

test("workspace memory is editable, persistent, and separate", async () => {
  const profile = join(temporaryRoot, "profile");
  const work = join(temporaryRoot, "Work");
  const personal = join(temporaryRoot, "Personal");
  await Promise.all([mkdir(work), mkdir(personal)]);
  application = await launch(profile, [work, personal]);
  let window = await application.firstWindow();
  await onboard(window);
  await window.getByRole("link", { name: "Assistant" }).click();
  await window.getByLabel("Memory text").fill("Prefers quiet mornings");
  await window.getByRole("button", { name: "Add memory" }).click();
  await expect(window.getByLabel("Workspace memories")).toContainText("Prefers quiet mornings");
  await addWorkspace(window, "Personal");
  await window.getByRole("link", { name: "Assistant" }).click();
  await expect(window.getByLabel("Workspace memories")).not.toContainText("Prefers quiet mornings");
  await window.getByLabel("Current workspace").selectOption({ label: "Work" });
  await expect(window.getByLabel("Workspace memories")).toContainText("Prefers quiet mornings");
  const memoryEditor = window.getByLabel("Workspace memories").locator("textarea");
  await memoryEditor.fill("Prefers late mornings");
  await memoryEditor.blur();
  await expect(window.getByLabel("Workspace memories")).toContainText("Prefers late mornings");
  await application.evaluate(({ app }) => app.quit());
  await application.close();
  application = await launch(profile);
  window = await application.firstWindow();
  await window.getByRole("link", { name: "Assistant" }).click();
  await expect(window.getByLabel("Workspace memories")).toContainText("Prefers late mornings");
  await window.getByRole("button", { name: "Delete" }).click();
  await expect(window.getByLabel("Workspace memories")).not.toContainText("Prefers late mornings");
});

test("unavailable shared base reconnects with the same attachment", async () => {
  const profile = join(temporaryRoot, "profile");
  const work = join(temporaryRoot, "Work");
  const shared = join(temporaryRoot, "Learning");
  const moved = join(temporaryRoot, "Moved Learning");
  await Promise.all([mkdir(work), mkdir(shared)]);
  await writeFile(join(shared, "Move.md"), "# Move\n\nlocation token");
  application = await launch(profile, [work, shared]);
  let window = await application.firstWindow();
  await onboard(window);
  await attachBase(window, "Learning", "Read only");
  await application.evaluate(({ app }) => app.quit());
  await application.close();
  application = undefined;
  await rename(shared, moved);
  application = await launch(profile, [moved]);
  window = await application.firstWindow();
  await window.getByRole("link", { name: "Settings" }).click();
  await expect(window.locator(".attachment-list")).toContainText("unavailable");
  await window.getByRole("button", { name: "Locate" }).click();
  await expect(window.locator(".attachment-list")).toContainText("read");
  await window.getByRole("link", { name: "Graph" }).click();
  await window.getByLabel("Search accessible knowledge").fill("location token");
  await window.getByRole("button", { name: "Search" }).click();
  await expect(window.getByLabel("Knowledge search results")).toContainText("Move");
});
