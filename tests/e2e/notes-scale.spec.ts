import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const requestedCorpusSize = Number(process.env.VOIDRA_SCALE_NOTES ?? 10_000);
const CORPUS_SIZE = Number.isInteger(requestedCorpusSize) && requestedCorpusSize >= 1_000 && requestedCorpusSize <= 60_000 ? requestedCorpusSize : 10_000;
const GROUP_SIZE = 100;

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

test(`indexes and navigates the ${CORPUS_SIZE.toLocaleString("en-US")}-note corpus with a bounded renderer projection`, async () => {
  test.setTimeout(CORPUS_SIZE > 10_000 ? 600_000 : 180_000);
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
    for (let directoryIndex = 0; directoryIndex < Math.ceil(CORPUS_SIZE / GROUP_SIZE); directoryIndex += 1) {
      const directory = join(knowledge, `group-${String(directoryIndex).padStart(2, "0")}`);
      await mkdir(directory, { recursive: true });
      const filesInGroup = Math.min(GROUP_SIZE, CORPUS_SIZE - directoryIndex * GROUP_SIZE);
      await Promise.all(Array.from({ length: filesInGroup }, (_, fileIndex) => {
        const index = directoryIndex * GROUP_SIZE + fileIndex;
        const id = String(index).padStart(5, "0");
        return writeFile(join(directory, `Note-${id}.md`), `# Note ${id}\n\nCorpus token ${id} #scale/group-${directoryIndex}\n\n[[Note-${String((index + 1) % CORPUS_SIZE).padStart(5, "0")}]]\n`);
      }));
    }

    const launchStarted = performance.now();
    application = await launch(profile);
    window = await application.firstWindow();
    await window.getByRole("link", { name: "Notes" }).click();
    await expect(window.locator(".note-list-limit")).toContainText(`${CORPUS_SIZE.toLocaleString("en-US")} notes`, { timeout: CORPUS_SIZE > 10_000 ? 480_000 : 120_000 });
    const firstCorpusListMs = Math.round(performance.now() - launchStarted);

    const graphStarted = performance.now();
    await window.getByRole("link", { name: "Graph" }).click();
    await expect(window.locator(".knowledge-graph")).toHaveAttribute("aria-label", new RegExp(`${CORPUS_SIZE} notes.*500 records loaded`), { timeout: CORPUS_SIZE > 10_000 ? 480_000 : 120_000 });
    const graphMs = Math.round(performance.now() - graphStarted);
    await window.getByRole("link", { name: "Notes" }).click();
    await expect(window.locator(".note-list-limit")).toContainText(`${CORPUS_SIZE.toLocaleString("en-US")} notes`);

    const searchStarted = performance.now();
    const targetId = String(CORPUS_SIZE - 1).padStart(5, "0");
    await window.getByLabel("Search notes").fill(targetId);
    await window.getByRole("button", { name: "Search" }).click();
    await expect(window.locator(".note-list")).toContainText(`Note ${targetId}`);
    const searchMs = Math.round(performance.now() - searchStarted);

    const openStarted = performance.now();
    await window.locator(".note-list").getByRole("button", { name: new RegExp(`Note ${targetId}`) }).click();
    await expect(window.locator(".cm-content")).toContainText(`Corpus token ${targetId}`);
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
