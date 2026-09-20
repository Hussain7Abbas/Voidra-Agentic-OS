import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { BackupManager } from "../../src/service/backup";
import { CURRENT_SCHEMA_VERSION, ServiceDatabase } from "../../src/service/database";
import { WorkspaceManager } from "../../src/service/workspaces";

const temporaryDirectories: string[] = [];

async function fixture(availableBytes?: number) {
  const directory = await mkdtemp(join(tmpdir(), "voidra-backup-"));
  temporaryDirectories.push(directory);
  const database = new ServiceDatabase(join(directory, "state.sqlite"));
  const workspaces = new WorkspaceManager(database);
  const root = join(directory, "Work");
  const shared = join(directory, "Shared");
  const backups = join(directory, "Backups");
  await Promise.all([mkdir(root), mkdir(shared), mkdir(backups)]);
  const workspace = await workspaces.create("Work", root);
  const manager = new BackupManager(database, workspaces, {
    applicationVersion: "test-version",
    now: () => new Date("2026-09-20T10:11:12.000Z"),
    availableBytes: availableBytes === undefined ? undefined : async () => availableBytes,
  });
  return { directory, database, workspaces, root, shared, backups, workspace, manager };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("BackupManager", () => {
  it("exports durable files, omits indexes and credentials, and restores identity plus shared references", async () => {
    const { directory, database, workspaces, root, shared, backups, workspace, manager } = await fixture();
    await writeFile(join(root, "project.md"), "# Project\n\nDurable source bytes.\n");
    await writeFile(join(root, ".voidra", "history.json"), JSON.stringify({ schemaVersion: 1, revisions: [{ id: "history-id" }] }));
    await writeFile(join(root, ".voidra", "planner.json"), JSON.stringify({ schemaVersion: 1, tasks: [{ id: "task-id" }] }));
    await writeFile(join(root, ".voidra", "index.sqlite"), "disposable-index");
    await symlink(join(root, "project.md"), join(root, "linked-note.md"));
    const now = new Date().toISOString();
    const baseId = "d6aa8dbe-6765-4e19-b1c3-aee8f286ab25";
    database.insertKnowledgeBase({ id: baseId, name: "Shared", canonicalPath: shared, createdAt: now, updatedAt: now });
    database.attachKnowledgeBase({ workspaceId: workspace.id, baseId, access: "read", attachedAt: now });
    workspaces.bindAccountReference(workspace.id, { accountId: "c2a25c69-8f58-4147-8e64-92cc68add0d9", provider: "calendar", credentialRef: "keychain://voidra/calendar/DO-NOT-EXPORT" });

    const exported = await manager.export(workspace, backups);
    const rawManifest = await readFile(join(exported.path, "manifest.json"), "utf8");
    expect(rawManifest).not.toContain("DO-NOT-EXPORT");
    expect(exported.manifest).toMatchObject({
      application: { version: "test-version", databaseSchemaVersion: CURRENT_SCHEMA_VERSION },
      workspace: { id: workspace.id },
      credentials: { exported: false, reauthorizationProviders: ["calendar"] },
      sharedBases: [{ id: baseId, access: "read", availableAtExport: true }],
    });
    expect(exported.manifest.files.map(({ path }) => path)).toEqual(expect.arrayContaining(["project.md", ".voidra/history.json", ".voidra/planner.json", ".voidra/workspace.json"]));
    expect(exported.manifest.files.map(({ path }) => path)).not.toContain(".voidra/index.sqlite");
    expect(exported.manifest.omitted).toEqual(expect.arrayContaining([
      { path: ".voidra/index.sqlite", reason: "rebuildable-index" },
      { path: "linked-note.md", reason: "symbolic-link" },
    ]));

    workspaces.remove(workspace.id);
    await rm(shared, { recursive: true });
    const destination = join(directory, "Restored Work");
    const restored = await manager.restore(exported.path, destination);
    expect(restored).toMatchObject({ workspace: { id: workspace.id, canonicalPath: await realpath(destination) }, credentialsRestored: false, sharedBases: [{ id: baseId, available: false }] });
    expect(await readFile(join(destination, "project.md"), "utf8")).toBe("# Project\n\nDurable source bytes.\n");
    expect(await readFile(join(destination, ".voidra", "history.json"), "utf8")).toContain("history-id");
    await expect(readFile(join(destination, ".voidra", "index.sqlite"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(database.listKnowledgeAttachments(workspace.id)).toEqual([expect.objectContaining({ baseId, access: "read" })]);
    expect(database.listAccountReferences(workspace.id)).toEqual([]);
    database.close();
  });

  it("rejects corrupted payloads and newer schemas before creating a destination", async () => {
    const { directory, database, root, backups, workspace, manager } = await fixture();
    await writeFile(join(root, "note.md"), "original");
    const exported = await manager.export(workspace, backups);
    await writeFile(join(exported.path, "workspace", "note.md"), "tampered");
    await expect(manager.restore(exported.path, join(directory, "Corrupt restore"))).rejects.toMatchObject({ code: "BACKUP_CONFLICT" });

    const linkedDirectory = join(directory, "Linked backups");
    await mkdir(linkedDirectory);
    const linked = await manager.export(workspace, linkedDirectory);
    await rm(join(linked.path, "workspace", "note.md"));
    await symlink(join(root, "note.md"), join(linked.path, "workspace", "note.md"));
    await expect(manager.inspect(linked.path)).rejects.toMatchObject({ code: "BACKUP_CONFLICT" });

    const secondDirectory = join(directory, "Second backups");
    await mkdir(secondDirectory);
    const second = await manager.export(workspace, secondDirectory);
    const manifest = JSON.parse(await readFile(join(second.path, "manifest.json"), "utf8"));
    manifest.application.databaseSchemaVersion = CURRENT_SCHEMA_VERSION + 1;
    await writeFile(join(second.path, "manifest.json"), JSON.stringify(manifest));
    await expect(manager.restore(second.path, join(directory, "Future restore"))).rejects.toMatchObject({ code: "INCOMPATIBLE_SCHEMA" });
    database.close();
  });

  it("preflights available space and does not leave a partial bundle", async () => {
    const { database, root, backups, workspace, manager } = await fixture(1);
    await writeFile(join(root, "large.md"), "larger than one byte");
    await expect(manager.export(workspace, backups)).rejects.toMatchObject({ code: "BACKUP_CONFLICT", retryable: true });
    expect(await import("node:fs/promises").then(({ readdir }) => readdir(backups))).toEqual([]);
    database.close();
  });
});
