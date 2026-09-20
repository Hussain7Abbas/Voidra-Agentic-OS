import { chmod, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceDatabase } from "../../src/service/database";
import { InstructionResolver } from "../../src/service/instructions";
import { DomainError, resolveInsideWorkspace, workspaceNameFromPath, WorkspaceManager } from "../../src/service/workspaces";

const temporaryDirectories: string[] = [];

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "voidra-workspaces-"));
  temporaryDirectories.push(base);
  const databasePath = join(base, "application.sqlite");
  const database = new ServiceDatabase(databasePath);
  return { base, databasePath, database, manager: new WorkspaceManager(database) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("WorkspaceManager", () => {
  it("creates independent Unicode roots and survives a registry reopen", async () => {
    const { base, databasePath, database, manager } = await fixture();
    const workRoot = join(base, "Work files");
    const personalRoot = join(base, "شخصي");
    await Promise.all([mkdir(workRoot), mkdir(personalRoot)]);
    const work = await manager.create("Work", workRoot);
    const personal = await manager.create("Personal", personalRoot);

    expect(await readFile(join(workRoot, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(JSON.parse(await readFile(join(workRoot, ".voidra", "workspace.json"), "utf8"))).toMatchObject({ workspaceId: work.id });
    database.close();

    const reopenedDatabase = new ServiceDatabase(databasePath);
    const reopened = await new WorkspaceManager(reopenedDatabase).list();
    expect(reopened.workspaces.map(({ name }) => name).sort()).toEqual(["Personal", "Work"]);
    expect(reopened.selectedWorkspaceId).toBe(personal.id);
    expect(reopened.defaultWorkspaceId).toBe(work.id);
    reopenedDatabase.close();
  });

  it("rejects symlink duplicates and overlapping roots", async () => {
    const { base, database, manager } = await fixture();
    const root = join(base, "Work");
    const nested = join(root, "nested");
    const alias = join(base, "work-alias");
    await mkdir(nested, { recursive: true });
    await symlink(root, alias);
    await manager.create("Work", root);

    await expect(manager.create("Alias", alias)).rejects.toMatchObject({ code: "DUPLICATE_WORKSPACE" });
    await expect(manager.create("Nested", nested)).rejects.toMatchObject({ code: "OVERLAPPING_WORKSPACE" });
    database.close();
  });

  it("reconnects a moved folder without changing identity and removal leaves files", async () => {
    const { base, database, manager } = await fixture();
    const original = join(base, "Original");
    const moved = join(base, "Moved");
    await mkdir(original);
    const workspace = await manager.create("Movable", original);
    await rename(original, moved);
    expect((await manager.list()).workspaces[0].available).toBe(false);
    const located = await manager.locate(workspace.id, moved);
    expect(located.id).toBe(workspace.id);
    manager.remove(workspace.id);
    expect(await readFile(join(moved, ".voidra", "workspace.json"), "utf8")).toContain(workspace.id);
    expect((await manager.list()).workspaces).toEqual([]);
    database.close();
  });

  it("preserves existing instructions and leaves conflicts recoverable but unregistered", async () => {
    const { base, database, manager } = await fixture();
    const existing = join(base, "Existing");
    await mkdir(existing);
    await writeFile(join(existing, "AGENTS.md"), "User rules\n");
    const created = await manager.create("Existing", existing);
    expect(await readFile(join(existing, "AGENTS.md"), "utf8")).toBe("User rules\n");
    expect(created.instructionIssues).toContainEqual(expect.objectContaining({ code: "missing_claude_import" }));

    const conflict = join(base, "Conflict");
    await mkdir(join(conflict, ".voidra"), { recursive: true });
    await expect(manager.create("Conflict", conflict)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    expect((await manager.list()).workspaces).toHaveLength(1);
    database.close();
  });

  it("keeps global and workspace settings separate and stores persona in its owner", async () => {
    const { base, database, manager } = await fixture();
    const workRoot = join(base, "Work");
    const personalRoot = join(base, "Personal");
    await Promise.all([mkdir(workRoot), mkdir(personalRoot)]);
    const work = await manager.create("Work", workRoot);
    const personal = await manager.create("Personal", personalRoot);
    manager.updateGlobalSettings({ execution: { preferredModel: "global/model" }, assistant: { persona: "Global" } });
    await manager.updateWorkspaceSettings(work.id, { execution: { preferredModel: "work/model", enabledTools: [] }, assistant: { persona: "Work only" }, voice: { enabled: false } });
    manager.updateGlobalSettings({ execution: { preferredModel: "global/changed" }, assistant: { persona: "Changed global" } });

    expect((await manager.getSettings(work.id)).effective.execution.preferredModel).toBe("work/model");
    expect((await manager.getSettings(personal.id)).effective.execution.preferredModel).toBe("global/changed");
    expect(await readFile(join(workRoot, "persona.md"), "utf8")).toBe("Work only");
    expect(await readFile(join(personalRoot, "persona.md"), "utf8")).toContain("inherits the global persona");
    await manager.updateWorkspaceSettings(work.id, {});
    expect((await manager.getSettings(work.id)).origins.execution.preferredModel).toBe("global");
    database.close();
  });

  it("stores only opaque workspace account references", async () => {
    const { base, database, manager } = await fixture();
    const root = join(base, "Accounts");
    await mkdir(root);
    const workspace = await manager.create("Accounts", root);
    manager.bindAccountReference(workspace.id, {
      accountId: "7d957abe-b57c-47fd-83c1-6bb69aaf2706",
      provider: "calendar",
      credentialRef: "keychain://voidra/calendar/work",
    });
    expect(manager.listAccountReferences(workspace.id)).toEqual([expect.objectContaining({ workspaceId: workspace.id, credentialRef: "keychain://voidra/calendar/work" })]);
    expect(await readFile(join(root, ".voidra", "settings.json"), "utf8")).not.toContain("keychain://");
    database.close();
  });

  it("opens a previously initialized root and manages explicit preferences", async () => {
    const { base, database, manager } = await fixture();
    const root = join(base, "Portable");
    await mkdir(root);
    const created = await manager.create("Portable", root);
    manager.remove(created.id);
    const opened = await manager.open(root);
    expect(opened.id).toBe(created.id);
    manager.setPreferences({ defaultWorkspaceId: null, askOnStartup: true });
    expect(await manager.list()).toMatchObject({ defaultWorkspaceId: null, askOnStartup: true });
    manager.setPreferences({ defaultWorkspaceId: opened.id, askOnStartup: false });
    expect(await manager.list()).toMatchObject({ defaultWorkspaceId: opened.id, askOnStartup: false });
    expect(manager.select(opened.id).id).toBe(opened.id);
    database.close();
  });

  it("reports missing, invalid, and mismatched workspace identities", async () => {
    const { base, database, manager } = await fixture();
    const absent = join(base, "Absent");
    const invalid = join(base, "Invalid");
    const firstRoot = join(base, "First");
    const secondRoot = join(base, "Second");
    await Promise.all([mkdir(invalid), mkdir(firstRoot), mkdir(secondRoot)]);
    await mkdir(join(invalid, ".voidra"));
    await writeFile(join(invalid, ".voidra", "workspace.json"), "not-json");
    await expect(manager.open(absent)).rejects.toMatchObject({ code: "WORKSPACE_UNAVAILABLE" });
    await expect(manager.open(invalid)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    const first = await manager.create("First", firstRoot);
    const second = await manager.create("Second", secondRoot);
    manager.remove(second.id);
    await expect(manager.locate(first.id, secondRoot)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    expect(() => manager.select("7d957abe-b57c-47fd-83c1-6bb69aaf2706")).toThrowError(DomainError);
    expect(() => manager.remove("7d957abe-b57c-47fd-83c1-6bb69aaf2706")).toThrowError(DomainError);
    database.close();
  });

  it("surfaces invalid settings without resetting their source", async () => {
    const { base, database, manager } = await fixture();
    const root = join(base, "Invalid settings");
    await mkdir(root);
    const workspace = await manager.create("Invalid settings", root);
    database.setMetadata("global_settings", "{broken");
    await expect(manager.getSettings(workspace.id)).rejects.toMatchObject({ code: "INCOMPATIBLE_SCHEMA" });
    database.deleteMetadata("global_settings");
    await writeFile(join(root, ".voidra", "settings.json"), JSON.stringify({ schemaVersion: 9, overrides: {} }));
    await expect(manager.getSettings(workspace.id)).rejects.toMatchObject({ code: "INCOMPATIBLE_SCHEMA" });
    await rm(join(root, ".voidra", "settings.json"));
    await expect(manager.getSettings(workspace.id)).rejects.toMatchObject({ code: "WORKSPACE_UNAVAILABLE", retryable: true });
    database.close();
  });

  it("preserves existing persona and reports every root instruction conflict", async () => {
    const { base, database, manager } = await fixture();
    const root = join(base, "Conflicting rules");
    await mkdir(root);
    await writeFile(join(root, "CLAUDE.md"), "Different import\n");
    await writeFile(join(root, "AGENTS.override.md"), "Override present\n");
    await writeFile(join(root, "persona.md"), "Existing persona\n");
    const created = await manager.create("Conflicts", root);
    expect(created.instructionIssues.map(({ code }) => code)).toEqual(expect.arrayContaining(["orphan_claude", "conflicting_claude_preserved", "existing_persona_preserved"]));
    const listed = await manager.list();
    expect(listed.workspaces[0].instructionIssues.map(({ code }) => code)).toEqual(expect.arrayContaining(["orphan_claude", "conflicting_claude_preserved", "agents_override_present"]));
    expect(await readFile(join(root, "persona.md"), "utf8")).toBe("Existing persona\n");
    database.close();
  });

  it("rejects non-directories and absolute or escaping workspace-relative paths", async () => {
    const { base, database, manager } = await fixture();
    const file = join(base, "file.txt");
    await writeFile(file, "not a directory");
    await expect(manager.create("File", file)).rejects.toMatchObject({ code: "WORKSPACE_UNAVAILABLE" });
    expect(() => resolveInsideWorkspace(base, "/absolute")).toThrowError(DomainError);
    expect(() => resolveInsideWorkspace(base, "../escape")).toThrowError(DomainError);
    expect(resolveInsideWorkspace(base, "")).toBe(base);
    expect(workspaceNameFromPath(join(base, "Named"))).toBe("Named");
    database.close();
  });

  it("does not register unwritable roots and recovers after a registration transaction failure", async () => {
    const { base, database, manager } = await fixture();
    const locked = join(base, "Locked");
    const recoverable = join(base, "Recoverable");
    await Promise.all([mkdir(locked), mkdir(recoverable)]);
    await chmod(locked, 0o500);
    await expect(manager.create("Locked", locked)).rejects.toMatchObject({ code: "WORKSPACE_UNAVAILABLE" });
    await chmod(locked, 0o700);
    expect((await manager.list()).workspaces).toEqual([]);

    const insert = vi.spyOn(database, "insertWorkspace").mockImplementationOnce(() => { throw new Error("simulated transaction failure"); });
    await expect(manager.create("Recoverable", recoverable)).rejects.toThrow("simulated transaction failure");
    insert.mockRestore();
    expect((await manager.list()).workspaces).toEqual([]);
    const reopened = await manager.open(recoverable);
    expect(reopened.name).toBe("Recoverable");
    database.close();
  });
});

describe("InstructionResolver", () => {
  it("resolves root-to-target ancestry without sibling leakage", async () => {
    const { base, database, manager } = await fixture();
    const root = join(base, "Rules");
    const child = join(root, "project", "child");
    const sibling = join(root, "sibling");
    await Promise.all([mkdir(child, { recursive: true }), mkdir(sibling, { recursive: true })]);
    const workspace = await manager.create("Rules", root);
    const resolver = new InstructionResolver();
    await resolver.createScope(root, "project", "Project rules");
    await resolver.createScope(root, "sibling", "Sibling rules");
    await writeFile(join(child, "note.md"), "target");
    await writeFile(join(sibling, "note.md"), "target");

    const [childResult, siblingResult] = await resolver.resolve(root, ["project/child/note.md", "sibling/note.md"]);
    expect(childResult.rules.map(({ content }) => content)).toEqual([expect.stringContaining("Voidra workspace"), "Project rules\n"]);
    expect(childResult.rules.map(({ content }) => content).join("\n")).not.toContain("Sibling rules");
    expect(siblingResult.rules.map(({ content }) => content).join("\n")).toContain("Sibling rules");
    expect(await readFile(join(root, "project", "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(workspace.id).toBeTruthy();
    database.close();
  });

  it("rejects escape paths, escaping symlinks, and conflicting pairs", async () => {
    const { base, database, manager } = await fixture();
    const root = join(base, "Root");
    const outside = join(base, "Outside");
    await Promise.all([mkdir(root), mkdir(outside)]);
    await manager.create("Root", root);
    const resolver = new InstructionResolver();
    await expect(resolver.resolve(root, ["../Outside"])).rejects.toBeInstanceOf(DomainError);
    await symlink(outside, join(root, "escape"));
    await expect(resolver.resolve(root, ["escape"])).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(resolver.createScope(root, ".", "Replacement")).rejects.toMatchObject({ code: "INSTRUCTION_CONFLICT" });
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).not.toContain("Replacement");
    database.close();
  });

  it("reports malformed instruction pairs, overrides, missing targets, and size limits", async () => {
    const { base, database, manager } = await fixture();
    const root = join(base, "Issues");
    const missingClaude = join(root, "missing-claude");
    const orphanClaude = join(root, "orphan-claude");
    const conflicting = join(root, "conflicting");
    const oversized = join(root, "oversized");
    await Promise.all([missingClaude, orphanClaude, conflicting, oversized].map((directory) => mkdir(directory, { recursive: true })));
    await manager.create("Issues", root);
    await writeFile(join(missingClaude, "AGENTS.md"), "Rules\n");
    await writeFile(join(orphanClaude, "CLAUDE.md"), "@AGENTS.md\n");
    await writeFile(join(conflicting, "AGENTS.md"), "Rules\n");
    await writeFile(join(conflicting, "CLAUDE.md"), "Different\n");
    await writeFile(join(conflicting, "AGENTS.override.md"), "Override\n");
    await writeFile(join(oversized, "AGENTS.md"), "x".repeat(128_001));
    const resolver = new InstructionResolver();

    const results = await resolver.resolve(root, ["missing-claude", "orphan-claude", "conflicting"]);
    expect(results[0].issues).toContainEqual(expect.objectContaining({ code: "missing_claude_import" }));
    expect(results[1].issues).toContainEqual(expect.objectContaining({ code: "orphan_claude" }));
    expect(results[2].issues.map(({ code }) => code)).toEqual(expect.arrayContaining(["conflicting_claude", "agents_override_present"]));
    await expect(resolver.resolve(root, ["oversized"])).rejects.toMatchObject({ code: "INSTRUCTION_CONFLICT" });
    await expect(resolver.resolve(root, ["missing.md"])).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(resolver.createScope(root, "missing-directory", "Rules")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    const file = join(root, "not-a-directory");
    await writeFile(file, "file");
    await expect(resolver.createScope(root, "not-a-directory", "Rules")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    database.close();
  });
});
