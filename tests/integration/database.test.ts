import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseIntegrityError, IncompatibleSchemaError, ServiceDatabase } from "../../src/service/database";

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
    legacy.pragma("journal_mode = WAL");
    legacy.pragma("wal_autocheckpoint = 0");
    legacy.exec(`
      CREATE TABLE service_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO service_metadata VALUES ('preserved', 'yes', '2026-09-20T00:00:00.000Z');
      PRAGMA user_version = 1;
    `);
    expect((await stat(`${path}-wal`)).size).toBeGreaterThan(0);
    const migrated = new ServiceDatabase(path);
    expect(migrated.getMetadata("preserved")).toBe("yes");
    expect(migrated.listWorkspaces()).toEqual([]);
    expect(migrated.migrationBackupPath).toContain(".pre-migration-v1-to-v3-");
    const backup = new Database(migrated.migrationBackupPath!, { readonly: true });
    expect(backup.pragma("user_version", { simple: true })).toBe(1);
    expect(backup.prepare("SELECT value FROM service_metadata WHERE key = 'preserved'").pluck().get()).toBe("yes");
    expect(backup.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'").pluck().get()).toBe(0);
    backup.close();
    expect((await stat(migrated.migrationBackupPath!)).mode & 0o777).toBe(0o600);
    migrated.close();
    legacy.close();
  });

  it("refuses to snapshot or migrate an existing database that fails quick_check", async () => {
    const path = await databasePath();
    const damaged = new Database(path);
    damaged.exec(`
      CREATE TABLE service_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE damaged_probe (
        value INTEGER NOT NULL CHECK(value > 0)
      ) STRICT;
      PRAGMA ignore_check_constraints = ON;
      INSERT INTO damaged_probe VALUES (0);
      PRAGMA ignore_check_constraints = OFF;
      PRAGMA user_version = 1;
    `);
    damaged.close();

    expect(() => new ServiceDatabase(path)).toThrow(DatabaseIntegrityError);
    expect((await readdir(dirname(path))).some((file) => file.includes(".pre-migration-"))).toBe(false);

    const unchanged = new Database(path, { readonly: true });
    expect(unchanged.pragma("user_version", { simple: true })).toBe(1);
    expect(unchanged.prepare("SELECT value FROM damaged_probe").pluck().get()).toBe(0);
    unchanged.close();
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

  it("rolls back the whole upgrade chain when a later migration step is interrupted", async () => {
    const path = await databasePath();
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE service_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO service_metadata VALUES ('preserved', 'after-failure', '2026-09-20T00:00:00.000Z');
      PRAGMA user_version = 1;
    `);
    legacy.close();

    expect(() => new ServiceDatabase(path, {
      beforeMigrationStep(fromVersion) {
        if (fromVersion === 2) throw new Error("simulated interruption");
      },
    })).toThrow("simulated interruption");

    const unchanged = new Database(path, { readonly: true });
    expect(unchanged.pragma("user_version", { simple: true })).toBe(1);
    expect(unchanged.prepare("SELECT value FROM service_metadata WHERE key = 'preserved'").pluck().get()).toBe("after-failure");
    expect(unchanged.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'").pluck().get()).toBe(0);
    unchanged.close();

    const files = await readdir(dirname(path));
    const backupPath = files.find((file) => file.includes(".pre-migration-v1-to-v3-"));
    expect(backupPath).toBeTruthy();
    const backup = new Database(join(dirname(path), backupPath!), { readonly: true });
    expect(backup.pragma("user_version", { simple: true })).toBe(1);
    expect(backup.prepare("SELECT value FROM service_metadata WHERE key = 'preserved'").pluck().get()).toBe("after-failure");
    backup.close();
  });
});
