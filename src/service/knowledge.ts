import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { normalizeLinkTarget, parseMarkdown, type ParsedLink } from "../domain/markdown";
import type { ServiceDatabase, WorkspaceRecord } from "./database";
import { NoteCoordinator } from "./notes";
import { DomainError } from "./workspaces";

type SharedDocument = {
  id: string;
  baseId: string;
  path: string;
  title: string;
  content: string;
  revision: string;
  modifiedMs: number;
  links: ParsedLink[];
  tags: string[];
};

const memoryFileSchema = z.object({
  schemaVersion: z.literal(1),
  memories: z.array(z.object({
    id: z.uuid(),
    text: z.string().min(1).max(100_000),
    source: z.string().min(1).max(500),
    confirmed: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
  }).strict()),
}).strict();

type MemoryRecord = z.infer<typeof memoryFileSchema>["memories"][number];

function digest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function toPosix(path: string) {
  return path.split(sep).join("/");
}

function containsPath(parent: string, child: string) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent));
}

async function atomicWrite(path: string, content: string) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try { await rename(temporary, path); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

async function markdownFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(root, path));
    else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.toLocaleLowerCase().endsWith(".md")) {
      try {
        const canonical = await realpath(path);
        if (canonical.startsWith(`${root}${sep}`)) files.push(path);
      } catch { /* A later rescan can pick up transient entries. */ }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export class KnowledgeManager {
  readonly #baseQueues = new Map<string, Promise<void>>();

  constructor(private readonly database: ServiceDatabase, private readonly notes: NoteCoordinator, private readonly options: { beforeSharedWrite?: () => void | Promise<void> } = {}) {}

  async attach(workspace: WorkspaceRecord, input: { name: string; path: string; access: "read" | "write" }) {
    const canonicalPath = await this.#canonicalBase(input.path, input.access === "write");
    this.#assertNotPrivateRoot(canonicalPath);
    let base = this.database.getKnowledgeBaseByPath(canonicalPath);
    if (!base) {
      const now = new Date().toISOString();
      base = { id: randomUUID(), name: input.name.trim(), canonicalPath, createdAt: now, updatedAt: now };
      this.database.insertKnowledgeBase(base);
    }
    this.database.attachKnowledgeBase({ workspaceId: workspace.id, baseId: base.id, access: input.access, attachedAt: new Date().toISOString() });
    return this.#attachmentView(workspace.id, base.id);
  }

  async list(workspaceId: string) {
    return Promise.all(this.database.listKnowledgeAttachments(workspaceId).map(async (attachment) => ({
      ...attachment,
      available: await this.#isAvailable(attachment.canonicalPath, attachment.access === "write"),
    })));
  }

  async setAccess(workspaceId: string, baseId: string, accessMode: "read" | "write") {
    const attachment = this.#requireAttachment(workspaceId, baseId);
    if (accessMode === "write") await this.#canonicalBase(attachment.canonicalPath, true);
    this.database.updateKnowledgeAttachmentAccess(workspaceId, baseId, accessMode);
    return this.#attachmentView(workspaceId, baseId);
  }

  detach(workspaceId: string, baseId: string) {
    this.#requireAttachment(workspaceId, baseId);
    this.database.detachKnowledgeBase(workspaceId, baseId);
    return { detached: true };
  }

  async locate(workspaceId: string, baseId: string, path: string) {
    this.#requireAttachment(workspaceId, baseId);
    const canonicalPath = await this.#canonicalBase(path, false);
    this.#assertNotPrivateRoot(canonicalPath);
    const duplicate = this.database.getKnowledgeBaseByPath(canonicalPath);
    if (duplicate && duplicate.id !== baseId) throw new DomainError("WORKSPACE_CONFLICT", "That directory belongs to another shared base.");
    this.database.updateKnowledgeBasePath(baseId, canonicalPath);
    return this.#attachmentView(workspaceId, baseId);
  }

  async search(workspace: WorkspaceRecord, query: string, tag?: string, delayMs = 0) {
    const results: Array<Record<string, unknown>> = [];
    const normalizedTag = tag?.replace(/^#/, "").toLocaleLowerCase();
    for (const result of await this.notes.run(workspace, (privateStore) => privateStore.search(query, tag))) results.push({ ...result, baseId: "private", baseName: workspace.name, access: "write", source: "private" });
    const attachments = this.database.listKnowledgeAttachments(workspace.id);
    for (const attachment of attachments) {
      if (!(await this.#isAvailable(attachment.canonicalPath, false))) continue;
      const documents = await this.#scan(attachment.id, attachment.canonicalPath);
      const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      for (const document of documents) {
        if (terms.some((term) => !`${document.title}\n${document.content}`.toLocaleLowerCase().includes(term))) continue;
        if (normalizedTag && !document.tags.some((candidate) => candidate.toLocaleLowerCase() === normalizedTag)) continue;
        results.push({ id: document.id, path: document.path, title: document.title, revision: document.revision, snippet: this.#snippet(document.content, terms[0]), baseId: attachment.id, baseName: attachment.name, access: attachment.access, source: "shared" });
      }
    }
    if (delayMs) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    const stillAttached = new Set(this.database.listKnowledgeAttachments(workspace.id).map(({ baseId }) => baseId));
    return results.filter((result) => result.baseId === "private" || stillAttached.has(String(result.baseId)));
  }

  async read(workspace: WorkspaceRecord, baseId: string, documentId: string) {
    if (baseId === "private") {
      const document = await this.notes.run(workspace, (privateStore) => privateStore.read(documentId));
      return { ...document, baseId, baseName: workspace.name, access: "write", source: "private" };
    }
    const attachment = this.#requireAttachment(workspace.id, baseId);
    const documents = await this.#scan(attachment.id, await this.#availablePath(attachment.canonicalPath));
    const document = documents.find(({ id }) => id === documentId);
    if (!document) throw new DomainError("WORKSPACE_CONFLICT", "The shared note is unavailable.");
    return { ...document, baseName: attachment.name, access: attachment.access, source: "shared" };
  }

  async create(workspaceId: string, baseId: string, relativePath: string, content: string) {
    return this.#withBaseLock(baseId, async () => {
      const attachment = await this.#requireWritable(workspaceId, baseId);
      return this.#withPhysicalWriteLock(attachment.canonicalPath, async () => {
        await this.options.beforeSharedWrite?.();
        const { absolute, normalized } = await this.#safeSharedPath(attachment.canonicalPath, relativePath, true);
        await mkdir(dirname(absolute), { recursive: true });
        try { await writeFile(absolute, content, { encoding: "utf8", flag: "wx" }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new DomainError("WORKSPACE_CONFLICT", "A shared note already exists at that path."); throw error; }
        const documents = await this.#scan(baseId, attachment.canonicalPath);
        return documents.find((document) => document.path === normalized)!;
      });
    });
  }

  async save(workspaceId: string, baseId: string, documentId: string, content: string, expectedRevision: string) {
    return this.#withBaseLock(baseId, async () => {
      const attachment = await this.#requireWritable(workspaceId, baseId);
      return this.#withPhysicalWriteLock(attachment.canonicalPath, async () => {
        await this.options.beforeSharedWrite?.();
        const documents = await this.#scan(baseId, attachment.canonicalPath);
        const document = documents.find(({ id }) => id === documentId);
        if (!document) throw new DomainError("WORKSPACE_CONFLICT", "The shared note is unavailable.");
        if (document.revision !== expectedRevision) return { status: "conflict" as const, disk: document, editorContent: content };
        const { absolute } = await this.#safeSharedPath(attachment.canonicalPath, document.path, false);
        await atomicWrite(absolute, content);
        const updated = (await this.#scan(baseId, attachment.canonicalPath)).find(({ id }) => id === documentId)!;
        return { status: "saved" as const, document: updated };
      });
    });
  }

  async graph(workspace: WorkspaceRecord, input: { focus?: { baseId: string; documentId: string }; depth?: number; tag?: string; filterOnly?: boolean }) {
    const privateDocuments = (await this.notes.run(workspace, (privateStore) => privateStore.graphSnapshot())).map((document) => ({ ...document, baseId: "private", baseName: workspace.name, access: "write" as const }));
    const sharedGroups = await Promise.all(this.database.listKnowledgeAttachments(workspace.id).map(async (attachment) => {
      if (!(await this.#isAvailable(attachment.canonicalPath, false))) return [];
      return (await this.#scan(attachment.id, attachment.canonicalPath)).map((document) => ({ ...document, baseName: attachment.name, access: attachment.access }));
    }));
    const documents = [...privateDocuments, ...sharedGroups.flat()];
    const nodes = documents.map((document) => ({
      id: `${document.baseId}:${document.id}`,
      documentId: document.id,
      baseId: document.baseId,
      baseName: document.baseName,
      path: document.path,
      title: document.title,
      tags: document.tags,
      access: document.access,
      revision: document.revision,
      highlighted: input.tag ? document.tags.some((tag) => tag.toLocaleLowerCase() === input.tag!.replace(/^#/, "").toLocaleLowerCase()) : false,
    }));
    const byBasePath = new Map(nodes.map((node) => [`${node.baseId}:${node.path.replace(/\.md$/i, "").toLocaleLowerCase()}`, node]));
    const byDocumentId = new Map(nodes.map((node) => [`${node.baseId}:${node.documentId}`, node]));
    const byBaseName = new Map<string, GraphNodeLike[]>();
    type GraphNodeLike = typeof nodes[number];
    for (const node of nodes) {
      const keys = new Set([node.title.toLocaleLowerCase(), basename(node.path, extname(node.path)).toLocaleLowerCase()]);
      for (const key of keys) { const mapKey = `${node.baseId}:${key}`; const candidates = byBaseName.get(mapKey); if (candidates) candidates.push(node); else byBaseName.set(mapKey, [node]); }
    }
    const baseByName = new Map(this.database.listKnowledgeAttachments(workspace.id).map((attachment) => [attachment.name.toLocaleLowerCase(), attachment.id]));
    baseByName.set(workspace.name.toLocaleLowerCase(), "private");
    const edges: Array<{ id: string; source: string; target: string; status: string; type: string; reason: string; sourceRecord: string; revision: string; scope: string; inferred: boolean }> = [];
    for (const document of documents) {
      const source = `${document.baseId}:${document.id}`;
      for (const link of document.links as Array<ParsedLink & { resolvedId?: string | null; status?: string }>) {
        let targetNode;
        const separator = link.target.indexOf("::");
        if (separator < 0 && document.baseId === "private" && link.resolvedId) targetNode = byDocumentId.get(`private:${link.resolvedId}`);
        else {
          const targetBaseId = separator >= 0 ? baseByName.get(link.target.slice(0, separator).toLocaleLowerCase()) : document.baseId;
          const targetPath = normalizeLinkTarget(separator >= 0 ? link.target.slice(separator + 2) : link.target);
          if (targetBaseId) {
            targetNode = byBasePath.get(`${targetBaseId}:${targetPath.toLocaleLowerCase()}`);
            if (!targetNode) {
              const candidates = byBaseName.get(`${targetBaseId}:${basename(targetPath).toLocaleLowerCase()}`) ?? [];
              if (candidates.length === 1) [targetNode] = candidates;
            }
          }
        }
        if (targetNode) edges.push({ id: `${source}->${targetNode.id}:${edges.length}`, source, target: targetNode.id, status: "resolved", type: `${link.kind}-link`, reason: `${link.kind === "wiki" ? "Wiki" : "Markdown"} link from ${document.path} to ${targetNode.path}.`, sourceRecord: document.path, revision: document.revision, scope: document.baseId === "private" ? "workspace" : `shared:${document.baseId}`, inferred: false });
      }
    }
    let visibleNodes = input.filterOnly && input.tag ? nodes.filter(({ highlighted }) => highlighted) : nodes;
    let visibleEdges = edges;
    if (input.focus) {
      const focusId = `${input.focus.baseId}:${input.focus.documentId}`;
      const visible = new Set([focusId]);
      let frontier = new Set([focusId]);
      for (let level = 0; level < Math.min(input.depth ?? 1, 5); level += 1) {
        const next = new Set<string>();
        for (const edge of edges) {
          if (frontier.has(edge.source) && !visible.has(edge.target)) next.add(edge.target);
          if (frontier.has(edge.target) && !visible.has(edge.source)) next.add(edge.source);
        }
        for (const id of next) visible.add(id);
        frontier = next;
      }
      visibleNodes = visibleNodes.filter(({ id }) => visible.has(id));
    }
    const visibleIds = new Set(visibleNodes.map(({ id }) => id));
    visibleEdges = visibleEdges.filter(({ source, target }) => visibleIds.has(source) && visibleIds.has(target));
    return { nodes: visibleNodes, edges: visibleEdges };
  }

  async listMemories(workspace: WorkspaceRecord, includeExpired = false) {
    const file = await this.#loadMemories(workspace);
    const now = Date.now();
    return file.memories.filter((memory) => includeExpired || memory.expiresAt === null || Date.parse(memory.expiresAt) > now).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createMemory(workspace: WorkspaceRecord, input: { text: string; source: string; confirmed: boolean; expiresAt?: string | null }) {
    const file = await this.#loadMemories(workspace);
    const now = new Date().toISOString();
    const memory: MemoryRecord = { id: randomUUID(), text: input.text.trim(), source: input.source, confirmed: input.confirmed, createdAt: now, updatedAt: now, expiresAt: input.expiresAt ?? null };
    file.memories.push(memory);
    await this.#writeMemories(workspace, file);
    return memory;
  }

  async updateMemory(workspace: WorkspaceRecord, memoryId: string, input: { text: string; source: string; confirmed: boolean; expiresAt?: string | null }) {
    const file = await this.#loadMemories(workspace);
    const memory = file.memories.find(({ id }) => id === memoryId);
    if (!memory) throw new DomainError("WORKSPACE_CONFLICT", "The memory does not exist in this workspace.");
    Object.assign(memory, { text: input.text.trim(), source: input.source, confirmed: input.confirmed, expiresAt: input.expiresAt ?? null, updatedAt: new Date().toISOString() });
    await this.#writeMemories(workspace, file);
    return memory;
  }

  async deleteMemory(workspace: WorkspaceRecord, memoryId: string) {
    const file = await this.#loadMemories(workspace);
    const next = file.memories.filter(({ id }) => id !== memoryId);
    if (next.length === file.memories.length) throw new DomainError("WORKSPACE_CONFLICT", "The memory does not exist in this workspace.");
    file.memories = next;
    await this.#writeMemories(workspace, file);
    return { deleted: true };
  }

  async memoryContext(workspace: WorkspaceRecord, query = "") {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return (await this.listMemories(workspace)).filter((memory) => terms.every((term) => `${memory.text}\n${memory.source}`.toLocaleLowerCase().includes(term)));
  }

  async #scan(baseId: string, root: string): Promise<SharedDocument[]> {
    const files = await markdownFiles(root);
    return Promise.all(files.map(async (absolute) => {
      const path = toPosix(relative(root, absolute));
      const content = await readFile(absolute, "utf8");
      const details = await stat(absolute);
      const parsed = parseMarkdown(content);
      return { id: digest(`${baseId}\0${path}`), baseId, path, title: parsed.title ?? basename(path, extname(path)), content, revision: digest(content), modifiedMs: details.mtimeMs, links: parsed.links, tags: parsed.tags };
    }));
  }

  async #attachmentView(workspaceId: string, baseId: string) {
    const attachment = this.#requireAttachment(workspaceId, baseId);
    return { ...attachment, available: await this.#isAvailable(attachment.canonicalPath, attachment.access === "write") };
  }

  #requireAttachment(workspaceId: string, baseId: string) {
    const attachment = this.database.getKnowledgeAttachment(workspaceId, baseId);
    if (!attachment) throw new DomainError("KNOWLEDGE_ACCESS_DENIED", "This workspace is not attached to that knowledge base.");
    return attachment;
  }

  async #requireWritable(workspaceId: string, baseId: string) {
    const attachment = this.#requireAttachment(workspaceId, baseId);
    if (attachment.access !== "write") throw new DomainError("KNOWLEDGE_ACCESS_DENIED", "This knowledge attachment is read-only.");
    await this.#canonicalBase(attachment.canonicalPath, true);
    return attachment;
  }

  async #availablePath(path: string) {
    try { return await this.#canonicalBase(path, false); }
    catch { throw new DomainError("KNOWLEDGE_BASE_UNAVAILABLE", "The shared knowledge directory is unavailable.", true); }
  }

  async #canonicalBase(path: string, writable: boolean) {
    try {
      const canonical = await realpath(path);
      if (!(await stat(canonical)).isDirectory()) throw new Error("Not a directory");
      await access(canonical, writable ? constants.R_OK | constants.W_OK : constants.R_OK);
      return canonical;
    } catch { throw new DomainError("KNOWLEDGE_BASE_UNAVAILABLE", "The shared knowledge directory is unavailable or inaccessible.", true); }
  }

  async #isAvailable(path: string, writable: boolean) {
    try { return (await this.#canonicalBase(path, writable)) === path; }
    catch { return false; }
  }

  #assertNotPrivateRoot(candidate: string) {
    for (const workspace of this.database.listWorkspaces()) {
      if (containsPath(workspace.canonicalPath, candidate) || containsPath(candidate, workspace.canonicalPath)) {
        throw new DomainError("WORKSPACE_CONFLICT", "A shared base cannot overlap a private workspace root.");
      }
    }
  }

  async #safeSharedPath(root: string, relativePath: string, allowMissing: boolean) {
    if (isAbsolute(relativePath)) throw new DomainError("WORKSPACE_CONFLICT", "Shared note paths must be base-relative.");
    const normalized = posix.normalize(toPosix(relativePath));
    if (normalized === "." || normalized.startsWith("../") || !normalized.toLocaleLowerCase().endsWith(".md")) throw new DomainError("WORKSPACE_CONFLICT", "Shared notes require a safe relative .md path.");
    const absolute = resolve(root, ...normalized.split("/"));
    if (!absolute.startsWith(`${root}${sep}`)) throw new DomainError("WORKSPACE_CONFLICT", "The shared note path escapes its base.");
    let check = allowMissing ? dirname(absolute) : absolute;
    while (true) {
      try {
        const canonical = await realpath(check);
        if (canonical !== root && !canonical.startsWith(`${root}${sep}`)) throw new Error("escape");
        break;
      } catch (error) {
        if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT" || check === root) throw new DomainError("WORKSPACE_CONFLICT", "The shared note path is unavailable or escapes its base.");
        check = dirname(check);
      }
    }
    return { absolute, normalized };
  }

  async #withBaseLock<T>(baseId: string, operation: () => Promise<T>) {
    const prior = this.#baseQueues.get(baseId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveCurrent) => { release = resolveCurrent; });
    this.#baseQueues.set(baseId, current);
    await prior.catch(() => undefined);
    try { return await operation(); }
    finally { release(); if (this.#baseQueues.get(baseId) === current) this.#baseQueues.delete(baseId); }
  }

  async #withPhysicalWriteLock<T>(root: string, operation: () => Promise<T>) {
    const lockPath = join(root, ".voidra-write.lock");
    const token = randomUUID();
    const acquire = async (allowRecovery: boolean): Promise<void> => {
      try {
        await writeFile(lockPath, JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }), { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (allowRecovery) {
          try {
            const existing = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: number };
            if (typeof existing.pid === "number") {
              try { process.kill(existing.pid, 0); }
              catch { await rm(lockPath, { force: true }); return acquire(false); }
            }
          } catch { /* malformed or concurrently removed locks fail closed */ }
        }
        throw new DomainError("KNOWLEDGE_BASE_BUSY", "Another Voidra instance is writing to this shared base. Try again after it finishes.", true);
      }
    };
    await acquire(true);
    try { return await operation(); }
    finally {
      try {
        const existing = JSON.parse(await readFile(lockPath, "utf8")) as { token?: string };
        if (existing.token === token) await rm(lockPath, { force: true });
      } catch { /* ownership was already cleared; never remove an unverified lock */ }
    }
  }

  #snippet(content: string, term?: string) {
    if (!term) return "";
    const index = content.toLocaleLowerCase().indexOf(term);
    if (index < 0) return "";
    return content.slice(Math.max(0, index - 40), Math.min(content.length, index + term.length + 80)).replace(/\s+/g, " ");
  }

  async #loadMemories(workspace: WorkspaceRecord) {
    const path = join(workspace.canonicalPath, "memory", "memories.json");
    try { return memoryFileSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new DomainError("INCOMPATIBLE_SCHEMA", "Workspace memory requires recovery.");
      const empty = { schemaVersion: 1 as const, memories: [] };
      await mkdir(dirname(path), { recursive: true });
      await atomicWrite(path, `${JSON.stringify(empty, null, 2)}\n`);
      return empty;
    }
  }

  async #writeMemories(workspace: WorkspaceRecord, file: z.infer<typeof memoryFileSchema>) {
    await atomicWrite(join(workspace.canonicalPath, "memory", "memories.json"), `${JSON.stringify(file, null, 2)}\n`);
  }
}
