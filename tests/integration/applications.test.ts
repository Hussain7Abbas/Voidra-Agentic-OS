import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApplicationManager } from "../../src/service/applications";
import type { WorkspaceRecord } from "../../src/service/database";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "voidra-applications-")); temporary.push(root); await mkdir(join(root, ".voidra")); const now = new Date().toISOString();
  const workspace: WorkspaceRecord = { id: "018f0f73-89db-7a63-a1b2-5d46f598ed01", name: "Work", canonicalPath: root, createdAt: now, updatedAt: now, lastOpenedAt: now };
  const manager = new ApplicationManager({ listMcp: async () => ({ connections: [] }), listVoice: async () => ({ muted: false }), remoteStatus: () => ({ available: true }), listAgents: async () => ({ tasks: [] }) });
  return { root, workspace, manager };
}

describe("ApplicationManager", () => {
  it("keeps declarations inert until linked to a current approved component", async () => {
    const { root, workspace, manager } = await fixture();
    const app = await manager.registerMicroApp(workspace, { title: "Project pulse", icon: "◇", surfaces: ["dashboard"], dataNeeds: ["workspace summary"], storage: "workspace-namespaced", actions: [{ id: "refresh", label: "Refresh", risk: "read" }] });
    expect(app).toMatchObject({ state: "declarative", artifactId: null, network: "broker-only" }); expect((await manager.list(workspace)).find(({ id }) => id === `micro:${app.id}`)).toMatchObject({ status: "configured" });
    const artifactId = crypto.randomUUID(); await writeFile(join(root, ".voidra", "artifacts.json"), JSON.stringify([{ id: artifactId, workspaceId: workspace.id, kind: "component", reviewState: "approved", reviewDecision: { verdict: "approved", expiresAt: new Date(Date.now() + 60_000).toISOString() } }]));
    expect(await manager.promoteMicroApp(workspace, app.id, artifactId)).toMatchObject({ state: "reviewed-component", artifactId });
    await expect(manager.promoteMicroApp(workspace, app.id, crypto.randomUUID())).rejects.toThrow("approved component");
  });

  it("ranks official routes first and journals exact widget actions", async () => {
    const { workspace, manager } = await fixture();
    expect(manager.recommend("calendar")[0]).toMatchObject({ provenance: "official-api", installation: "separate-review-required" });
    const action = await manager.prepareWidgetAction(workspace, "calendar", "open-settings", {}); expect(action).toMatchObject({ state: "completed", risk: "read", result: { destination: "/settings/" } });
    await expect(manager.prepareWidgetAction(workspace, "calendar", "undeclared", {})).rejects.toThrow("not declared");
  });
});
