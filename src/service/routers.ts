import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import { z } from "zod";
import type { WorkspaceRecord } from "./database";
import type { ManualHandoffManager } from "./handoffs";
import type { KnowledgeManager } from "./knowledge";
import { DomainError } from "./workspaces";

const suggestionSchema = z.object({
  schemaVersion: z.literal(1),
  suggestions: z.array(z.object({
    id: z.uuid(), workspaceId: z.uuid(), targetPath: z.string(), domain: z.string(), status: z.enum(["draft", "applied", "superseded"]),
    expectedRevision: z.string().nullable(), preview: z.string(), sources: z.array(z.object({ type: z.string(), id: z.string(), label: z.string() }).strict()),
    createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  }).strict()),
}).strict();

type SuggestionRegistry = z.infer<typeof suggestionSchema>;
type Suggestion = SuggestionRegistry["suggestions"][number];

const START = "<!-- voidra:router:start -->";
const END = "<!-- voidra:router:end -->";

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function optionalRead(path: string) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function atomicWrite(path: string, content: string) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try { await rename(temporary, path); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

export class RouterManager {
  constructor(private readonly knowledge: KnowledgeManager, private readonly handoffs: ManualHandoffManager) {}

  async list(workspace: WorkspaceRecord) {
    return (await this.#registry(workspace)).suggestions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async suggest(workspace: WorkspaceRecord, domainInput = "") {
    const domain = this.#normalizeDomain(domainInput);
    const targetPath = domain ? posix.join(domain, "ROUTER.md") : "ROUTER.md";
    const target = await this.#safeTarget(workspace, targetPath, true);
    const existing = await optionalRead(target);
    const graph = await this.knowledge.graph(workspace, {});
    const prefix = domain ? `${domain}/` : "";
    const notes = graph.nodes.filter((node) => !prefix || node.path.startsWith(prefix)).slice(0, 200);
    const skills = await this.handoffs.listSkills(workspace);
    const routines = await this.handoffs.listRoutines(workspace);
    const sources: Suggestion["sources"] = [
      ...notes.map((note) => ({ type: "note", id: note.id, label: note.path })),
      ...skills.map((skill) => ({ type: "skill", id: skill.id, label: `${skill.name} v${skill.version}` })),
      ...routines.map((routine) => ({ type: "routine", id: routine.id, label: `${routine.name} → skill v${routine.skillVersion}` })),
    ];
    const generated = [
      START,
      "## Voidra routes",
      "",
      "This generated section is navigation context only. It grants no filesystem, connector, network, or execution capability.",
      "",
      "### Notes",
      ...(notes.length ? notes.map((note) => `- [${note.title}](${posix.relative(domain || ".", note.path) || note.path}) <!-- id:${note.id} -->`) : ["- No indexed Markdown notes in this domain."]),
      "",
      "### Skills",
      ...(skills.length ? skills.map((skill) => `- ${skill.name} · v${skill.version} · bundle ${skill.currentDigest.slice(0, 12)} <!-- id:${skill.id} -->`) : ["- No skills registered."]),
      "",
      "### Routines",
      ...(routines.length ? routines.map((routine) => `- ${routine.name} · ${routine.client} · skill v${routine.skillVersion} <!-- id:${routine.id} -->`) : ["- No routines registered."]),
      END,
    ].join("\n");
    let preview: string;
    if (existing === null) preview = `# ${domain ? `${domain} router` : `${workspace.name} router`}\n\n${generated}\n`;
    else {
      const start = existing.indexOf(START);
      const end = existing.indexOf(END);
      if ((start < 0) !== (end < 0) || (start >= 0 && end < start)) throw new DomainError("WORKSPACE_CONFLICT", "The existing router has damaged generated-section markers. Repair it manually before regenerating.");
      preview = start < 0 ? `${existing.replace(/\s*$/, "")}\n\n${generated}\n` : `${existing.slice(0, start)}${generated}${existing.slice(end + END.length)}`;
    }
    const registry = await this.#registry(workspace);
    for (const prior of registry.suggestions.filter((item) => item.targetPath === targetPath && item.status === "draft")) prior.status = "superseded";
    const now = new Date().toISOString();
    const suggestion: Suggestion = { id: randomUUID(), workspaceId: workspace.id, targetPath, domain, status: "draft", expectedRevision: existing === null ? null : digest(existing), preview, sources, createdAt: now, updatedAt: now };
    registry.suggestions.push(suggestion);
    await this.#writeRegistry(workspace, registry);
    return suggestion;
  }

  async update(workspace: WorkspaceRecord, suggestionId: string, preview: string) {
    const { registry, suggestion } = await this.#suggestion(workspace, suggestionId);
    if (suggestion.status !== "draft") throw new DomainError("WORKSPACE_CONFLICT", "Only a draft router suggestion can be edited.");
    if (!preview.includes(START) || !preview.includes(END)) throw new DomainError("WORKSPACE_CONFLICT", "Router previews must preserve the generated-section markers.");
    suggestion.preview = preview;
    suggestion.updatedAt = new Date().toISOString();
    await this.#writeRegistry(workspace, registry);
    return suggestion;
  }

  async apply(workspace: WorkspaceRecord, suggestionId: string) {
    const { registry, suggestion } = await this.#suggestion(workspace, suggestionId);
    if (suggestion.status !== "draft") throw new DomainError("WORKSPACE_CONFLICT", "Only a draft router suggestion can be applied.");
    const target = await this.#safeTarget(workspace, suggestion.targetPath, true);
    const current = await optionalRead(target);
    if ((current === null ? null : digest(current)) !== suggestion.expectedRevision) throw new DomainError("WORKSPACE_CONFLICT", "The router changed after preview. Generate and review a new suggestion.");
    await atomicWrite(target, suggestion.preview);
    suggestion.status = "applied";
    suggestion.updatedAt = new Date().toISOString();
    await this.#writeRegistry(workspace, registry);
    return suggestion;
  }

  #normalizeDomain(value: string) {
    if (isAbsolute(value)) throw new DomainError("WORKSPACE_CONFLICT", "Router domains must be workspace-relative.");
    const normalized = posix.normalize(value.trim().replaceAll("\\", "/") || ".");
    if (normalized === ".") return "";
    if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) throw new DomainError("WORKSPACE_CONFLICT", "The router domain escapes the workspace.");
    return normalized.replace(/^\.\//, "");
  }

  async #safeTarget(workspace: WorkspaceRecord, targetPath: string, allowMissing: boolean) {
    const absolute = resolve(workspace.canonicalPath, ...targetPath.split("/"));
    if (!absolute.startsWith(`${workspace.canonicalPath}${sep}`)) throw new DomainError("WORKSPACE_CONFLICT", "The router target escapes the workspace.");
    let ancestor = dirname(absolute);
    while (true) {
      try { ancestor = await realpath(ancestor); break; }
      catch (error) {
        if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT" || ancestor === workspace.canonicalPath) throw new DomainError("WORKSPACE_CONFLICT", "The router target is unavailable.");
        ancestor = dirname(ancestor);
      }
    }
    if (ancestor !== workspace.canonicalPath && !ancestor.startsWith(`${workspace.canonicalPath}${sep}`)) throw new DomainError("WORKSPACE_CONFLICT", "The router target escapes the workspace.");
    return absolute;
  }

  async #registry(workspace: WorkspaceRecord): Promise<SuggestionRegistry> {
    const path = join(workspace.canonicalPath, ".voidra", "router-suggestions.json");
    const content = await optionalRead(path);
    if (content === null) {
      const empty: SuggestionRegistry = { schemaVersion: 1, suggestions: [] };
      await atomicWrite(path, `${JSON.stringify(empty, null, 2)}\n`);
      return empty;
    }
    try { return suggestionSchema.parse(JSON.parse(content)); }
    catch { throw new DomainError("INCOMPATIBLE_SCHEMA", "Router suggestions require recovery."); }
  }

  async #writeRegistry(workspace: WorkspaceRecord, registry: SuggestionRegistry) {
    await atomicWrite(join(workspace.canonicalPath, ".voidra", "router-suggestions.json"), `${JSON.stringify(registry, null, 2)}\n`);
  }

  async #suggestion(workspace: WorkspaceRecord, id: string) {
    const registry = await this.#registry(workspace);
    const suggestion = registry.suggestions.find((item) => item.id === id && item.workspaceId === workspace.id);
    if (!suggestion) throw new DomainError("WORKSPACE_CONFLICT", "The router suggestion does not exist in this workspace.");
    return { registry, suggestion };
  }
}
