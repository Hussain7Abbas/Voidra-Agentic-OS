import Database from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 3;

export type WorkspaceRecord = {
  id: string;
  name: string;
  canonicalPath: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
};

export type AccountReference = {
  accountId: string;
  workspaceId: string;
  provider: string;
  credentialRef: string;
};

export type KnowledgeBaseRecord = {
  id: string;
  name: string;
  canonicalPath: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeAttachmentRecord = {
  workspaceId: string;
  baseId: string;
  access: "read" | "write";
  attachedAt: string;
};

export class IncompatibleSchemaError extends Error {
  constructor(readonly foundVersion: number) {
    super(`Database schema ${foundVersion} is not supported by this version of Voidra.`);
    this.name = "IncompatibleSchemaError";
  }
}

export class ServiceDatabase {
  readonly #database: Database.Database;

  constructor(path: string) {
    this.#database = new Database(path);
    this.#database.pragma("foreign_keys = ON");
    this.#database.pragma("journal_mode = WAL");
    this.#migrate();
  }

  #migrate() {
    let version = this.#database.pragma("user_version", { simple: true }) as number;
    if (version > CURRENT_SCHEMA_VERSION) {
      this.#database.close();
      throw new IncompatibleSchemaError(version);
    }
    if (version === 0) {
      this.#database.transaction(() => {
        this.#database.exec(`
          CREATE TABLE service_metadata (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;
        `);
        this.#database.pragma("user_version = 1");
      })();
      version = 1;
    }
    if (version === 1) {
      this.#database.transaction(() => {
        this.#database.exec(`
          CREATE TABLE workspaces (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            canonical_path TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_opened_at TEXT NOT NULL
          ) STRICT;

          CREATE TABLE workspace_accounts (
            account_id TEXT PRIMARY KEY NOT NULL,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            provider TEXT NOT NULL,
            credential_ref TEXT NOT NULL,
            UNIQUE(workspace_id, provider, account_id)
          ) STRICT;
        `);
        this.#database.pragma("user_version = 2");
      })();
      version = 2;
    }
    if (version === 2) {
      this.#database.transaction(() => {
        this.#database.exec(`
          CREATE TABLE knowledge_bases (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            canonical_path TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;

          CREATE TABLE workspace_knowledge_attachments (
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
            access TEXT NOT NULL CHECK(access IN ('read', 'write')),
            attached_at TEXT NOT NULL,
            PRIMARY KEY(workspace_id, base_id)
          ) STRICT;
        `);
        this.#database.pragma("user_version = 3");
      })();
    }
  }

  setMetadata(key: string, value: string) {
    this.#database.prepare(`
      INSERT INTO service_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }

  getMetadata(key: string) {
    const row = this.#database.prepare("SELECT value FROM service_metadata WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  deleteMetadata(key: string) {
    this.#database.prepare("DELETE FROM service_metadata WHERE key = ?").run(key);
  }

  listWorkspaces(): WorkspaceRecord[] {
    const rows = this.#database.prepare(`
      SELECT id, name, canonical_path, created_at, updated_at, last_opened_at
      FROM workspaces
      ORDER BY last_opened_at DESC, name COLLATE NOCASE
    `).all() as Array<Record<string, string>>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      canonicalPath: row.canonical_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastOpenedAt: row.last_opened_at,
    }));
  }

  getWorkspace(id: string): WorkspaceRecord | undefined {
    const row = this.#database.prepare(`
      SELECT id, name, canonical_path, created_at, updated_at, last_opened_at
      FROM workspaces WHERE id = ?
    `).get(id) as Record<string, string> | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      canonicalPath: row.canonical_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastOpenedAt: row.last_opened_at,
    };
  }

  insertWorkspace(record: WorkspaceRecord) {
    this.#database.prepare(`
      INSERT INTO workspaces (id, name, canonical_path, created_at, updated_at, last_opened_at)
      VALUES (@id, @name, @canonicalPath, @createdAt, @updatedAt, @lastOpenedAt)
    `).run(record);
  }

  updateWorkspacePath(id: string, canonicalPath: string) {
    const now = new Date().toISOString();
    this.#database.prepare("UPDATE workspaces SET canonical_path = ?, updated_at = ?, last_opened_at = ? WHERE id = ?")
      .run(canonicalPath, now, now, id);
  }

  selectWorkspace(id: string) {
    const now = new Date().toISOString();
    this.#database.prepare("UPDATE workspaces SET last_opened_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
    this.setMetadata("selected_workspace_id", id);
  }

  removeWorkspace(id: string) {
    this.#database.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
    if (this.getMetadata("selected_workspace_id") === id) this.deleteMetadata("selected_workspace_id");
    if (this.getMetadata("default_workspace_id") === id) this.deleteMetadata("default_workspace_id");
  }

  bindAccountReference(reference: AccountReference) {
    this.#database.prepare(`
      INSERT INTO workspace_accounts (account_id, workspace_id, provider, credential_ref)
      VALUES (@accountId, @workspaceId, @provider, @credentialRef)
      ON CONFLICT(account_id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        provider = excluded.provider,
        credential_ref = excluded.credential_ref
    `).run(reference);
  }

  listAccountReferences(workspaceId: string): AccountReference[] {
    const rows = this.#database.prepare(`
      SELECT account_id, workspace_id, provider, credential_ref
      FROM workspace_accounts WHERE workspace_id = ? ORDER BY provider, account_id
    `).all(workspaceId) as Array<Record<string, string>>;
    return rows.map((row) => ({
      accountId: row.account_id,
      workspaceId: row.workspace_id,
      provider: row.provider,
      credentialRef: row.credential_ref,
    }));
  }

  getKnowledgeBase(id: string): KnowledgeBaseRecord | undefined {
    const row = this.#database.prepare("SELECT id, name, canonical_path, created_at, updated_at FROM knowledge_bases WHERE id = ?").get(id) as Record<string, string> | undefined;
    return row ? { id: row.id, name: row.name, canonicalPath: row.canonical_path, createdAt: row.created_at, updatedAt: row.updated_at } : undefined;
  }

  getKnowledgeBaseByPath(canonicalPath: string): KnowledgeBaseRecord | undefined {
    const row = this.#database.prepare("SELECT id, name, canonical_path, created_at, updated_at FROM knowledge_bases WHERE canonical_path = ?").get(canonicalPath) as Record<string, string> | undefined;
    return row ? { id: row.id, name: row.name, canonicalPath: row.canonical_path, createdAt: row.created_at, updatedAt: row.updated_at } : undefined;
  }

  insertKnowledgeBase(record: KnowledgeBaseRecord) {
    this.#database.prepare("INSERT INTO knowledge_bases (id, name, canonical_path, created_at, updated_at) VALUES (@id, @name, @canonicalPath, @createdAt, @updatedAt)").run(record);
  }

  updateKnowledgeBasePath(id: string, canonicalPath: string) {
    this.#database.prepare("UPDATE knowledge_bases SET canonical_path = ?, updated_at = ? WHERE id = ?").run(canonicalPath, new Date().toISOString(), id);
  }

  attachKnowledgeBase(record: KnowledgeAttachmentRecord) {
    this.#database.prepare(`
      INSERT INTO workspace_knowledge_attachments (workspace_id, base_id, access, attached_at)
      VALUES (@workspaceId, @baseId, @access, @attachedAt)
      ON CONFLICT(workspace_id, base_id) DO UPDATE SET access = excluded.access
    `).run(record);
  }

  listKnowledgeAttachments(workspaceId: string): Array<KnowledgeAttachmentRecord & KnowledgeBaseRecord> {
    const rows = this.#database.prepare(`
      SELECT a.workspace_id, a.base_id, a.access, a.attached_at,
             b.id, b.name, b.canonical_path, b.created_at, b.updated_at
      FROM workspace_knowledge_attachments a JOIN knowledge_bases b ON b.id = a.base_id
      WHERE a.workspace_id = ? ORDER BY b.name COLLATE NOCASE, b.id
    `).all(workspaceId) as Array<Record<string, string>>;
    return rows.map((row) => ({
      workspaceId: row.workspace_id,
      baseId: row.base_id,
      access: row.access as "read" | "write",
      attachedAt: row.attached_at,
      id: row.id,
      name: row.name,
      canonicalPath: row.canonical_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getKnowledgeAttachment(workspaceId: string, baseId: string) {
    return this.listKnowledgeAttachments(workspaceId).find((attachment) => attachment.baseId === baseId);
  }

  updateKnowledgeAttachmentAccess(workspaceId: string, baseId: string, access: "read" | "write") {
    this.#database.prepare("UPDATE workspace_knowledge_attachments SET access = ? WHERE workspace_id = ? AND base_id = ?").run(access, workspaceId, baseId);
  }

  detachKnowledgeBase(workspaceId: string, baseId: string) {
    this.#database.prepare("DELETE FROM workspace_knowledge_attachments WHERE workspace_id = ? AND base_id = ?").run(workspaceId, baseId);
  }

  close() {
    this.#database.close();
  }
}
