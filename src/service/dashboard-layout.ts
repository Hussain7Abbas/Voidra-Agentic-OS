import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { WorkspaceRecord } from "./database";
import { DomainError } from "./workspaces";

const widgetIds = ["applications", "calendar", "pulse", "attention", "skills", "routines"] as const;
const itemSchema = z.object({ id: z.enum(widgetIds), zone: z.enum(["left", "right"]), order: z.number().int().min(0).max(5), size: z.enum(["compact", "standard", "expanded"]), visible: z.boolean() }).strict();
const layoutSchema = z.object({ schemaVersion: z.literal(1), revision: z.uuid(), preset: z.literal("command-center-v1"), items: z.array(itemSchema).length(widgetIds.length), updatedAt: z.iso.datetime() }).strict();
export type DashboardLayout = z.infer<typeof layoutSchema>;

function defaults(): DashboardLayout { const updatedAt = new Date().toISOString(); return { schemaVersion: 1, revision: randomUUID(), preset: "command-center-v1", updatedAt, items: [{ id: "applications", zone: "left", order: 0, size: "standard", visible: true }, { id: "calendar", zone: "left", order: 1, size: "standard", visible: true }, { id: "pulse", zone: "left", order: 2, size: "compact", visible: true }, { id: "attention", zone: "right", order: 0, size: "standard", visible: true }, { id: "skills", zone: "right", order: 1, size: "expanded", visible: true }, { id: "routines", zone: "right", order: 2, size: "standard", visible: true }] }; }
async function atomicWrite(path: string, value: unknown) { const temporary = `${path}.tmp-${randomUUID()}`; await mkdir(dirname(path), { recursive: true }); await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); await rename(temporary, path); }

export class DashboardLayoutManager {
  async get(workspace: WorkspaceRecord) { try { return this.#validate(layoutSchema.parse(JSON.parse(await readFile(this.#path(workspace), "utf8")))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new DomainError("INCOMPATIBLE_SCHEMA", "Dashboard layout requires recovery."); const layout = defaults(); await atomicWrite(this.#path(workspace), layout); return layout; } }
  async update(workspace: WorkspaceRecord, expectedRevision: string, items: DashboardLayout["items"]) { const current = await this.get(workspace); if (current.revision !== expectedRevision) throw new DomainError("WORKSPACE_CONFLICT", "Dashboard layout changed; reload before saving."); const next = this.#validate(layoutSchema.parse({ ...current, revision: randomUUID(), items, updatedAt: new Date().toISOString() })); await atomicWrite(this.#path(workspace), next); return next; }
  async reset(workspace: WorkspaceRecord) { const layout = defaults(); await atomicWrite(this.#path(workspace), layout); return layout; }
  #validate(layout: DashboardLayout) { const ids = layout.items.map(({ id }) => id); if (new Set(ids).size !== widgetIds.length || widgetIds.some((id) => !ids.includes(id))) throw new DomainError("WORKSPACE_CONFLICT", "Dashboard layout must include each known widget exactly once."); for (const zone of ["left", "right"] as const) { const orders = layout.items.filter((item) => item.zone === zone).map(({ order }) => order); if (new Set(orders).size !== orders.length) throw new DomainError("WORKSPACE_CONFLICT", "Dashboard widgets in one rail cannot share an order."); } return layout; }
  #path(workspace: WorkspaceRecord) { return join(workspace.canonicalPath, ".voidra", "dashboard-layout.json"); }
}
