import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/service/database";
import { OutputCatalogManager } from "../../src/service/output-catalog";

const temporaryDirectories: string[] = [];

async function fixture(name = "Work", id = "018f0f73-89db-7a63-a1b2-5d46f598ed01") {
  const parent = await mkdtemp(join(tmpdir(), "voidra-outputs-")); temporaryDirectories.push(parent); const root = join(parent, name); await mkdir(join(root, ".voidra"), { recursive: true }); const now = new Date().toISOString();
  const workspace: WorkspaceRecord = { id, name, canonicalPath: root, createdAt: now, updatedAt: now, lastOpenedAt: now };
  return { parent, root, workspace, catalog: new OutputCatalogManager() };
}

afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("OutputCatalogManager", () => {
  it("sniffs content instead of trusting extensions and records safe preview policy", async () => {
    const { root, workspace, catalog } = await fixture();
    await writeFile(join(root, "misleading.bin"), "# Markdown-like text\n");
    await writeFile(join(root, "fake.pdf"), "not a pdf\n");
    await writeFile(join(root, "actual.data"), Buffer.from("%PDF-1.7\nfixture"));
    await writeFile(join(root, "legacy.html"), "<script>alert(1)</script>");
    await writeFile(join(root, "opaque.txt"), Buffer.from([0, 1, 2, 3]));
    const text = await catalog.registerPath(workspace, { path: "misleading.bin", provider: "fixture", tags: ["Project X"] });
    expect(text).toMatchObject({ kind: "text", previewState: "safe", tags: ["project x"] });
    expect(await catalog.registerPath(workspace, { path: "fake.pdf", provider: "fixture" })).toMatchObject({ kind: "text", contentType: "text/plain" });
    expect(await catalog.registerPath(workspace, { path: "actual.data", provider: "fixture" })).toMatchObject({ kind: "pdf", contentType: "application/pdf" });
    expect(await catalog.registerPath(workspace, { path: "legacy.html", provider: "fixture" })).toMatchObject({ kind: "legacy-html", previewState: "legacy-read-only", securityReviewState: "legacy" });
    expect(await catalog.registerPath(workspace, { path: "opaque.txt", provider: "fixture" })).toMatchObject({ kind: "binary", previewState: "metadata-only", securityReviewState: "blocked" });
    expect((await catalog.list(workspace, { query: "project x" })).map(({ id }) => id)).toContain(text.id);
  });

  it("recognizes component packages, deduplicates exact lineage, and rejects symlinks", async () => {
    const { root, workspace, catalog } = await fixture();
    await mkdir(join(root, "component", "src"), { recursive: true }); await writeFile(join(root, "component", "artifact.json"), "{}\n"); await writeFile(join(root, "component", "src", "Artifact.tsx"), "export default function Artifact(){return null}\n");
    const first = await catalog.registerPath(workspace, { path: "component", runId: "run-1", provider: "fixture" }); const again = await catalog.registerPath(workspace, { path: "component", runId: "run-1", provider: "fixture" });
    expect(first).toMatchObject({ kind: "component", previewState: "quarantined", securityReviewState: "pending" }); expect(again.id).toBe(first.id);
    await writeFile(join(root, "outside.txt"), "outside"); await symlink(join(root, "outside.txt"), join(root, "linked.txt"));
    await expect(catalog.registerPath(workspace, { path: "linked.txt", provider: "fixture" })).rejects.toThrow("symbolic links");
  });

  it("reuses only an unchanged text digest and isolates workspace catalogs", async () => {
    const first = await fixture(); const second = await fixture("Personal", "128f0f73-89db-7a63-a1b2-5d46f598ed02");
    await writeFile(join(first.root, "report.md"), "# Reviewed result\n"); const record = await first.catalog.registerPath(first.workspace, { path: "report.md", runId: "run-1", provider: "fixture", retention: "canonical" });
    expect((await first.catalog.readText(first.workspace, record.id)).content).toContain("Reviewed result");
    await writeFile(join(first.root, "report.md"), "# Changed later\n"); await expect(first.catalog.readText(first.workspace, record.id)).rejects.toThrow("changed after cataloging");
    expect(await second.catalog.list(second.workspace)).toEqual([]);
    await expect(second.catalog.readText(second.workspace, record.id)).rejects.toThrow("does not exist in this workspace");
  });
});
