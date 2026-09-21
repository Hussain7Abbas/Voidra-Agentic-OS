import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { WorkspaceRecord } from "./database";
import { DomainError } from "./workspaces";

const digestPattern = /^[a-f0-9]{64}$/;
const recordSchema = z.object({
  id: z.uuid(), workspaceId: z.uuid(), runId: z.string().nullable(), routineId: z.string().nullable(), skillBundleDigest: z.string().regex(digestPattern).nullable(), contextManifestDigest: z.string().regex(digestPattern).nullable(),
  provider: z.string(), providerVersion: z.string().nullable(), title: z.string(), path: z.string(), storagePath: z.string(), kind: z.enum(["markdown", "text", "image", "pdf", "component", "legacy-html", "directory", "binary"]),
  contentType: z.string(), bytes: z.number().int().nonnegative(), digest: z.string().regex(digestPattern), tags: z.array(z.string()),
  previewState: z.enum(["safe", "quarantined", "legacy-read-only", "metadata-only"]), securityReviewState: z.enum(["not-required", "pending", "legacy", "blocked", "approved"]),
  parentArtifactIds: z.array(z.uuid()), retention: z.enum(["canonical", "retained-run-object", "staged"]), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
const registrySchema = z.object({ schemaVersion: z.literal(1), records: z.array(recordSchema) }).strict();
export type OutputRecord = z.infer<typeof recordSchema>;

const MAX_RECORDS = 20_000;
const MAX_DIRECTORY_FILES = 5_000;
const MAX_HASH_BYTES = 500_000_000;
const TEXT_READ_LIMIT = 200_000;

function json(value: unknown) { return `${JSON.stringify(value, null, 2)}\n`; }
function contained(root: string, candidate: string) { const delta = relative(root, candidate); return delta === "" || (delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta)); }
async function assertNoSymlinks(root: string, relativePath: string) { let cursor = root; for (const part of relativePath.split("/").filter(Boolean)) { cursor = join(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new DomainError("WORKSPACE_CONFLICT", "Catalog paths cannot traverse symbolic links."); } }

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp-${randomUUID()}`; await writeFile(temporary, content, { flag: "wx" }); await rename(temporary, path);
}

async function hashFile(path: string) {
  const digest = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; if (bytes > MAX_HASH_BYTES) throw new DomainError("WORKSPACE_CONFLICT", "Catalog files are limited to 500 MB."); digest.update(chunk); }
  return { digest: digest.digest("hex"), bytes };
}

async function hashDirectory(root: string) {
  const digest = createHash("sha256"); let bytes = 0; let files = 0;
  const walk = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name); const local = relative(root, path).split(sep).join("/"); const details = await lstat(path);
      if (details.isSymbolicLink()) throw new DomainError("WORKSPACE_CONFLICT", "Catalog directories cannot contain symbolic links.");
      if (details.isDirectory()) await walk(path);
      else if (details.isFile()) { files += 1; if (files > MAX_DIRECTORY_FILES) throw new DomainError("WORKSPACE_CONFLICT", "Catalog directories are limited to 5,000 files."); const hashed = await hashFile(path); bytes += hashed.bytes; if (bytes > MAX_HASH_BYTES) throw new DomainError("WORKSPACE_CONFLICT", "Catalog directories are limited to 500 MB."); digest.update(local).update("\0").update(hashed.digest).update("\0"); }
    }
  };
  await walk(root); return { digest: digest.digest("hex"), bytes };
}

async function sniff(path: string, directory: boolean) {
  if (directory) {
    try { await Promise.all([readFile(join(path, "artifact.json"), "utf8"), readFile(join(path, "src", "Artifact.tsx"), "utf8")]); return { kind: "component" as const, contentType: "application/vnd.voidra.component", previewState: "quarantined" as const, securityReviewState: "pending" as const }; }
    catch { return { kind: "directory" as const, contentType: "inode/directory", previewState: "metadata-only" as const, securityReviewState: "not-required" as const }; }
  }
  const handle = await open(path, "r"); const sampleBuffer = Buffer.alloc(8192); let bytesRead = 0;
  try { ({ bytesRead } = await handle.read(sampleBuffer, 0, sampleBuffer.length, 0)); } finally { await handle.close(); }
  const sample = sampleBuffer.subarray(0, bytesRead); const extension = extname(path).toLowerCase();
  if (sample.subarray(0, 5).toString() === "%PDF-") return { kind: "pdf" as const, contentType: "application/pdf", previewState: "safe" as const, securityReviewState: "not-required" as const };
  if (sample.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { kind: "image" as const, contentType: "image/png", previewState: "safe" as const, securityReviewState: "not-required" as const };
  if (sample.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return { kind: "image" as const, contentType: "image/jpeg", previewState: "safe" as const, securityReviewState: "not-required" as const };
  if (["GIF87a", "GIF89a"].includes(sample.subarray(0, 6).toString())) return { kind: "image" as const, contentType: "image/gif", previewState: "safe" as const, securityReviewState: "not-required" as const };
  if (sample.subarray(0, 4).toString() === "RIFF" && sample.subarray(8, 12).toString() === "WEBP") return { kind: "image" as const, contentType: "image/webp", previewState: "safe" as const, securityReviewState: "not-required" as const };
  const text = !sample.includes(0);
  if (text && [".html", ".htm"].includes(extension)) return { kind: "legacy-html" as const, contentType: "text/html", previewState: "legacy-read-only" as const, securityReviewState: "legacy" as const };
  if (text && [".md", ".markdown"].includes(extension)) return { kind: "markdown" as const, contentType: "text/markdown", previewState: "safe" as const, securityReviewState: "not-required" as const };
  if (text) return { kind: "text" as const, contentType: "text/plain", previewState: "safe" as const, securityReviewState: "not-required" as const };
  return { kind: "binary" as const, contentType: "application/octet-stream", previewState: "metadata-only" as const, securityReviewState: "blocked" as const };
}

export class OutputCatalogManager {
  readonly #registries = new Map<string, z.infer<typeof registrySchema>>();
  readonly #saveQueues = new Map<string, Promise<void>>();

  async list(workspace: WorkspaceRecord, input: { query?: string; kind?: OutputRecord["kind"] | null; provider?: string | null; tags?: string[]; limit?: number } = {}) {
    const registry = await this.#registry(workspace); const query = input.query?.trim().toLowerCase() ?? ""; const tags = new Set((input.tags ?? []).map((tag) => tag.toLowerCase()));
    return registry.records.filter((record) => (!input.kind || record.kind === input.kind) && (!input.provider || record.provider === input.provider) && [...tags].every((tag) => record.tags.includes(tag)) && (!query || [record.title, record.path, record.kind, record.provider, record.runId ?? "", record.routineId ?? "", ...record.tags].join(" ").toLowerCase().includes(query))).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)).slice(0, Math.min(500, Math.max(1, input.limit ?? 200)));
  }

  async registerPath(workspace: WorkspaceRecord, input: { path: string; logicalPath?: string; runId?: string | null; routineId?: string | null; skillBundleDigest?: string | null; contextManifestDigest?: string | null; provider: string; providerVersion?: string | null; title?: string; tags?: string[]; retention?: OutputRecord["retention"]; parentArtifactIds?: string[] }) {
    const normalized = posix.normalize(input.path); if (isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) throw new DomainError("WORKSPACE_CONFLICT", "Catalog paths must remain inside the workspace.");
    const workspaceRoot = await realpath(workspace.canonicalPath); const absolute = resolve(workspaceRoot, ...normalized.split("/")); await assertNoSymlinks(workspaceRoot, normalized); const unresolvedDetails = await lstat(absolute); if (unresolvedDetails.isSymbolicLink()) throw new DomainError("WORKSPACE_CONFLICT", "Catalog entries must be regular files or directories."); const canonical = await realpath(absolute); if (!contained(workspaceRoot, canonical)) throw new DomainError("WORKSPACE_CONFLICT", "The catalog path escapes its workspace.");
    const details = await lstat(canonical); if (!details.isFile() && !details.isDirectory()) throw new DomainError("WORKSPACE_CONFLICT", "Catalog entries must be regular files or directories.");
    const hashed = details.isDirectory() ? await hashDirectory(canonical) : await hashFile(canonical); const classification = await sniff(canonical, details.isDirectory()); const now = new Date().toISOString(); const registry = await this.#registry(workspace);
    const retention = input.retention ?? "canonical";
    const existing = registry.records.find((record) => record.digest === hashed.digest && record.path === (input.logicalPath ?? normalized) && record.runId === (input.runId ?? null) && record.retention === retention);
    if (existing) return existing;
    if (registry.records.length >= MAX_RECORDS) throw new DomainError("WORKSPACE_CONFLICT", "The workspace output catalog reached its 20,000-record limit.");
    const record: OutputRecord = { id: randomUUID(), workspaceId: workspace.id, runId: input.runId ?? null, routineId: input.routineId ?? null, skillBundleDigest: input.skillBundleDigest ?? null, contextManifestDigest: input.contextManifestDigest ?? null, provider: input.provider, providerVersion: input.providerVersion ?? null, title: input.title?.trim() || basename(input.logicalPath ?? normalized), path: input.logicalPath ?? normalized, storagePath: normalized, ...classification, bytes: hashed.bytes, digest: hashed.digest, tags: [...new Set((input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 50), parentArtifactIds: (input.parentArtifactIds ?? []).filter((id) => z.uuid().safeParse(id).success).slice(0, 100), retention, createdAt: now, updatedAt: now };
    registry.records.push(record); await this.#save(workspace, registry); return record;
  }

  async registerText(workspace: WorkspaceRecord, input: Omit<Parameters<OutputCatalogManager["registerPath"]>[1], "path" | "logicalPath" | "retention"> & { content: string; filename: string }) {
    if (Buffer.byteLength(input.content) > 2_000_000) throw new DomainError("WORKSPACE_CONFLICT", "Retained reports are limited to 2 MB.");
    const objectId = randomUUID(); const storagePath = posix.join(".voidra", "run-output-objects", `${objectId}-${basename(input.filename).replace(/[^A-Za-z0-9._-]/g, "_") || "report.txt"}`); await atomicWrite(join(workspace.canonicalPath, ...storagePath.split("/")), input.content);
    return this.registerPath(workspace, { ...input, path: storagePath, logicalPath: input.filename, retention: "retained-run-object" });
  }

  async readText(workspace: WorkspaceRecord, artifactId: string) {
    const record = (await this.#registry(workspace)).records.find(({ id, workspaceId }) => id === artifactId && workspaceId === workspace.id); if (!record) throw new DomainError("WORKSPACE_CONFLICT", "The output does not exist in this workspace.");
    if (!["markdown", "text"].includes(record.kind) || record.bytes > TEXT_READ_LIMIT) throw new DomainError("WORKSPACE_CONFLICT", "Only text outputs up to 200 KB can be reused as context.");
    const workspaceRoot = await realpath(workspace.canonicalPath); const absolute = resolve(workspaceRoot, ...record.storagePath.split("/")); await assertNoSymlinks(workspaceRoot, record.storagePath); const canonical = await realpath(absolute); if (!contained(workspaceRoot, canonical) || (await lstat(canonical)).isSymbolicLink()) throw new DomainError("WORKSPACE_CONFLICT", "The output storage path is unavailable.");
    const content = await readFile(canonical, "utf8"); const fresh = createHash("sha256").update(content).digest("hex"); if (fresh !== record.digest) throw new DomainError("WORKSPACE_CONFLICT", "The output changed after cataloging. Register the current revision before reuse.");
    return { record, content };
  }

  #path(workspace: WorkspaceRecord) { return join(workspace.canonicalPath, ".voidra", "run-outputs.json"); }
  async #registry(workspace: WorkspaceRecord) {
    const cached = this.#registries.get(workspace.id); if (cached) return cached;
    let registry: z.infer<typeof registrySchema>;
    try { registry = registrySchema.parse(JSON.parse(await readFile(this.#path(workspace), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new DomainError("INCOMPATIBLE_SCHEMA", "The output catalog requires recovery."); registry = { schemaVersion: 1, records: [] }; await this.#save(workspace, registry); }
    this.#registries.set(workspace.id, registry); return registry;
  }
  async #save(workspace: WorkspaceRecord, registry: z.infer<typeof registrySchema>) { const prior = this.#saveQueues.get(workspace.id) ?? Promise.resolve(); const next = prior.then(() => atomicWrite(this.#path(workspace), json(registry))); this.#saveQueues.set(workspace.id, next.catch(() => undefined)); await next; }
}
