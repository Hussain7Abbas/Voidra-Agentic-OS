import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("bounds a 10,000-version artifact catalog before it reaches the renderer", async () => {
  test.setTimeout(120_000);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-artifact-scale-")); const profile = join(temporaryRoot, "profile"); const workspace = join(temporaryRoot, "Workspace");
  await mkdir(workspace); let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile, VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify([workspace]) } });
    let window = await application.firstWindow(); await window.getByLabel("Workspace name").fill("Artifact Scale"); await window.getByRole("button", { name: "Choose workspace folder" }).click(); await window.getByRole("button", { name: "Create workspace" }).click(); await expect(window.getByTestId("workspace-dialog")).toBeHidden();
    await application.evaluate(({ app }) => app.quit()); await application.close(); application = undefined;
    const workspaceManifest = JSON.parse(await readFile(join(workspace, ".voidra", "workspace.json"), "utf8")) as { workspaceId: string }; const canonicalWorkspace = await realpath(workspace);
    const now = Date.now();
    const records = Array.from({ length: 10_000 }, (_, index) => {
      const id = randomUUID(); const updatedAt = new Date(now - index * 1_000).toISOString();
      return { id, workspaceId: workspaceManifest.workspaceId, runId: null, name: `Artifact ${String(index).padStart(5, "0")}`, entryFile: "dist/index.html", sourceNoteIds: [], files: ["artifact.json", "src/Artifact.tsx", "dist/index.html"], revision: String(index).padStart(64, "0"), createdAt: updatedAt, updatedAt, root: join(canonicalWorkspace, ".voidra", "artifacts", id), kind: "component", reviewState: "approved", sourceDigest: "a".repeat(64), bundleDigest: "b".repeat(64), requestedCapabilities: [], grants: [], securityReview: null };
    });
    await writeFile(join(workspace, ".voidra", "artifacts.json"), `${JSON.stringify(records)}\n`);
    const started = performance.now(); application = await electron.launch({ args: [process.cwd()], env: { ...process.env, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile } }); window = await application.firstWindow();
    await expect(window.getByRole("region", { name: "Artifact Scale command center" })).toBeVisible();
    await expect(window.getByLabel("Approved artifact ring").getByRole("link")).toHaveCount(10);
    const returned = await window.evaluate(({ workspaceId, root }) => globalThis.window.voidra!.artifacts.list(workspaceId, root), { workspaceId: workspaceManifest.workspaceId, root: workspace });
    expect(returned).toHaveLength(500); expect(returned[0]?.name).toBe("Artifact 00000");
    const searched = await window.evaluate(({ workspaceId, root }) => globalThis.window.voidra!.artifacts.search(workspaceId, root, { query: "Artifact 09999", limit: 20 }), { workspaceId: workspaceManifest.workspaceId, root: workspace });
    expect(searched).toHaveLength(1); expect(searched[0]?.name).toBe("Artifact 09999");
    const metrics = await application.evaluate(({ app }) => app.getAppMetrics().reduce((total, entry) => total + entry.memory.workingSetSize, 0));
    console.log(JSON.stringify({ artifactVersions: records.length, rendererRecords: returned.length, loadMs: Math.round(performance.now() - started), workingSetMb: Math.round(metrics / 1024) }));
  } finally { if (application) await application.close().catch(() => undefined); await rm(temporaryRoot, { recursive: true, force: true }); }
});
