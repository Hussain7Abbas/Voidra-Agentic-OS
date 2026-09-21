import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceDatabase } from "../../src/service/database";
import { ManualHandoffManager } from "../../src/service/handoffs";
import { InstructionResolver } from "../../src/service/instructions";
import { KnowledgeManager } from "../../src/service/knowledge";
import { NoteCoordinator } from "../../src/service/notes";
import { RouterManager } from "../../src/service/routers";
import { WorkspaceManager } from "../../src/service/workspaces";

const directories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "voidra-router-"));
  directories.push(directory);
  const root = join(directory, "Work");
  await mkdir(root);
  const database = new ServiceDatabase(join(directory, "state.sqlite"));
  const workspaces = new WorkspaceManager(database);
  const workspace = await workspaces.create("Work", root);
  const notes = new NoteCoordinator();
  const knowledge = new KnowledgeManager(database, notes);
  const handoffs = new ManualHandoffManager(workspaces, new InstructionResolver(), knowledge);
  const routers = new RouterManager(knowledge, handoffs);
  return { root, workspace, notes, database, handoffs, routers };
}

afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("RouterManager", () => {
  it("previews reviewable generated sections and preserves human bytes", async () => {
    const { root, workspace, notes, database, handoffs, routers } = await fixture();
    await (await notes.forWorkspace(workspace)).create("Project.md", "# Project\n\nHuman note");
    await handoffs.createSkill(workspace, { name: "Brief", description: "", instructions: "Brief it", expectedOutput: "text", inputs: [] });
    await writeFile(join(root, "ROUTER.md"), "# Human router\n\nKeep this paragraph byte-for-byte.\n");
    const suggestion = await routers.suggest(workspace, "");
    expect(await readFile(join(root, "ROUTER.md"), "utf8")).toBe("# Human router\n\nKeep this paragraph byte-for-byte.\n");
    expect(suggestion.preview).toContain("Keep this paragraph byte-for-byte.");
    expect(suggestion.preview).toContain("<!-- voidra:router:start -->");
    await routers.apply(workspace, suggestion.id);
    const applied = await readFile(join(root, "ROUTER.md"), "utf8");
    expect(applied).toContain("Keep this paragraph byte-for-byte.");
    expect(applied).toContain("Brief · v1");
    await notes.shutdown(); database.close();
  });

  it("fails closed after concurrent edits and rejects traversal", async () => {
    const { root, workspace, notes, database, routers } = await fixture();
    const suggestion = await routers.suggest(workspace, "projects");
    await mkdir(join(root, "projects"), { recursive: true });
    await writeFile(join(root, "projects", "ROUTER.md"), "changed");
    await expect(routers.apply(workspace, suggestion.id)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(routers.suggest(workspace, "../outside")).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await notes.shutdown(); database.close();
  });
});
