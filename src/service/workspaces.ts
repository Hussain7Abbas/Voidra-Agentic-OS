import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { settingsOverrideSchema, workspaceSettingsFileSchema, resolveSettings, type SettingsOverride, type WorkspaceSettingsFile } from "../domain/settings";
import type { ErrorCode } from "../shared/contracts";
import { ServiceDatabase, type WorkspaceRecord } from "./database";

const workspaceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceId: z.uuid(),
  name: z.string().min(1).max(80),
  createdAt: z.iso.datetime(),
}).strict();

export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>;

export class DomainError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly retryable = false) {
    super(message);
    this.name = "DomainError";
  }
}

async function atomicWrite(path: string, content: string) {
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, path);
}

function containsPath(parent: string, child: string) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent));
}

function safeJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const inheritedPersona = "# Workspace persona\n\nThis workspace currently inherits the global persona.\n";
const defaultAgents = `# Voidra workspace instructions

- Keep private workspace content inside this workspace unless the user explicitly attaches or exports it.
- Follow more-specific AGENTS.md files only for their descendant paths.
- Instructions never grant tool, account, operating-system, or shared-knowledge permissions.
`;

export class WorkspaceManager {
  constructor(private readonly database: ServiceDatabase) {}

  async list() {
    const records = this.database.listWorkspaces();
    const workspaces = await Promise.all(records.map(async (record) => {
      const available = await this.#isAvailable(record);
      return {
        ...record,
        available,
        instructionIssues: available ? await this.#inspectRootInstructionPair(record.canonicalPath) : [],
      };
    }));
    return {
      workspaces,
      selectedWorkspaceId: this.database.getMetadata("selected_workspace_id") ?? null,
      defaultWorkspaceId: this.database.getMetadata("default_workspace_id") ?? null,
      askOnStartup: this.database.getMetadata("ask_on_startup") === "true",
    };
  }

  async create(name: string, rootPath: string) {
    const canonicalPath = await this.#canonicalDirectory(rootPath, true);
    this.#assertUnregisteredPath(canonicalPath);
    const voidraDirectory = join(canonicalPath, ".voidra");
    try {
      await stat(voidraDirectory);
      throw new DomainError("WORKSPACE_CONFLICT", "This directory already contains Voidra workspace metadata.");
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const now = new Date().toISOString();
    const manifest: WorkspaceManifest = { schemaVersion: 1, workspaceId: randomUUID(), name: name.trim(), createdAt: now };
    const settings: WorkspaceSettingsFile = { schemaVersion: 1, overrides: {} };
    const stage = join(canonicalPath, `.voidra-init-${manifest.workspaceId}`);
    await mkdir(stage, { recursive: false });
    try {
      await writeFile(join(stage, "workspace.json"), safeJson(manifest), { encoding: "utf8", flag: "wx" });
      await writeFile(join(stage, "settings.json"), safeJson(settings), { encoding: "utf8", flag: "wx" });
      await rename(stage, voidraDirectory);
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      throw error;
    }

    const instructionIssues = await this.#ensureRootInstructionPair(canonicalPath);
    const personaPath = join(canonicalPath, "persona.md");
    try {
      await writeFile(personaPath, inheritedPersona, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      instructionIssues.push({ path: personaPath, code: "existing_persona_preserved" });
    }

    const record: WorkspaceRecord = {
      id: manifest.workspaceId,
      name: manifest.name,
      canonicalPath,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    this.database.insertWorkspace(record);
    if (!this.database.getMetadata("default_workspace_id")) this.database.setMetadata("default_workspace_id", record.id);
    this.database.selectWorkspace(record.id);
    return { ...record, available: true, instructionIssues };
  }

  async open(rootPath: string) {
    const canonicalPath = await this.#canonicalDirectory(rootPath, false);
    this.#assertUnregisteredPath(canonicalPath);
    const manifest = await this.#readManifest(canonicalPath);
    if (this.database.getWorkspace(manifest.workspaceId)) {
      throw new DomainError("DUPLICATE_WORKSPACE", "This workspace identity is already registered.");
    }
    const now = new Date().toISOString();
    const record: WorkspaceRecord = {
      id: manifest.workspaceId,
      name: manifest.name,
      canonicalPath,
      createdAt: manifest.createdAt,
      updatedAt: now,
      lastOpenedAt: now,
    };
    this.database.insertWorkspace(record);
    if (!this.database.getMetadata("default_workspace_id")) this.database.setMetadata("default_workspace_id", record.id);
    this.database.selectWorkspace(record.id);
    return { ...record, available: true };
  }

  async locate(workspaceId: string, rootPath: string) {
    const existing = this.#requireWorkspace(workspaceId);
    const canonicalPath = await this.#canonicalDirectory(rootPath, false);
    this.#assertUnregisteredPath(canonicalPath, workspaceId);
    const manifest = await this.#readManifest(canonicalPath);
    if (manifest.workspaceId !== workspaceId) {
      throw new DomainError("WORKSPACE_CONFLICT", "The selected folder belongs to a different workspace identity.");
    }
    this.database.updateWorkspacePath(existing.id, canonicalPath);
    return { ...this.database.getWorkspace(existing.id)!, available: true };
  }

  select(workspaceId: string) {
    this.#requireWorkspace(workspaceId);
    this.database.selectWorkspace(workspaceId);
    return this.database.getWorkspace(workspaceId)!;
  }

  remove(workspaceId: string) {
    this.#requireWorkspace(workspaceId);
    this.database.removeWorkspace(workspaceId);
  }

  setPreferences(input: { defaultWorkspaceId?: string | null; askOnStartup?: boolean }) {
    if (input.defaultWorkspaceId !== undefined) {
      if (input.defaultWorkspaceId === null) this.database.deleteMetadata("default_workspace_id");
      else {
        this.#requireWorkspace(input.defaultWorkspaceId);
        this.database.setMetadata("default_workspace_id", input.defaultWorkspaceId);
      }
    }
    if (input.askOnStartup !== undefined) this.database.setMetadata("ask_on_startup", String(input.askOnStartup));
  }

  async getSettings(workspaceId: string) {
    const workspace = this.#requireWorkspace(workspaceId);
    const global = this.#readGlobalSettings();
    const workspaceSettings = await this.#readWorkspaceSettings(workspace);
    return resolveSettings(global, workspaceSettings.overrides);
  }

  updateGlobalSettings(input: unknown) {
    const overrides = settingsOverrideSchema.parse(input);
    this.database.setMetadata("global_settings", safeJson(overrides));
    return overrides;
  }

  async updateWorkspaceSettings(workspaceId: string, input: unknown) {
    const workspace = this.#requireWorkspace(workspaceId);
    const overrides = settingsOverrideSchema.parse(input);
    const settings: WorkspaceSettingsFile = { schemaVersion: 1, overrides };
    await atomicWrite(join(workspace.canonicalPath, ".voidra", "settings.json"), safeJson(settings));
    await atomicWrite(join(workspace.canonicalPath, "persona.md"), overrides.assistant?.persona ?? inheritedPersona);
    return this.getSettings(workspaceId);
  }

  bindAccountReference(workspaceId: string, reference: { accountId: string; provider: string; credentialRef: string }) {
    this.#requireWorkspace(workspaceId);
    this.database.bindAccountReference({ workspaceId, ...reference });
  }

  listAccountReferences(workspaceId: string) {
    this.#requireWorkspace(workspaceId);
    return this.database.listAccountReferences(workspaceId);
  }

  async requireAvailableWorkspace(workspaceId: string) {
    const workspace = this.#requireWorkspace(workspaceId);
    if (!(await this.#isAvailable(workspace))) {
      throw new DomainError("WORKSPACE_UNAVAILABLE", "The workspace directory is unavailable.", true);
    }
    return workspace;
  }

  #readGlobalSettings(): SettingsOverride {
    const stored = this.database.getMetadata("global_settings");
    if (!stored) return {};
    try {
      return settingsOverrideSchema.parse(JSON.parse(stored));
    } catch {
      throw new DomainError("INCOMPATIBLE_SCHEMA", "Global settings are invalid and require recovery.");
    }
  }

  async #readWorkspaceSettings(workspace: WorkspaceRecord) {
    try {
      const content = await readFile(join(workspace.canonicalPath, ".voidra", "settings.json"), "utf8");
      return workspaceSettingsFileSchema.parse(JSON.parse(content));
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        throw new DomainError("INCOMPATIBLE_SCHEMA", "Workspace settings are invalid and require recovery.");
      }
      throw new DomainError("WORKSPACE_UNAVAILABLE", "Workspace settings are unavailable.", true);
    }
  }

  #requireWorkspace(workspaceId: string) {
    const workspace = this.database.getWorkspace(workspaceId);
    if (!workspace) throw new DomainError("WORKSPACE_NOT_FOUND", "The workspace is not registered.");
    return workspace;
  }

  async #canonicalDirectory(inputPath: string, requireWritable: boolean) {
    try {
      const canonicalPath = await realpath(inputPath);
      const details = await stat(canonicalPath);
      if (!details.isDirectory()) throw new Error("Not a directory");
      await access(canonicalPath, requireWritable ? constants.R_OK | constants.W_OK : constants.R_OK);
      return canonicalPath;
    } catch {
      throw new DomainError("WORKSPACE_UNAVAILABLE", "The selected workspace directory is unavailable or inaccessible.", true);
    }
  }

  #assertUnregisteredPath(candidate: string, exceptWorkspaceId?: string) {
    for (const workspace of this.database.listWorkspaces()) {
      if (workspace.id === exceptWorkspaceId) continue;
      if (workspace.canonicalPath === candidate) {
        throw new DomainError("DUPLICATE_WORKSPACE", "This physical directory is already registered.");
      }
      if (containsPath(workspace.canonicalPath, candidate) || containsPath(candidate, workspace.canonicalPath)) {
        throw new DomainError("OVERLAPPING_WORKSPACE", "Workspace roots cannot contain one another.");
      }
    }
  }

  async #readManifest(rootPath: string) {
    try {
      const content = await readFile(join(rootPath, ".voidra", "workspace.json"), "utf8");
      return workspaceManifestSchema.parse(JSON.parse(content));
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        throw new DomainError("WORKSPACE_CONFLICT", "The selected folder has invalid Voidra workspace metadata.");
      }
      throw new DomainError("WORKSPACE_CONFLICT", "The selected folder is not an initialized Voidra workspace.");
    }
  }

  async #isAvailable(record: WorkspaceRecord) {
    try {
      const manifest = await this.#readManifest(record.canonicalPath);
      return manifest.workspaceId === record.id;
    } catch {
      return false;
    }
  }

  async #ensureRootInstructionPair(rootPath: string) {
    const agentsPath = join(rootPath, "AGENTS.md");
    const claudePath = join(rootPath, "CLAUDE.md");
    const issues: Array<{ path: string; code: string }> = [];
    const [agents, claude] = await Promise.all([
      readFile(agentsPath, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error)),
      readFile(claudePath, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error)),
    ]);
    if (agents === null && claude === null) {
      await atomicWrite(agentsPath, defaultAgents);
      await atomicWrite(claudePath, "@AGENTS.md\n");
      return issues;
    }
    if (agents === null) issues.push({ path: claudePath, code: "orphan_claude" });
    if (claude === null) issues.push({ path: agentsPath, code: "missing_claude_import" });
    if (claude !== null && claude !== "@AGENTS.md\n") issues.push({ path: claudePath, code: "conflicting_claude_preserved" });
    return issues;
  }

  async #inspectRootInstructionPair(rootPath: string) {
    const agentsPath = join(rootPath, "AGENTS.md");
    const claudePath = join(rootPath, "CLAUDE.md");
    const overridePath = join(rootPath, "AGENTS.override.md");
    const [agents, claude, override] = await Promise.all([
      readFile(agentsPath, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error)),
      readFile(claudePath, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error)),
      readFile(overridePath, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error)),
    ]);
    const issues: Array<{ path: string; code: string }> = [];
    if (agents === null && claude !== null) issues.push({ path: claudePath, code: "orphan_claude" });
    if (agents !== null && claude === null) issues.push({ path: agentsPath, code: "missing_claude_import" });
    if (claude !== null && claude !== "@AGENTS.md\n") issues.push({ path: claudePath, code: "conflicting_claude_preserved" });
    if (override !== null) issues.push({ path: overridePath, code: "agents_override_present" });
    return issues;
  }
}

export function resolveInsideWorkspace(rootPath: string, relativePath: string) {
  if (isAbsolute(relativePath)) throw new DomainError("WORKSPACE_CONFLICT", "Workspace-relative paths must not be absolute.");
  const candidate = resolve(rootPath, relativePath || ".");
  if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${sep}`)) {
    throw new DomainError("WORKSPACE_CONFLICT", "The requested path escapes the workspace.");
  }
  return candidate;
}

export function workspaceNameFromPath(path: string) {
  return basename(path);
}
