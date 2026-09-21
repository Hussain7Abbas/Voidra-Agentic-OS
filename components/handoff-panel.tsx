"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestService } from "@/components/service-types";

type SkillResource = { path: string; kind: "reference" | "asset" | "script" | "test"; size: number; digest: string; risk: "inert" | "executable-review-required" };
type Skill = { id: string; name: string; slug: string; description: string; instructions: string; expectedOutput: string; inputs: string[]; version: number; currentDigest: string; resources: SkillResource[] };
type Routine = { id: string; name: string; skillId: string; skillVersion: number; client: "claude" | "codex"; preferredModel: string; outputDirectory: string; inlineInstructions: string; executionMode: "manual" | "headless"; headlessExecutablePath: string | null; headlessAccessMode: "read-only" | "staged-write"; headlessMaxRuntimeMs: number };
type Provider = { provider: "claude" | "codex"; path: string; version: string };
type Output = { id: string; title: string; path: string; kind: string; provider: string; digest: string; bytes: number };
type Run = { id: string; routineId: string; status: string; trigger: string; client: string; preferredModel: string; prompt: string; sources: Array<{ label: string; revision: string }>; contextManifest?: { digest: string; bytes: number; estimatedTokens: number; included: Array<{ type: string; id: string; reason: string; bytes: number }>; excluded: Array<{ type: string; id: string; reason: string }> }; resultPreview: { path: string; before: string | null; after: string } | null; appliedOutput: string | null };

export function HandoffPanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [skillName, setSkillName] = useState("Daily brief");
  const [skillDescription, setSkillDescription] = useState("Turn selected context into a concise brief.");
  const [skillInstructions, setSkillInstructions] = useState("Summarize the supplied context, preserve factual uncertainty, and list next actions.");
  const [expectedOutput, setExpectedOutput] = useState("a Markdown brief");
  const [resourceSkillId, setResourceSkillId] = useState("");
  const [resourceKind, setResourceKind] = useState<SkillResource["kind"]>("reference");
  const [resourcePath, setResourcePath] = useState("example.md");
  const [resourceContent, setResourceContent] = useState("# Reference\n");
  const [portableSkill, setPortableSkill] = useState("");
  const [routineName, setRoutineName] = useState("Plan the Day");
  const [skillId, setSkillId] = useState("");
  const [client, setClient] = useState<"claude" | "codex">("claude");
  const [preferredModel, setPreferredModel] = useState("use current client model");
  const [outputDirectory, setOutputDirectory] = useState("outputs");
  const [routineInstructions, setRoutineInstructions] = useState("");
  const [executionMode, setExecutionMode] = useState<"manual" | "headless">("manual");
  const [headlessExecutablePath, setHeadlessExecutablePath] = useState("");
  const [headlessAccessMode, setHeadlessAccessMode] = useState<"read-only" | "staged-write">("read-only");
  const [headlessMaxRuntimeMs, setHeadlessMaxRuntimeMs] = useState(300_000);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editingRoutineId, setEditingRoutineId] = useState("");
  const [objective, setObjective] = useState("Prepare today's focused plan.");
  const [targetPath, setTargetPath] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceResults, setSourceResults] = useState<Array<{ baseId: string; documentId: string; title: string; baseName: string; path: string }>>([]);
  const [selectedSources, setSelectedSources] = useState<Array<{ baseId: string; documentId: string; label: string }>>([]);
  const [outputQuery, setOutputQuery] = useState("");
  const [outputResults, setOutputResults] = useState<Output[]>([]);
  const [selectedOutputIds, setSelectedOutputIds] = useState<string[]>([]);
  const [selectedRoutineId, setSelectedRoutineId] = useState("");
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [prompt, setPrompt] = useState("");
  const [resultText, setResultText] = useState("");
  const [resultPath, setResultPath] = useState("brief.md");
  const [resultContent, setResultContent] = useState("# Daily brief\n");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [skillResult, routineResult, runResult, providerResult] = await Promise.all([
      request("skill.list", {}, workspaceId), request("routine.list", {}, workspaceId), request("handoff.list", {}, workspaceId), request("headless.discover", {}, workspaceId),
    ]);
    const nextSkills = skillResult.ok ? ((skillResult.data.skills as Skill[]) ?? []) : [];
    const nextRoutines = routineResult.ok ? ((routineResult.data.routines as Routine[]) ?? []) : [];
    const entity = new URLSearchParams(window.location.search).get("entity") ?? "";
    const [entityType, entityId] = entity.split(":", 2);
    if (skillResult.ok) {
      setSkills(nextSkills);
      const requestedSkill = entityType === "skill" && nextSkills.some(({ id }) => id === entityId) ? entityId : "";
      setSkillId((current) => requestedSkill || current || nextSkills[0]?.id || "");
      setResourceSkillId((current) => requestedSkill || current || nextSkills[0]?.id || "");
    }
    if (routineResult.ok) {
      setRoutines(nextRoutines);
      const requestedRoutine = entityType === "routine" ? nextRoutines.find(({ id }) => id === entityId) : entityType === "skill" ? nextRoutines.find(({ skillId: owner }) => owner === entityId) : undefined;
      setSelectedRoutineId((current) => requestedRoutine?.id || current || nextRoutines[0]?.id || "");
      if (entityType === "routine" && requestedRoutine) setSkillId(requestedRoutine.skillId);
    }
    if (runResult.ok) setRuns((runResult.data.runs as Run[]) ?? []);
    if (providerResult.ok) setProviders((providerResult.data.providers as Provider[]) ?? []);
  }, [request, workspaceId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setActiveRun(null); setPrompt(""); setSelectedSources([]); setSelectedOutputIds([]); void load(); }, [workspaceId, load]);
  useEffect(() => {
    const entity = new URLSearchParams(window.location.search).get("entity") ?? "";
    if (!selectedRoutineId || (!entity.startsWith("skill:") && !entity.startsWith("routine:"))) return;
    const frame = window.requestAnimationFrame(() => document.getElementById("run-review")?.scrollIntoView({ block: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedRoutineId]);

  const createSkill = async () => {
    const result = await request("skill.create", { name: skillName, description: skillDescription, instructions: skillInstructions, expectedOutput, inputs: ["objective", "selected context"] }, workspaceId);
    setMessage(result.ok ? "Skill created at version 1." : result.error.message);
    if (result.ok) { setSkillId(result.data.id as string); await load(); }
  };

  const updateSkill = async (skill: Skill) => {
    const result = await request("skill.update", { skillId: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions, expectedOutput: skill.expectedOutput, inputs: skill.inputs }, workspaceId);
    setMessage(result.ok ? `Skill saved as version ${result.data.version}. Existing routines stay pinned.` : result.error.message);
    if (result.ok) await load();
  };

  const writeResource = async () => {
    const result = await request("skill.resource.write", { skillId: resourceSkillId, kind: resourceKind, path: resourcePath, encoding: "utf8", content: resourceContent }, workspaceId);
    setMessage(result.ok ? `${resourceKind} saved in the editable bundle. Save a new skill version to pin it.` : result.error.message);
    if (result.ok) await load();
  };

  const importSkill = async () => {
    const result = await request("skill.import", { content: portableSkill }, workspaceId);
    setMessage(result.ok ? `Imported ${String(result.data.name)}. Scripts remain inert and require separate execution review.` : result.error.message);
    if (result.ok) { setPortableSkill(""); await load(); }
  };

  const validateSkill = async (skillId: string) => {
    const result = await request("skill.validate", { skillId }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    const data = result.data as { passed: boolean; tests: Array<{ diagnostics: string[] }>; diagnostic: string | null };
    setMessage(data.passed ? `All ${data.tests.length} deterministic skill tests passed.` : data.diagnostic ?? data.tests.flatMap(({ diagnostics }) => diagnostics).join("; "));
  };

  const createRoutine = async () => {
    const result = await request(editingRoutineId ? "routine.update" : "routine.create", { ...(editingRoutineId ? { routineId: editingRoutineId } : {}), name: routineName, skillId, client, preferredModel, outputDirectory, inlineInstructions: routineInstructions, executionMode, headlessExecutablePath: headlessExecutablePath || null, headlessAccessMode, headlessMaxRuntimeMs }, workspaceId);
    setMessage(result.ok ? `Routine ${editingRoutineId ? "updated" : "created"}.` : result.error.message);
    if (result.ok) { setSelectedRoutineId(result.data.id as string); setEditingRoutineId(""); await load(); }
  };

  const searchSources = async () => {
    const result = await request("knowledge.search", { query: sourceQuery }, workspaceId);
    setSourceResults(result.ok ? ((result.data.results as Array<Record<string, unknown>>).map((entry) => ({ baseId: String(entry.baseId), documentId: String(entry.id), title: String(entry.title), baseName: String(entry.baseName), path: String(entry.path) }))) : []);
    if (!result.ok) setMessage(result.error.message);
  };

  const searchOutputs = async () => {
    const result = await request("output.search", { query: outputQuery, kind: null, provider: null, tags: [], limit: 100 }, workspaceId);
    if (result.ok) setOutputResults((result.data.outputs as Output[]) ?? []); else setMessage(result.error.message);
  };

  const compile = async (scheduled = false) => {
    const selectedRoutine = routines.find(({ id }) => id === selectedRoutineId);
    const operation = !scheduled && selectedRoutine?.executionMode === "headless" ? "routine.launch" : scheduled ? "handoff.prepareScheduled" : "handoff.compile";
    const result = await request(operation, {
      routineId: selectedRoutineId,
      objective,
      targetPaths: targetPath ? [targetPath] : [],
      sources: selectedSources.map(({ baseId, documentId }) => ({ baseId, documentId })),
      outputIds: selectedOutputIds,
    }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    if (operation === "routine.launch") {
      setActiveRun(null); setPrompt("");
      setMessage(`${selectedRoutine?.client === "claude" ? "Claude Code" : "Codex"} started from the pinned skill snapshot. Review its journal and any staged writeback below.`);
      await load(); return;
    }
    const run = result.data as unknown as Run;
    setActiveRun(run); setPrompt(run.prompt);
    setMessage(scheduled ? "Scheduled handoff prepared. Clipboard was not changed." : "Prompt ready for review.");
    await load();
  };

  const savePrompt = async () => {
    if (!activeRun) return;
    const result = await request("handoff.updatePrompt", { runId: activeRun.id, prompt }, workspaceId);
    setMessage(result.ok ? "Prompt edits saved." : result.error.message);
  };

  const copyPrompt = async () => {
    if (!activeRun || !window.voidra) return;
    const saved = await request("handoff.updatePrompt", { runId: activeRun.id, prompt }, workspaceId);
    if (!saved.ok) { setMessage(saved.error.message); return; }
    try {
      await window.voidra.shell.copyText(prompt);
    } catch {
      setMessage("Clipboard write failed. The editable prompt remains ready.");
      return;
    }
    const marked = await request("handoff.markCopied", { runId: activeRun.id }, workspaceId);
    if (marked.ok) { setActiveRun(marked.data as unknown as Run); setMessage("Prompt copied. Awaiting a result; this is not completion."); await load(); }
    else setMessage(marked.error.message);
  };

  const previewResult = async () => {
    if (!activeRun) return;
    const result = await request("handoff.previewResult", { runId: activeRun.id, resultText, outputPath: resultPath, outputContent: resultContent }, workspaceId);
    if (result.ok) { setActiveRun(result.data as unknown as Run); setMessage("Result staged for review. No local file changed."); await load(); }
    else setMessage(result.error.message);
  };

  const applyResult = async () => {
    if (!activeRun) return;
    const result = await request("handoff.applyResult", { runId: activeRun.id }, workspaceId);
    if (result.ok) { setActiveRun(result.data as unknown as Run); setMessage("Reviewed output applied."); await load(); }
    else setMessage(result.error.message);
  };

  const complete = async () => {
    if (!activeRun) return;
    const result = await request("handoff.complete", { runId: activeRun.id }, workspaceId);
    if (result.ok) { setActiveRun(result.data as unknown as Run); setMessage("Handoff marked completed by the user."); await load(); }
    else setMessage(result.error.message);
  };

  return <div className="handoff-grid">
    <article className="panel handoff-card">
      <p className="card-label">SKILL LIBRARY</p>
      <label>Name<input aria-label="Skill name" value={skillName} onChange={(event) => setSkillName(event.target.value)} /></label>
      <label>Description<input aria-label="Skill description" value={skillDescription} onChange={(event) => setSkillDescription(event.target.value)} /></label>
      <label>Instructions<textarea aria-label="Skill instructions" value={skillInstructions} onChange={(event) => setSkillInstructions(event.target.value)} /></label>
      <label>Expected output<input aria-label="Expected output" value={expectedOutput} onChange={(event) => setExpectedOutput(event.target.value)} /></label>
      <button onClick={createSkill}>Create skill</button>
      <div aria-label="Saved skills" className="compact-list">{skills.map((skill) => <div key={skill.id}><span><strong>{skill.name}</strong><small>v{skill.version} · {skill.slug} · {skill.currentDigest.slice(0, 10)}</small><small>{skill.resources.length} resources · {skill.description}</small></span><button onClick={() => void updateSkill(skill)}>Save new version</button><button onClick={async () => { await request("skill.duplicate", { skillId: skill.id, name: `${skill.name} copy` }, workspaceId); await load(); }}>Duplicate</button><button onClick={() => void validateSkill(skill.id)}>Validate fixtures</button><button onClick={async () => { const result = await request("skill.export", { skillId: skill.id }, workspaceId); if (result.ok) { setPortableSkill(String(result.data.content)); setMessage(`Portable bundle ready: ${String(result.data.filename)} · ${String(result.data.bytes)} B.`); } else setMessage(result.error.message); }}>Export bundle</button>{skill.resources.map((resource) => <small key={resource.path} className={resource.kind === "script" ? "resource-risk" : ""}>{resource.kind} · {resource.path} · {resource.size} B · {resource.risk}</small>)}</div>)}</div>
      <fieldset className="skill-resource-editor"><legend>Portable bundle</legend><label>Bundle JSON<textarea aria-label="Portable skill bundle" value={portableSkill} onChange={(event) => setPortableSkill(event.target.value)} placeholder="Paste a .voidra-skill.json bundle" /></label><div className="button-row"><button disabled={!portableSkill.trim()} onClick={importSkill}>Import as a new skill</button><button disabled={!portableSkill.trim()} onClick={async () => { await window.voidra?.shell.copyText(portableSkill); setMessage("Portable bundle copied after explicit user action."); }}>Copy export</button></div></fieldset>
      <fieldset className="skill-resource-editor">
        <legend>Bundle resource</legend>
        <label>Skill<select aria-label="Resource skill" value={resourceSkillId} onChange={(event) => setResourceSkillId(event.target.value)}>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
        <label>Type<select aria-label="Resource type" value={resourceKind} onChange={(event) => setResourceKind(event.target.value as SkillResource["kind"])}><option value="reference">Reference</option><option value="asset">Asset</option><option value="script">Script (inert)</option><option value="test">Test</option></select></label>
        <label>Path<input aria-label="Resource path" value={resourcePath} onChange={(event) => setResourcePath(event.target.value)} /></label>
        <label>Content<textarea aria-label="Resource content" value={resourceContent} onChange={(event) => setResourceContent(event.target.value)} /></label>
        <button onClick={writeResource} disabled={!resourceSkillId}>Add resource</button>
      </fieldset>
    </article>

    <article className="panel handoff-card">
      <p className="card-label">ROUTINE</p>
      <label>Name<input aria-label="Routine name" value={routineName} onChange={(event) => setRoutineName(event.target.value)} /></label>
      <label>Skill<select aria-label="Routine skill" value={skillId} onChange={(event) => setSkillId(event.target.value)}>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name} · v{skill.version}</option>)}</select></label>
      <label>Subscription client<select aria-label="Subscription client" value={client} onChange={(event) => setClient(event.target.value as "claude" | "codex")}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
      <label>Execution profile<select aria-label="Routine execution profile" value={executionMode} onChange={(event) => { const mode = event.target.value as "manual" | "headless"; setExecutionMode(mode); if (mode === "headless" && !headlessExecutablePath) setHeadlessExecutablePath(providers.find((provider) => provider.provider === client)?.path ?? ""); }}><option value="manual">Manual handoff — review and copy</option><option value="headless">Supervised headless CLI</option></select></label>
      {executionMode === "headless" && <fieldset className="skill-resource-editor"><legend>Headless safety profile</legend><label>Approved executable path<input aria-label="Routine headless executable" value={headlessExecutablePath} onChange={(event) => setHeadlessExecutablePath(event.target.value)} placeholder={`/absolute/path/to/${client}`} /></label><label>Filesystem profile<select aria-label="Routine headless filesystem profile" value={headlessAccessMode} onChange={(event) => setHeadlessAccessMode(event.target.value as "read-only" | "staged-write")}><option value="read-only">Read-only report</option><option value="staged-write">Staged edits — review before apply</option></select></label><label>Runtime limit (seconds)<input aria-label="Routine headless runtime" type="number" min={1} max={3600} value={Math.round(headlessMaxRuntimeMs / 1000)} onChange={(event) => setHeadlessMaxRuntimeMs(Math.max(1, Math.min(3600, Number(event.target.value) || 1)) * 1000)} /></label><small>Voidra runs only while awake. CLI authentication remains owned by the selected executable.</small></fieldset>}
      <label>Preferred model<input aria-label="Preferred model" value={preferredModel} onChange={(event) => setPreferredModel(event.target.value)} /></label>
      <label>Granted output directory<input aria-label="Output directory" value={outputDirectory} onChange={(event) => setOutputDirectory(event.target.value)} /></label>
      <label>Routine instructions<textarea aria-label="Routine instructions" value={routineInstructions} onChange={(event) => setRoutineInstructions(event.target.value)} /></label>
      <div className="button-row"><button onClick={createRoutine} disabled={!skillId}>{editingRoutineId ? "Update routine" : "Create routine"}</button>{editingRoutineId && <button onClick={() => setEditingRoutineId("")}>Cancel edit</button>}</div>
      <div aria-label="Saved routines" className="compact-list">{routines.map((routine) => <div key={routine.id}><button className="list-choice" onClick={() => setSelectedRoutineId(routine.id)}><strong>{routine.name}</strong><small>{routine.executionMode} · {routine.client} · {routine.preferredModel} · skill v{routine.skillVersion}</small></button><button onClick={() => { setEditingRoutineId(routine.id); setRoutineName(routine.name); setSkillId(routine.skillId); setClient(routine.client); setPreferredModel(routine.preferredModel); setOutputDirectory(routine.outputDirectory); setRoutineInstructions(routine.inlineInstructions); setExecutionMode(routine.executionMode); setHeadlessExecutablePath(routine.headlessExecutablePath ?? ""); setHeadlessAccessMode(routine.headlessAccessMode); setHeadlessMaxRuntimeMs(routine.headlessMaxRuntimeMs); }}>Edit routine</button><button onClick={async () => { await request("routine.duplicate", { routineId: routine.id, name: `${routine.name} for ${routine.client === "claude" ? "Codex" : "Claude"}`, client: routine.client === "claude" ? "codex" : "claude", preferredModel: "use current client model" }, workspaceId); await load(); }}>Duplicate for other client</button></div>)}</div>
    </article>

    <article id="run-review" className="panel handoff-card handoff-compile">
      <p className="card-label">LOCAL PROMPT ASSEMBLY</p>
      <label>Routine<select aria-label="Compile routine" value={selectedRoutineId} onChange={(event) => setSelectedRoutineId(event.target.value)}>{routines.map((routine) => <option key={routine.id} value={routine.id}>{routine.name}</option>)}</select></label>
      <label>Objective<textarea aria-label="Handoff objective" value={objective} onChange={(event) => setObjective(event.target.value)} /></label>
      <label>Target path for scoped rules<input aria-label="Target path" value={targetPath} onChange={(event) => setTargetPath(event.target.value)} placeholder="projects/today.md" /></label>
      <div className="inline-fields"><input aria-label="Source query" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} /><button onClick={searchSources}>Find sources</button></div>
      <div aria-label="Context sources" className="compact-list">{sourceResults.map((source) => { const selected = selectedSources.some((entry) => entry.baseId === source.baseId && entry.documentId === source.documentId); return <button key={`${source.baseId}:${source.documentId}`} className={selected ? "selected-source" : ""} onClick={() => setSelectedSources((current) => selected ? current.filter((entry) => entry.baseId !== source.baseId || entry.documentId !== source.documentId) : [...current, { baseId: source.baseId, documentId: source.documentId, label: `${source.baseName} / ${source.path}` }])}>{selected ? "✓ " : "+ "}{source.baseName} / {source.path}</button>; })}</div>
      <div className="inline-fields"><input aria-label="Prior output query" value={outputQuery} onChange={(event) => setOutputQuery(event.target.value)} /><button onClick={searchOutputs}>Find prior outputs</button></div>
      <div aria-label="Prior run outputs" className="compact-list">{outputResults.map((output) => { const selected = selectedOutputIds.includes(output.id); const reusable = output.kind === "markdown" || output.kind === "text"; return <button key={output.id} disabled={!reusable} className={selected ? "selected-source" : ""} onClick={() => setSelectedOutputIds((current) => selected ? current.filter((id) => id !== output.id) : [...current, output.id])}>{selected ? "✓ " : "+ "}{output.title} · {output.kind} · {output.digest.slice(0, 10)}</button>; })}</div>
      <div className="button-row"><button className="primary" onClick={() => void compile()} disabled={!selectedRoutineId}>{routines.find(({ id }) => id === selectedRoutineId)?.executionMode === "headless" ? "Run supervised headless" : "Compile prompt"}</button><button onClick={() => void compile(true)} disabled={!selectedRoutineId || routines.find(({ id }) => id === selectedRoutineId)?.executionMode === "headless"}>Prepare scheduled handoff</button></div>
    </article>

    {activeRun && <article className="panel handoff-card handoff-preview">
      <p className="card-label">PROMPT PREVIEW · {activeRun.status.toUpperCase()}</p>
      <textarea aria-label="Compiled prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={18} />
      <div aria-label="Included source manifest" className="manifest">{activeRun.sources.length ? activeRun.sources.map((source) => <small key={`${source.label}:${source.revision}`}>{source.label} · {source.revision.slice(0, 10)}</small>) : <small>No note excerpts selected.</small>}</div>
      {activeRun.contextManifest && <details className="context-manifest"><summary>Context pack · {activeRun.contextManifest.bytes} B · ~{activeRun.contextManifest.estimatedTokens} tokens · {activeRun.contextManifest.digest.slice(0, 10)}</summary><div>{activeRun.contextManifest.included.map((item) => <small key={`in:${item.type}:${item.id}`}>IN · {item.type} · {item.id} · {item.reason}</small>)}{activeRun.contextManifest.excluded.map((item) => <small key={`out:${item.type}:${item.id}`}>OUT · {item.type} · {item.id} · {item.reason}</small>)}</div></details>}
      {activeRun.status === "ready-to-copy" && <div className="button-row"><button onClick={savePrompt}>Save prompt edits</button><button className="primary" onClick={copyPrompt}>Copy Prompt</button></div>}
      {activeRun.status === "awaiting-result" && <div className="result-form"><label>Returned result<textarea aria-label="Returned result" value={resultText} onChange={(event) => setResultText(event.target.value)} /></label><label>Output path<input aria-label="Result output path" value={resultPath} onChange={(event) => setResultPath(event.target.value)} /></label><label>Output content<textarea aria-label="Result output content" value={resultContent} onChange={(event) => setResultContent(event.target.value)} /></label><button onClick={previewResult}>Preview local changes</button></div>}
      {activeRun.status === "result-under-review" && activeRun.resultPreview && <div className="result-review" aria-label="Result change preview"><p><strong>{activeRun.resultPreview.path}</strong></p><div><pre>{activeRun.resultPreview.before ?? "(new file)"}</pre><pre>{activeRun.resultPreview.after}</pre></div><div className="button-row"><button className="primary" onClick={applyResult}>Apply reviewed output</button><button onClick={complete}>Mark externally complete</button>{activeRun.appliedOutput && <a href="/notes/">Open saved output</a>}</div></div>}
    </article>}

    <article className="panel handoff-card handoff-runs"><p className="card-label">HANDOFF RUNS</p><div aria-label="Handoff runs" className="compact-list">{runs.map((run) => <button key={run.id} className="list-choice" onClick={() => { setActiveRun(run); setPrompt(run.prompt); }}><strong>{run.client} · {run.status}</strong><small>{run.trigger} · {run.preferredModel}</small></button>)}</div></article>
    {message && <p className="save-message" role="status">{message}</p>}
  </div>;
}
