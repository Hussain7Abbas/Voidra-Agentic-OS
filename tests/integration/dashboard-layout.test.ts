import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DashboardLayoutManager } from "../../src/service/dashboard-layout";
import type { WorkspaceRecord } from "../../src/service/database";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function workspace(name: string) { const root = await mkdtemp(join(tmpdir(), `voidra-layout-${name}-`)); temporary.push(root); await mkdir(join(root, ".voidra")); const now = new Date().toISOString(); return { id: crypto.randomUUID(), name, canonicalPath: root, createdAt: now, updatedAt: now, lastOpenedAt: now } satisfies WorkspaceRecord; }

describe("DashboardLayoutManager", () => {
  it("persists versioned workspace layouts and restores the preset independently", async () => {
    const manager = new DashboardLayoutManager(); const work = await workspace("work"); const personal = await workspace("personal"); const initial = await manager.get(work); const items = initial.items.map((item) => item.id === "pulse" ? { ...item, visible: false as const } : item);
    const saved = await manager.update(work, initial.revision, items); expect(saved.revision).not.toBe(initial.revision); expect(saved.items.find(({ id }) => id === "pulse")?.visible).toBe(false); expect((await manager.get(personal)).items.find(({ id }) => id === "pulse")?.visible).toBe(true);
    await expect(manager.update(work, initial.revision, items)).rejects.toThrow("changed"); expect((await manager.reset(work)).items.find(({ id }) => id === "pulse")?.visible).toBe(true);
  });

  it("rejects collisions and incomplete widget sets", async () => {
    const manager = new DashboardLayoutManager(); const work = await workspace("invalid"); const initial = await manager.get(work); const collided = initial.items.map((item) => item.zone === "left" ? { ...item, order: 0 } : item);
    await expect(manager.update(work, initial.revision, collided)).rejects.toThrow("cannot share an order");
  });
});
