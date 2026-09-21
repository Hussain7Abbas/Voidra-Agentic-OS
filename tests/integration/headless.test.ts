import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HeadlessRunner } from "../../src/service/headless";
import type { WorkspaceRecord } from "../../src/service/database";
import { OutputCatalogManager } from "../../src/service/output-catalog";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture(provider: "claude" | "codex", body: string) {
  const root = await mkdtemp(join(tmpdir(), "voidra-headless-")); temporaryDirectories.push(root);
  const workspaceRoot = join(root, "Workspace"); const bin = join(root, "bin"); await Promise.all([mkdir(workspaceRoot), mkdir(bin)]);
  await mkdir(join(workspaceRoot, ".voidra"));
  await writeFile(join(workspaceRoot, "AGENTS.md"), "# Test instructions\n"); await writeFile(join(workspaceRoot, "CLAUDE.md"), "@AGENTS.md\n");
  const executable = join(bin, provider); await writeFile(executable, `#!/usr/bin/env node\n${body}\n`); await chmod(executable, 0o755);
  const now = new Date().toISOString();
  const workspace: WorkspaceRecord = { id: "018f0f73-89db-7a63-a1b2-5d46f598ed01", name: "Test", canonicalPath: workspaceRoot, createdAt: now, updatedAt: now, lastOpenedAt: now };
  return { root, workspace, executable };
}

async function waitForTerminal(runner: HeadlessRunner, workspace: WorkspaceRecord) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [run] = await runner.list(workspace); if (run && ["completed", "failed", "cancelled", "interrupted"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Headless fixture did not finish.");
}

describe("HeadlessRunner", () => {
  it("spawns Claude directly with stdin, a staged workspace, and durable events", async () => {
    const { workspace, executable } = await fixture("claude", `if(process.argv.includes("--version")){console.log("claude fixture 1.0");process.exit(0)}let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>{console.log(JSON.stringify({type:"result",text:input, cwd:process.cwd(), secret:process.env.OPENROUTER_API_KEY??null,args:process.argv.slice(2)}))})`);
    const catalog = new OutputCatalogManager(); const runner = new HeadlessRunner(catalog); const started = await runner.start(workspace, { provider: "claude", executablePath: executable, prompt: "staged prompt", maxRuntimeMs: 5_000 });
    expect(started.status).toBe("queued"); const finished = await waitForTerminal(runner, workspace);
    expect(finished.status).toBe("completed"); expect(finished.output).toContain("staged prompt"); expect(finished.output).toContain("headless-runs"); expect(finished.output).toContain('"secret":null');
    expect(finished.output).toContain('"--safe-mode"'); expect(finished.output).toContain('"plan"');
    expect(finished.events.map((event) => event.type)).toEqual(expect.arrayContaining(["run.queued", "run.started", "provider.event", "provider.output", "run.completed"]));
    expect(await catalog.list(workspace)).toEqual([expect.objectContaining({ runId: started.id, kind: "text", provider: "claude", retention: "retained-run-object" })]);
  });

  it("cancels the complete provider process group", async () => {
    const { workspace, executable } = await fixture("codex", `if(process.argv.includes("--version")){console.log("codex fixture 1.0");process.exit(0)}process.stdin.resume();setInterval(()=>console.log("working"),50)`);
    const runner = new HeadlessRunner(); const started = await runner.start(workspace, { provider: "codex", executablePath: executable, prompt: "wait", maxRuntimeMs: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 80)); await runner.cancel(workspace, started.id); const finished = await waitForTerminal(runner, workspace);
    expect(finished.status).toBe("cancelled"); expect(finished.events.some((event) => event.type === "run.cancelling")).toBe(true);
  });

  it("keeps provider edits staged until exact reviewed paths are applied", async () => {
    const { workspace, executable } = await fixture("codex", `const fs=require("node:fs");if(process.argv.includes("--version")){console.log("codex fixture 1.0");process.exit(0)}process.stdin.resume();process.stdin.on("end",()=>{fs.writeFileSync("note.md","staged update\\n");fs.writeFileSync("new.md","new output\\n");console.log(JSON.stringify({type:"result"}))})`);
    await writeFile(join(workspace.canonicalPath, "note.md"), "canonical original\n");
    const catalog = new OutputCatalogManager(); const runner = new HeadlessRunner(catalog); const started = await runner.start(workspace, { provider: "codex", executablePath: executable, prompt: "edit staged files", accessMode: "staged-write", maxRuntimeMs: 5_000 });
    const finished = await waitForTerminal(runner, workspace);
    expect(finished.status).toBe("completed"); expect(finished.writebackStatus).toBe("pending-review");
    expect(finished.stagedChanges.map((change) => `${change.type}:${change.path}`)).toEqual(expect.arrayContaining(["modified:note.md", "added:new.md"]));
    expect(finished.events.find((event) => event.type === "run.started")?.data.args).toEqual(expect.arrayContaining(["workspace-write", "--ephemeral", "--ignore-user-config", "--ignore-rules"]));
    expect(await readFile(join(workspace.canonicalPath, "note.md"), "utf8")).toBe("canonical original\n");
    await expect(readFile(join(workspace.canonicalPath, "new.md"), "utf8")).rejects.toThrow();
    await runner.applyWriteback(workspace, started.id, ["new.md", "note.md"]);
    expect(await readFile(join(workspace.canonicalPath, "note.md"), "utf8")).toBe("staged update\n");
    expect(await readFile(join(workspace.canonicalPath, "new.md"), "utf8")).toBe("new output\n");
    expect((await catalog.list(workspace)).map(({ path, retention }) => `${retention}:${path}`)).toEqual(expect.arrayContaining(["staged:new.md", "staged:note.md", "canonical:new.md", "canonical:note.md"]));
  });

  it("denies stale staged writeback after canonical source changes", async () => {
    const { workspace, executable } = await fixture("claude", `const fs=require("node:fs");if(process.argv.includes("--version")){console.log("claude fixture 1.0");process.exit(0)}process.stdin.resume();process.stdin.on("end",()=>{fs.writeFileSync("note.md","provider edit\\n");console.log(JSON.stringify({type:"result"}))})`);
    await writeFile(join(workspace.canonicalPath, "note.md"), "original\n");
    const runner = new HeadlessRunner(); const started = await runner.start(workspace, { provider: "claude", executablePath: executable, prompt: "edit", accessMode: "staged-write", maxRuntimeMs: 5_000 });
    await waitForTerminal(runner, workspace); await writeFile(join(workspace.canonicalPath, "note.md"), "user changed this\n");
    await expect(runner.applyWriteback(workspace, started.id, ["note.md"])).rejects.toThrow("Canonical source changed since staging");
    expect(await readFile(join(workspace.canonicalPath, "note.md"), "utf8")).toBe("user changed this\n");
  });

  it("includes active provider processes in global Stop All", async () => {
    const { workspace, executable } = await fixture("codex", `if(process.argv.includes("--version")){console.log("codex fixture 1.0");process.exit(0)}process.stdin.resume();setInterval(()=>console.log("working"),50)`);
    const runner = new HeadlessRunner(); const started = await runner.start(workspace, { provider: "codex", executablePath: executable, prompt: "wait", maxRuntimeMs: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 80)); const stopped = await runner.stopAll(); const finished = await waitForTerminal(runner, workspace);
    expect(stopped.stopped).toContain(started.id); expect(finished.status).toBe("cancelled");
  });

  it("pauses queue admission during device pressure and resumes without losing ownership", async () => {
    const { workspace, executable } = await fixture("codex", `if(process.argv.includes("--version")){console.log("codex fixture 1.0");process.exit(0)}process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({type:"result"})))`);
    let pressured = true; const runner = new HeadlessRunner(undefined, { resourceProbe: () => ({ memoryFreeRatio: pressured ? 0.0001 : 0.5, loadPerCore: 0.1 }), pressureRetryMs: 20 });
    const started = await runner.start(workspace, { provider: "codex", executablePath: executable, prompt: "wait for resources", maxRuntimeMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 40)); const [queued] = await runner.list(workspace); expect(queued).toMatchObject({ id: started.id, status: "queued" }); expect(queued!.events.some(({ type }) => type === "queue.pressure-paused")).toBe(true);
    pressured = false; const finished = await waitForTerminal(runner, workspace); expect(finished.status).toBe("completed");
  });

  it("admits one provider at a time and prioritizes explicit runs without starving aged scheduled work", async () => {
    const orderPath = join(tmpdir(), `voidra-headless-order-${crypto.randomUUID()}.txt`); temporaryDirectories.push(orderPath);
    const { workspace, executable } = await fixture("codex", `const fs=require("node:fs");if(process.argv.includes("--version")){console.log("codex fixture 1.0");process.exit(0)}let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>setTimeout(()=>{fs.appendFileSync(${JSON.stringify(orderPath)},input+"\\n");console.log(JSON.stringify({type:"result"}))},input==="active"?180:10))`);
    const runner = new HeadlessRunner();
    const active = await runner.start(workspace, { provider: "codex", executablePath: executable, prompt: "active", maxRuntimeMs: 5_000 });
    const scheduled = await runner.start(workspace, { provider: "codex", executablePath: executable, prompt: "scheduled", maxRuntimeMs: 5_000, provenance: { routineId: crypto.randomUUID(), trigger: "scheduled", skillBundleDigest: "a".repeat(64), contextManifestDigest: "b".repeat(64) } });
    const interactive = await runner.start(workspace, { provider: "codex", executablePath: executable, prompt: "interactive", maxRuntimeMs: 5_000 });
    expect((await runner.list(workspace)).filter(({ status }) => status === "running")).toHaveLength(1);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const states = await runner.list(workspace);
      if (states.every(({ status }) => ["completed", "failed", "cancelled", "interrupted"].includes(status))) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect((await runner.list(workspace)).filter(({ status }) => status === "completed").map(({ id }) => id).sort()).toEqual([active.id, scheduled.id, interactive.id].sort());
    expect((await readFile(orderPath, "utf8")).trim().split("\n")).toEqual(["active", "interactive", "scheduled"]);
  });
});
