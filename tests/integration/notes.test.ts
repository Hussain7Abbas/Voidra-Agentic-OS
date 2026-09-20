import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceDatabase } from "../../src/service/database";
import { NoteCoordinator, NoteStore } from "../../src/service/notes";
import { WorkspaceManager } from "../../src/service/workspaces";

const temporaryDirectories: string[] = [];

async function fixture(options: ConstructorParameters<typeof NoteStore>[1] = {}) {
  const base = await mkdtemp(join(tmpdir(), "voidra-notes-"));
  temporaryDirectories.push(base);
  const root = join(base, "Workspace");
  await mkdir(root);
  const database = new ServiceDatabase(join(base, "application.sqlite"));
  const workspace = await new WorkspaceManager(database).create("Notes", root);
  const store = new NoteStore(workspace, options);
  return { base, root, database, workspace, store };
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for note state");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("NoteStore", () => {
  it("creates, saves, reopens, searches, and resolves links without merging duplicate titles", async () => {
    const { database, workspace, store } = await fixture();
    const target = await store.create("one/Target.md", "# Target\n\nAlpha content #project/core");
    await store.create("other/Target.md", "# Duplicate target\n");
    const source = await store.create("Source.md", "# Source\n\n[[Target]] and [[other/Target|specific]].\n");
    const opened = await store.read(source.id);
    expect(opened.links).toEqual([
      expect.objectContaining({ target: "Target", status: "ambiguous", resolvedId: null }),
      expect.objectContaining({ target: "other/Target", status: "resolved" }),
    ]);
    expect(await store.backlinks(target.id)).toEqual([]);
    expect(await store.search("Alpha", "project/core")).toEqual([expect.objectContaining({ id: target.id })]);
    const saved = await store.save(target.id, "# Target\n\nUpdated searchable text #project/core", (await store.read(target.id)).revision);
    expect(saved.status).toBe("saved");

    const reopened = new NoteStore(workspace);
    expect((await reopened.read(target.id)).content).toContain("Updated searchable text");
    expect(await readFile(join(workspace.canonicalPath, "knowledge", "one", "Target.md"), "utf8")).toContain("Updated searchable text");
    database.close();
  });

  it("preserves disk and editor versions during an external-write conflict and restores history", async () => {
    const { database, workspace, store } = await fixture();
    const note = await store.create("Conflict.md", "Original");
    const opened = await store.read(note.id);
    const path = join(workspace.canonicalPath, "knowledge", "Conflict.md");
    await writeFile(path, "External version");
    const conflict = await store.save(note.id, "Editor version", opened.revision);
    expect(conflict.status).toBe("conflict");
    expect(await readFile(path, "utf8")).toBe("External version");
    if (conflict.status !== "conflict") throw new Error("Expected conflict");
    expect(conflict.snapshots.map(({ kind }) => kind)).toEqual(["conflict-disk", "conflict-editor"]);
    const resolved = await store.resolveConflict(note.id, "editor", conflict.disk.revision, conflict.editorContent);
    expect(resolved.status).toBe("saved");
    expect(await readFile(path, "utf8")).toBe("Editor version");
    const diskRevision = (await store.history(note.id)).find(({ kind }) => kind === "conflict-disk")!;
    const restored = await store.restore(note.id, diskRevision.id);
    expect(restored.content).toBe("External version");
    expect((await store.history(note.id)).map(({ kind }) => kind)).toContain("pre-restore");
    database.close();
  });

  it("supports disk conflict resolution, detects a second race, and skips unchanged saves", async () => {
    const { database, workspace, store } = await fixture();
    const note = await store.create("Race.md", "Original");
    const opened = await store.read(note.id);
    const unchanged = await store.save(note.id, opened.content, opened.revision);
    expect(unchanged).toEqual(expect.objectContaining({ status: "saved", document: expect.objectContaining({ revision: opened.revision }) }));
    const path = join(workspace.canonicalPath, "knowledge", "Race.md");
    await writeFile(path, "External one");
    const conflict = await store.save(note.id, "Editor one", opened.revision);
    if (conflict.status !== "conflict") throw new Error("Expected conflict");
    const keptDisk = await store.resolveConflict(note.id, "disk", conflict.disk.revision);
    if (keptDisk.status !== "saved") throw new Error("Expected disk resolution");
    expect(keptDisk.document.content).toBe("External one");
    await writeFile(path, "External two");
    expect(await store.resolveConflict(note.id, "merge", conflict.disk.revision, undefined, "Merged")).toEqual(expect.objectContaining({ status: "conflict" }));
    database.close();
  });

  it("preserves original bytes when atomic replacement fails", async () => {
    let fail = false;
    const { database, workspace, store } = await fixture({ beforeAtomicReplace: (path) => { if (fail && path.endsWith("Atomic.md")) throw new Error("simulated atomic failure"); } });
    const note = await store.create("Atomic.md", "Original bytes");
    const opened = await store.read(note.id);
    fail = true;
    await expect(store.save(note.id, "New bytes", opened.revision)).rejects.toThrow("simulated atomic failure");
    const knowledge = join(workspace.canonicalPath, "knowledge");
    expect(await readFile(join(knowledge, "Atomic.md"), "utf8")).toBe("Original bytes");
    expect((await readdir(knowledge)).filter((name) => name.includes(".tmp-"))).toEqual([]);
    database.close();
  });

  it("repairs an interrupted rename journal and updates only resolved references", async () => {
    const { database, workspace, store } = await fixture();
    const target = await store.create("Target.md", "# Target\n");
    const source = await store.create("Source.md", "Target prose stays. [[Target|wiki]] and [markdown](Target.md#target).\n");
    await expect(store.rename(target.id, "folder/Renamed.md", { interruptAfterOperations: 1 })).rejects.toThrow("Simulated rename interruption");
    expect(await readFile(join(workspace.canonicalPath, ".voidra", "rename-journal.json"), "utf8")).toContain(target.id);

    const recovered = new NoteStore(workspace);
    await recovered.syncIndex();
    const sourceContent = (await recovered.read(source.id)).content;
    expect(sourceContent).toContain("Target prose stays.");
    expect(sourceContent).toContain("[[folder/Renamed|wiki]]");
    expect(sourceContent).toContain("[markdown](folder/Renamed.md#target)");
    expect((await recovered.read(target.id)).path).toBe("folder/Renamed.md");
    await expect(readFile(join(workspace.canonicalPath, ".voidra", "rename-journal.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    database.close();
  });

  it("updates resolved references during an uninterrupted rename", async () => {
    const { database, workspace, store } = await fixture();
    const target = await store.create("Target.md", "# Target\n");
    const source = await store.create("Source.md", "Target prose remains. [[Target|linked target]].");

    await store.rename(target.id, "projects/Renamed.md");

    expect((await store.read(source.id)).content).toBe("Target prose remains. [[projects/Renamed|linked target]].");
    expect((await store.read(target.id)).path).toBe("projects/Renamed.md");
    database.close();
  });

  it("rejects duplicate create and rename destinations and reports missing documents", async () => {
    const { database, store } = await fixture();
    const first = await store.create("First.md", "# First");
    await store.create("Second.md", "# Second");
    await expect(store.create("First.md", "duplicate")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(store.rename(first.id, "Second.md")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(store.read("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    expect(await store.repairRename()).toEqual({ repaired: false });
    database.close();
  });

  it("rebuilds a disposable index and converges after deletion, reappearance, and external moves", async () => {
    const { database, workspace, store } = await fixture();
    const first = await store.create("First.md", "Unique first token");
    await store.create("Second.md", "Unique second token");
    expect(await store.search("first")).toEqual([expect.objectContaining({ id: first.id })]);
    await store.rebuildIndex();
    expect(await store.search("second")).toHaveLength(1);
    const knowledge = join(workspace.canonicalPath, "knowledge");
    await rm(join(knowledge, "First.md"));
    await store.syncIndex();
    expect(await store.search("first")).toEqual([]);
    await writeFile(join(knowledge, "First.md"), "First returned");
    await store.syncIndex();
    expect(await store.search("returned")).toEqual([expect.objectContaining({ id: first.id })]);
    await rename(join(knowledge, "First.md"), join(knowledge, "Moved.md"));
    await store.syncIndex();
    const moved = await store.search("returned");
    expect(moved).toEqual([expect.objectContaining({ path: "Moved.md" })]);
    expect(moved[0].id).not.toBe(first.id);
    database.close();
  });

  it("filters empty searches by tag and exposes broken link state", async () => {
    const { database, store } = await fixture();
    const tagged = await store.create("Tagged.md", "# Tagged\n\n#area/one [[Missing]]");
    await store.create("Other.md", "# Other\n\n#area/two");
    expect(await store.search("", "#area/one")).toEqual([expect.objectContaining({ id: tagged.id, snippet: "" })]);
    expect((await store.read(tagged.id)).links).toEqual([expect.objectContaining({ status: "broken", resolvedId: null })]);
    database.close();
  });

  it("coalesces external file changes through the workspace watcher", async () => {
    const { database, workspace } = await fixture();
    const coordinator = new NoteCoordinator();
    const store = await coordinator.forWorkspace(workspace);
    const knowledge = join(workspace.canonicalPath, "knowledge");
    await writeFile(join(knowledge, "Watched.md"), "# Watched\n\nFirst external value");
    await writeFile(join(knowledge, "Watched.md"), "# Watched\n\nCoalesced external value");
    try {
      await waitFor(() => coordinator.status(workspace.id).state === "idle" && coordinator.status(workspace.id).indexed === 1, 10_000);
      expect(await store.search("Coalesced")).toHaveLength(1);
    } finally {
      coordinator.close();
    }
    database.close();
  });

  it("retains the newest 100 normal revisions without pruning conflict snapshots", async () => {
    const { database, workspace, store } = await fixture();
    const note = await store.create("Retention.md", "Version 0");
    let opened = await store.read(note.id);
    await writeFile(join(workspace.canonicalPath, "knowledge", "Retention.md"), "External snapshot");
    const conflict = await store.save(note.id, "Editor snapshot", opened.revision);
    if (conflict.status !== "conflict") throw new Error("Expected conflict");
    const resolved = await store.resolveConflict(note.id, "editor", conflict.disk.revision, conflict.editorContent);
    if (resolved.status !== "saved") throw new Error("Expected saved resolution");
    opened = resolved.document;
    for (let index = 1; index <= 101; index += 1) {
      const saved = await store.save(note.id, `Version ${index}`, opened.revision);
      if (saved.status !== "saved") throw new Error("Unexpected conflict");
      opened = saved.document;
    }
    const history = await store.history(note.id);
    expect(history.filter(({ kind }) => !kind.startsWith("conflict-"))).toHaveLength(100);
    expect(history.filter(({ kind }) => kind.startsWith("conflict-")).map(({ kind }) => kind).sort()).toEqual(["conflict-disk", "conflict-editor"]);
    expect(opened.content).toBe("Version 101");
    database.close();
  }, 15_000);

  it("rejects traversal, absolute paths, and symlink escapes", async () => {
    const { base, database, workspace, store } = await fixture();
    await expect(store.create("../escape.md", "no")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(store.create("/absolute.md", "no")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(store.create("not-markdown.txt", "no")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    const outside = join(base, "outside");
    await mkdir(outside);
    await symlink(outside, join(workspace.canonicalPath, "knowledge", "escape"));
    await expect(store.create("escape/note.md", "no")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    database.close();
  });
});
