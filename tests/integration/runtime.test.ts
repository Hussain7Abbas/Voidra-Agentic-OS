import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceDatabase } from "../../src/service/database";
import { ServiceRuntime } from "../../src/service/runtime";
import { WORKSPACE_ID_EXAMPLE } from "../../src/shared/contracts";

const temporaryDirectories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "voidra-runtime-test-"));
  temporaryDirectories.push(directory);
  const database = new ServiceDatabase(join(directory, "runtime.sqlite"));
  return { directory, database, runtime: new ServiceRuntime(database) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ServiceRuntime", () => {
  it("correlates a ping and records its workspace", async () => {
    const { database, runtime } = await fixture();
    const response = await runtime.handle({
      requestId: "7d957abe-b57c-47fd-83c1-6bb69aaf2706",
      workspaceId: WORKSPACE_ID_EXAMPLE,
      sessionId: "57359854-b7cd-4d3d-8f84-ac579257c579",
      operation: "system.ping",
      payload: {},
    });
    expect(response).toMatchObject({ ok: true, requestId: "7d957abe-b57c-47fd-83c1-6bb69aaf2706" });
    expect(database.getMetadata("last_ping_workspace")).toBe(WORKSPACE_ID_EXAMPLE);
    database.close();
  });

  it("validates a real directory and does not expose internal error details", async () => {
    const { directory, database, runtime } = await fixture();
    const base = {
      requestId: "7d957abe-b57c-47fd-83c1-6bb69aaf2706",
      workspaceId: WORKSPACE_ID_EXAMPLE,
      sessionId: "57359854-b7cd-4d3d-8f84-ac579257c579",
      operation: "workspace.validateDirectory",
    } as const;
    await expect(runtime.handle({ ...base, payload: { path: directory } })).resolves.toMatchObject({ ok: true });
    const missing = await runtime.handle({ ...base, payload: { path: join(directory, "secret-token-value") } });
    expect(missing).toMatchObject({ ok: false, error: { code: "DIRECTORY_UNAVAILABLE" } });
    expect(JSON.stringify(missing)).not.toContain("secret-token-value");
    database.close();
  });

  it("binds an opaque account reference but never serializes it back to the renderer", async () => {
    const { directory, database, runtime } = await fixture();
    const root = join(directory, "Workspace");
    await mkdir(root);
    const identity = {
      requestId: "7d957abe-b57c-47fd-83c1-6bb69aaf2706",
      workspaceId: WORKSPACE_ID_EXAMPLE,
      sessionId: "57359854-b7cd-4d3d-8f84-ac579257c579",
    };
    const created = await runtime.handle({ ...identity, operation: "workspace.create", payload: { name: "Accounts", path: root } });
    expect(created.ok).toBe(true);
    const workspaceId = created.ok ? (created.data.workspace as { id: string }).id : WORKSPACE_ID_EXAMPLE;
    const bound = await runtime.handle({
      ...identity,
      requestId: "8d957abe-b57c-47fd-83c1-6bb69aaf2706",
      workspaceId,
      operation: "account.bindReference",
      payload: { accountId: "9d957abe-b57c-47fd-83c1-6bb69aaf2706", provider: "calendar", credentialRef: "keychain://voidra/calendar/work" },
    });
    expect(bound).toMatchObject({ ok: true });
    const listed = await runtime.handle({
      ...identity,
      requestId: "ad957abe-b57c-47fd-83c1-6bb69aaf2706",
      workspaceId,
      operation: "account.listReferences",
      payload: {},
    });
    expect(listed).toMatchObject({ ok: true, data: { references: [{ provider: "calendar", connected: true }] } });
    expect(JSON.stringify(listed)).not.toContain("keychain://");
    database.close();
  });
});
