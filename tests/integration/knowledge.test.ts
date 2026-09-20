import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceDatabase } from "../../src/service/database";
import { KnowledgeManager } from "../../src/service/knowledge";
import { NoteCoordinator } from "../../src/service/notes";
import { WorkspaceManager } from "../../src/service/workspaces";

const temporaryDirectories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "voidra-knowledge-"));
  temporaryDirectories.push(directory);
  const database = new ServiceDatabase(join(directory, "application.sqlite"));
  const workspaces = new WorkspaceManager(database);
  const workRoot = join(directory, "Work");
  const personalRoot = join(directory, "Personal");
  const sharedRoot = join(directory, "Learning");
  await Promise.all([mkdir(workRoot), mkdir(personalRoot), mkdir(sharedRoot)]);
  const work = await workspaces.create("Work", workRoot);
  const personal = await workspaces.create("Personal", personalRoot);
  const notes = new NoteCoordinator();
  const knowledge = new KnowledgeManager(database, notes);
  return { directory, database, work, personal, sharedRoot, notes, knowledge };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("KnowledgeManager", () => {
  it("shares one source with independent grants and filters private content", async () => {
    const { database, work, personal, sharedRoot, notes, knowledge } = await fixture();
    await (await notes.forWorkspace(work)).create("Private.md", "Work-only sentinel heliotrope-secret");
    await (await notes.forWorkspace(personal)).create("Private.md", "Personal-only sentinel cobalt-secret");
    const writable = await knowledge.attach(work, { name: "Learning", path: sharedRoot, access: "write" });
    await knowledge.attach(personal, { name: "Learning", path: sharedRoot, access: "read" });
    const shared = await knowledge.create(work.id, writable.baseId, "Guide.md", "# Guide\n\nShared comet token #learning");

    expect(await readFile(join(sharedRoot, "Guide.md"), "utf8")).toContain("Shared comet token");
    expect(await knowledge.search(personal, "comet")).toEqual([expect.objectContaining({ baseId: writable.baseId, access: "read" })]);
    expect(await knowledge.search(personal, "", "different-tag")).toEqual([]);
    expect(await knowledge.search(personal, "heliotrope-secret")).toEqual([]);
    await expect(knowledge.create(personal.id, writable.baseId, "Denied.md", "no")).rejects.toMatchObject({ code: "KNOWLEDGE_ACCESS_DENIED" });
    await expect(knowledge.read(personal, writable.baseId, shared.id)).resolves.toMatchObject({ content: expect.stringContaining("comet") });
    notes.close();
    database.close();
  });

  it("changes grants explicitly and validates shared file operations", async () => {
    const { database, work, sharedRoot, notes, knowledge } = await fixture();
    const attachment = await knowledge.attach(work, { name: "Learning", path: sharedRoot, access: "read" });
    expect(await knowledge.setAccess(work.id, attachment.baseId, "write")).toEqual(expect.objectContaining({ access: "write" }));
    const created = await knowledge.create(work.id, attachment.baseId, "Nested/Valid.md", "valid");
    await expect(knowledge.create(work.id, attachment.baseId, "Nested/Valid.md", "duplicate")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(knowledge.create(work.id, attachment.baseId, "../escape.md", "escape")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(knowledge.create(work.id, attachment.baseId, "/absolute.md", "escape")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(knowledge.read(work, attachment.baseId, "missing-document")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(knowledge.save(work.id, attachment.baseId, "missing-document", "no", created.revision)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    expect(await knowledge.setAccess(work.id, attachment.baseId, "read")).toEqual(expect.objectContaining({ access: "read" }));
    notes.close();
    database.close();
  });

  it("rechecks attachment access before returning delayed retrieval", async () => {
    const { database, work, sharedRoot, notes, knowledge } = await fixture();
    await writeFile(join(sharedRoot, "Revoked.md"), "# Revoked\n\nrevocation sentinel");
    const attachment = await knowledge.attach(work, { name: "Learning", path: sharedRoot, access: "read" });
    const pending = knowledge.search(work, "revocation", undefined, 120);
    await new Promise((resolve) => setTimeout(resolve, 25));
    knowledge.detach(work.id, attachment.baseId);
    expect(await pending).toEqual([]);
    await expect(knowledge.read(work, attachment.baseId, "copied-id")).rejects.toMatchObject({ code: "KNOWLEDGE_ACCESS_DENIED" });
    notes.close();
    database.close();
  });

  it("serializes shared writes and reports the stale writer as a conflict", async () => {
    const { database, work, personal, sharedRoot, notes, knowledge } = await fixture();
    const workAttachment = await knowledge.attach(work, { name: "Learning", path: sharedRoot, access: "write" });
    await knowledge.attach(personal, { name: "Learning", path: sharedRoot, access: "write" });
    const created = await knowledge.create(work.id, workAttachment.baseId, "Race.md", "Original");
    const [first, second] = await Promise.all([
      knowledge.save(work.id, workAttachment.baseId, created.id, "Work edit", created.revision),
      knowledge.save(personal.id, workAttachment.baseId, created.id, "Personal edit", created.revision),
    ]);
    expect([first.status, second.status].sort()).toEqual(["conflict", "saved"]);
    const disk = await readFile(join(sharedRoot, "Race.md"), "utf8");
    expect(["Work edit", "Personal edit"]).toContain(disk);
    notes.close();
    database.close();
  });

  it("fails visibly while another runtime owns the physical base lock and recovers a dead-owner lock", async () => {
    const { database, work, sharedRoot, notes } = await fixture();
    let releaseWrite!: () => void;
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const hold = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const first = new KnowledgeManager(database, notes, { beforeSharedWrite: async () => { signalEntered(); await hold; } });
    const secondNotes = new NoteCoordinator();
    const second = new KnowledgeManager(database, secondNotes);
    const attachment = await first.attach(work, { name: "Learning", path: sharedRoot, access: "write" });
    const pending = first.create(work.id, attachment.baseId, "First.md", "first");
    await entered;
    await expect(second.create(work.id, attachment.baseId, "Second.md", "second")).rejects.toMatchObject({ code: "KNOWLEDGE_BASE_BUSY", retryable: true });
    releaseWrite();
    await expect(pending).resolves.toMatchObject({ path: "First.md" });
    await writeFile(join(sharedRoot, ".voidra-write.lock"), JSON.stringify({ token: "dead", pid: 999_999_999 }));
    await expect(second.create(work.id, attachment.baseId, "Recovered.md", "recovered")).resolves.toMatchObject({ path: "Recovered.md" });
    secondNotes.close();
    notes.close();
    database.close();
  });

  it("builds deterministic scoped graph nodes and tag highlights across bases", async () => {
    const { database, work, sharedRoot, notes, knowledge } = await fixture();
    const privateTarget = await (await notes.forWorkspace(work)).create("Target.md", "# Private Target\n\n#focus");
    await (await notes.forWorkspace(work)).create("Home.md", "# Home\n\n[[Target]], [[Far]], and [[Learning::Shared/Target]]");
    const far = await (await notes.forWorkspace(work)).create("Far.md", "# Far");
    await mkdir(join(sharedRoot, "Shared"));
    await writeFile(join(sharedRoot, "Shared", "Target.md"), "# Shared Target\n\n#focus [[Sibling]]");
    await writeFile(join(sharedRoot, "Sibling.md"), "# Sibling");
    const attachment = await knowledge.attach(work, { name: "Learning", path: sharedRoot, access: "read" });

    const graph = await knowledge.graph(work, { tag: "focus" });
    expect(graph.nodes.filter(({ highlighted }) => highlighted)).toHaveLength(2);
    expect(graph.nodes.filter(({ title }) => title.includes("Target"))).toHaveLength(2);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: expect.stringContaining("private:"), target: `private:${privateTarget.id}` }),
      expect.objectContaining({ source: expect.stringContaining("private:"), target: expect.stringContaining(`${attachment.baseId}:`) }),
    ]));
    const filtered = await knowledge.graph(work, { tag: "focus", filterOnly: true });
    expect(filtered.nodes).toHaveLength(2);
    expect(filtered.nodes.every(({ highlighted }) => highlighted)).toBe(true);
    const local = await knowledge.graph(work, { focus: { baseId: "private", documentId: privateTarget.id }, depth: 0 });
    expect(local.nodes).toEqual([expect.objectContaining({ documentId: privateTarget.id, highlighted: false })]);
    const oneHop = await knowledge.graph(work, { focus: { baseId: "private", documentId: privateTarget.id }, depth: 1 });
    expect(oneHop.nodes.some(({ documentId }) => documentId === far.id)).toBe(false);
    const twoHops = await knowledge.graph(work, { focus: { baseId: "private", documentId: privateTarget.id }, depth: 2 });
    expect(twoHops.nodes.some(({ documentId }) => documentId === far.id)).toBe(true);
    expect(graph.edges).toEqual(expect.arrayContaining([expect.objectContaining({ source: expect.stringContaining(`${attachment.baseId}:`), target: expect.stringContaining(`${attachment.baseId}:`) })]));
    notes.close();
    database.close();
  });

  it("marks unavailable bases, relocates the same identity, and rejects private overlap", async () => {
    const { directory, database, work, sharedRoot, notes, knowledge } = await fixture();
    const attachment = await knowledge.attach(work, { name: "Learning", path: sharedRoot, access: "read" });
    const secondRoot = join(directory, "Second");
    await mkdir(secondRoot);
    const second = await knowledge.attach(work, { name: "Second", path: secondRoot, access: "read" });
    await expect(knowledge.locate(work.id, second.baseId, sharedRoot)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(knowledge.attach(work, { name: "Private leak", path: work.canonicalPath, access: "read" })).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    const moved = join(directory, "Moved Learning");
    await rename(sharedRoot, moved);
    expect(await knowledge.list(work.id)).toEqual(expect.arrayContaining([expect.objectContaining({ baseId: attachment.baseId, available: false }), expect.objectContaining({ baseId: second.baseId, available: true })]));
    expect(await knowledge.locate(work.id, attachment.baseId, moved)).toEqual(expect.objectContaining({ baseId: attachment.baseId, available: true }));
    notes.close();
    database.close();
  });

  it("persists, expires, edits, deletes, and isolates workspace memory", async () => {
    const { database, work, personal, notes, knowledge } = await fixture();
    const active = await knowledge.createMemory(work, { text: "Prefers focused mornings", source: "user", confirmed: true });
    await knowledge.createMemory(work, { text: "Temporary inference", source: "assistant", confirmed: false, expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(await knowledge.listMemories(work)).toEqual([expect.objectContaining({ id: active.id })]);
    expect(await knowledge.listMemories(work, true)).toHaveLength(2);
    expect(await knowledge.listMemories(personal)).toEqual([]);
    expect(await knowledge.memoryContext(work, "focused user")).toEqual([expect.objectContaining({ id: active.id })]);
    expect(await knowledge.memoryContext(personal, "focused")).toEqual([]);
    await knowledge.updateMemory(work, active.id, { text: "Prefers late mornings", source: "user correction", confirmed: true });
    expect(await knowledge.listMemories(work)).toEqual([expect.objectContaining({ text: "Prefers late mornings", source: "user correction" })]);
    await knowledge.deleteMemory(work, active.id);
    expect(await knowledge.listMemories(work)).toEqual([]);
    expect(await knowledge.memoryContext(work, "")).toEqual([]);
    await expect(knowledge.updateMemory(work, active.id, { text: "missing", source: "test", confirmed: true })).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(knowledge.deleteMemory(work, active.id)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    notes.close();
    database.close();
  });

  it("fails visibly when workspace memory metadata is malformed", async () => {
    const { database, work, notes, knowledge } = await fixture();
    await mkdir(join(work.canonicalPath, "memory"));
    await writeFile(join(work.canonicalPath, "memory", "memories.json"), "not json");
    await expect(knowledge.listMemories(work)).rejects.toMatchObject({ code: "INCOMPATIBLE_SCHEMA" });
    notes.close();
    database.close();
  });
});
