import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { parseMarkdown, type ParsedLink } from "../domain/markdown";
import { DomainError } from "./workspaces";
import type { WorkspaceRecord } from "./database";

const documentRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  documents: z.array(z.object({
    id: z.uuid(),
    path: z.string(),
    createdAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable(),
  }).strict()),
}).strict();

const historySchema = z.object({
  schemaVersion: z.literal(1),
  revisions: z.array(z.object({
    id: z.uuid(),
    documentId: z.uuid(),
    createdAt: z.iso.datetime(),
    contentHash: z.string(),
    kind: z.enum(["save", "pre-restore", "conflict-disk", "conflict-editor", "rename"]),
    file: z.string(),
  }).strict()),
}).strict();

type DocumentRegistry = z.infer<typeof documentRegistrySchema>;
type HistoryFile = z.infer<typeof historySchema>;
type HistoryRevision = HistoryFile["revisions"][number];

const renameJournalSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  documentId: z.uuid(),
  oldPath: z.string(),
  newPath: z.string(),
  targetRenamed: z.boolean(),
  operations: z.array(z.object({
    documentId: z.uuid(),
    path: z.string(),
    originalHash: z.string(),
    newContent: z.string(),
    completed: z.boolean(),
  }).strict()),
}).strict();

type RenameJournal = z.infer<typeof renameJournalSchema>;

export type NoteSearchResult = { id: string; path: string; title: string; revision: string; snippet: string };

type IndexedDocument = { id: string; path: string; title: string; content: string; hash: string; modifiedMs: number; links: ParsedLink[]; tags: string[] };

export type NoteStoreOptions = {
  beforeAtomicReplace?: (path: string) => void | Promise<void>;
};

function hashContent(content: string | Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function toPosix(path: string) {
  return path.split(sep).join("/");
}

async function optionalRead(path: string) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

class NoteIndex {
  readonly database: Database.Database;

  constructor(path: string) {
    this.database = new Database(path);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS note_documents (
        id TEXT PRIMARY KEY NOT NULL,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        modified_ms REAL NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS note_links (
        source_id TEXT NOT NULL,
        target_text TEXT NOT NULL,
        alias TEXT,
        anchor TEXT,
        kind TEXT NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        resolved_id TEXT,
        status TEXT NOT NULL,
        FOREIGN KEY(source_id) REFERENCES note_documents(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS note_links_target ON note_links(resolved_id);
      CREATE TABLE IF NOT EXISTS note_tags (
        document_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY(document_id, tag),
        FOREIGN KEY(document_id) REFERENCES note_documents(id) ON DELETE CASCADE
      ) STRICT;
      CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
        document_id UNINDEXED,
        title,
        content,
        tags,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
  }

  upsertMany(documents: IndexedDocument[]) {
    const upsertDocument = this.database.prepare(`
        INSERT INTO note_documents (id, path, title, content_hash, modified_ms)
        VALUES (@id, @path, @title, @hash, @modifiedMs)
        ON CONFLICT(id) DO UPDATE SET path=excluded.path, title=excluded.title, content_hash=excluded.content_hash, modified_ms=excluded.modified_ms
      `);
    const deleteLinks = this.database.prepare("DELETE FROM note_links WHERE source_id = ?");
    const deleteTags = this.database.prepare("DELETE FROM note_tags WHERE document_id = ?");
    const deleteFts = this.database.prepare("DELETE FROM note_fts WHERE document_id = ?");
    const insertLink = this.database.prepare(`
        INSERT INTO note_links (source_id, target_text, alias, anchor, kind, start_offset, end_offset, resolved_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'broken')
      `);
    const insertTag = this.database.prepare("INSERT INTO note_tags (document_id, tag) VALUES (?, ?)");
    const insertFts = this.database.prepare("INSERT INTO note_fts (document_id, title, content, tags) VALUES (?, ?, ?, ?)");
    this.database.transaction(() => {
      for (const document of documents) {
        upsertDocument.run(document);
        deleteLinks.run(document.id);
        deleteTags.run(document.id);
        deleteFts.run(document.id);
        for (const link of document.links) insertLink.run(document.id, link.target, link.alias, link.anchor, link.kind, link.startOffset, link.endOffset);
        for (const tag of document.tags) insertTag.run(document.id, tag);
        insertFts.run(document.id, document.title, document.content, document.tags.join(" "));
      }
    })();
  }

  deleteMissing(activeIds: Set<string>) {
    const ids = (this.database.prepare("SELECT id FROM note_documents").all() as Array<{ id: string }>).map(({ id }) => id);
    const remove = this.database.prepare("DELETE FROM note_documents WHERE id = ?");
    const removeFts = this.database.prepare("DELETE FROM note_fts WHERE document_id = ?");
    const missing = ids.filter((id) => !activeIds.has(id));
    this.database.transaction(() => {
      for (const id of missing) { removeFts.run(id); remove.run(id); }
    })();
    return missing.length > 0;
  }

  resolveLinks() {
    const documents = this.list();
    const byId = new Map(documents.map((document) => [document.id, document]));
    const byPath = new Map(documents.map((document) => [document.path.replace(/\.md$/i, "").toLocaleLowerCase(), document]));
    const links = this.database.prepare("SELECT rowid, source_id, target_text, kind FROM note_links").all() as Array<{ rowid: number; source_id: string; target_text: string; kind: string }>;
    const update = this.database.prepare("UPDATE note_links SET resolved_id = ?, status = ? WHERE rowid = ?");
    const byStemOrTitle = new Map<string, typeof documents>();
    for (const document of documents) {
      const keys = new Set([posix.basename(document.path, extname(document.path)).toLocaleLowerCase(), document.title.toLocaleLowerCase()]);
      for (const key of keys) byStemOrTitle.set(key, [...(byStemOrTitle.get(key) ?? []), document]);
    }
    this.database.transaction(() => {
      for (const link of links) {
        const source = byId.get(link.source_id)!;
        const raw = link.kind === "markdown" ? posix.normalize(posix.join(posix.dirname(source.path), link.target_text)) : link.target_text;
        const exact = byPath.get(raw.replace(/\.md$/i, "").toLocaleLowerCase());
        const candidateKeys = new Set([link.target_text.toLocaleLowerCase(), posix.basename(link.target_text).toLocaleLowerCase()]);
        const candidates = exact ? [exact] : [...new Map([...candidateKeys].flatMap((key) => byStemOrTitle.get(key) ?? []).map((document) => [document.id, document])).values()];
        update.run(candidates.length === 1 ? candidates[0].id : null, candidates.length === 1 ? "resolved" : candidates.length > 1 ? "ambiguous" : "broken", link.rowid);
      }
    })();
  }

  list() {
    return this.database.prepare("SELECT id, path, title, content_hash AS revision, modified_ms AS modifiedMs FROM note_documents ORDER BY path COLLATE NOCASE").all() as Array<{ id: string; path: string; title: string; revision: string; modifiedMs: number }>;
  }

  get(id: string) {
    return this.database.prepare("SELECT id, path, title, content_hash AS revision, modified_ms AS modifiedMs FROM note_documents WHERE id = ?").get(id) as { id: string; path: string; title: string; revision: string; modifiedMs: number } | undefined;
  }

  linksFrom(id: string) {
    return this.database.prepare(`
      SELECT target_text AS target, alias, anchor, kind, resolved_id AS resolvedId, status
      FROM note_links WHERE source_id = ? ORDER BY start_offset
    `).all(id);
  }

  backlinks(id: string) {
    return this.database.prepare(`
      SELECT d.id, d.path, d.title, l.alias, l.anchor, l.kind
      FROM note_links l JOIN note_documents d ON d.id = l.source_id
      WHERE l.resolved_id = ? ORDER BY d.path COLLATE NOCASE
    `).all(id);
  }

  tagsFor(id: string) {
    return (this.database.prepare("SELECT tag FROM note_tags WHERE document_id = ? ORDER BY tag").all(id) as Array<{ tag: string }>).map(({ tag }) => tag);
  }

  resolvedOccurrences(id: string) {
    return this.database.prepare(`
      SELECT l.source_id AS sourceId, d.path, l.kind, l.start_offset AS startOffset, l.end_offset AS endOffset
      FROM note_links l JOIN note_documents d ON d.id = l.source_id
      WHERE l.resolved_id = ? ORDER BY d.path, l.start_offset
    `).all(id) as Array<{ sourceId: string; path: string; kind: "wiki" | "markdown"; startOffset: number; endOffset: number }>;
  }

  search(query: string, tag?: string): NoteSearchResult[] {
    const normalizedTag = tag?.replace(/^#/, "");
    if (!query.trim()) {
      return this.database.prepare(`
        SELECT DISTINCT d.id, d.path, d.title, d.content_hash AS revision, '' AS snippet
        FROM note_documents d LEFT JOIN note_tags t ON t.document_id = d.id
        WHERE (? IS NULL OR t.tag = ?) ORDER BY d.path COLLATE NOCASE
      `).all(normalizedTag ?? null, normalizedTag ?? null) as NoteSearchResult[];
    }
    const ftsQuery = query.trim().split(/\s+/).map((part) => `"${part.replaceAll('"', '""')}"`).join(" AND ");
    return this.database.prepare(`
      SELECT DISTINCT d.id, d.path, d.title, d.content_hash AS revision,
        snippet(note_fts, 2, '<mark>', '</mark>', '…', 18) AS snippet
      FROM note_fts JOIN note_documents d ON d.id = note_fts.document_id
      LEFT JOIN note_tags t ON t.document_id = d.id
      WHERE note_fts MATCH ? AND (? IS NULL OR t.tag = ?)
      ORDER BY bm25(note_fts), d.path COLLATE NOCASE
    `).all(ftsQuery, normalizedTag ?? null, normalizedTag ?? null) as NoteSearchResult[];
  }

  close() { this.database.close(); }
}

export class NoteStore {
  readonly #root: string;
  readonly #knowledge: string;
  readonly #metadata: string;
  readonly #documentsPath: string;
  readonly #historyPath: string;
  readonly #journalPath: string;
  readonly #indexPath: string;
  #indexed = false;

  constructor(readonly workspace: WorkspaceRecord, private readonly options: NoteStoreOptions = {}) {
    this.#root = workspace.canonicalPath;
    this.#knowledge = join(this.#root, "knowledge");
    this.#metadata = join(this.#root, ".voidra");
    this.#documentsPath = join(this.#metadata, "documents.json");
    this.#historyPath = join(this.#metadata, "history.json");
    this.#journalPath = join(this.#metadata, "rename-journal.json");
    this.#indexPath = join(this.#metadata, "index.sqlite");
  }

  async ensure() {
    await mkdir(this.#knowledge, { recursive: true });
    await mkdir(join(this.#metadata, "revisions"), { recursive: true });
    if (await optionalRead(this.#documentsPath) === null) await this.#atomicWrite(this.#documentsPath, json({ schemaVersion: 1, documents: [] }));
    if (await optionalRead(this.#historyPath) === null) await this.#atomicWrite(this.#historyPath, json({ schemaVersion: 1, revisions: [] }));
  }

  async syncIndex(force = false) {
    await this.ensure();
    if (await optionalRead(this.#journalPath)) await this.repairRename();
    const registry = await this.#loadRegistry();
    const files = await this.#markdownFiles(this.#knowledge);
    const now = new Date().toISOString();
    let registryChanged = false;
    let indexChanged = false;
    const index = new NoteIndex(this.#indexPath);
    const activeIds = new Set<string>();
    const changedDocuments: IndexedDocument[] = [];
    try {
      const indexedDocuments = new Map(index.list().map((document) => [document.id, document]));
      const registryByPath = new Map(registry.documents.map((document) => [document.path, document]));
      const pending: Array<{ absolutePath: string; path: string; entry: DocumentRegistry["documents"][number] }> = [];
      for (const absolutePath of files) {
        const path = toPosix(relative(this.#knowledge, absolutePath));
        let entry = registryByPath.get(path);
        if (!entry) {
          entry = { id: randomUUID(), path, createdAt: now, deletedAt: null };
          registry.documents.push(entry);
          registryByPath.set(path, entry);
          registryChanged = true;
        } else if (entry.deletedAt !== null) {
          entry.deletedAt = null;
          registryChanged = true;
        }
        activeIds.add(entry.id);
        pending.push({ absolutePath, path, entry });
      }
      for (let offset = 0; offset < pending.length; offset += 128) {
        const batch = await Promise.all(pending.slice(offset, offset + 128).map(async ({ absolutePath, path, entry }) => {
          const details = await stat(absolutePath);
          const alreadyIndexed = indexedDocuments.get(entry.id);
          if (!force && alreadyIndexed?.path === path && alreadyIndexed.modifiedMs === details.mtimeMs) return null;
          const content = await readFile(absolutePath, "utf8");
          const parsed = parseMarkdown(content);
          return { id: entry.id, path, title: parsed.title ?? posix.basename(path, extname(path)), content, hash: hashContent(content), modifiedMs: details.mtimeMs, links: parsed.links, tags: parsed.tags } satisfies IndexedDocument;
        }));
        for (const document of batch) if (document) changedDocuments.push(document);
      }
      indexChanged = changedDocuments.length > 0;
      index.upsertMany(changedDocuments);
      for (const entry of registry.documents) {
        if (!activeIds.has(entry.id) && entry.deletedAt === null) { entry.deletedAt = now; registryChanged = true; }
      }
      indexChanged = index.deleteMissing(activeIds) || indexChanged;
      if (indexChanged) index.resolveLinks();
      if (registryChanged) await this.#atomicWrite(this.#documentsPath, json(registry));
      this.#indexed = true;
      return { documents: index.list(), indexed: activeIds.size };
    } finally {
      index.close();
    }
  }

  async list() {
    await this.#ensureIndex();
    const index = new NoteIndex(this.#indexPath);
    try { return index.list(); }
    finally { index.close(); }
  }

  async create(relativePath: string, content = "") {
    await this.ensure();
    const { absolute, normalized } = await this.#safeNotePath(relativePath, true);
    await mkdir(dirname(absolute), { recursive: true });
    try { await writeFile(absolute, content, { encoding: "utf8", flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new DomainError("WORKSPACE_CONFLICT", "A note already exists at that path."); throw error; }
    await this.syncIndex();
    const index = new NoteIndex(this.#indexPath);
    try { return index.list().find((document) => document.path === normalized)!; }
    finally { index.close(); }
  }

  async read(documentId: string) {
    await this.#ensureIndex();
    const index = new NoteIndex(this.#indexPath);
    try {
      const document = index.get(documentId);
      if (!document) throw new DomainError("WORKSPACE_CONFLICT", "The note no longer exists.");
      const { absolute } = await this.#safeNotePath(document.path, false);
      const content = await readFile(absolute, "utf8");
      return { ...document, content, revision: hashContent(content), links: index.linksFrom(documentId), backlinks: index.backlinks(documentId) };
    } finally { index.close(); }
  }

  async save(documentId: string, content: string, expectedRevision: string) {
    const current = await this.read(documentId);
    if (current.revision !== expectedRevision) {
      const diskSnapshot = await this.#recordRevision(documentId, current.content, "conflict-disk");
      const editorSnapshot = await this.#recordRevision(documentId, content, "conflict-editor");
      return { status: "conflict" as const, disk: current, editorContent: content, snapshots: [diskSnapshot, editorSnapshot] };
    }
    if (current.content === content) return { status: "saved" as const, document: current };
    await this.#recordRevision(documentId, current.content, "save");
    const { absolute } = await this.#safeNotePath(current.path, false);
    await this.#atomicWrite(absolute, content);
    await this.syncIndex();
    return { status: "saved" as const, document: await this.read(documentId) };
  }

  async resolveConflict(documentId: string, strategy: "disk" | "editor" | "merge", expectedDiskRevision: string, editorContent?: string, mergedContent?: string) {
    const disk = await this.read(documentId);
    if (disk.revision !== expectedDiskRevision) {
      return { status: "conflict" as const, disk, editorContent: strategy === "merge" ? mergedContent ?? "" : editorContent ?? "" };
    }
    if (strategy === "disk") return { status: "saved" as const, document: disk };
    return this.save(documentId, strategy === "merge" ? mergedContent ?? "" : editorContent ?? "", expectedDiskRevision);
  }

  async history(documentId: string) {
    const history = await this.#loadHistory();
    return history.revisions
      .map((revision, index) => ({ revision, index }))
      .filter(({ revision }) => revision.documentId === documentId)
      .sort((a, b) => b.revision.createdAt.localeCompare(a.revision.createdAt) || b.index - a.index)
      .map(({ revision }) => revision);
  }

  async restore(documentId: string, revisionId: string) {
    const current = await this.read(documentId);
    const history = await this.#loadHistory();
    const revision = history.revisions.find((candidate) => candidate.id === revisionId && candidate.documentId === documentId);
    if (!revision) throw new DomainError("WORKSPACE_CONFLICT", "The requested revision does not exist.");
    const restored = await readFile(join(this.#metadata, revision.file), "utf8");
    await this.#recordRevision(documentId, current.content, "pre-restore");
    const { absolute } = await this.#safeNotePath(current.path, false);
    await this.#atomicWrite(absolute, restored);
    await this.syncIndex();
    return this.read(documentId);
  }

  async search(query: string, tag?: string) {
    await this.#ensureIndex();
    const index = new NoteIndex(this.#indexPath);
    try { return index.search(query, tag); }
    finally { index.close(); }
  }

  async backlinks(documentId: string) {
    await this.#ensureIndex();
    const index = new NoteIndex(this.#indexPath);
    try { return index.backlinks(documentId); }
    finally { index.close(); }
  }

  async graphSnapshot() {
    await this.#ensureIndex();
    const index = new NoteIndex(this.#indexPath);
    try {
      return index.list().map((document) => ({ ...document, links: index.linksFrom(document.id), tags: index.tagsFor(document.id) }));
    } finally { index.close(); }
  }

  async rebuildIndex() {
    await Promise.all([this.#indexPath, `${this.#indexPath}-wal`, `${this.#indexPath}-shm`].map((path) => rm(path, { force: true })));
    this.#indexed = false;
    return this.syncIndex();
  }

  async rename(documentId: string, newRelativePath: string, testOptions: { interruptAfterOperations?: number } = {}) {
    await this.#ensureIndex();
    const index = new NoteIndex(this.#indexPath);
    const target = index.get(documentId);
    if (!target) { index.close(); throw new DomainError("WORKSPACE_CONFLICT", "The note no longer exists."); }
    const { absolute: oldAbsolute } = await this.#safeNotePath(target.path, false);
    const { absolute: newAbsolute, normalized: newPath } = await this.#safeNotePath(newRelativePath, true);
    if (await optionalRead(newAbsolute) !== null) { index.close(); throw new DomainError("WORKSPACE_CONFLICT", "The rename destination already exists."); }
    const occurrences = index.resolvedOccurrences(documentId);
    const grouped = new Map<string, typeof occurrences>();
    for (const occurrence of occurrences) grouped.set(occurrence.sourceId, [...(grouped.get(occurrence.sourceId) ?? []), occurrence]);
    const operations: RenameJournal["operations"] = [];
    for (const [sourceId, sourceOccurrences] of grouped) {
      const source = index.get(sourceId)!;
      const { absolute } = await this.#safeNotePath(source.path, false);
      const content = await readFile(absolute, "utf8");
      let newContent = content;
      for (const occurrence of [...sourceOccurrences].sort((a, b) => b.startOffset - a.startOffset)) {
        const replacement = occurrence.kind === "wiki"
          ? newPath.replace(/\.md$/i, "")
          : posix.relative(posix.dirname(source.path), newPath);
        newContent = `${newContent.slice(0, occurrence.startOffset)}${replacement}${newContent.slice(occurrence.endOffset)}`;
      }
      if (newContent !== content) operations.push({ documentId: sourceId, path: source.path, originalHash: hashContent(content), newContent, completed: false });
    }
    index.close();
    const journal: RenameJournal = { schemaVersion: 1, id: randomUUID(), documentId, oldPath: target.path, newPath, targetRenamed: false, operations };
    await this.#atomicWrite(this.#journalPath, json(journal));
    await this.#applyRenameJournal(journal, testOptions.interruptAfterOperations);
    return this.read(documentId);
  }

  async repairRename() {
    const content = await optionalRead(this.#journalPath);
    if (!content) return { repaired: false };
    const journal = renameJournalSchema.parse(JSON.parse(content));
    await this.#applyRenameJournal(journal);
    return { repaired: true };
  }

  async #applyRenameJournal(journal: RenameJournal, interruptAfterOperations?: number) {
    let completedThisRun = 0;
    for (const operation of journal.operations) {
      if (operation.completed) continue;
      const { absolute } = await this.#safeNotePath(operation.path, false);
      const current = await readFile(absolute, "utf8");
      const currentHash = hashContent(current);
      if (currentHash === operation.originalHash) {
        await this.#recordRevision(operation.documentId, current, "rename");
        await this.#atomicWrite(absolute, operation.newContent);
      } else if (currentHash !== hashContent(operation.newContent)) {
        throw new DomainError("WORKSPACE_CONFLICT", "A note changed while repairing a rename; the journal was preserved.");
      }
      operation.completed = true;
      await this.#atomicWrite(this.#journalPath, json(journal));
      completedThisRun += 1;
      if (interruptAfterOperations !== undefined && completedThisRun >= interruptAfterOperations) throw new Error("Simulated rename interruption");
    }
    const { absolute: oldAbsolute } = await this.#safeNotePath(journal.oldPath, true);
    const { absolute: newAbsolute } = await this.#safeNotePath(journal.newPath, true);
    if (!journal.targetRenamed) {
      await mkdir(dirname(newAbsolute), { recursive: true });
      const oldExists = await optionalRead(oldAbsolute) !== null;
      const newExists = await optionalRead(newAbsolute) !== null;
      if (oldExists) await rename(oldAbsolute, newAbsolute);
      else if (!newExists) throw new DomainError("WORKSPACE_CONFLICT", "Neither rename location exists; the journal was preserved.");
      journal.targetRenamed = true;
      await this.#atomicWrite(this.#journalPath, json(journal));
    }
    const registry = await this.#loadRegistry();
    const entry = registry.documents.find((document) => document.id === journal.documentId);
    if (!entry) throw new DomainError("WORKSPACE_CONFLICT", "The rename target identity is missing.");
    entry.path = journal.newPath;
    entry.deletedAt = null;
    await this.#atomicWrite(this.#documentsPath, json(registry));
    await rm(this.#journalPath, { force: true });
    await this.syncIndex();
  }

  async #recordRevision(documentId: string, content: string, kind: HistoryRevision["kind"]) {
    await this.ensure();
    const history = await this.#loadHistory();
    const id = randomUUID();
    const relativeFile = posix.join("revisions", documentId, `${id}.md`);
    const absoluteFile = join(this.#metadata, ...relativeFile.split("/"));
    await mkdir(dirname(absoluteFile), { recursive: true });
    await this.#atomicWrite(absoluteFile, content);
    const revision: HistoryRevision = { id, documentId, createdAt: new Date().toISOString(), contentHash: hashContent(content), kind, file: relativeFile };
    history.revisions.push(revision);
    const normal = history.revisions
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.documentId === documentId && !item.kind.startsWith("conflict-"))
      .sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt) || b.index - a.index);
    for (const { item: expired } of normal.slice(100)) {
      history.revisions = history.revisions.filter((item) => item.id !== expired.id);
      await rm(join(this.#metadata, expired.file), { force: true });
    }
    await this.#atomicWrite(this.#historyPath, json(history));
    return revision;
  }

  async #loadRegistry(): Promise<DocumentRegistry> {
    await this.ensure();
    try { return documentRegistrySchema.parse(JSON.parse(await readFile(this.#documentsPath, "utf8"))); }
    catch { throw new DomainError("INCOMPATIBLE_SCHEMA", "The workspace document registry requires recovery."); }
  }

  async #ensureIndex() {
    if (!this.#indexed) await this.syncIndex();
  }

  async #loadHistory(): Promise<HistoryFile> {
    await this.ensure();
    try { return historySchema.parse(JSON.parse(await readFile(this.#historyPath, "utf8"))); }
    catch { throw new DomainError("INCOMPATIBLE_SCHEMA", "The workspace revision history requires recovery."); }
  }

  async #atomicWrite(path: string, content: string) {
    const temporary = `${path}.tmp-${randomUUID()}`;
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    try {
      await this.options.beforeAtomicReplace?.(path);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async #safeNotePath(relativePath: string, allowMissing: boolean) {
    if (isAbsolute(relativePath)) throw new DomainError("WORKSPACE_CONFLICT", "Note paths must be workspace-relative.");
    const normalized = posix.normalize(toPosix(relativePath));
    if (normalized === "." || normalized.startsWith("../") || !normalized.toLocaleLowerCase().endsWith(".md")) {
      throw new DomainError("WORKSPACE_CONFLICT", "Notes must use a safe relative .md path.");
    }
    const absolute = resolve(this.#knowledge, ...normalized.split("/"));
    if (!absolute.startsWith(`${this.#knowledge}${sep}`)) throw new DomainError("WORKSPACE_CONFLICT", "The note path escapes the knowledge directory.");
    const checkPath = allowMissing ? dirname(absolute) : absolute;
    try {
      const canonical = await realpath(checkPath);
      if (canonical !== this.#knowledge && !canonical.startsWith(`${this.#knowledge}${sep}`)) throw new Error("Symlink escape");
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw new DomainError("WORKSPACE_CONFLICT", "The note path is unavailable or escapes the workspace.");
      let ancestor = dirname(checkPath);
      while (ancestor !== this.#knowledge) {
        try {
          const canonical = await realpath(ancestor);
          if (canonical !== this.#knowledge && !canonical.startsWith(`${this.#knowledge}${sep}`)) throw new Error("Symlink escape");
          break;
        } catch (ancestorError) {
          if ((ancestorError as NodeJS.ErrnoException).code !== "ENOENT") throw new DomainError("WORKSPACE_CONFLICT", "The note path escapes the workspace.");
          ancestor = dirname(ancestor);
        }
      }
    }
    return { absolute, normalized };
  }

  async #markdownFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await this.#markdownFiles(path));
      else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.toLocaleLowerCase().endsWith(".md")) {
        try {
          const canonical = await realpath(path);
          if (canonical.startsWith(`${this.#knowledge}${sep}`)) files.push(path);
        } catch { /* unavailable entries are ignored until the next rescan */ }
      }
    }
    return files.sort((a, b) => a.localeCompare(b));
  }
}

export type IndexingState = { state: "idle" | "indexing" | "error"; indexed: number; error?: string };

export class NoteCoordinator {
  readonly #stores = new Map<string, NoteStore>();
  readonly #watchers = new Map<string, FSWatcher>();
  readonly #timers = new Map<string, NodeJS.Timeout>();
  readonly #states = new Map<string, IndexingState>();
  readonly #queues = new Map<string, Promise<void>>();

  async forWorkspace(workspace: WorkspaceRecord) {
    let store = this.#stores.get(workspace.id);
    if (!store) {
      store = new NoteStore(workspace);
      await store.ensure();
      this.#stores.set(workspace.id, store);
      this.#states.set(workspace.id, { state: "idle", indexed: 0 });
      this.#startWatcher(workspace);
    }
    return store;
  }

  async run<T>(workspace: WorkspaceRecord, operation: (store: NoteStore) => Promise<T>): Promise<T> {
    const previous = this.#queues.get(workspace.id) ?? Promise.resolve();
    let resolveCurrent!: () => void;
    const current = new Promise<void>((resolve) => { resolveCurrent = resolve; });
    this.#queues.set(workspace.id, current);
    await previous.catch(() => undefined);
    try {
      const store = await this.forWorkspace(workspace);
      return await operation(store);
    } finally {
      resolveCurrent();
      if (this.#queues.get(workspace.id) === current) this.#queues.delete(workspace.id);
    }
  }

  status(workspaceId: string): IndexingState {
    return this.#states.get(workspaceId) ?? { state: "idle", indexed: 0 };
  }

  close() {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    for (const watcher of this.#watchers.values()) watcher.close();
    this.#timers.clear();
    this.#watchers.clear();
    this.#stores.clear();
    this.#queues.clear();
  }

  #startWatcher(workspace: WorkspaceRecord) {
    const knowledgePath = join(workspace.canonicalPath, "knowledge");
    try {
      const watcher = watch(knowledgePath, { recursive: true }, (_event, filename) => {
        if (filename && !String(filename).toLocaleLowerCase().endsWith(".md")) return;
        const pending = this.#timers.get(workspace.id);
        if (pending) clearTimeout(pending);
        this.#timers.set(workspace.id, setTimeout(() => {
          this.#timers.delete(workspace.id);
          this.#states.set(workspace.id, { ...this.status(workspace.id), state: "indexing" });
          void this.run(workspace, (queuedStore) => queuedStore.syncIndex(true)).then(({ indexed }) => {
            this.#states.set(workspace.id, { state: "idle", indexed });
          }).catch(() => {
            this.#states.set(workspace.id, { ...this.status(workspace.id), state: "error", error: "The note index needs a rescan." });
          });
        }, 180));
      });
      watcher.on("error", () => this.#states.set(workspace.id, { ...this.status(workspace.id), state: "error", error: "The file watcher stopped; rebuild the index." }));
      this.#watchers.set(workspace.id, watcher);
    } catch {
      this.#states.set(workspace.id, { state: "error", indexed: 0, error: "The knowledge directory could not be watched." });
    }
  }
}
