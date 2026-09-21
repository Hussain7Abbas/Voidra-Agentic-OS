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
import { OutputCatalogManager } from "../../src/service/output-catalog";

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

  it("versions rich skill bundle resources while keeping scripts inert", async () => {
    const { workspace, handoffs, close } = await fixture();
    const skill = await handoffs.createSkill(workspace, { name: "Research", description: "Research bundle", instructions: "Use the bundled reference.", expectedOutput: "a report", inputs: ["topic"] });
    await handoffs.writeSkillResource(workspace, skill.id, { kind: "reference", path: "guide.md", encoding: "utf8", content: "# Trusted guide\n" });
    await handoffs.writeSkillResource(workspace, skill.id, { kind: "script", path: "collect.sh", encoding: "utf8", content: "#!/bin/sh\ntouch SHOULD_NOT_EXIST\n" });
    const updated = await handoffs.updateSkill(workspace, skill.id, { ...skill, instructions: "Use the versioned reference." });
    expect(updated.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "references/guide.md", risk: "inert" }),
      expect.objectContaining({ path: "scripts/collect.sh", risk: "executable-review-required" }),
    ]));
    const routine = await handoffs.createRoutine(workspace, { name: "Research", skillId: skill.id, client: "codex", preferredModel: "default", outputDirectory: "outputs", inlineInstructions: "" });
    const run = await handoffs.compile(workspace, { routineId: routine.id, objective: "Test bundle", targetPaths: [], sources: [] });
    expect(run.prompt).toContain("# Trusted guide");
    expect(run.prompt).not.toContain("touch SHOULD_NOT_EXIST");
    expect(run.skillSnapshot).toMatchObject({ version: 2, bundleDigest: updated.currentDigest });
    await expect(readFile(join(workspace.canonicalPath, "SHOULD_NOT_EXIST"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    close();
  });

  it("round-trips portable bundles without executing scripts and validates deterministic fixtures", async () => {
    const { workspace, other, handoffs, close } = await fixture();
    const skill = await handoffs.createSkill(workspace, { name: "Portable", description: "Portable skill", instructions: "Use the reference.", expectedOutput: "structured output", inputs: ["topic"] });
    await handoffs.writeSkillResource(workspace, skill.id, { kind: "reference", path: "guide.md", encoding: "utf8", content: "# Guide\n" });
    await handoffs.writeSkillResource(workspace, skill.id, { kind: "script", path: "never-run.sh", encoding: "utf8", content: "#!/bin/sh\ntouch SHOULD_NOT_EXIST\n" });
    await handoffs.writeSkillResource(workspace, skill.id, { kind: "test", path: "shape.json", encoding: "utf8", content: JSON.stringify({ name: "shape", input: { topic: "test" }, outputFixture: { title: "ok" }, expected: { type: "object", required: ["title"] }, requiredResources: ["references/guide.md"] }) });
    await handoffs.updateSkill(workspace, skill.id, { ...skill, instructions: "Use the versioned reference." });
    const validation = await handoffs.validateSkill(workspace, skill.id); expect(validation).toMatchObject({ passed: true });
    const exported = await handoffs.exportSkill(workspace, skill.id); const imported = await handoffs.importSkill(other, exported.content);
    expect(imported).toMatchObject({ name: "Portable", version: 1, importedScripts: 1 });
    expect(imported.resources).toEqual(expect.arrayContaining([expect.objectContaining({ path: "scripts/never-run.sh", risk: "executable-review-required" })]));
    expect(Buffer.from((await handoffs.readSkillResource(other, imported.id, "scripts/never-run.sh")).content, "base64").toString("utf8")).toContain("SHOULD_NOT_EXIST");
    await expect(readFile(join(other.canonicalPath, "SHOULD_NOT_EXIST"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const malicious = JSON.parse(exported.content); malicious.resources[0].path = "../escape.md";
    await expect(handoffs.importSkill(other, JSON.stringify(malicious))).rejects.toThrow("unsafe or mismatched resource path");
    close();
  });

  it("migrates V1 skill files to editable bundles and immutable digest snapshots", async () => {
    const { workspace, workspaces, knowledge, instructions, handoffs, close } = await fixture();
    const id = "11111111-1111-4111-8111-111111111111";
    await mkdir(join(workspace.canonicalPath, "skills", id), { recursive: true });
    await writeFile(join(workspace.canonicalPath, "skills", id, "v1.md"), "Legacy v1");
    await writeFile(join(workspace.canonicalPath, "skills", id, "v2.md"), "Legacy v2");
    const now = new Date().toISOString();
    await writeFile(join(workspace.canonicalPath, ".voidra", "skills.json"), `${JSON.stringify({ schemaVersion: 1, skills: [{ id, name: "Legacy Skill", description: "old", version: 2, expectedOutput: "text", inputs: [], createdAt: now, updatedAt: now }] })}\n`);
    const reopened = new ManualHandoffManager(workspaces, instructions, knowledge);
    const migrated = await reopened.listSkills(workspace);
    expect(migrated[0]).toMatchObject({ id, slug: "legacy-skill", version: 2, instructions: "Legacy v2" });
    expect(migrated[0]!.versions).toHaveLength(2);
    expect(await readFile(join(workspace.canonicalPath, "skills", "legacy-skill", "SKILL.md"), "utf8")).toBe("Legacy v2");
    const registry = JSON.parse(await readFile(join(workspace.canonicalPath, ".voidra", "skills.json"), "utf8")) as { schemaVersion: number };
    expect(registry.schemaVersion).toBe(2);
    close();
  });

  it("migrates existing routines to manual mode and keeps headless execution explicitly opt-in", async () => {
    const { workspace, workspaces, knowledge, instructions, handoffs, close } = await fixture();
    const { routine } = await skillAndRoutine(handoffs, workspace);
    const current = JSON.parse(await readFile(join(workspace.canonicalPath, ".voidra", "routines.json"), "utf8")) as { routines: Array<Record<string, unknown>> };
    const legacy = { schemaVersion: 1, routines: current.routines.map(({ executionMode: _mode, headlessExecutablePath: _path, headlessAccessMode: _access, headlessMaxRuntimeMs: _runtime, ...record }) => record) };
    await writeFile(join(workspace.canonicalPath, ".voidra", "routines.json"), `${JSON.stringify(legacy)}\n`);
    const reopened = new ManualHandoffManager(workspaces, instructions, knowledge);
    expect((await reopened.listRoutines(workspace))[0]).toMatchObject({ id: routine.id, executionMode: "manual", headlessExecutablePath: null, headlessAccessMode: "read-only", headlessMaxRuntimeMs: 300_000 });
    const migrated = JSON.parse(await readFile(join(workspace.canonicalPath, ".voidra", "routines.json"), "utf8")) as { schemaVersion: number };
    expect(migrated.schemaVersion).toBe(2);
    const skill = (await reopened.listSkills(workspace))[0]!;
    await expect(reopened.createRoutine(workspace, { name: "Unsafe", skillId: skill.id, client: "codex", preferredModel: "default", outputDirectory: ".", inlineInstructions: "", executionMode: "headless", headlessExecutablePath: "relative/codex" })).rejects.toThrow("absolute CLI path");
    const headless = await reopened.createRoutine(workspace, { name: "Headless", skillId: skill.id, client: "codex", preferredModel: "default", outputDirectory: ".", inlineInstructions: "", executionMode: "headless", headlessExecutablePath: "/opt/local/bin/codex", headlessAccessMode: "staged-write", headlessMaxRuntimeMs: 60_000 });
    expect(headless).toMatchObject({ executionMode: "headless", headlessAccessMode: "staged-write", headlessMaxRuntimeMs: 60_000 });
    const otherClient = await reopened.duplicateRoutine(workspace, headless.id, { name: "Claude copy", client: "claude", preferredModel: "default" });
    expect(otherClient).toMatchObject({ executionMode: "manual", headlessExecutablePath: null });
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

  it("catalogs reviewed manual output and reuses only the explicitly selected immutable revision", async () => {
    const { workspace, workspaces, instructions, knowledge, close } = await fixture(); const outputs = new OutputCatalogManager(); const handoffs = new ManualHandoffManager(workspaces, instructions, knowledge, outputs);
    const { routine } = await skillAndRoutine(handoffs, workspace); const first = await handoffs.compile(workspace, { routineId: routine.id, objective: "Create reusable output", targetPaths: [], sources: [] }); await handoffs.markCopied(workspace, first.id); await handoffs.previewResult(workspace, first.id, "returned", "reusable.md", "# Reusable evidence\n"); await handoffs.applyResult(workspace, first.id);
    const [output] = await outputs.list(workspace); expect(output).toMatchObject({ runId: first.id, kind: "markdown", provider: "manual-claude", retention: "canonical" });
    const reused = await handoffs.compile(workspace, { routineId: routine.id, objective: "Use prior evidence", targetPaths: [], sources: [], outputIds: [output!.id] });
    expect(reused.prompt).toContain("Prior output:"); expect(reused.prompt).toContain("# Reusable evidence"); expect(reused.contextManifest?.included).toEqual(expect.arrayContaining([expect.objectContaining({ type: "run-output", id: output!.id })]));
    await writeFile(join(workspace.canonicalPath, "outputs", "reusable.md"), "# Mutated after cataloging\n");
    await expect(handoffs.compile(workspace, { routineId: routine.id, objective: "Reject stale", targetPaths: [], sources: [], outputIds: [output!.id] })).rejects.toThrow("changed after cataloging");
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
