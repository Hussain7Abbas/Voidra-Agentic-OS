import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("searches and graphs a 10,000-note attached shared base", async () => {
  test.setTimeout(180_000);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-shared-scale-"));
  const workspace = join(temporaryRoot, "Workspace");
  const shared = join(temporaryRoot, "Shared");
  const profile = join(temporaryRoot, "profile");
  await Promise.all([mkdir(workspace), mkdir(shared)]);
  let application: ElectronApplication | undefined;
  try {
    for (let directoryIndex = 0; directoryIndex < 100; directoryIndex += 1) {
      const directory = join(shared, `group-${String(directoryIndex).padStart(2, "0")}`);
      await mkdir(directory);
      await Promise.all(Array.from({ length: 100 }, (_, fileIndex) => {
        const index = directoryIndex * 100 + fileIndex;
        const id = String(index).padStart(5, "0");
        return writeFile(join(directory, `Shared-${id}.md`), `# Shared ${id}\n\nAttached corpus token ${id} #shared/group-${directoryIndex}\n`);
      }));
    }

    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile, VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify([workspace, shared]) } });
    const window = await application.firstWindow();
    await window.getByLabel("Workspace name").fill("Scale");
    await window.getByRole("button", { name: "Choose workspace folder" }).click();
    await window.getByRole("button", { name: "Create workspace" }).click();
    await window.getByRole("link", { name: "Settings" }).click();
    await window.getByLabel("Shared base name").fill("Shared Scale");
    await window.getByRole("button", { name: "Choose shared knowledge folder" }).click();
    await window.getByRole("button", { name: "Attach base" }).click();
    await expect(window.getByRole("status")).toContainText("Shared knowledge attached");

    const graphStarted = performance.now();
    await window.getByRole("link", { name: "Graph" }).click();
    await expect(window.locator(".knowledge-graph")).toHaveAttribute("aria-label", /10000 notes.*500 records loaded/, { timeout: 120_000 });
    const sharedGraphMs = Math.round(performance.now() - graphStarted);

    const searchStarted = performance.now();
    await window.getByLabel("Search accessible knowledge").fill("09999");
    await window.getByRole("button", { name: "Search" }).click();
    await expect(window.getByLabel("Knowledge search results")).toContainText("Shared 09999", { timeout: 120_000 });
    const sharedSearchMs = Math.round(performance.now() - searchStarted);
    console.log(JSON.stringify({ sharedCorpusSize: 10_000, sharedGraphMs, sharedSearchMs }));
  } finally {
    if (application) await application.close().catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
