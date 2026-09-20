import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { IncompatibleSchemaError, ServiceDatabase } from "../../src/service/database";

const temporaryDirectories: string[] = [];

async function databasePath() {
  const directory = await mkdtemp(join(tmpdir(), "voidra-db-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "state.sqlite");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ServiceDatabase", () => {
  it("persists durable metadata across a real close and reopen", async () => {
    const path = await databasePath();
    const first = new ServiceDatabase(path);
    first.setMetadata("workspace", "foundation");
    first.close();

    const reopened = new ServiceDatabase(path);
    expect(reopened.getMetadata("workspace")).toBe("foundation");
    reopened.close();
  });

  it("refuses a newer schema without resetting it", async () => {
    const path = await databasePath();
    const future = new Database(path);
    future.pragma("user_version = 999");
    future.close();

    expect(() => new ServiceDatabase(path)).toThrow(IncompatibleSchemaError);
    const inspected = new Database(path, { readonly: true });
    expect(inspected.pragma("user_version", { simple: true })).toBe(999);
    inspected.close();
  });

  it("migrates the P00 schema without losing metadata", async () => {
    const path = await databasePath();
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE service_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO service_metadata VALUES ('preserved', 'yes', '2026-09-20T00:00:00.000Z');
      PRAGMA user_version = 1;
    `);
    legacy.close();
    const migrated = new ServiceDatabase(path);
    expect(migrated.getMetadata("preserved")).toBe("yes");
    expect(migrated.listWorkspaces()).toEqual([]);
    migrated.close();
  });

  it("migrates the P02 workspace schema and adds shared-base attachments", async () => {
    const path = await databasePath();
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE service_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, canonical_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_opened_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE workspace_accounts (
        account_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        provider TEXT NOT NULL, credential_ref TEXT NOT NULL,
        UNIQUE(workspace_id, provider, account_id)
      ) STRICT;
      INSERT INTO service_metadata VALUES ('p02-preserved', 'yes', '2026-09-20T00:00:00.000Z');
      PRAGMA user_version = 2;
    `);
    legacy.close();
    const migrated = new ServiceDatabase(path);
    expect(migrated.getMetadata("p02-preserved")).toBe("yes");
    expect(migrated.listKnowledgeAttachments("00000000-0000-4000-8000-000000000000")).toEqual([]);
    migrated.close();
  });
});
