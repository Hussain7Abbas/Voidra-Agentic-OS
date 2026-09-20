import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentTaskManager } from "../../src/service/agents";
import { ServiceDatabase } from "../../src/service/database";
import { OpenRouterAdapter } from "../../src/service/openrouter";
import { RemoteManager } from "../../src/service/remote";
import { WorkspaceManager } from "../../src/service/workspaces";

const temporaryDirectories: string[] = [];
function complete(text = "Remote result") { return new Response(`data: ${JSON.stringify({ model: "fixture/remote", choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } }); }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "voidra-remote-")); temporaryDirectories.push(directory); const database = new ServiceDatabase(join(directory, "state.sqlite")); const workspaces = new WorkspaceManager(database); const workRoot = join(directory, "Work"); const personalRoot = join(directory, "Personal"); await Promise.all([mkdir(workRoot), mkdir(personalRoot)]); const work = await workspaces.create("Work", workRoot); const personal = await workspaces.create("Personal", personalRoot); const provider = vi.fn().mockResolvedValue(complete()); const agents = new AgentTaskManager(new OpenRouterAdapter({ baseUrl: "http://fixture", apiKey: () => "key", fetch: provider as typeof fetch })); const remote = new RemoteManager(database, workspaces, agents); return { database, workspaces, work, personal, provider, agents, remote };
}
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("RemoteManager", () => {
  it("pairs once from a short-lived Mac-created challenge and stores only a token hash", async () => {
    const { database, remote, work } = await fixture(); const challenge = await remote.createChallenge("Phone", [work.id]); const claimed = remote.claim(challenge.code, "Hussain's phone");
    expect(claimed.device).toMatchObject({ name: "Hussain's phone", workspaceIds: [work.id], revokedAt: null });
    expect(database.getMetadata("remote_registry_v1")).not.toContain(claimed.token);
    expect(await remote.companionStatus(claimed.token)).toMatchObject({ device: { id: claimed.device.id }, workspaces: [{ id: work.id, name: "Work" }] });
    expect(() => remote.claim(challenge.code, "Replay")).toThrowError(/invalid or expired/);
    database.close();
  });

  it("enforces workspace scope and immediate revocation", async () => {
    const { database, remote, work, personal } = await fixture(); const challenge = await remote.createChallenge("Phone", [personal.id]); const { token, device } = remote.claim(challenge.code, "Phone");
    await expect(remote.submit(token, { workspaceId: work.id, idempotencyKey: "wrong-space", objective: "Read Work", model: "fixture/remote" })).rejects.toMatchObject({ code: "REMOTE_AUTH_FAILED" });
    remote.revoke(device.id);
    await expect(remote.companionStatus(token)).rejects.toMatchObject({ code: "REMOTE_AUTH_FAILED" });
    database.close();
  });

  it("maps retries to one task and rejects idempotency-key payload changes", async () => {
    const { database, remote, work, provider } = await fixture(); const { token } = remote.claim((await remote.createChallenge("Phone", [work.id])).code, "Phone"); const input = { workspaceId: work.id, idempotencyKey: "request-1", objective: "Prepare update", model: "fixture/remote" };
    const first = await remote.submit(token, input); const duplicate = await remote.submit(token, input);
    expect(first).toMatchObject({ duplicate: false, state: "completed", task: { status: "completed", output: "Remote result" } }); expect(duplicate).toMatchObject({ duplicate: true, taskId: first.taskId }); expect(provider).toHaveBeenCalledTimes(1);
    await expect(remote.submit(token, { ...input, objective: "Different request" })).rejects.toMatchObject({ code: "REMOTE_CONFLICT" });
    const events = remote.events(token, work.id, 0); expect(events.events.map(({ type }) => type)).toEqual(["task.accepted", "task.started", "task.updated"]); expect(remote.events(token, work.id, events.nextCursor).events).toEqual([]);
    database.close();
  });

  it("rejects requests while unavailable without queuing them for wake", async () => {
    const { database, remote, work, provider } = await fixture(); const { token } = remote.claim((await remote.createChallenge("Phone", [work.id])).code, "Phone"); remote.setAvailable(false);
    await expect(remote.submit(token, { workspaceId: work.id, idempotencyKey: "offline", objective: "Do not queue", model: "fixture/remote" })).rejects.toMatchObject({ code: "REMOTE_UNAVAILABLE", retryable: true });
    remote.setAvailable(true); expect(provider).not.toHaveBeenCalled(); expect(remote.events(token, work.id, 0).events).toEqual([]);
    database.close();
  });

  it("expires challenges and preserves paired identities across manager restart", async () => {
    const { database, workspaces, agents, remote, work } = await fixture(); const expired = await remote.createChallenge("Expired", [work.id], 0); expect(() => remote.claim(expired.code, "Late")).toThrowError(/invalid or expired/); const valid = await remote.createChallenge("Tablet", [work.id]); const { token } = remote.claim(valid.code, "Tablet"); const reopened = new RemoteManager(database, workspaces, agents); expect((await reopened.companionStatus(token)).device.name).toBe("Tablet"); database.close();
  });
});
