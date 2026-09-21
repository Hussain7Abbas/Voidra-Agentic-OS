import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceDatabase } from "../../src/service/database";
import { AgentTaskManager } from "../../src/service/agents";
import { ManualHandoffManager } from "../../src/service/handoffs";
import { InstructionResolver } from "../../src/service/instructions";
import { KnowledgeManager } from "../../src/service/knowledge";
import { NoteCoordinator } from "../../src/service/notes";
import { PlannerScheduler, nextDailyOccurrence, resolveLocalOccurrence } from "../../src/service/planner";
import { WorkspaceManager } from "../../src/service/workspaces";
import { HeadlessRunner } from "../../src/service/headless";

const temporaryDirectories: string[] = [];

async function fixture(notify = vi.fn()) {
  const directory = await mkdtemp(join(tmpdir(), "voidra-planner-")); temporaryDirectories.push(directory);
  const database = new ServiceDatabase(join(directory, "state.sqlite"));
  const workspaces = new WorkspaceManager(database); const notes = new NoteCoordinator(); const knowledge = new KnowledgeManager(database, notes); const instructions = new InstructionResolver();
  const workRoot = join(directory, "Work"); const personalRoot = join(directory, "Personal"); await Promise.all([mkdir(workRoot), mkdir(personalRoot)]);
  const work = await workspaces.create("Work", workRoot); const personal = await workspaces.create("Personal", personalRoot);
  const handoffs = new ManualHandoffManager(workspaces, instructions, knowledge);
  const agentTasks: Array<{ id: string; status: string }> = [];
  const start = vi.fn().mockImplementation(async () => { const task = { id: crypto.randomUUID(), status: "running" }; agentTasks.push(task); return task; });
  const agents = { start, list: vi.fn().mockImplementation(async () => ({ tasks: agentTasks, grants: [] })) } as unknown as AgentTaskManager;
  const headless = new HeadlessRunner();
  const planner = new PlannerScheduler(handoffs, agents, knowledge, notify, headless);
  const close = () => { notes.close(); database.close(); };
  return { directory, database, workspaces, work, personal, notes, knowledge, handoffs, planner, headless, start, agentTasks, notify, close };
}

afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("planner timezone policy", () => {
  it("shifts daylight-saving gaps forward and chooses the first duplicate", () => {
    expect(resolveLocalOccurrence("2026-03-08", "02:30", "America/New_York").toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(resolveLocalOccurrence("2026-11-01", "01:30", "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(resolveLocalOccurrence("2028-02-29", "08:00", "UTC").toISOString()).toBe("2028-02-29T08:00:00.000Z");
    expect(nextDailyOccurrence(new Date("2026-11-01T05:45:00.000Z"), "01:30", "America/New_York").toISOString()).toBe("2026-11-02T06:30:00.000Z");
    expect(() => resolveLocalOccurrence("bad", "08:00", "UTC")).toThrow("valid local date");
  });
});

describe("PlannerScheduler", () => {
  it("seeds Plan the Day and generates an editable sourced local plan without inference", async () => {
    const { work, personal, notes, handoffs, planner, start, close } = await fixture();
    const initial = await planner.list(work);
    expect(initial.defaultRoutine).toMatchObject({ name: "Plan the Day", client: "codex" });
    expect(await handoffs.listSkills(work)).toEqual([expect.objectContaining({ name: "Plan the Day" })]);
    expect((await planner.list(personal)).tasks).toEqual([]);
    await planner.addTask(work, { title: "Overdue report", dueDate: "2026-09-19" });
    await planner.addTask(work, { title: "Optional reading", optional: true });
    const planningNote = await (await notes.forWorkspace(work)).create("Goals.md", "# Goal\n\nShip the planner safely.");
    const plan = await planner.generateLocal(work, {
      date: "2026-09-20", timezone: "Asia/Baghdad", availability: { start: "09:00", end: "17:00" }, unavailableSources: ["Personal calendar"],
      events: [
        { sourceId: "calendar:event-a", title: "Planning review", start: "2026-09-20T07:00:00.000Z", end: "2026-09-20T08:00:00.000Z" },
        { sourceId: "calendar:event-b", title: "Overlapping call", start: "2026-09-20T07:30:00.000Z", end: "2026-09-20T08:30:00.000Z" },
        { sourceId: "calendar:holiday", title: "Company day", start: "2026-09-19T21:00:00.000Z", end: "2026-09-20T21:00:00.000Z", allDay: true, recurringId: "series:holiday" },
      ],
      sources: [{ baseId: "private", documentId: planningNote.id }],
    });
    expect(plan.markdown).toContain("## Hard commitments"); expect(plan.markdown).toContain("calendar:event-a"); expect(plan.markdown).toContain("overdue from 2026-09-19"); expect(plan.markdown).toContain("Personal calendar is unavailable");
    expect(plan.markdown).toContain("recurrence `series:holiday`");
    expect(plan.conflicts).toEqual(expect.arrayContaining([expect.stringContaining("overlaps")]));
    expect(plan.sources).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "knowledge", label: "Work / Goals.md" })]));
    expect(start).not.toHaveBeenCalled();
    expect(await readFile(join(work.canonicalPath, "Daily Plans", "2026-09-20.md"), "utf8")).toBe(plan.markdown);
    const originalRevision = plan.revision;
    const saved = await planner.savePlan(work, plan.id, `${plan.markdown}\nUser edit.\n`, originalRevision);
    expect(saved.markdown).toContain("User edit");
    await expect(planner.savePlan(work, plan.id, "stale", originalRevision)).rejects.toMatchObject({ code: "SCHEDULE_STATE_CONFLICT" });
    expect((await planner.list(personal)).plans).toEqual([]);
    close();
  });

  it("prepares manual planning without clipboard or model use and starts explicit automatic planning", async () => {
    const { work, planner, start, close } = await fixture();
    await planner.addTask(work, { title: "Local priority", dueDate: "2026-09-20" });
    const manual = await planner.prepareManual(work, { date: "2026-09-20", timezone: "UTC", availability: null, unavailableSources: ["Calendar"] });
    expect(manual).toMatchObject({ trigger: "manual", status: "ready-to-copy", copiedAt: null });
    expect(manual.prompt).toContain("Local priority"); expect(start).not.toHaveBeenCalled();
    const automatic = await planner.generateAutomatic(work, { date: "2026-09-20", timezone: "UTC", model: "fixture/model" });
    expect(automatic.id).toEqual(expect.any(String));
    expect(start).toHaveBeenCalledWith(work, expect.objectContaining({ model: "fixture/model", targetPaths: ["Daily Plans"] }));
    close();
  });

  it("claims one occurrence before dispatch across racing ticks and restart", async () => {
    const { work, handoffs, knowledge, planner, notify, close } = await fixture();
    const compile = vi.spyOn(handoffs, "compile");
    const created = await planner.createSchedule(work, { name: "Morning plan", mode: "manual", objective: "Prepare today", localTime: "08:00", timezone: "UTC", missedPolicy: "run-once" }, new Date("2026-09-20T07:00:00.000Z"));
    const [first, second] = await Promise.all([planner.tick([work], new Date("2026-09-20T08:01:00.000Z")), planner.tick([work], new Date("2026-09-20T08:01:00.000Z"))]);
    expect([...first, ...second]).toHaveLength(1); expect(compile).toHaveBeenCalledTimes(1); expect(notify).toHaveBeenCalledTimes(1);
    expect((await planner.list(work)).occurrences).toEqual([expect.objectContaining({ id: `${created.id}:2026-09-20`, state: "ready-to-copy" })]);
    const reopened = new PlannerScheduler(handoffs, { start: vi.fn() } as unknown as AgentTaskManager, knowledge);
    expect(await reopened.tick([work], new Date("2026-09-20T08:01:00.000Z"))).toEqual([]);
    expect((await reopened.list(work)).occurrences).toHaveLength(1);
    close();
  });

  it("dispatches an awake-only headless routine with immutable provenance and follows its terminal state", async () => {
    const { directory, work, handoffs, planner, headless, close } = await fixture();
    const bin = join(directory, "bin"); await mkdir(bin);
    const executable = join(bin, "codex");
    await writeFile(executable, `#!/usr/bin/env node\nif(process.argv.includes("--version")){console.log("codex fixture 1.0");process.exit(0)}let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>console.log(JSON.stringify({type:"result",received:input.length})))\n`);
    await chmod(executable, 0o755);
    const skill = await handoffs.createSkill(work, { name: "Scheduled report", description: "fixture", instructions: "Return a report.", expectedOutput: "a report", inputs: [] });
    const routine = await handoffs.createRoutine(work, { name: "Headless report", skillId: skill.id, client: "codex", preferredModel: "use current client model", outputDirectory: ".", inlineInstructions: "", executionMode: "headless", headlessExecutablePath: executable, headlessAccessMode: "read-only", headlessMaxRuntimeMs: 5_000 });
    const schedule = await planner.createSchedule(work, { name: "Headless daily", mode: "manual", routineId: routine.id, objective: "Prepare the report", localTime: "08:00", timezone: "UTC", missedPolicy: "skip" }, new Date("2026-09-20T07:00:00.000Z"));
    const [claimed] = await planner.tick([work], new Date("2026-09-20T08:01:00.000Z"));
    expect(claimed).toMatchObject({ scheduleId: schedule.id, state: "running" });
    let run = (await headless.list(work))[0]!;
    for (let attempt = 0; attempt < 100 && !["completed", "failed", "cancelled", "interrupted"].includes(run.status); attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 20)); run = (await headless.list(work))[0]!; }
    expect(run).toMatchObject({ status: "completed", provenance: { routineId: routine.id, trigger: "scheduled", skillBundleDigest: skill.currentDigest } });
    expect(run.provenance?.contextManifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect((await planner.list(work)).occurrences.find(({ scheduleId }) => scheduleId === schedule.id)?.state).toBe("completed");
    expect(await handoffs.listRuns(work)).toEqual([]);
    close();
  });

  it("applies missed-run policies, owns automatic runs by workspace, and clears disabled next runs", async () => {
    const { work, personal, planner, start, agentTasks, close } = await fixture();
    const base = new Date("2026-09-18T07:00:00.000Z");
    const runOnce = await planner.createSchedule(work, { name: "Catch up", mode: "automatic", model: "fixture/model", objective: "Run", localTime: "08:00", timezone: "UTC", missedPolicy: "run-once" }, base);
    await planner.createSchedule(work, { name: "Skip", mode: "manual", objective: "Skip", localTime: "08:00", timezone: "UTC", missedPolicy: "skip" }, base);
    await planner.createSchedule(work, { name: "Review", mode: "manual", objective: "Review", localTime: "08:00", timezone: "UTC", missedPolicy: "review" }, base);
    const occurrences = await planner.tick([work], new Date("2026-09-20T09:00:00.000Z"));
    expect(occurrences.map(({ state }) => state).sort()).toEqual(["needs-review", "running", "skipped"]);
    expect(start).toHaveBeenCalledWith(work, expect.objectContaining({ objective: "Run" }));
    expect((await planner.list(work)).occurrences).toEqual(expect.arrayContaining([expect.objectContaining({ scheduleId: runOnce.id, state: "running" })]));
    agentTasks[0]!.status = "completed";
    expect((await planner.list(work)).occurrences).toEqual(expect.arrayContaining([expect.objectContaining({ scheduleId: runOnce.id, state: "completed" })]));
    expect((await planner.list(personal)).occurrences).toEqual([]);
    expect((await planner.setScheduleEnabled(work, runOnce.id, false)).nextOccurrence).toBeNull();
    const nextDay = await planner.tick([work], new Date("2026-09-21T09:00:00.000Z"));
    expect(nextDay).toHaveLength(2);
    expect(nextDay.some(({ scheduleId }) => scheduleId === runOnce.id)).toBe(false);
    close();
  });

  it("validates input and fails visibly on corrupt state", async () => {
    const { work, handoffs, knowledge, planner, close } = await fixture();
    await expect(planner.addTask(work, { title: "Bad", dueDate: "tomorrow" })).rejects.toMatchObject({ code: "SCHEDULE_STATE_CONFLICT" });
    await expect(planner.generateLocal(work, { date: "bad", timezone: "UTC" })).rejects.toMatchObject({ code: "SCHEDULE_STATE_CONFLICT" });
    await expect(planner.generateLocal(work, { date: "2026-09-20", timezone: "Invalid/Zone" })).rejects.toMatchObject({ code: "SCHEDULE_STATE_CONFLICT" });
    await expect(planner.generateLocal(work, { date: "2026-09-20", timezone: "UTC", availability: { start: "17:00", end: "09:00" } })).rejects.toMatchObject({ code: "SCHEDULE_STATE_CONFLICT" });
    await expect(planner.generateLocal(work, { date: "2026-09-20", timezone: "UTC", events: [{ sourceId: "", title: "Bad", start: "2026-09-20T09:00:00.000Z", end: "2026-09-20T08:00:00.000Z" }] })).rejects.toMatchObject({ code: "SCHEDULE_STATE_CONFLICT" });
    const empty = await planner.generateLocal(work, { date: "2026-09-20", timezone: "UTC" });
    expect(empty.markdown).toContain("Availability was not supplied"); expect(empty.markdown).toContain("- None supplied.");
    await expect(planner.savePlan(work, crypto.randomUUID(), "missing", "0".repeat(64))).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await planner.addTask(work, { title: "Due today", dueDate: "2026-09-21" });
    await planner.addTask(work, { title: "Won't fit" });
    const constrained = await planner.generateLocal(work, { date: "2026-09-21", timezone: "UTC", availability: { start: "09:00", end: "10:30" }, events: [{ sourceId: "crossing", title: "Crossing event", start: "2026-09-20T23:30:00.000Z", end: "2026-09-21T00:30:00.000Z" }, { sourceId: "busy", title: "Morning event", start: "2026-09-21T09:00:00.000Z", end: "2026-09-21T10:00:00.000Z" }] });
    expect(constrained.markdown).toContain("due today"); expect(constrained.markdown).toContain("crossing");
    await expect(planner.createSchedule(work, { name: "Bad", mode: "automatic", objective: "x", localTime: "25:00", timezone: "UTC", missedPolicy: "skip" })).rejects.toMatchObject({ code: "SCHEDULE_STATE_CONFLICT" });
    await expect(planner.createSchedule(work, { name: "No model", mode: "automatic", objective: "x", localTime: "08:00", timezone: "UTC", missedPolicy: "skip" })).rejects.toMatchObject({ code: "SCHEDULE_STATE_CONFLICT" });
    await expect(planner.createSchedule(work, { name: "Missing routine", mode: "manual", routineId: crypto.randomUUID(), objective: "x", localTime: "08:00", timezone: "UTC", missedPolicy: "skip" })).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    const defaultRoutine = (await planner.list(work)).defaultRoutine;
    const explicit = await planner.createSchedule(work, { name: "Explicit", mode: "manual", routineId: defaultRoutine.id, objective: "x", localTime: "08:00", timezone: "UTC", missedPolicy: "skip", enabled: false }, new Date("2026-09-20T07:00:00.000Z"));
    expect(explicit.nextOccurrence).toBeNull();
    expect((await planner.setScheduleEnabled(work, explicit.id, true, new Date("2026-09-20T07:00:00.000Z"))).nextOccurrence).toBe("2026-09-20T08:00:00.000Z");
    await expect(planner.setScheduleEnabled(work, crypto.randomUUID(), true)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    const editable = await planner.createSchedule(work, { name: "Editable", mode: "manual", objective: "First", localTime: "08:00", timezone: "UTC", missedPolicy: "skip" }, new Date("2026-09-20T07:00:00.000Z"));
    expect(await planner.updateSchedule(work, editable.id, { name: "Edited", mode: "automatic", model: "fixture/model", objective: "Second", localTime: "09:30", timezone: "Asia/Baghdad", missedPolicy: "review" }, new Date("2026-09-20T07:00:00.000Z"))).toMatchObject({ name: "Edited", mode: "automatic", timezone: "Asia/Baghdad", nextOccurrence: "2026-09-21T06:30:00.000Z" });
    await expect(planner.updateSchedule(work, editable.id, { name: "Bad", mode: "automatic", model: null, objective: "x", localTime: "09:30", timezone: "UTC", missedPolicy: "skip" })).rejects.toMatchObject({ code: "SCHEDULE_STATE_CONFLICT" });
    await expect(planner.updateSchedule(work, crypto.randomUUID(), { name: "Missing", mode: "manual", routineId: defaultRoutine.id, objective: "x", localTime: "09:30", timezone: "UTC", missedPolicy: "skip" })).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    expect(await planner.removeSchedule(work, editable.id)).toEqual({ removed: true });
    await expect(planner.removeSchedule(work, editable.id)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await writeFile(join(work.canonicalPath, ".voidra", "planner.json"), "corrupt");
    const reopened = new PlannerScheduler(handoffs, { start: vi.fn() } as unknown as AgentTaskManager, knowledge);
    await expect(reopened.list(work)).rejects.toMatchObject({ code: "INCOMPATIBLE_SCHEMA" });
    close();
  });

  it("follows manual and automatic terminal run states", async () => {
    const { work, handoffs, planner, agentTasks, close } = await fixture();
    const now = new Date("2026-09-20T07:00:00.000Z");
    const manual = await planner.createSchedule(work, { name: "Manual", mode: "manual", objective: "draft", localTime: "08:00", timezone: "UTC", missedPolicy: "skip" }, now);
    const autos = await Promise.all(["Cancelled", "Failed", "Interrupted"].map((name) => planner.createSchedule(work, { name, mode: "automatic", model: "fixture/model", objective: name, localTime: "08:00", timezone: "UTC", missedPolicy: "skip" }, now)));
    await planner.tick([work], new Date("2026-09-20T08:01:00.000Z"));
    const manualOccurrence = (await planner.list(work)).occurrences.find(({ scheduleId }) => scheduleId === manual.id)!;
    await handoffs.markCopied(work, manualOccurrence.dispatchId!);
    expect((await planner.list(work)).occurrences.find(({ scheduleId }) => scheduleId === manual.id)?.state).toBe("awaiting-result");
    await handoffs.cancel(work, manualOccurrence.dispatchId!);
    agentTasks[0]!.status = "cancelled"; agentTasks[1]!.status = "failed"; agentTasks[2]!.status = "interrupted";
    const states = await planner.list(work);
    expect(states.occurrences.find(({ scheduleId }) => scheduleId === manual.id)?.state).toBe("cancelled");
    expect(states.occurrences.filter(({ scheduleId }) => autos.some(({ id }) => id === scheduleId)).map(({ state }) => state).sort()).toEqual(["cancelled", "failed", "interrupted"]);
    close();
  });
});
