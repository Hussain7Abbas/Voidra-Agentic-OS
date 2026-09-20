import { readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { DomainError, resolveInsideWorkspace } from "./workspaces";

const MAX_INSTRUCTION_BYTES = 128_000;

async function optionalRead(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicPairWrite(directory: string, content: string) {
  const agentsPath = join(directory, "AGENTS.md");
  const claudePath = join(directory, "CLAUDE.md");
  const existing = await Promise.all([optionalRead(agentsPath), optionalRead(claudePath)]);
  if (existing.some((value) => value !== null)) {
    throw new DomainError("INSTRUCTION_CONFLICT", "Existing instruction files were preserved; choose an explicit reconciliation.");
  }
  await writeFile(agentsPath, content.endsWith("\n") ? content : `${content}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await writeFile(claudePath, "@AGENTS.md\n", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    await rm(agentsPath, { force: true });
    throw error;
  }
}

export class InstructionResolver {
  async createScope(rootPath: string, relativeDirectory: string, content: string) {
    const canonicalRoot = await realpath(rootPath);
    const requested = resolveInsideWorkspace(canonicalRoot, relativeDirectory);
    let directory: string;
    try {
      directory = await realpath(requested);
      if (!(await stat(directory)).isDirectory()) throw new Error("Not a directory");
    } catch {
      throw new DomainError("WORKSPACE_CONFLICT", "The scoped instruction directory must already exist inside the workspace.");
    }
    this.#assertCanonicalInside(canonicalRoot, directory);
    await atomicPairWrite(directory, content);
    return { agentsPath: join(directory, "AGENTS.md"), claudePath: join(directory, "CLAUDE.md") };
  }

  async resolve(rootPath: string, relativeTargets: string[]) {
    const canonicalRoot = await realpath(rootPath);
    const results = [];
    for (const relativeTarget of relativeTargets) {
      const requested = resolveInsideWorkspace(canonicalRoot, relativeTarget);
      let target: string;
      try {
        target = await realpath(requested);
      } catch {
        throw new DomainError("WORKSPACE_CONFLICT", "An instruction target is missing or inaccessible.");
      }
      this.#assertCanonicalInside(canonicalRoot, target);
      const targetStat = await stat(target);
      let cursor = targetStat.isDirectory() ? target : dirname(target);
      const directories: string[] = [];
      while (true) {
        directories.push(cursor);
        if (cursor === canonicalRoot) break;
        cursor = dirname(cursor);
      }
      directories.reverse();

      const rules: Array<{ scope: string; path: string; content: string }> = [];
      const issues: Array<{ scope: string; path: string; code: string }> = [];
      let totalBytes = 0;
      for (const directory of directories) {
        const agentsPath = join(directory, "AGENTS.md");
        const claudePath = join(directory, "CLAUDE.md");
        const overridePath = join(directory, "AGENTS.override.md");
        const [agents, claude, override] = await Promise.all([optionalRead(agentsPath), optionalRead(claudePath), optionalRead(overridePath)]);
        const scope = relative(canonicalRoot, directory) || ".";
        if (agents !== null) {
          totalBytes += Buffer.byteLength(agents);
          if (totalBytes > MAX_INSTRUCTION_BYTES) {
            throw new DomainError("INSTRUCTION_CONFLICT", "Applicable instructions exceed the supported size; no content was silently truncated.");
          }
          rules.push({ scope, path: agentsPath, content: agents });
          if (claude === null) issues.push({ scope, path: claudePath, code: "missing_claude_import" });
        } else if (claude !== null) {
          issues.push({ scope, path: claudePath, code: "orphan_claude" });
        }
        if (claude !== null && claude !== "@AGENTS.md\n") issues.push({ scope, path: claudePath, code: "conflicting_claude" });
        if (override !== null) issues.push({ scope, path: overridePath, code: "agents_override_present" });
      }
      results.push({ target: relativeTarget, rules, issues });
    }
    return results;
  }

  #assertCanonicalInside(rootPath: string, candidate: string) {
    if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${sep}`)) {
      throw new DomainError("WORKSPACE_CONFLICT", "A symbolic link escapes the workspace root.");
    }
  }
}
