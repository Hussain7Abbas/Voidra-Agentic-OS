import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import type { WorkspaceRecord } from "./database";
import { DomainError } from "./workspaces";
import type { OutputCatalogManager } from "./output-catalog";

export type HeadlessProvider = "claude" | "codex";
export type HeadlessAccessMode = "read-only" | "staged-write";
export type HeadlessStagedChange = { path: string; type: "added" | "modified" | "deleted" | "blocked"; beforeDigest: string | null; afterDigest: string | null; bytes: number; reason?: string };
export type HeadlessRun = {
  id: string;
  workspaceId: string;
  provider: HeadlessProvider;
  executablePath: string;
  executableFingerprint: string;
  version: string;
  model: string | null;
  provenance: { routineId: string; trigger: "manual" | "scheduled"; skillBundleDigest: string; contextManifestDigest: string } | null;
  queueClass: "interactive" | "scheduled";
  accessMode: HeadlessAccessMode;
  status: "queued" | "running" | "cancelling" | "cancelled" | "completed" | "failed" | "interrupted";
  promptDigest: string;
  stagePath: string;
  output: string;
  error: string | null;
  exitCode: number | null;
  snapshot: Record<string, { digest: string; bytes: number }>;
  stagedChanges: HeadlessStagedChange[];
  writebackStatus: "not-requested" | "pending-review" | "applied";
  appliedPaths: string[];
  events: Array<{ sequence: number; type: string; at: string; data: Record<string, unknown> }>;
  createdAt: string;
  updatedAt: string;
};

const MAX_OUTPUT_BYTES = 2_000_000;
const MAX_STAGE_FILES = 5_000;
const MAX_STAGE_BYTES = 50_000_000;
const MAX_STAGE_FILE_BYTES = 5_000_000;
const MAX_PROVIDER_PROCESSES = 64;
const MAX_PROVIDER_RSS_KB = 4 * 1024 * 1024;
const MAX_PROVIDER_IDLE_MS = 120_000;
const excludedDirectories = new Set([".git", ".voidra", ".next", "node_modules", "dist", "release", "coverage"]);
const sensitiveName = /(^|\/)(?:\.env(?:\..*)?|id_(?:rsa|ed25519)(?:\.pub)?|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|.*\.(?:pem|p12|pfx|key))$/i;
const allowedEnvironment = ["HOME", "PATH", "LANG", "LC_ALL", "TMPDIR", "XDG_CONFIG_HOME", "USER"] as const;

function digest(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function json(value: unknown) { return `${JSON.stringify(value, null, 2)}\n`; }

async function atomicWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, json(value), { encoding: "utf8", flag: "wx" }); await rename(temporary, path);
}

function minimalEnvironment() {
  const result: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production", VOIDRA_HEADLESS: "1", NO_COLOR: "1", TERM: "dumb" };
  for (const key of allowedEnvironment) if (process.env[key]) result[key] = process.env[key];
  return result;
}

function isContained(root: string, candidate: string) {
  const delta = relative(root, candidate);
  return delta === "" || (!delta.startsWith(`..${sep}`) && delta !== ".." && !isAbsolute(delta));
}

async function scanFiles(root: string, copyTo?: string) {
  const files: Record<string, { digest: string; bytes: number }> = {};
  const blocked: HeadlessStagedChange[] = [];
  let totalBytes = 0;
  const walk = async (directory: string, prefix = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!prefix && excludedDirectories.has(entry.name)) { if (!copyTo) blocked.push({ path, type: "blocked", beforeDigest: null, afterDigest: null, bytes: 0, reason: "Runtime and dependency directories cannot cross the writeback boundary." }); continue; }
      if (sensitiveName.test(path)) { if (!copyTo) blocked.push({ path, type: "blocked", beforeDigest: null, afterDigest: null, bytes: 0, reason: "Credential-like files cannot cross the writeback boundary." }); continue; }
      const source = join(directory, entry.name);
      const details = await lstat(source);
      if (details.isSymbolicLink()) { blocked.push({ path, type: "blocked", beforeDigest: null, afterDigest: null, bytes: 0, reason: "Symbolic links are never staged or applied." }); continue; }
      if (details.isDirectory()) { await walk(source, path); continue; }
      if (!details.isFile()) { blocked.push({ path, type: "blocked", beforeDigest: null, afterDigest: null, bytes: 0, reason: "Only regular files can cross the staging boundary." }); continue; }
      if (details.size > MAX_STAGE_FILE_BYTES) { blocked.push({ path, type: "blocked", beforeDigest: null, afterDigest: null, bytes: details.size, reason: "File exceeds the 5 MB staging limit." }); continue; }
      totalBytes += details.size;
      if (Object.keys(files).length >= MAX_STAGE_FILES || totalBytes > MAX_STAGE_BYTES) throw new DomainError("AGENT_STATE_CONFLICT", "Workspace staging exceeds the 5,000 file or 50 MB safety limit.");
      const bytes = await readFile(source);
      files[path] = { digest: digest(bytes), bytes: bytes.length };
      if (copyTo) { const destination = join(copyTo, path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes, { flag: "wx" }); }
    }
  };
  await walk(root);
  return { files, blocked };
}

function changesBetween(before: Record<string, { digest: string; bytes: number }>, after: Record<string, { digest: string; bytes: number }>, blocked: HeadlessStagedChange[]) {
  const changes: HeadlessStagedChange[] = [];
  for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const prior = before[path]; const next = after[path];
    if (!prior && next) changes.push({ path, type: "added", beforeDigest: null, afterDigest: next.digest, bytes: next.bytes });
    else if (prior && !next) changes.push({ path, type: "deleted", beforeDigest: prior.digest, afterDigest: null, bytes: prior.bytes });
    else if (prior && next && prior.digest !== next.digest) changes.push({ path, type: "modified", beforeDigest: prior.digest, afterDigest: next.digest, bytes: next.bytes });
  }
  return [...changes, ...blocked].slice(0, MAX_STAGE_FILES);
}

async function collect(processValue: ChildProcessWithoutNullStreams, timeoutMs = 5_000) {
  let output = ""; let error = "";
  processValue.stdout.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-100_000); });
  processValue.stderr.on("data", (chunk) => { error = `${error}${String(chunk)}`.slice(-100_000); });
  return await new Promise<{ code: number | null; output: string; error: string }>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => { processValue.kill("SIGKILL"); rejectPromise(new DomainError("AGENT_STATE_CONFLICT", "CLI version probe timed out.")); }, timeoutMs);
    processValue.once("error", (spawnError) => { clearTimeout(timer); rejectPromise(spawnError); });
    processValue.once("close", (code) => { clearTimeout(timer); resolvePromise({ code, output, error }); });
  });
}

async function processGroupUsage(groupId: number) {
  if (process.platform === "win32") return { processes: 1, rssKb: 0 };
  const ps = spawn("/bin/ps", ["-axo", "pgid=,rss="], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; ps.stdout.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-2_000_000); });
  await new Promise<void>((resolvePromise) => { ps.once("error", () => resolvePromise()); ps.once("close", () => resolvePromise()); });
  const rows = output.split("\n").map((line) => line.trim().split(/\s+/).map(Number)).filter(([pgid, rss]) => pgid === groupId && Number.isFinite(rss));
  return { processes: rows.length, rssKb: rows.reduce((sum, [, rss]) => sum + (rss ?? 0), 0) };
}

export class HeadlessRunner {
  readonly #children = new Map<string, ChildProcessWithoutNullStreams>();
  readonly #queue: Array<{ workspace: WorkspaceRecord; registry: HeadlessRun[]; run: HeadlessRun; prompt: string; timeoutMs: number }> = [];
  readonly #registries = new Map<string, HeadlessRun[]>();
  readonly #workspaceRecords = new Map<string, WorkspaceRecord>();
  readonly #saveQueues = new Map<string, Promise<void>>();
  #launching = false;
  #pressureRetry: NodeJS.Timeout | null = null;

  constructor(private readonly outputs?: OutputCatalogManager, private readonly options: { resourceProbe?: () => { memoryFreeRatio: number; loadPerCore: number }; pressureRetryMs?: number } = {}) {}

  async discover() {
    const candidates: Array<{ provider: HeadlessProvider; path: string; version: string; fingerprint: string }> = [];
    const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
    for (const provider of ["claude", "codex"] as const) {
      for (const directory of pathEntries) {
        const candidate = resolve(directory, provider);
        try {
          await access(candidate, constants.X_OK);
          const identity = await this.#identity(candidate);
          candidates.push({ provider, path: identity.path, version: identity.version, fingerprint: identity.fingerprint });
          break;
        } catch { /* Continue through PATH without executing a shell. */ }
      }
    }
    return candidates;
  }

  async list(workspace: WorkspaceRecord) {
    return [...await this.#registry(workspace)].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async start(workspace: WorkspaceRecord, input: { provider: HeadlessProvider; executablePath: string; prompt: string; model?: string | null; maxRuntimeMs?: number; accessMode?: HeadlessAccessMode; provenance?: HeadlessRun["provenance"] }) {
    if (!isAbsolute(input.executablePath)) throw new DomainError("AGENT_STATE_CONFLICT", "Headless executable path must be absolute and explicitly selected.");
    if (!input.prompt.trim() || input.prompt.length > 100_000) throw new DomainError("INVALID_REQUEST", "Headless prompt is empty or too large.");
    if (this.#queue.length >= 100) throw new DomainError("AGENT_STATE_CONFLICT", "The device headless queue reached its 100-run admission limit.");
    if (this.#queue.filter((item) => item.workspace.id === workspace.id).length >= 20) throw new DomainError("AGENT_STATE_CONFLICT", "This workspace already has 20 queued headless runs.");
    const identity = await this.#identity(input.executablePath);
    if (basename(identity.path).toLowerCase() !== input.provider) throw new DomainError("AGENT_STATE_CONFLICT", "The executable name does not match the selected provider.");
    const id = randomUUID(); const now = new Date().toISOString(); const stagePath = join(workspace.canonicalPath, ".voidra", "headless-runs", id);
    const stageWorkspace = join(stagePath, "workspace"); await mkdir(stageWorkspace, { recursive: true });
    const staged = await scanFiles(workspace.canonicalPath, stageWorkspace);
    await writeFile(join(stagePath, "prompt.md"), input.prompt, "utf8");
    const accessMode = input.accessMode ?? "read-only";
    const run: HeadlessRun = { id, workspaceId: workspace.id, provider: input.provider, executablePath: identity.path, executableFingerprint: identity.fingerprint, version: identity.version, model: input.model?.trim() || null, provenance: input.provenance ?? null, queueClass: input.provenance?.trigger === "scheduled" ? "scheduled" : "interactive", accessMode, status: "queued", promptDigest: digest(input.prompt), stagePath, output: "", error: null, exitCode: null, snapshot: staged.files, stagedChanges: staged.blocked, writebackStatus: "not-requested", appliedPaths: [], events: [], createdAt: now, updatedAt: now };
    const registry = await this.#registry(workspace); registry.push(run); this.#event(run, "run.queued", { provider: run.provider, version: run.version, fingerprint: run.executableFingerprint }); await this.#save(workspace, registry);
    this.#queue.push({ workspace, registry, run, prompt: input.prompt, timeoutMs: Math.min(3_600_000, Math.max(1_000, input.maxRuntimeMs ?? 300_000)) });
    setImmediate(() => { void this.#pump(); });
    return run;
  }

  async applyWriteback(workspace: WorkspaceRecord, runId: string, requestedPaths: string[]) {
    const registry = await this.#registry(workspace); const run = registry.find((item) => item.id === runId && item.workspaceId === workspace.id);
    if (!run) throw new DomainError("WORKSPACE_CONFLICT", "Headless run does not belong to this workspace.");
    if (run.status !== "completed" || run.accessMode !== "staged-write" || run.writebackStatus !== "pending-review") throw new DomainError("AGENT_STATE_CONFLICT", "This run has no reviewed staged writeback to apply.");
    const fresh = await scanFiles(join(run.stagePath, "workspace")); const currentChanges = changesBetween(run.snapshot, fresh.files, fresh.blocked);
    const requested = [...new Set(requestedPaths)].sort();
    if (!requested.length || requested.length > 200) throw new DomainError("INVALID_REQUEST", "Select between 1 and 200 staged paths to apply.");
    const changes = requested.map((path) => currentChanges.find((change) => change.path === path && change.type !== "blocked"));
    if (changes.some((change) => !change)) throw new DomainError("AGENT_STATE_CONFLICT", "The staged change set changed; review it again before applying.");
    const writebackId = randomUUID(); const backupRoot = join(workspace.canonicalPath, ".voidra", "headless-writebacks", writebackId, "backup");
    const journalPath = join(workspace.canonicalPath, ".voidra", "headless-writebacks", writebackId, "journal.json");
    await atomicWrite(journalPath, { schemaVersion: 1, id: writebackId, runId, workspaceId: workspace.id, status: "prepared", paths: requested, createdAt: new Date().toISOString() });
    for (const change of changes as HeadlessStagedChange[]) {
      const destination = resolve(workspace.canonicalPath, change.path);
      if (!isContained(workspace.canonicalPath, destination) || change.path.startsWith(".voidra/")) throw new DomainError("WORKSPACE_CONFLICT", "A staged path crossed the workspace boundary.");
      let cursor = workspace.canonicalPath;
      for (const part of dirname(change.path).split("/").filter(Boolean)) { cursor = join(cursor, part); try { if ((await lstat(cursor)).isSymbolicLink()) throw new DomainError("WORKSPACE_CONFLICT", "A canonical parent became a symbolic link."); } catch (error) { if (error instanceof DomainError) throw error; } }
      let canonicalDigest: string | null = null;
      try { const details = await lstat(destination); if (!details.isFile() || details.isSymbolicLink()) throw new DomainError("WORKSPACE_CONFLICT", "Canonical target is not a regular file."); const bytes = await readFile(destination); canonicalDigest = digest(bytes); const backup = join(backupRoot, change.path); await mkdir(dirname(backup), { recursive: true }); await writeFile(backup, bytes, { flag: "wx" }); } catch (error) { if (error instanceof DomainError) throw error; }
      if (canonicalDigest !== change.beforeDigest) throw new DomainError("AGENT_STATE_CONFLICT", `Canonical source changed since staging: ${change.path}`);
    }
    for (const change of changes as HeadlessStagedChange[]) {
      const destination = resolve(workspace.canonicalPath, change.path);
      if (change.type === "deleted") await rm(destination, { force: true });
      else { const bytes = await readFile(join(run.stagePath, "workspace", change.path)); await mkdir(dirname(destination), { recursive: true }); const temporary = `${destination}.voidra-${writebackId}.tmp`; await writeFile(temporary, bytes, { flag: "wx" }); await rename(temporary, destination); }
    }
    if (this.outputs) for (const change of changes as HeadlessStagedChange[]) if (change.type !== "deleted") await this.outputs.registerPath(workspace, { path: change.path, runId: run.id, routineId: run.provenance?.routineId ?? null, skillBundleDigest: run.provenance?.skillBundleDigest ?? null, contextManifestDigest: run.provenance?.contextManifestDigest ?? null, provider: run.provider, providerVersion: run.version, title: basename(change.path), tags: ["headless", "reviewed-writeback"], retention: "canonical" });
    run.appliedPaths = [...new Set([...run.appliedPaths, ...requested])].sort(); run.writebackStatus = "applied"; this.#event(run, "writeback.applied", { writebackId, paths: requested });
    await atomicWrite(journalPath, { schemaVersion: 1, id: writebackId, runId, workspaceId: workspace.id, status: "applied", paths: requested, appliedAt: new Date().toISOString() }); await this.#save(workspace, registry);
    return run;
  }

  async cancel(workspace: WorkspaceRecord, runId: string) {
    const registry = await this.#registry(workspace); const run = registry.find((item) => item.id === runId && item.workspaceId === workspace.id);
    if (!run) throw new DomainError("WORKSPACE_CONFLICT", "Headless run does not belong to this workspace.");
    if (!["queued", "running", "cancelling"].includes(run.status)) throw new DomainError("AGENT_STATE_CONFLICT", "Headless run is already finished.");
    run.status = "cancelling"; this.#event(run, "run.cancelling", {}); await this.#save(workspace, registry);
    const child = this.#children.get(run.id);
    if (child?.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      setTimeout(() => { if (child.exitCode === null) { try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); } } }, 2_000).unref();
    } else { run.status = "cancelled"; this.#event(run, "run.cancelled", {}); this.#removeQueued(run.id); await this.#save(workspace, registry); void this.#pump(); }
    return run;
  }

  async stopAll() {
    const stopped: string[] = [];
    for (const [workspaceId, registry] of this.#registries) {
      const workspace = this.#workspaceRecords.get(workspaceId);
      for (const run of registry) {
        if (!["queued", "running", "cancelling"].includes(run.status)) continue;
        const child = this.#children.get(run.id); run.status = child ? "cancelling" : "cancelled"; this.#event(run, child ? "run.cancelling" : "run.cancelled", { reason: "stop-all" }); stopped.push(run.id);
        if (child?.pid && child.exitCode === null) { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } }
      }
      if (workspace) await this.#save(workspace, registry);
    }
    this.#queue.splice(0, this.#queue.length);
    return { stopped };
  }

  #removeQueued(runId: string) {
    const index = this.#queue.findIndex(({ run }) => run.id === runId);
    if (index >= 0) this.#queue.splice(index, 1);
  }

  async #pump() {
    if (this.#launching || [...this.#children.values()].some((child) => child.exitCode === null)) return;
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) if (this.#queue[index]!.run.status !== "queued") this.#queue.splice(index, 1);
    if (!this.#queue.length) return;
    const pressure = this.options.resourceProbe?.() ?? { memoryFreeRatio: totalmem() ? freemem() / totalmem() : 1, loadPerCore: loadavg()[0]! / Math.max(1, cpus().length) };
    if (pressure.memoryFreeRatio < 0.001 || pressure.loadPerCore > 20) {
      for (const item of this.#queue) if (item.run.events.at(-1)?.type !== "queue.pressure-paused") { this.#event(item.run, "queue.pressure-paused", { memoryFreeRatio: Number(pressure.memoryFreeRatio.toFixed(3)), loadPerCore: Number(pressure.loadPerCore.toFixed(2)) }); void this.#save(item.workspace, item.registry); }
      if (!this.#pressureRetry) { this.#pressureRetry = setTimeout(() => { this.#pressureRetry = null; void this.#pump(); }, this.options.pressureRetryMs ?? 5_000); this.#pressureRetry.unref(); }
      return;
    }
    const now = Date.now();
    this.#queue.sort((left, right) => {
      const leftAged = now - new Date(left.run.createdAt).getTime() >= 300_000;
      const rightAged = now - new Date(right.run.createdAt).getTime() >= 300_000;
      const leftPriority = leftAged || left.run.queueClass === "interactive" ? 0 : 1;
      const rightPriority = rightAged || right.run.queueClass === "interactive" ? 0 : 1;
      return leftPriority - rightPriority || left.run.createdAt.localeCompare(right.run.createdAt) || left.run.id.localeCompare(right.run.id);
    });
    const next = this.#queue.shift()!;
    this.#launching = true;
    try { await this.#execute(next.workspace, next.registry, next.run, next.prompt, next.timeoutMs); }
    catch (error) {
      next.run.status = "failed"; next.run.error = error instanceof Error ? error.message : "The headless provider could not start."; this.#event(next.run, "run.failed", { admission: true }); await this.#save(next.workspace, next.registry);
    } finally {
      this.#launching = false;
      if (![...this.#children.values()].some((child) => child.exitCode === null)) void this.#pump();
    }
  }

  async #identity(executablePath: string) {
    const canonical = await realpath(executablePath); const details = await lstat(canonical);
    if (!details.isFile()) throw new DomainError("AGENT_STATE_CONFLICT", "Headless executable is not a regular file.");
    await access(canonical, constants.X_OK);
    const bytes = await readFile(canonical); const fingerprint = digest(bytes);
    const probe = spawn(canonical, ["--version"], { cwd: dirname(canonical), env: minimalEnvironment(), shell: false, stdio: ["pipe", "pipe", "pipe"] }); probe.stdin.end();
    const result = await collect(probe); const version = (result.output || result.error).trim().split("\n")[0]?.slice(0, 200) || "unknown";
    if (result.code !== 0) throw new DomainError("AGENT_STATE_CONFLICT", `CLI version probe failed: ${version}`);
    return { path: canonical, fingerprint, version };
  }

  async #execute(workspace: WorkspaceRecord, registry: HeadlessRun[], run: HeadlessRun, prompt: string, timeoutMs: number) {
    const args = run.provider === "claude"
      ? ["-p", "--output-format", "stream-json", "--safe-mode", "--disable-slash-commands", "--no-session-persistence", "--strict-mcp-config", "--mcp-config", "{}", "--permission-mode", run.accessMode === "staged-write" ? "acceptEdits" : "plan", "--tools", run.accessMode === "staged-write" ? "Read,Edit,Write,Glob,Grep" : "Read,Glob,Grep", "--setting-sources", "", ...(run.model ? ["--model", run.model] : [])]
      : ["exec", "--json", "--sandbox", run.accessMode === "staged-write" ? "workspace-write" : "read-only", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "-c", "mcp_servers={}", ...(run.model ? ["--model", run.model] : []), "-"];
    run.status = "running"; this.#event(run, "run.started", { args: args.map((value, index) => index && args[index - 1] === "--model" ? "<selected-model>" : value), stage: run.stagePath }); await this.#save(workspace, registry);
    const child = spawn(run.executablePath, args, { cwd: join(run.stagePath, "workspace"), env: minimalEnvironment(), shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    this.#children.set(run.id, child); child.stdin.end(prompt);
    let outputBytes = 0; let stderr = ""; let stdoutLines = ""; let saveTimer: NodeJS.Timeout | null = null; let lastActivityAt = Date.now(); let monitoring = false;
    const scheduleSave = () => { if (saveTimer) return; saveTimer = setTimeout(() => { saveTimer = null; void this.#save(workspace, registry); }, 80); };
    const normalizeLine = (line: string) => {
      try {
        const value = JSON.parse(line) as Record<string, unknown>; const providerType = typeof value.type === "string" ? value.type.slice(0, 100) : "json";
        const subtype = typeof value.subtype === "string" ? value.subtype.slice(0, 100) : null;
        const usage = value.usage && typeof value.usage === "object" ? Object.fromEntries(Object.entries(value.usage as Record<string, unknown>).filter(([, item]) => typeof item === "number").slice(0, 20)) : null;
        this.#event(run, "provider.event", { providerType, ...(subtype ? { subtype } : {}), ...(usage && Object.keys(usage).length ? { usage } : {}) });
      } catch { /* Non-JSON provider diagnostics remain bounded in raw output only. */ }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) { run.error = "Headless output exceeded the 2 MB limit."; try { process.kill(-child.pid!, "SIGTERM"); } catch { child.kill("SIGTERM"); } return; }
      lastActivityAt = Date.now(); const text = chunk.toString("utf8"); run.output += text; stdoutLines += text; const lines = stdoutLines.split("\n"); stdoutLines = lines.pop() ?? ""; for (const line of lines) if (line.trim()) normalizeLine(line); this.#event(run, "provider.output", { bytes: chunk.length }); scheduleSave();
    });
    child.stderr.on("data", (chunk: Buffer) => { lastActivityAt = Date.now(); stderr = `${stderr}${chunk.toString("utf8")}`.slice(-100_000); scheduleSave(); });
    child.on("error", (error) => { run.error = error.message; });
    const timeout = setTimeout(() => { run.error = `Runtime limit ${timeoutMs} ms reached.`; try { process.kill(-child.pid!, "SIGTERM"); } catch { child.kill("SIGTERM"); } }, timeoutMs);
    const resourceMonitor = setInterval(() => {
      if (monitoring || !child.pid || child.exitCode !== null) return; monitoring = true;
      void (async () => {
        try {
          const usage = await processGroupUsage(child.pid!);
          if (usage.processes > MAX_PROVIDER_PROCESSES || usage.rssKb > MAX_PROVIDER_RSS_KB || Date.now() - lastActivityAt > MAX_PROVIDER_IDLE_MS) {
            run.error = usage.processes > MAX_PROVIDER_PROCESSES ? `Provider process count exceeded ${MAX_PROVIDER_PROCESSES}.` : usage.rssKb > MAX_PROVIDER_RSS_KB ? "Provider memory exceeded 4 GB." : `Provider was idle for ${MAX_PROVIDER_IDLE_MS} ms.`;
            this.#event(run, "run.resource-limit", { processes: usage.processes, rssKb: usage.rssKb, idleMs: Date.now() - lastActivityAt });
            try { process.kill(-child.pid!, "SIGTERM"); } catch { child.kill("SIGTERM"); }
          }
        } finally { monitoring = false; }
      })();
    }, 2_000); resourceMonitor.unref();
    child.once("close", async (code, signal) => {
      clearTimeout(timeout); clearInterval(resourceMonitor); if (saveTimer) clearTimeout(saveTimer); if (stdoutLines.trim()) normalizeLine(stdoutLines); this.#children.delete(run.id); run.exitCode = code; run.updatedAt = new Date().toISOString();
      if (run.status === "cancelling") { run.status = "cancelled"; this.#event(run, "run.cancelled", { signal }); }
      else if (run.error?.includes("Runtime limit") || run.error?.includes("2 MB") || run.error?.includes("Provider process") || run.error?.includes("Provider memory") || run.error?.includes("Provider was idle")) { run.status = "interrupted"; this.#event(run, "run.interrupted", { error: run.error, signal }); }
      else if (code === 0) {
        const staged = await scanFiles(join(run.stagePath, "workspace")); run.stagedChanges = changesBetween(run.snapshot, staged.files, staged.blocked);
        if (run.accessMode === "read-only" && run.stagedChanges.some((change) => change.type !== "blocked")) { run.status = "failed"; run.error = "The provider changed files during a read-only run; canonical files were not touched."; this.#event(run, "run.boundary-violation", { changedPaths: run.stagedChanges.map((change) => change.path).slice(0, 100) }); }
        else {
          run.writebackStatus = run.accessMode === "staged-write" && run.stagedChanges.some((change) => change.type !== "blocked") ? "pending-review" : "not-requested";
          if (this.outputs) {
            try {
              if (run.output.trim()) await this.outputs.registerText(workspace, { content: run.output, filename: `${run.provider}-${run.id}-report.txt`, runId: run.id, routineId: run.provenance?.routineId ?? null, skillBundleDigest: run.provenance?.skillBundleDigest ?? null, contextManifestDigest: run.provenance?.contextManifestDigest ?? null, provider: run.provider, providerVersion: run.version, title: `${run.provider} run report`, tags: ["headless", "report"] });
              for (const change of run.stagedChanges) if (change.type === "added" || change.type === "modified") await this.outputs.registerPath(workspace, { path: posix.join(".voidra", "headless-runs", run.id, "workspace", change.path), logicalPath: change.path, runId: run.id, routineId: run.provenance?.routineId ?? null, skillBundleDigest: run.provenance?.skillBundleDigest ?? null, contextManifestDigest: run.provenance?.contextManifestDigest ?? null, provider: run.provider, providerVersion: run.version, title: basename(change.path), tags: ["headless", "staged"], retention: "staged" });
              this.#event(run, "artifacts.cataloged", { report: Boolean(run.output.trim()), staged: run.stagedChanges.filter((change) => change.type === "added" || change.type === "modified").length });
            } catch (error) { this.#event(run, "artifacts.catalog-failed", { diagnostic: error instanceof Error ? error.message.slice(0, 500) : "Cataloging failed." }); }
          }
          run.status = "completed"; this.#event(run, "run.completed", { outputBytes, stagedChanges: run.stagedChanges.length });
        }
      }
      else { run.status = "failed"; run.error = (run.error || stderr || `Provider exited with code ${code}`).slice(0, 100_000); this.#event(run, "run.failed", { code, signal }); }
      await this.#save(workspace, registry);
      void this.#pump();
    });
  }

  async #registry(workspace: WorkspaceRecord) {
    this.#workspaceRecords.set(workspace.id, workspace);
    const existing = this.#registries.get(workspace.id); if (existing) return existing;
    let runs: HeadlessRun[] = [];
    try { const parsed = JSON.parse(await readFile(join(workspace.canonicalPath, ".voidra", "headless-runs.json"), "utf8")); if (Array.isArray(parsed)) runs = parsed.filter((item) => item.workspaceId === workspace.id).map((item) => { const normalized = { provenance: null, queueClass: "interactive", accessMode: "read-only", snapshot: {}, stagedChanges: [], writebackStatus: "not-requested", appliedPaths: [], ...item }; return ["queued", "running", "cancelling"].includes(normalized.status) ? { ...normalized, status: "interrupted", error: "Voidra restarted while the provider was active." } : normalized; }); } catch { /* First run. */ }
    this.#registries.set(workspace.id, runs); return runs;
  }

  #event(run: HeadlessRun, type: string, data: Record<string, unknown>) { const at = new Date().toISOString(); if (run.events.length >= 5_000 && !type.startsWith("run.") && type !== "writeback.applied") { if (run.events.at(-1)?.type !== "provider.events-truncated") run.events.push({ sequence: run.events.length + 1, type: "provider.events-truncated", at, data: { limit: 5_000 } }); run.updatedAt = at; return; } run.events.push({ sequence: run.events.length + 1, type, at, data }); run.updatedAt = at; }
  async #save(workspace: WorkspaceRecord, registry: HeadlessRun[]) { const prior = this.#saveQueues.get(workspace.id) ?? Promise.resolve(); const next = prior.then(() => atomicWrite(join(workspace.canonicalPath, ".voidra", "headless-runs.json"), registry)); this.#saveQueues.set(workspace.id, next.catch(() => undefined)); await next; }
}
