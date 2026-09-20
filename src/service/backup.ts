import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, type KnowledgeAttachmentRecord, type KnowledgeBaseRecord, type ServiceDatabase, type WorkspaceRecord } from "./database";
import { DomainError, WorkspaceManager } from "./workspaces";

const relativePathSchema = z.string().min(1).max(4096).refine((value) => {
  const normalized = posix.normalize(value);
  return normalized === value && !isAbsolute(value) && value !== ".." && !value.startsWith("../") && !value.includes("\0");
}, "Backup paths must be normalized and relative.");

const fileSchema = z.object({
  path: relativePathSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  mode: z.number().int().nonnegative(),
}).strict();

const sharedBaseSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  canonicalPath: z.string().min(1),
  access: z.enum(["read", "write"]),
  attachedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  availableAtExport: z.boolean(),
}).strict();

export const backupManifestSchema = z.object({
  schemaVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  application: z.object({
    name: z.literal("Voidra"),
    version: z.string().min(1),
    databaseSchemaVersion: z.number().int().positive(),
    workspaceSchemaVersion: z.literal(1),
  }).strict(),
  workspace: z.object({ id: z.uuid(), name: z.string().min(1), createdAt: z.iso.datetime() }).strict(),
  files: z.array(fileSchema),
  omitted: z.array(z.object({ path: relativePathSchema, reason: z.enum(["rebuildable-index", "transient-file", "symbolic-link"]) }).strict()),
  sharedBases: z.array(sharedBaseSchema),
  credentials: z.object({ exported: z.literal(false), reauthorizationProviders: z.array(z.string().min(1)) }).strict(),
}).strict();

export type BackupManifest = z.infer<typeof backupManifestSchema>;

type BackupOptions = {
  applicationVersion?: string;
  now?: () => Date;
  availableBytes?: (path: string) => Promise<number>;
};

function containsPath(parent: string, child: string) {
  const fromParent = relative(parent, child);
  return fromParent === "" || (fromParent !== ".." && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent));
}

function portablePath(root: string, path: string) {
  return relative(root, path).split(sep).join("/");
}

function omittedReason(path: string): BackupManifest["omitted"][number]["reason"] | null {
  if (path === ".voidra/index.sqlite" || path.startsWith(".voidra/index.sqlite-")) return "rebuildable-index";
  if (path === ".voidra/rename-journal.json" || basename(path) === ".DS_Store" || basename(path).includes(".tmp-")) return "transient-file";
  return null;
}

function safeName(name: string) {
  return name.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "workspace";
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function pathAvailable(path: string) {
  try { return (await stat(path)).isDirectory(); }
  catch { return false; }
}

async function pathExists(path: string) {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export class BackupManager {
  readonly #applicationVersion: string;
  readonly #now: () => Date;
  readonly #availableBytes: (path: string) => Promise<number>;

  constructor(
    private readonly database: ServiceDatabase,
    private readonly workspaces: WorkspaceManager,
    options: BackupOptions = {},
  ) {
    this.#applicationVersion = options.applicationVersion ?? "0.1.0";
    this.#now = options.now ?? (() => new Date());
    this.#availableBytes = options.availableBytes ?? (async (path) => {
      const details = await statfs(path);
      return details.bavail * details.bsize;
    });
  }

  async export(workspace: WorkspaceRecord, destinationDirectory: string) {
    const destination = await this.#canonicalDirectory(destinationDirectory);
    if (containsPath(workspace.canonicalPath, destination)) throw new DomainError("BACKUP_CONFLICT", "Choose a backup destination outside the workspace.");

    const sourceFiles: Array<{ source: string; path: string; bytes: number; mode: number }> = [];
    const omitted: BackupManifest["omitted"] = [];
    await this.#walk(workspace.canonicalPath, workspace.canonicalPath, sourceFiles, omitted);
    const totalBytes = sourceFiles.reduce((sum, file) => sum + file.bytes, 0);
    if (await this.#availableBytes(destination) < totalBytes) throw new DomainError("BACKUP_CONFLICT", "The backup destination does not have enough available space.", true);

    const stamp = this.#now().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    const bundleName = `${safeName(workspace.name)}-${stamp}.voidra-backup`;
    const finalPath = join(destination, bundleName);
    const stage = join(destination, `.${bundleName}.stage-${randomUUID()}`);
    if (await pathExists(finalPath)) throw new DomainError("BACKUP_CONFLICT", "A backup with this name already exists.");

    try {
      await mkdir(join(stage, "workspace"), { recursive: true, mode: 0o700 });
      const files: BackupManifest["files"] = [];
      for (const file of sourceFiles.sort((a, b) => a.path.localeCompare(b.path))) {
        const target = join(stage, "workspace", ...file.path.split("/"));
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await copyFile(file.source, target);
        const copied = await stat(target);
        files.push({ path: file.path, sha256: await sha256(target), bytes: copied.size, mode: file.mode });
      }
      const attachments = this.database.listKnowledgeAttachments(workspace.id);
      const providers = [...new Set(this.database.listAccountReferences(workspace.id).map(({ provider }) => provider))].sort();
      const manifest: BackupManifest = {
        schemaVersion: 1,
        createdAt: this.#now().toISOString(),
        application: { name: "Voidra", version: this.#applicationVersion, databaseSchemaVersion: CURRENT_SCHEMA_VERSION, workspaceSchemaVersion: 1 },
        workspace: { id: workspace.id, name: workspace.name, createdAt: workspace.createdAt },
        files,
        omitted: omitted.sort((a, b) => a.path.localeCompare(b.path)),
        sharedBases: await Promise.all(attachments.map(async ({ workspaceId: _workspaceId, baseId: _baseId, ...attachment }) => ({
          ...attachment,
          availableAtExport: await pathAvailable(attachment.canonicalPath),
        }))),
        credentials: { exported: false, reauthorizationProviders: providers },
      };
      await writeFile(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(stage, finalPath);
      return { path: finalPath, manifest };
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      throw error;
    }
  }

  async inspect(backupPath: string) {
    const canonical = await realpath(backupPath).catch(() => { throw new DomainError("BACKUP_CONFLICT", "The backup directory is unavailable."); });
    const manifest = await this.#readManifest(canonical);
    await this.#verifyFiles(canonical, manifest);
    return { path: canonical, manifest };
  }

  async restore(backupPath: string, destinationPath: string) {
    const inspected = await this.inspect(backupPath);
    if (inspected.manifest.application.databaseSchemaVersion > CURRENT_SCHEMA_VERSION) throw new DomainError("INCOMPATIBLE_SCHEMA", "This backup requires a newer Voidra database schema.");
    if (!isAbsolute(destinationPath)) throw new DomainError("BACKUP_CONFLICT", "The restore destination must be an absolute path.");
    const requestedDestination = resolve(destinationPath);
    try { await stat(requestedDestination); throw new DomainError("BACKUP_CONFLICT", "Restore requires a new destination folder."); }
    catch (error) { if (error instanceof DomainError) throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = await this.#canonicalDirectory(dirname(requestedDestination));
    const destination = join(parent, basename(requestedDestination));
    if (!containsPath(parent, destination)) throw new DomainError("BACKUP_CONFLICT", "The restore destination is invalid.");
    const totalBytes = inspected.manifest.files.reduce((sum, file) => sum + file.bytes, 0);
    if (await this.#availableBytes(parent) < totalBytes) throw new DomainError("BACKUP_CONFLICT", "The restore destination does not have enough available space.", true);

    const stage = join(parent, `.${basename(destination)}.restore-${randomUUID()}`);
    try {
      await mkdir(stage, { mode: 0o700 });
      for (const file of inspected.manifest.files) {
        const source = join(inspected.path, "workspace", ...file.path.split("/"));
        const target = join(stage, ...file.path.split("/"));
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await copyFile(source, target);
        await chmod(target, file.mode);
      }
      await rename(stage, destination);
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      throw error;
    }

    let workspace: WorkspaceRecord;
    try { workspace = await this.workspaces.open(destination); }
    catch (error) {
      throw new DomainError("BACKUP_CONFLICT", `Files were restored to ${destination}, but the workspace could not be registered: ${error instanceof Error ? error.message : "unknown error"}`);
    }

    const unresolvedSharedBases: Array<{ id: string; reason: string }> = [];
    for (const reference of inspected.manifest.sharedBases) {
      const byId = this.database.getKnowledgeBase(reference.id);
      const byPath = this.database.getKnowledgeBaseByPath(reference.canonicalPath);
      let base: KnowledgeBaseRecord | undefined;
      if (byId && byId.canonicalPath !== reference.canonicalPath) unresolvedSharedBases.push({ id: reference.id, reason: "The shared-base identity is already registered at another path." });
      else if (byPath && byPath.id !== reference.id) unresolvedSharedBases.push({ id: reference.id, reason: "The shared-base path is already registered with another identity." });
      else {
        base = byId ?? byPath;
        if (!base) {
          base = { id: reference.id, name: reference.name, canonicalPath: reference.canonicalPath, createdAt: reference.createdAt, updatedAt: reference.updatedAt };
          this.database.insertKnowledgeBase(base);
        }
        const attachment: KnowledgeAttachmentRecord = { workspaceId: workspace.id, baseId: base.id, access: reference.access, attachedAt: reference.attachedAt };
        this.database.attachKnowledgeBase(attachment);
      }
    }
    const sharedBases = await Promise.all(inspected.manifest.sharedBases.map(async (reference) => ({ id: reference.id, available: await pathAvailable(reference.canonicalPath) })));
    return { workspace, sharedBases, unresolvedSharedBases, credentialsRestored: false };
  }

  async #canonicalDirectory(path: string) {
    if (!isAbsolute(path)) throw new DomainError("BACKUP_CONFLICT", "Backup paths must be absolute.");
    const canonical = await realpath(path).catch(() => { throw new DomainError("BACKUP_CONFLICT", "The selected backup directory is unavailable."); });
    if (!(await stat(canonical)).isDirectory()) throw new DomainError("BACKUP_CONFLICT", "The selected backup path is not a directory.");
    return canonical;
  }

  async #walk(root: string, directory: string, files: Array<{ source: string; path: string; bytes: number; mode: number }>, omitted: BackupManifest["omitted"]) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const source = join(directory, entry.name);
      const path = portablePath(root, source);
      if (entry.isSymbolicLink()) { omitted.push({ path, reason: "symbolic-link" }); continue; }
      const reason = omittedReason(path);
      if (reason) { omitted.push({ path, reason }); continue; }
      if (entry.isDirectory()) await this.#walk(root, source, files, omitted);
      else if (entry.isFile()) { const details = await stat(source); files.push({ source, path, bytes: details.size, mode: details.mode & 0o777 }); }
    }
  }

  async #readManifest(path: string) {
    try {
      const manifestPath = join(path, "manifest.json");
      if ((await lstat(manifestPath)).isSymbolicLink()) throw new Error("unsafe manifest link");
      return backupManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    }
    catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("BACKUP_CONFLICT", "The backup manifest is missing, invalid, or unsupported.");
    }
  }

  async #verifyFiles(path: string, manifest: BackupManifest) {
    const seen = new Set<string>();
    const declaredDataRoot = join(path, "workspace");
    const dataRoot = await realpath(declaredDataRoot).catch(() => { throw new DomainError("BACKUP_CONFLICT", "The backup workspace payload is missing."); });
    if (!containsPath(path, dataRoot) || (await lstat(declaredDataRoot)).isSymbolicLink()) throw new DomainError("BACKUP_CONFLICT", "The backup workspace payload is unsafe.");
    for (const file of manifest.files) {
      if (seen.has(file.path)) throw new DomainError("BACKUP_CONFLICT", "The backup manifest contains duplicate file paths.");
      seen.add(file.path);
      const candidate = join(path, "workspace", ...file.path.split("/"));
      if (!containsPath(join(path, "workspace"), candidate)) throw new DomainError("BACKUP_CONFLICT", "The backup contains an unsafe file path.");
      try {
        const details = await lstat(candidate);
        const canonical = await realpath(candidate);
        if (details.isSymbolicLink() || !containsPath(dataRoot, canonical)) throw new Error("unsafe-link");
        if (!details.isFile() || details.size !== file.bytes || await sha256(candidate) !== file.sha256) throw new Error("mismatch");
      } catch { throw new DomainError("BACKUP_CONFLICT", `Backup integrity verification failed for ${file.path}.`); }
    }
  }
}
