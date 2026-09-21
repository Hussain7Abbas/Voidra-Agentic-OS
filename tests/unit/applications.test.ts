import { describe, expect, it } from "vitest";
import { ApplicationManager } from "../../src/service/applications";

const workspace = { id: "11111111-1111-4111-8111-111111111111", name: "Work", canonicalPath: "/tmp/work", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", lastOpenedAt: "2026-01-01T00:00:00.000Z" };

describe("ApplicationManager", () => {
  it("normalizes app provenance, scope, capabilities, and honest widget freshness", async () => {
    const manager = new ApplicationManager({
      listMcp: async () => ({ connections: [{ id: "mcp-id", name: "Mail", status: "authorization-required", updatedAt: "2026-01-01T00:00:00.000Z", capabilities: { tools: [], resources: [] }, diagnostic: "Sign in" }] }),
      listVoice: async () => ({ muted: false }),
      remoteStatus: () => ({ available: false, reason: "Mac sleeping" }),
      listAgents: async () => ({ tasks: [{ id: "run", objective: "Draft", status: "running" }] }),
    });
    const apps = await manager.list(workspace);
    expect(apps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "voidra.browser", scope: "workspace", status: "ready" }),
      expect.objectContaining({ id: "voidra.remote", scope: "device-wide", status: "unavailable" }),
      expect.objectContaining({ id: "mcp:mcp-id", status: "auth-required" }),
    ]));
    const widgets = await manager.widgets(workspace);
    expect(widgets.find(({ widgetId }) => widgetId === "calendar")).toMatchObject({ freshness: "auth-required", summary: { events: [] } });
    expect(widgets.find(({ widgetId }) => widgetId === "creator-metrics")).toMatchObject({ freshness: "unavailable", summary: { metrics: [] } });
    expect(JSON.stringify(widgets)).not.toMatch(/subscriber|view count|event title/i);
  });
});
