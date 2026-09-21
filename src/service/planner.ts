import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { z } from "zod";
import type { WorkspaceRecord } from "./database";
import type { AgentTaskManager } from "./agents";
import type { ManualHandoffManager } from "./handoffs";
import type { KnowledgeManager } from "./knowledge";
import type { HeadlessRunner } from "./headless";
import type { OutputCatalogManager } from "./output-catalog";
import { DomainError } from "./workspaces";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const taskSchema = z.object({
  id: z.uuid(), workspaceId: z.uuid(), title: z.string(), dueDate: z.string().nullable(), optional: z.boolean(), completed: z.boolean(), sourceId: z.string(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
const sourceSchema = z.object({ id: z.string(), kind: z.enum(["local-task", "calendar-event", "knowledge", "availability", "unavailable-integration"]), label: z.string() }).strict();
const planSchema = z.object({
  id: z.uuid(), workspaceId: z.uuid(), date: z.string(), timezone: z.string(), markdown: z.string(), revision: z.string(), sources: z.array(sourceSchema), conflicts: z.array(z.string()), mode: z.enum(["local", "automatic"]), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
const scheduleSchema = z.object({
  id: z.uuid(), workspaceId: z.uuid(), name: z.string(), mode: z.enum(["manual", "automatic"]), routineId: z.uuid().nullable(), routineVersionPolicy: z.literal("pinned"), model: z.string().nullable(), objective: z.string(), localTime: z.string(), timezone: z.string(), missedPolicy: z.enum(["skip", "run-once", "review"]), enabled: z.boolean(), nextOccurrence: z.iso.datetime().nullable(), lastOccurrenceId: z.string().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
const occurrenceSchema = z.object({
  id: z.string(), scheduleId: z.uuid(), workspaceId: z.uuid(), localDate: z.string(), scheduledFor: z.iso.datetime(), state: z.enum(["claimed", "dispatched", "ready-to-copy", "awaiting-result", "result-under-review", "running", "completed", "cancelled", "interrupted", "skipped", "needs-review", "failed"]), dispatchId: z.string().nullable(), notificationKey: z.string(), diagnostic: z.string().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
const registrySchema = z.object({ schemaVersion: z.literal(1), tasks: z.array(taskSchema), plans: z.array(planSchema), schedules: z.array(scheduleSchema), occurrences: z.array(occurrenceSchema) }).strict();
type Registry = z.infer<typeof registrySchema>;
type Task = z.infer<typeof taskSchema>;
type Schedule = z.infer<typeof scheduleSchema>;

export type PlanningEvent = { sourceId: string; title: string; start: string; end: string; allDay?: boolean; recurringId?: string };
export type PlanningInput = { date: string; timezone: string; availability?: { start: string; end: string } | null; events?: PlanningEvent[]; unavailableSources?: string[]; sources?: Array<{ baseId: string; documentId: string }> };

function json(value: unknown) { return `${JSON.stringify(value, null, 2)}\n`; }
function revision(value: string) { return createHash("sha256").update(value).digest("hex"); }
function pad(value: number) { return String(value).padStart(2, "0"); }

async function atomicWrite(path: string, content: string) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try { await rename(temporary, path); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

function formatter(timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } catch { throw new DomainError("SCHEDULE_STATE_CONFLICT", "The schedule timezone is not supported."); }
}

function civilParts(instant: Date, timezone: string) {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(instant).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, Number(value)]));
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, minute: parts.minute!, second: parts.second! };
}

function civilKey(parts: { year: number; month: number; day: number; hour?: number; minute?: number }) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}${parts.hour === undefined ? "" : `T${pad(parts.hour)}:${pad(parts.minute ?? 0)}`}`;
}

export function localDateAt(instant: Date, timezone: string) {
  const parts = civilParts(instant, timezone);
  return civilKey(parts).slice(0, 10);
}

function addCivilDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function resolveLocalOccurrence(date: string, time: string, timezone: string) {
  if (!datePattern.test(date) || !timePattern.test(time)) throw new DomainError("SCHEDULE_STATE_CONFLICT", "Use a valid local date and 24-hour time.");
  formatter(timezone);
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = `${date}T${time}`;
  const center = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const exact: Date[] = [];
  let firstAfter: Date | null = null;
  for (let offset = -18 * 60; offset <= 18 * 60; offset += 1) {
    const candidate = new Date(center + offset * 60_000);
    const parts = civilParts(candidate, timezone);
    const key = civilKey(parts);
    if (key === target) exact.push(candidate);
    if (!firstAfter && key > target && key.slice(0, 10) === date) firstAfter = candidate;
  }
  if (exact.length) return exact.sort((a, b) => a.getTime() - b.getTime())[0]!;
  if (firstAfter) return firstAfter;
  throw new DomainError("SCHEDULE_STATE_CONFLICT", "The local occurrence could not be resolved in this timezone.");
}

export function nextDailyOccurrence(after: Date, localTime: string, timezone: string) {
  let date = localDateAt(after, timezone);
  for (let attempt = 0; attempt < 370; attempt += 1) {
    const candidate = resolveLocalOccurrence(date, localTime, timezone);
    if (candidate.getTime() > after.getTime()) return candidate;
    date = addCivilDays(date, 1);
  }
  throw new DomainError("SCHEDULE_STATE_CONFLICT", "The next schedule occurrence could not be calculated.");
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}

function displayTime(instant: string, timezone: string) {
  const parts = civilParts(new Date(instant), timezone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

function normalizeInput(input: PlanningInput) {
  if (!datePattern.test(input.date)) throw new DomainError("SCHEDULE_STATE_CONFLICT", "The plan date must use YYYY-MM-DD.");
  formatter(input.timezone);
  if (input.availability && (!timePattern.test(input.availability.start) || !timePattern.test(input.availability.end) || minutes(input.availability.start) >= minutes(input.availability.end))) throw new DomainError("SCHEDULE_STATE_CONFLICT", "Availability must be a valid increasing local time window.");
  const events = (input.events ?? []).map((event) => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (!event.sourceId.trim() || !event.title.trim() || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new DomainError("SCHEDULE_STATE_CONFLICT", "Calendar events require source IDs and a valid time range.");
    return { ...event, title: event.title.trim(), sourceId: event.sourceId.trim(), allDay: Boolean(event.allDay), start: start.toISOString(), end: end.toISOString() };
  });
  return { ...input, events, unavailableSources: [...new Set(input.unavailableSources ?? [])] };
}

export class PlannerScheduler {
  readonly #registries = new Map<string, Registry>();
  readonly #registryLoads = new Map<string, Promise<Registry>>();
  readonly #saveQueues = new Map<string, Promise<void>>();
  #tickQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly handoffs: ManualHandoffManager, private readonly agents: AgentTaskManager, private readonly knowledge: KnowledgeManager, private readonly notify: (workspaceId: string, payload: Record<string, unknown>) => void = () => undefined, private readonly headless?: HeadlessRunner, private readonly outputs?: OutputCatalogManager) {}

  async list(workspace: WorkspaceRecord) {
    const routine = await this.handoffs.ensurePlanTheDay(workspace);
    const registry = await this.#registry(workspace);
    await this.#syncRunStates(workspace, registry);
    return { defaultRoutine: routine, tasks: registry.tasks, plans: [...registry.plans].sort((a, b) => b.date.localeCompare(a.date)), schedules: registry.schedules, occurrences: [...registry.occurrences].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }

  async addTask(workspace: WorkspaceRecord, input: { title: string; dueDate?: string | null; optional?: boolean }) {
    if (input.dueDate && !datePattern.test(input.dueDate)) throw new DomainError("SCHEDULE_STATE_CONFLICT", "Task due dates must use YYYY-MM-DD.");
    const registry = await this.#registry(workspace);
    const now = new Date().toISOString();
    const task: Task = { id: randomUUID(), workspaceId: workspace.id, title: input.title.trim(), dueDate: input.dueDate ?? null, optional: input.optional ?? false, completed: false, sourceId: `local-task:${randomUUID()}`, createdAt: now, updatedAt: now };
    registry.tasks.push(task);
    await this.#save(workspace, registry);
    return task;
  }

  async updateTask(workspace: WorkspaceRecord, taskId: string, input: { title?: string; dueDate?: string | null; optional?: boolean; completed?: boolean }) {
    if (input.dueDate && !datePattern.test(input.dueDate)) throw new DomainError("SCHEDULE_STATE_CONFLICT", "Task due dates must use YYYY-MM-DD.");
    const registry = await this.#registry(workspace);
    const task = registry.tasks.find(({ id, workspaceId }) => id === taskId && workspaceId === workspace.id);
    if (!task) throw new DomainError("WORKSPACE_CONFLICT", "The local task does not exist in this workspace.");
    if (input.title !== undefined) task.title = input.title.trim();
    if (input.dueDate !== undefined) task.dueDate = input.dueDate;
    if (input.optional !== undefined) task.optional = input.optional;
    if (input.completed !== undefined) task.completed = input.completed;
    task.updatedAt = new Date().toISOString();
    await this.#save(workspace, registry);
    return task;
  }

  async removeTask(workspace: WorkspaceRecord, taskId: string) {
    const registry = await this.#registry(workspace);
    const count = registry.tasks.length;
    registry.tasks = registry.tasks.filter(({ id, workspaceId }) => id !== taskId || workspaceId !== workspace.id);
    if (registry.tasks.length === count) throw new DomainError("WORKSPACE_CONFLICT", "The local task does not exist in this workspace.");
    await this.#save(workspace, registry);
    return { removed: true };
  }

  async generateLocal(workspace: WorkspaceRecord, raw: PlanningInput) {
    const input = normalizeInput(raw);
    const registry = await this.#registry(workspace);
    const tasks = registry.tasks.filter(({ completed }) => !completed).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.createdAt.localeCompare(b.createdAt));
    const knowledgeSources = [];
    for (const source of input.sources ?? []) {
      const document = await this.knowledge.read(workspace, source.baseId, source.documentId);
      knowledgeSources.push({ id: `${source.baseId}:${source.documentId}`, kind: "knowledge" as const, label: `${document.baseName} / ${document.path}` });
    }
    const events = input.events.filter(({ start, end, allDay }) => allDay || localDateAt(new Date(start), input.timezone) === input.date || localDateAt(new Date(end), input.timezone) === input.date);
    const timed = events.filter(({ allDay }) => !allDay).sort((a, b) => a.start.localeCompare(b.start));
    const conflicts: string[] = [];
    for (let index = 1; index < timed.length; index += 1) if (new Date(timed[index - 1]!.end) > new Date(timed[index]!.start)) conflicts.push(`${timed[index - 1]!.sourceId} overlaps ${timed[index]!.sourceId}`);
    const deadlines = tasks.filter(({ dueDate }) => dueDate && dueDate <= input.date);
    const optional = tasks.filter((task) => task.optional && !deadlines.includes(task));
    const priorities = tasks.filter((task) => !task.optional && !deadlines.includes(task));
    const suggested: Array<{ time: string; title: string; sourceId: string }> = [];
    if (input.availability) {
      let cursor = minutes(input.availability.start);
      const busy = timed.map((event) => ({ start: minutes(displayTime(event.start, input.timezone)), end: minutes(displayTime(event.end, input.timezone)) })).sort((a, b) => a.start - b.start);
      for (const task of [...deadlines, ...priorities]) {
        while (busy.some((slot) => cursor >= slot.start && cursor < slot.end)) cursor = Math.max(cursor, ...busy.filter((slot) => cursor >= slot.start && cursor < slot.end).map((slot) => slot.end));
        if (cursor + 60 > minutes(input.availability.end)) break;
        const hour = Math.floor(cursor / 60); const minute = cursor % 60;
        suggested.push({ time: `${pad(hour)}:${pad(minute)}`, title: task.title, sourceId: task.sourceId });
        cursor += 60;
      }
    }
    const sourceLines = [
      ...tasks.map((task) => ({ id: task.sourceId, kind: "local-task" as const, label: task.title })),
      ...events.map((event) => ({ id: event.sourceId, kind: "calendar-event" as const, label: event.title })),
      ...knowledgeSources,
      ...(input.availability ? [{ id: `availability:${input.date}:${input.timezone}`, kind: "availability" as const, label: `${input.availability.start}–${input.availability.end} ${input.timezone}` }] : []),
      ...input.unavailableSources.map((label) => ({ id: `unavailable:${label}`, kind: "unavailable-integration" as const, label })),
    ];
    const bullet = (items: string[]) => items.length ? items.map((item) => `- ${item}`).join("\n") : "- None supplied.";
    const markdown = `# Plan for ${input.date}\n\n_Timezone: ${input.timezone}_\n\n## Hard commitments\n\n${bullet(events.map((event) => `${event.allDay ? `${event.title} (all day)` : `${displayTime(event.start, input.timezone)}–${displayTime(event.end, input.timezone)} ${event.title}`} — source \`${event.sourceId}\`${event.recurringId ? ` · recurrence \`${event.recurringId}\`` : ""}`))}\n\n## Deadlines and overdue tasks\n\n${bullet(deadlines.map((task) => `${task.title} (${task.dueDate === input.date ? "due today" : `overdue from ${task.dueDate}`}) — source \`${task.sourceId}\``))}\n\n## Suggested blocks\n\n${input.availability ? bullet(suggested.map((block) => `${block.time}–${pad((minutes(block.time) + 60) / 60 | 0)}:${pad((minutes(block.time) + 60) % 60)} ${block.title} — source \`${block.sourceId}\``)) : "- Availability was not supplied; no time blocks were invented."}\n\n## Optional tasks\n\n${bullet(optional.map((task) => `${task.title} — source \`${task.sourceId}\``))}\n\n## Sources\n\n${bullet(sourceLines.map((source) => `\`${source.id}\` — ${source.kind}: ${source.label}`))}\n\n## Unresolved conflicts\n\n${bullet([...conflicts, ...input.unavailableSources.map((source) => `${source} is unavailable; its commitments were not included.`)])}\n`;
    const now = new Date().toISOString();
    const prior = registry.plans.find((plan) => plan.date === input.date);
    const plan = { id: prior?.id ?? randomUUID(), workspaceId: workspace.id, date: input.date, timezone: input.timezone, markdown, revision: revision(markdown), sources: sourceLines, conflicts: [...conflicts, ...input.unavailableSources], mode: "local" as const, createdAt: prior?.createdAt ?? now, updatedAt: now };
    registry.plans = registry.plans.filter(({ date }) => date !== input.date);
    registry.plans.push(plan);
    await this.#save(workspace, registry);
    await atomicWrite(join(workspace.canonicalPath, "Daily Plans", `${input.date}.md`), markdown);
    await this.outputs?.registerPath(workspace, { path: posix.join("Daily Plans", `${input.date}.md`), runId: plan.id, provider: "local-deterministic", title: `Plan for ${input.date}`, tags: ["plan-the-day", "local"] });
    return plan;
  }

  async savePlan(workspace: WorkspaceRecord, planId: string, markdown: string, expectedRevision: string) {
    const registry = await this.#registry(workspace);
    const plan = registry.plans.find(({ id, workspaceId }) => id === planId && workspaceId === workspace.id);
    if (!plan) throw new DomainError("WORKSPACE_CONFLICT", "The daily plan does not exist in this workspace.");
    if (plan.revision !== expectedRevision) throw new DomainError("SCHEDULE_STATE_CONFLICT", "The daily plan changed after it was opened. Reload before saving.");
    plan.markdown = markdown;
    plan.revision = revision(markdown);
    plan.updatedAt = new Date().toISOString();
    await this.#save(workspace, registry);
    await atomicWrite(join(workspace.canonicalPath, "Daily Plans", `${plan.date}.md`), markdown);
    await this.outputs?.registerPath(workspace, { path: posix.join("Daily Plans", `${plan.date}.md`), runId: plan.id, provider: "local-deterministic", title: `Plan for ${plan.date}`, tags: ["plan-the-day", "local", "edited"] });
    return plan;
  }

  async prepareManual(workspace: WorkspaceRecord, input: PlanningInput) {
    const normalized = normalizeInput(input);
    const routine = await this.handoffs.ensurePlanTheDay(workspace);
    const registry = await this.#registry(workspace);
    const tasks = registry.tasks.filter(({ completed }) => !completed).map(({ sourceId, title, dueDate, optional }) => ({ sourceId, title, dueDate, optional }));
    return this.handoffs.compile(workspace, { routineId: routine.id, objective: `Plan ${normalized.date} in ${normalized.timezone}. Local tasks: ${JSON.stringify(tasks)}. Availability: ${JSON.stringify(normalized.availability ?? null)}. Calendar commitments: ${JSON.stringify(normalized.events)}. Unavailable sources: ${JSON.stringify(normalized.unavailableSources)}.`, targetPaths: ["Daily Plans"], sources: normalized.sources ?? [], trigger: "manual" });
  }

  async generateAutomatic(workspace: WorkspaceRecord, input: PlanningInput & { model: string }) {
    const normalized = normalizeInput(input);
    await this.handoffs.ensurePlanTheDay(workspace);
    const registry = await this.#registry(workspace);
    const tasks = registry.tasks.filter(({ completed }) => !completed).map(({ sourceId, title, dueDate, optional }) => ({ sourceId, title, dueDate, optional }));
    return this.agents.start(workspace, { objective: `Create an editable sourced Markdown plan for ${normalized.date} (${normalized.timezone}) at Daily Plans/${normalized.date}.md. Separate hard commitments, deadlines, suggested blocks, optional tasks, sources, and unresolved conflicts. Never invent availability or calendar details. Local tasks: ${JSON.stringify(tasks)}. Availability: ${JSON.stringify(normalized.availability ?? null)}. Calendar commitments: ${JSON.stringify(normalized.events)}. Unavailable sources: ${JSON.stringify(normalized.unavailableSources)}.`, model: input.model, maxSteps: 8, maxTokens: 50_000, maxRuntimeMs: 300_000, targetPaths: ["Daily Plans"], sources: normalized.sources ?? [] });
  }

  async createSchedule(workspace: WorkspaceRecord, input: { name: string; mode: "manual" | "automatic"; routineId?: string | null; model?: string | null; objective: string; localTime: string; timezone: string; missedPolicy: "skip" | "run-once" | "review"; enabled?: boolean }, now = new Date()) {
    if (!timePattern.test(input.localTime)) throw new DomainError("SCHEDULE_STATE_CONFLICT", "Schedule time must use 24-hour HH:mm.");
    const routine = input.mode === "manual" ? input.routineId ? (await this.handoffs.listRoutines(workspace)).find(({ id }) => id === input.routineId) : await this.handoffs.ensurePlanTheDay(workspace) : null;
    if (input.mode === "manual" && !routine) throw new DomainError("WORKSPACE_CONFLICT", "The scheduled routine does not exist in this workspace.");
    if (input.mode === "automatic" && !input.model?.trim()) throw new DomainError("SCHEDULE_STATE_CONFLICT", "Automatic schedules require an explicit model.");
    const registry = await this.#registry(workspace);
    const createdAt = now.toISOString();
    const enabled = input.enabled ?? true;
    const schedule: Schedule = { id: randomUUID(), workspaceId: workspace.id, name: input.name.trim(), mode: input.mode, routineId: routine?.id ?? null, routineVersionPolicy: "pinned", model: input.mode === "automatic" ? input.model!.trim() : null, objective: input.objective.trim(), localTime: input.localTime, timezone: input.timezone, missedPolicy: input.missedPolicy, enabled, nextOccurrence: enabled ? nextDailyOccurrence(now, input.localTime, input.timezone).toISOString() : null, lastOccurrenceId: null, createdAt, updatedAt: createdAt };
    registry.schedules.push(schedule);
    await this.#save(workspace, registry);
    return schedule;
  }

  async setScheduleEnabled(workspace: WorkspaceRecord, scheduleId: string, enabled: boolean, now = new Date()) {
    const registry = await this.#registry(workspace);
    const schedule = registry.schedules.find(({ id, workspaceId }) => id === scheduleId && workspaceId === workspace.id);
    if (!schedule) throw new DomainError("WORKSPACE_CONFLICT", "The schedule does not exist in this workspace.");
    schedule.enabled = enabled;
    schedule.nextOccurrence = enabled ? nextDailyOccurrence(now, schedule.localTime, schedule.timezone).toISOString() : null;
    schedule.updatedAt = now.toISOString();
    await this.#save(workspace, registry);
    return schedule;
  }

  async updateSchedule(workspace: WorkspaceRecord, scheduleId: string, input: { name: string; mode: "manual" | "automatic"; routineId?: string | null; model?: string | null; objective: string; localTime: string; timezone: string; missedPolicy: "skip" | "run-once" | "review" }, now = new Date()) {
    if (!timePattern.test(input.localTime)) throw new DomainError("SCHEDULE_STATE_CONFLICT", "Schedule time must use 24-hour HH:mm.");
    const routine = input.mode === "manual" ? input.routineId ? (await this.handoffs.listRoutines(workspace)).find(({ id }) => id === input.routineId) : await this.handoffs.ensurePlanTheDay(workspace) : null;
    if (input.mode === "manual" && !routine) throw new DomainError("WORKSPACE_CONFLICT", "The scheduled routine does not exist in this workspace.");
    if (input.mode === "automatic" && !input.model?.trim()) throw new DomainError("SCHEDULE_STATE_CONFLICT", "Automatic schedules require an explicit model.");
    const registry = await this.#registry(workspace);
    const schedule = registry.schedules.find(({ id, workspaceId }) => id === scheduleId && workspaceId === workspace.id);
    if (!schedule) throw new DomainError("WORKSPACE_CONFLICT", "The schedule does not exist in this workspace.");
    Object.assign(schedule, { name: input.name.trim(), mode: input.mode, routineId: routine?.id ?? null, model: input.mode === "automatic" ? input.model!.trim() : null, objective: input.objective.trim(), localTime: input.localTime, timezone: input.timezone, missedPolicy: input.missedPolicy, nextOccurrence: schedule.enabled ? nextDailyOccurrence(now, input.localTime, input.timezone).toISOString() : null, updatedAt: now.toISOString() });
    await this.#save(workspace, registry);
    return schedule;
  }

  async removeSchedule(workspace: WorkspaceRecord, scheduleId: string) {
    const registry = await this.#registry(workspace);
    const count = registry.schedules.length;
    registry.schedules = registry.schedules.filter(({ id, workspaceId }) => id !== scheduleId || workspaceId !== workspace.id);
    if (count === registry.schedules.length) throw new DomainError("WORKSPACE_CONFLICT", "The schedule does not exist in this workspace.");
    await this.#save(workspace, registry);
    return { removed: true };
  }

  async tick(workspaces: WorkspaceRecord[], now = new Date()) {
    const operation = this.#tickQueue.catch(() => undefined).then(async () => {
      const results = [];
      for (const workspace of workspaces) results.push(...await this.#tickWorkspace(workspace, now));
      return results;
    });
    this.#tickQueue = operation;
    return operation;
  }

  async #tickWorkspace(workspace: WorkspaceRecord, now: Date) {
    const registry = await this.#registry(workspace);
    const due = registry.schedules.filter(({ enabled, nextOccurrence }) => enabled && nextOccurrence && new Date(nextOccurrence) <= now);
    const results = [];
    for (const schedule of due) {
      const scheduledFor = schedule.nextOccurrence!;
      const scheduledDate = localDateAt(new Date(scheduledFor), schedule.timezone);
      const currentDate = localDateAt(now, schedule.timezone);
      const old = scheduledDate < currentDate;
      const localDate = old && schedule.missedPolicy === "run-once" ? currentDate : scheduledDate;
      const id = `${schedule.id}:${localDate}`;
      if (registry.occurrences.some((occurrence) => occurrence.id === id)) {
        schedule.nextOccurrence = nextDailyOccurrence(now, schedule.localTime, schedule.timezone).toISOString();
        schedule.updatedAt = now.toISOString();
        continue;
      }
      const state = old && schedule.missedPolicy === "skip" ? "skipped" : old && schedule.missedPolicy === "review" ? "needs-review" : "claimed";
      const occurrence: z.infer<typeof occurrenceSchema> = { id, scheduleId: schedule.id, workspaceId: workspace.id, localDate, scheduledFor, state, dispatchId: null, notificationKey: id, diagnostic: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
      registry.occurrences.push(occurrence);
      schedule.lastOccurrenceId = id;
      schedule.nextOccurrence = nextDailyOccurrence(now, schedule.localTime, schedule.timezone).toISOString();
      schedule.updatedAt = now.toISOString();
      await this.#save(workspace, registry);
      if (occurrence.state !== "claimed") {
        if (occurrence.state === "needs-review") this.notify(workspace.id, { occurrenceId: occurrence.id, scheduleId: schedule.id, scheduleName: schedule.name, state: occurrence.state, dispatchId: null });
        results.push(occurrence); continue;
      }
      if (!schedule.enabled) { occurrence.state = "skipped"; occurrence.diagnostic = "Schedule was disabled before dispatch."; }
      else {
        try {
          if (schedule.mode === "manual") {
            const routine = (await this.handoffs.listRoutines(workspace)).find(({ id }) => id === schedule.routineId);
            if (!routine) throw new DomainError("WORKSPACE_CONFLICT", "The scheduled routine no longer exists.");
            if (routine.executionMode === "headless") {
              if (!this.headless) throw new DomainError("AGENT_STATE_CONFLICT", "The supervised headless runner is unavailable.");
              const context = await this.handoffs.compile(workspace, { routineId: schedule.routineId!, objective: schedule.objective, targetPaths: [], sources: [], trigger: "scheduled" }, { persist: false });
              const run = await this.headless.start(workspace, { provider: routine.client, executablePath: routine.headlessExecutablePath!, prompt: context.prompt, model: routine.preferredModel === "use current client model" ? null : routine.preferredModel, accessMode: routine.headlessAccessMode, maxRuntimeMs: routine.headlessMaxRuntimeMs, provenance: { routineId: routine.id, trigger: "scheduled", skillBundleDigest: context.skillSnapshot.bundleDigest!, contextManifestDigest: context.contextManifest!.digest } });
              occurrence.state = "running";
              occurrence.dispatchId = run.id;
            } else {
              const run = await this.handoffs.compile(workspace, { routineId: schedule.routineId!, objective: schedule.objective, targetPaths: [], sources: [], trigger: "scheduled" });
              occurrence.state = "ready-to-copy";
              occurrence.dispatchId = run.id;
            }
          } else {
            const task = await this.agents.start(workspace, { objective: schedule.objective, model: schedule.model!, maxSteps: 8, maxTokens: 50_000, maxRuntimeMs: 300_000, targetPaths: [], sources: [] });
            occurrence.state = "running";
            occurrence.dispatchId = task.id;
          }
        } catch (error) {
          occurrence.state = "failed";
          occurrence.diagnostic = error instanceof Error ? error.message.slice(0, 1000) : "Dispatch failed.";
        }
      }
      occurrence.updatedAt = new Date().toISOString();
      await this.#save(workspace, registry);
      this.notify(workspace.id, { occurrenceId: occurrence.id, scheduleId: schedule.id, scheduleName: schedule.name, state: occurrence.state, dispatchId: occurrence.dispatchId });
      results.push(occurrence);
    }
    return results;
  }

  async #syncRunStates(workspace: WorkspaceRecord, registry: Registry) {
    const active = registry.occurrences.filter(({ dispatchId }) => dispatchId).filter(({ state }) => !["completed", "cancelled", "interrupted", "failed", "skipped", "needs-review"].includes(state));
    if (!active.length) return;
    const routines = await this.handoffs.listRoutines(workspace);
    const isHeadlessOccurrence = (occurrence: (typeof active)[number]) => {
      const schedule = registry.schedules.find(({ id }) => id === occurrence.scheduleId);
      return schedule?.mode === "manual" && routines.find(({ id }) => id === schedule.routineId)?.executionMode === "headless";
    };
    const needsHeadless = active.some(isHeadlessOccurrence);
    const needsManual = active.some((occurrence) => registry.schedules.find(({ id }) => id === occurrence.scheduleId)?.mode === "manual" && !isHeadlessOccurrence(occurrence));
    const needsAutomatic = active.some((occurrence) => registry.schedules.find(({ id }) => id === occurrence.scheduleId)?.mode === "automatic");
    const [handoffRuns, agentRegistry, headlessRuns] = await Promise.all([needsManual ? this.handoffs.listRuns(workspace) : Promise.resolve([]), needsAutomatic ? this.agents.list(workspace) : Promise.resolve({ tasks: [], grants: [] }), needsHeadless && this.headless ? this.headless.list(workspace) : Promise.resolve([])]);
    let changed = false;
    for (const occurrence of active) {
      const schedule = registry.schedules.find(({ id }) => id === occurrence.scheduleId);
      if (!schedule) continue;
      let next = occurrence.state;
      if (schedule.mode === "manual") {
        if (isHeadlessOccurrence(occurrence)) {
          const run = headlessRuns.find(({ id }) => id === occurrence.dispatchId);
          if (run) next = run.status === "queued" || run.status === "running" || run.status === "cancelling" ? "running" : run.status;
        } else {
          const run = handoffRuns.find(({ id }) => id === occurrence.dispatchId);
          if (run) next = run.status === "draft" ? "claimed" : run.status;
        }
      } else {
        const task = agentRegistry.tasks.find(({ id }) => id === occurrence.dispatchId);
        if (task) next = task.status === "completed" ? "completed" : task.status === "cancelled" ? "cancelled" : task.status === "failed" ? "failed" : task.status === "interrupted" ? "interrupted" : "running";
      }
      if (next !== occurrence.state) { occurrence.state = next; occurrence.updatedAt = new Date().toISOString(); changed = true; }
    }
    if (changed) await this.#save(workspace, registry);
  }

  #path(workspace: WorkspaceRecord) { return join(workspace.canonicalPath, ".voidra", "planner.json"); }

  async #registry(workspace: WorkspaceRecord) {
    const cached = this.#registries.get(workspace.id);
    if (cached) return cached;
    const pending = this.#registryLoads.get(workspace.id); if (pending) return pending;
    const load = (async () => {
      let registry: Registry;
      try { registry = registrySchema.parse(JSON.parse(await readFile(this.#path(workspace), "utf8"))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new DomainError("INCOMPATIBLE_SCHEMA", "Planner and schedule metadata requires recovery.");
        registry = { schemaVersion: 1, tasks: [], plans: [], schedules: [], occurrences: [] };
      }
      this.#registries.set(workspace.id, registry); await this.#save(workspace, registry); return registry;
    })();
    this.#registryLoads.set(workspace.id, load);
    try { return await load; } finally { this.#registryLoads.delete(workspace.id); }
  }

  async #save(workspace: WorkspaceRecord, registry: Registry) {
    const content = json(registry);
    const prior = this.#saveQueues.get(workspace.id) ?? Promise.resolve();
    const pending = prior.catch(() => undefined).then(() => atomicWrite(this.#path(workspace), content));
    this.#saveQueues.set(workspace.id, pending);
    try { await pending; }
    finally { if (this.#saveQueues.get(workspace.id) === pending) this.#saveQueues.delete(workspace.id); }
  }
}
