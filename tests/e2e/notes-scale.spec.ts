import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CORPUS_SIZE = 10_000;

async function launch(profile: string, folderResults: Array<string | null> = []) {
  return electron.launch({
    args: [process.cwd()],
    env: { ...process.env, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile, VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify(folderResults) },
  });
}

async function quit(application: ElectronApplication) {
  await application.evaluate(({ app }) => app.quit());
  await application.close();
}

test("indexes and navigates the provisional 10,000-note corpus", async () => {
  test.setTimeout(180_000);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-notes-scale-"));
  const profile = join(temporaryRoot, "profile");
  const workspace = join(temporaryRoot, "Workspace");
  await mkdir(workspace);
  let application: ElectronApplication | undefined;
  try {
    application = await launch(profile, [workspace]);
    let window = await application.firstWindow();
    await window.getByLabel("Workspace name").fill("Scale");
    await window.getByRole("button", { name: "Choose workspace folder" }).click();
    await window.getByRole("button", { name: "Create workspace" }).click();
    await expect(window.getByTestId("workspace-dialog")).toBeHidden();
    await quit(application);
    application = undefined;

    const knowledge = join(workspace, "knowledge");
    for (let directoryIndex = 0; directoryIndex < 100; directoryIndex += 1) {
      const directory = join(knowledge, `group-${String(directoryIndex).padStart(2, "0")}`);
      await mkdir(directory, { recursive: true });
      await Promise.all(Array.from({ length: 100 }, (_, fileIndex) => {
        const index = directoryIndex * 100 + fileIndex;
        const id = String(index).padStart(5, "0");
        return writeFile(join(directory, `Note-${id}.md`), `# Note ${id}\n\nCorpus token ${id} #scale/group-${directoryIndex}\n\n[[Note-${String((index + 1) % CORPUS_SIZE).padStart(5, "0")}]]\n`);
      }));
    }

    const launchStarted = performance.now();
    application = await launch(profile);
    window = await application.firstWindow();
    await window.getByRole("link", { name: "Notes" }).click();
    await expect(window.locator(".note-list-limit")).toContainText("10,000 notes", { timeout: 120_000 });
    const firstCorpusListMs = Math.round(performance.now() - launchStarted);

    const graphStarted = performance.now();
    await window.getByRole("link", { name: "Graph" }).click();
    await expect(window.locator(".knowledge-graph")).toHaveAttribute("aria-label", /10000 notes/);
    const graphMs = Math.round(performance.now() - graphStarted);
    await window.getByRole("link", { name: "Notes" }).click();
    await expect(window.locator(".note-list-limit")).toContainText("10,000 notes");

    const searchStarted = performance.now();
    await window.getByLabel("Search notes").fill("09999");
    await window.getByRole("button", { name: "Search" }).click();
    await expect(window.locator(".note-list")).toContainText("Note 09999");
    const searchMs = Math.round(performance.now() - searchStarted);

    const openStarted = performance.now();
    await window.locator(".note-list").getByRole("button", { name: /Note 09999/ }).click();
    await expect(window.locator(".cm-content")).toContainText("Corpus token 09999");
    const noteOpenMs = Math.round(performance.now() - openStarted);

    const editStarted = performance.now();
    await window.locator(".cm-content").press("End");
    await window.locator(".cm-content").pressSequentially(" measured");
    await expect(window.getByTestId("save-state")).toHaveText("Unsaved");
    const editMs = Math.round(performance.now() - editStarted);

    const metrics = await application.evaluate(({ app }) => app.getAppMetrics().map(({ type, memory }) => ({ type, workingSetKb: memory.workingSetSize })));
    const workingSetMb = Math.round(metrics.reduce((total, metric) => total + metric.workingSetKb, 0) / 1024);
    console.log(JSON.stringify({ corpusSize: CORPUS_SIZE, firstCorpusListMs, graphMs, searchMs, noteOpenMs, editMs, workingSetMb, metrics }));
  } finally {
    if (application) await application.close().catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
