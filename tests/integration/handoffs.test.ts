import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceDatabase } from "../../src/service/database";
import { ManualHandoffManager } from "../../src/service/handoffs";
import { InstructionResolver } from "../../src/service/instructions";
import { KnowledgeManager } from "../../src/service/knowledge";
import { NoteCoordinator } from "../../src/service/notes";
import { WorkspaceManager } from "../../src/service/workspaces";

const temporaryDirectories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "voidra-handoffs-"));
  temporaryDirectories.push(directory);
  const root = join(directory, "Work");
  const otherRoot = join(directory, "Personal");
  const sharedRoot = join(directory, "Shared");
  await Promise.all([mkdir(root), mkdir(otherRoot), mkdir(sharedRoot)]);
  const database = new ServiceDatabase(join(directory, "state.sqlite"));
  const workspaces = new WorkspaceManager(database);
  const workspace = await workspaces.create("Work", root);
  const other = await workspaces.create("Personal", otherRoot);
  const notes = new NoteCoordinator();
  const knowledge = new KnowledgeManager(database, notes);
  const instructions = new InstructionResolver();
  const handoffs = new ManualHandoffManager(workspaces, instructions, knowledge);
  const close = () => { notes.close(); database.close(); };
  return { directory, root, otherRoot, sharedRoot, database, workspaces, workspace, other, notes, knowledge, instructions, handoffs, close };
}

async function skillAndRoutine(handoffs: ManualHandoffManager, workspace: Awaited<ReturnType<WorkspaceManager["create"]>>, client: "claude" | "codex" = "claude") {
  const skill = await handoffs.createSkill(workspace, { name: "Brief", description: "Create a brief", instructions: "Use only supplied evidence.", expectedOutput: "a Markdown brief", inputs: ["objective"] });
  const routine = await handoffs.createRoutine(workspace, { name: "Plan", skillId: skill.id, client, preferredModel: `${client}-preferred`, outputDirectory: "outputs", inlineInstructions: "Answer concisely." });
  return { skill, routine };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ManualHandoffManager", () => {
  it("compiles deterministic, scoped, redacted prompts with a source manifest", async () => {
    const { root, sharedRoot, workspaces, workspace, notes, knowledge, instructions, handoffs, close } = await fixture();
    await workspaces.updateWorkspaceSettings(workspace.id, { assistant: { persona: "A careful planner" } });
    await writeFile(join(root, "AGENTS.md"), "Root rule. Secret sk-1234567890abcdefghijklmnop\n");
    await mkdir(join(root, "project"));
    await instructions.createScope(root, "project", "Child rule.");
    await writeFile(join(root, "project", "today.md"), "target");
    await mkdir(join(root, "sibling"));
    await instructions.createScope(root, "sibling", "Sibling private rule.");
    const privateNote = await (await notes.forWorkspace(workspace)).create("Context.md", "# سياق\n\nالنص المختار Bearer abcdefghijklmnop");
    await knowledge.createMemory(workspace, { text: "Plan three priorities using context", source: "user", confirmed: true });
    await writeFile(join(sharedRoot, "Reference.md"), "# Reference\n\nShared read-only fact");
    const attachment = await knowledge.attach(workspace, { name: "Reference", path: sharedRoot, access: "read" });
    const shared = (await knowledge.search(workspace, "read-only"))[0]!;
    const { routine } = await skillAndRoutine(handoffs, workspace);
    const input = { routineId: routine.id, objective: "Plan three priorities using context", targetPaths: ["project/today.md"], sources: [{ baseId: "private", documentId: privateNote.id }, { baseId: attachment.baseId, documentId: String(shared.id) }] };
    const first = await handoffs.compile(workspace, input);
    const second = await handoffs.compile(workspace, input);
    expect(first.prompt).toBe(second.prompt);
    expect(first.prompt).toContain("A careful planner");
    expect(first.prompt).toContain("Root rule");
    expect(first.prompt).toContain("Child rule");
    expect(first.prompt).not.toContain("Sibling private rule");
    expect(first.prompt).toContain("النص المختار");
    expect(first.prompt).toContain("Shared read-only fact");
    expect(first.prompt).toContain("[confirmed; user] Plan three priorities using context");
    expect(first.prompt).not.toContain("sk-1234567890abcdefghijklmnop");
    expect(first.prompt).not.toContain("Bearer abcdefghijklmnop");
    expect(first.sources).toHaveLength(2);
    close();
  });

  it("pins skill versions, duplicates client preferences, and isolates workspace registries", async () => {
    const { workspace, other, handoffs, close } = await fixture();
    const { skill, routine } = await skillAndRoutine(handoffs, workspace);
    const updated = await handoffs.updateSkill(workspace, skill.id, { ...skill, instructions: "New version instructions." });
    expect(updated.version).toBe(2);
    const oldRun = await handoffs.compile(workspace, { routineId: routine.id, objective: "Old", targetPaths: [], sources: [] });
    expect(oldRun.skillSnapshot).toMatchObject({ version: 1, instructions: "Use only supplied evidence." });
    const newRoutine = await handoffs.createRoutine(workspace, { name: "New", skillId: skill.id, client: "codex", preferredModel: "gpt-user-choice", outputDirectory: "outputs", inlineInstructions: "" });
    const newRun = await handoffs.compile(workspace, { routineId: newRoutine.id, objective: "New", targetPaths: [], sources: [] });
    expect(newRun.skillSnapshot).toMatchObject({ version: 2, instructions: "New version instructions." });
    const duplicate = await handoffs.duplicateRoutine(workspace, routine.id, { name: "Codex copy", client: "codex", preferredModel: "gpt-custom" });
    expect(duplicate).toMatchObject({ client: "codex", preferredModel: "gpt-custom", skillVersion: 1 });
    expect(await handoffs.listSkills(other)).toEqual([]);
    expect(await handoffs.listRoutines(other)).toEqual([]);
    close();
  });

  it("enforces manual state transitions and scheduled preparation remains ready for the user", async () => {
    const { workspace, handoffs, close } = await fixture();
    const { routine } = await skillAndRoutine(handoffs, workspace);
    const scheduled = await handoffs.compile(workspace, { routineId: routine.id, objective: "Scheduled", targetPaths: [], sources: [], trigger: "scheduled" });
    expect(scheduled).toMatchObject({ trigger: "scheduled", status: "ready-to-copy", copiedAt: null });
    await expect(handoffs.complete(workspace, scheduled.id)).rejects.toMatchObject({ code: "HANDOFF_STATE_CONFLICT" });
    const copied = await handoffs.markCopied(workspace, scheduled.id);
    expect(copied.status).toBe("awaiting-result");
    await expect(handoffs.complete(workspace, scheduled.id)).rejects.toMatchObject({ code: "HANDOFF_STATE_CONFLICT" });
    const reviewed = await handoffs.previewResult(workspace, scheduled.id, "Returned externally", "brief.md", "# Done\n");
    expect(reviewed.status).toBe("result-under-review");
    await handoffs.applyResult(workspace, scheduled.id);
    expect(await readFile(join(workspace.canonicalPath, "outputs", "brief.md"), "utf8")).toBe("# Done\n");
    expect((await handoffs.complete(workspace, scheduled.id)).status).toBe("completed");
    await expect(handoffs.cancel(workspace, scheduled.id)).rejects.toMatchObject({ code: "HANDOFF_STATE_CONFLICT" });
    const second = await handoffs.compile(workspace, { routineId: routine.id, objective: "Cancel", targetPaths: [], sources: [] });
    expect((await handoffs.cancel(workspace, second.id)).status).toBe("cancelled");
    close();
  });

  it("rejects oversized or revoked context and unsafe or stale result writes", async () => {
    const { directory, workspace, sharedRoot, knowledge, handoffs, close } = await fixture();
    const { routine } = await skillAndRoutine(handoffs, workspace);
    await writeFile(join(sharedRoot, "Huge.md"), `# Huge\n\n${"x".repeat(201_000)}`);
    const attachment = await knowledge.attach(workspace, { name: "Shared", path: sharedRoot, access: "read" });
    const huge = (await knowledge.search(workspace, "Huge"))[0]!;
    await expect(handoffs.compile(workspace, { routineId: routine.id, objective: "Too large", targetPaths: [], sources: [{ baseId: attachment.baseId, documentId: String(huge.id) }] })).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    knowledge.detach(workspace.id, attachment.baseId);
    await expect(handoffs.compile(workspace, { routineId: routine.id, objective: "Revoked", targetPaths: [], sources: [{ baseId: attachment.baseId, documentId: String(huge.id) }] })).rejects.toMatchObject({ code: "KNOWLEDGE_ACCESS_DENIED" });

    const run = await handoffs.compile(workspace, { routineId: routine.id, objective: "Safe", targetPaths: [], sources: [] });
    await handoffs.markCopied(workspace, run.id);
    await expect(handoffs.previewResult(workspace, run.id, "bad", "../escape.md", "bad")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    const outside = join(directory, "outside");
    await mkdir(outside);
    await symlink(outside, join(workspace.canonicalPath, "outputs", "link"));
    await expect(handoffs.previewResult(workspace, run.id, "bad", "link/escape.md", "bad")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(handoffs.previewResult(workspace, run.id, "bad", "link/new/escape.md", "bad")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(readFile(join(outside, "new", "escape.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const reviewed = await handoffs.previewResult(workspace, run.id, "ok", "safe.md", "new");
    await writeFile(join(workspace.canonicalPath, reviewed.resultPreview!.path), "changed elsewhere");
    await expect(handoffs.applyResult(workspace, run.id)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    close();
  });

  it("recovers persisted metadata and rejects corrupt registries", async () => {
    const { workspace, workspaces, knowledge, instructions, handoffs, close } = await fixture();
    const { routine } = await skillAndRoutine(handoffs, workspace, "codex");
    await handoffs.compile(workspace, { routineId: routine.id, objective: "Persist", targetPaths: [], sources: [] });
    const reopened = new ManualHandoffManager(workspaces, instructions, knowledge);
    expect(await reopened.listSkills(workspace)).toEqual([expect.objectContaining({ name: "Brief" })]);
    expect(await reopened.listRoutines(workspace)).toEqual([expect.objectContaining({ client: "codex" })]);
    expect(await reopened.listRuns(workspace)).toEqual([expect.objectContaining({ objective: "Persist" })]);
    await writeFile(join(workspace.canonicalPath, ".voidra", "skills.json"), "not json");
    await expect(reopened.listSkills(workspace)).rejects.toMatchObject({ code: "INCOMPATIBLE_SCHEMA" });
    close();
  });
});
