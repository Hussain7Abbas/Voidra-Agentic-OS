import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationManager } from "../../src/service/automation";
import { ServiceDatabase } from "../../src/service/database";
import { WorkspaceManager } from "../../src/service/workspaces";

const temporaryDirectories: string[] = [];
async function fixture(hostCall?: ConstructorParameters<typeof AutomationManager>[0]) { const directory = await mkdtemp(join(tmpdir(), "voidra-automation-")); temporaryDirectories.push(directory); const database = new ServiceDatabase(join(directory, "state.sqlite")); const workspaces = new WorkspaceManager(database); const workPath = join(directory, "Work"); const personalPath = join(directory, "Personal"); const files = join(directory, "Chosen Files"); await Promise.all([mkdir(workPath), mkdir(personalPath), mkdir(files)]); const work = await workspaces.create("Work", workPath); const personal = await workspaces.create("Personal", personalPath); return { directory, database, work, personal, files, manager: new AutomationManager(hostCall) }; }
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("AutomationManager", () => {
  it("reviews copy, move, write, and recoverable trash operations with undo", async () => {
    const { database, work, files, manager } = await fixture(); await writeFile(join(files, "source.txt"), "source"); const root = await manager.addRoot(work, "Fixture", files);
    const copy = await manager.prepareFile(work, { rootId: root.id, action: "copy", source: "source.txt", destination: "copies/source.txt" }); expect(copy.state).toBe("awaiting-approval"); const copied = await manager.approveFile(work, copy.id); expect(copied.state).toBe("completed"); expect(await readFile(join(files, "copies", "source.txt"), "utf8")).toBe("source"); await manager.undoFile(work, copy.id); await expect(readFile(join(files, "copies", "source.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const move = await manager.prepareFile(work, { rootId: root.id, action: "move", source: "source.txt", destination: "sorted/source.txt" }); await manager.approveFile(work, move.id); expect(await readFile(join(files, "sorted", "source.txt"), "utf8")).toBe("source"); await manager.undoFile(work, move.id); expect(await readFile(join(files, "source.txt"), "utf8")).toBe("source");
    const write = await manager.prepareFile(work, { rootId: root.id, action: "write", source: "new.txt", content: "new" }); await manager.approveFile(work, write.id); expect(await readFile(join(files, "new.txt"), "utf8")).toBe("new"); await manager.undoFile(work, write.id); await expect(readFile(join(files, "new.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const trash = await manager.prepareFile(work, { rootId: root.id, action: "trash", source: "source.txt" }); await manager.approveFile(work, trash.id); await expect(readFile(join(files, "source.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" }); await manager.undoFile(work, trash.id); expect(await readFile(join(files, "source.txt"), "utf8")).toBe("source"); database.close();
  });

  it("rejects cross-workspace handles, traversal, symlinks, conflicts, and duplicate approval", async () => {
    const { directory, database, work, personal, files, manager } = await fixture(); await writeFile(join(files, "source.txt"), "source"); await writeFile(join(files, "exists.txt"), "exists"); const root = await manager.addRoot(work, "Fixture", files); await expect(manager.listFiles(personal, root.id, "")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" }); await expect(manager.prepareFile(work, { rootId: root.id, action: "copy", source: "../escape", destination: "x" })).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" }); await expect(manager.prepareFile(work, { rootId: root.id, action: "copy", source: "source.txt", destination: "exists.txt" })).rejects.toMatchObject({ code: "AUTOMATION_STATE_CONFLICT" }); const outside = join(directory, "outside.txt"); await writeFile(outside, "outside"); await symlink(outside, join(files, "link.txt")); await expect(manager.prepareFile(work, { rootId: root.id, action: "trash", source: "link.txt" })).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" }); const action = await manager.prepareFile(work, { rootId: root.id, action: "trash", source: "source.txt" }); await manager.approveFile(work, action.id); await expect(manager.approveFile(work, action.id)).rejects.toMatchObject({ code: "AUTOMATION_STATE_CONFLICT" }); database.close();
  });

  it("persists native review state, capability denial, takeover, and restart interruption", async () => {
    const host = vi.fn(async (operation: string) => operation === "native.status" ? { accessibility: "denied", screen: "restricted", automation: "not-determined", adapter: "fixture" } : operation === "native.takeover" ? { interrupted: true } : Promise.reject(new Error("Accessibility permission is denied.")));
    const { database, work, manager } = await fixture(host as ConstructorParameters<typeof AutomationManager>[0]); expect(await manager.capabilities(work)).toMatchObject({ accessibility: "denied", screen: "restricted" }); const action = await manager.prepareNative(work, "activate-control", { appId: "fixture" }); expect((await manager.approveNative(work, action.id)).state).toBe("failed"); expect((await manager.list(work)).actions[0]).toMatchObject({ error: expect.stringContaining("denied") }); expect(await manager.takeover(work)).toMatchObject({ interrupted: true }); database.close();
  });
});
