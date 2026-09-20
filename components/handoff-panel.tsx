"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestService } from "@/components/service-types";

type Skill = { id: string; name: string; description: string; instructions: string; expectedOutput: string; inputs: string[]; version: number };
type Routine = { id: string; name: string; skillId: string; skillVersion: number; client: "claude" | "codex"; preferredModel: string; outputDirectory: string; inlineInstructions: string };
type Run = { id: string; routineId: string; status: string; trigger: string; client: string; preferredModel: string; prompt: string; sources: Array<{ label: string; revision: string }>; resultPreview: { path: string; before: string | null; after: string } | null; appliedOutput: string | null };

export function HandoffPanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [skillName, setSkillName] = useState("Daily brief");
  const [skillDescription, setSkillDescription] = useState("Turn selected context into a concise brief.");
  const [skillInstructions, setSkillInstructions] = useState("Summarize the supplied context, preserve factual uncertainty, and list next actions.");
  const [expectedOutput, setExpectedOutput] = useState("a Markdown brief");
  const [routineName, setRoutineName] = useState("Plan the Day");
  const [skillId, setSkillId] = useState("");
  const [client, setClient] = useState<"claude" | "codex">("claude");
  const [preferredModel, setPreferredModel] = useState("use current client model");
  const [outputDirectory, setOutputDirectory] = useState("outputs");
  const [objective, setObjective] = useState("Prepare today's focused plan.");
  const [targetPath, setTargetPath] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceResults, setSourceResults] = useState<Array<{ baseId: string; documentId: string; title: string; baseName: string; path: string }>>([]);
  const [selectedSources, setSelectedSources] = useState<Array<{ baseId: string; documentId: string; label: string }>>([]);
  const [selectedRoutineId, setSelectedRoutineId] = useState("");
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [prompt, setPrompt] = useState("");
  const [resultText, setResultText] = useState("");
  const [resultPath, setResultPath] = useState("brief.md");
  const [resultContent, setResultContent] = useState("# Daily brief\n");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [skillResult, routineResult, runResult] = await Promise.all([
      request("skill.list", {}, workspaceId), request("routine.list", {}, workspaceId), request("handoff.list", {}, workspaceId),
    ]);
    if (skillResult.ok) {
      const next = (skillResult.data.skills as Skill[]) ?? [];
      setSkills(next);
      setSkillId((current) => current || next[0]?.id || "");
    }
    if (routineResult.ok) {
      const next = (routineResult.data.routines as Routine[]) ?? [];
      setRoutines(next);
      setSelectedRoutineId((current) => current || next[0]?.id || "");
    }
    if (runResult.ok) setRuns((runResult.data.runs as Run[]) ?? []);
  }, [request, workspaceId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setActiveRun(null); setPrompt(""); setSelectedSources([]); void load(); }, [workspaceId, load]);

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

  const createRoutine = async () => {
    const result = await request("routine.create", { name: routineName, skillId, client, preferredModel, outputDirectory, inlineInstructions: "" }, workspaceId);
    setMessage(result.ok ? "Routine created." : result.error.message);
    if (result.ok) { setSelectedRoutineId(result.data.id as string); await load(); }
  };

  const searchSources = async () => {
    const result = await request("knowledge.search", { query: sourceQuery }, workspaceId);
    setSourceResults(result.ok ? ((result.data.results as Array<Record<string, unknown>>).map((entry) => ({ baseId: String(entry.baseId), documentId: String(entry.id), title: String(entry.title), baseName: String(entry.baseName), path: String(entry.path) }))) : []);
    if (!result.ok) setMessage(result.error.message);
  };

  const compile = async (scheduled = false) => {
    const result = await request(scheduled ? "handoff.prepareScheduled" : "handoff.compile", {
      routineId: selectedRoutineId,
      objective,
      targetPaths: targetPath ? [targetPath] : [],
      sources: selectedSources.map(({ baseId, documentId }) => ({ baseId, documentId })),
    }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
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
      <div aria-label="Saved skills" className="compact-list">{skills.map((skill) => <div key={skill.id}><span><strong>{skill.name}</strong><small>v{skill.version} · {skill.description}</small></span><button onClick={() => void updateSkill(skill)}>Save new version</button><button onClick={async () => { await request("skill.duplicate", { skillId: skill.id, name: `${skill.name} copy` }, workspaceId); await load(); }}>Duplicate</button></div>)}</div>
    </article>

    <article className="panel handoff-card">
      <p className="card-label">ROUTINE</p>
      <label>Name<input aria-label="Routine name" value={routineName} onChange={(event) => setRoutineName(event.target.value)} /></label>
      <label>Skill<select aria-label="Routine skill" value={skillId} onChange={(event) => setSkillId(event.target.value)}>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name} · v{skill.version}</option>)}</select></label>
      <label>Subscription client<select aria-label="Subscription client" value={client} onChange={(event) => setClient(event.target.value as "claude" | "codex")}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
      <label>Preferred model<input aria-label="Preferred model" value={preferredModel} onChange={(event) => setPreferredModel(event.target.value)} /></label>
      <label>Granted output directory<input aria-label="Output directory" value={outputDirectory} onChange={(event) => setOutputDirectory(event.target.value)} /></label>
      <button onClick={createRoutine} disabled={!skillId}>Create routine</button>
      <div aria-label="Saved routines" className="compact-list">{routines.map((routine) => <div key={routine.id}><button className="list-choice" onClick={() => setSelectedRoutineId(routine.id)}><strong>{routine.name}</strong><small>{routine.client} · {routine.preferredModel} · skill v{routine.skillVersion}</small></button><button onClick={async () => { await request("routine.duplicate", { routineId: routine.id, name: `${routine.name} for ${routine.client === "claude" ? "Codex" : "Claude"}`, client: routine.client === "claude" ? "codex" : "claude", preferredModel: "use current client model" }, workspaceId); await load(); }}>Duplicate for other client</button></div>)}</div>
    </article>

    <article className="panel handoff-card handoff-compile">
      <p className="card-label">LOCAL PROMPT ASSEMBLY</p>
      <label>Routine<select aria-label="Compile routine" value={selectedRoutineId} onChange={(event) => setSelectedRoutineId(event.target.value)}>{routines.map((routine) => <option key={routine.id} value={routine.id}>{routine.name}</option>)}</select></label>
      <label>Objective<textarea aria-label="Handoff objective" value={objective} onChange={(event) => setObjective(event.target.value)} /></label>
      <label>Target path for scoped rules<input aria-label="Target path" value={targetPath} onChange={(event) => setTargetPath(event.target.value)} placeholder="projects/today.md" /></label>
      <div className="inline-fields"><input aria-label="Source query" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} /><button onClick={searchSources}>Find sources</button></div>
      <div aria-label="Context sources" className="compact-list">{sourceResults.map((source) => { const selected = selectedSources.some((entry) => entry.baseId === source.baseId && entry.documentId === source.documentId); return <button key={`${source.baseId}:${source.documentId}`} className={selected ? "selected-source" : ""} onClick={() => setSelectedSources((current) => selected ? current.filter((entry) => entry.baseId !== source.baseId || entry.documentId !== source.documentId) : [...current, { baseId: source.baseId, documentId: source.documentId, label: `${source.baseName} / ${source.path}` }])}>{selected ? "✓ " : "+ "}{source.baseName} / {source.path}</button>; })}</div>
      <div className="button-row"><button className="primary" onClick={() => void compile()} disabled={!selectedRoutineId}>Compile prompt</button><button onClick={() => void compile(true)} disabled={!selectedRoutineId}>Prepare scheduled handoff</button></div>
    </article>

    {activeRun && <article className="panel handoff-card handoff-preview">
      <p className="card-label">PROMPT PREVIEW · {activeRun.status.toUpperCase()}</p>
      <textarea aria-label="Compiled prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={18} />
      <div aria-label="Included source manifest" className="manifest">{activeRun.sources.length ? activeRun.sources.map((source) => <small key={`${source.label}:${source.revision}`}>{source.label} · {source.revision.slice(0, 10)}</small>) : <small>No note excerpts selected.</small>}</div>
      {activeRun.status === "ready-to-copy" && <div className="button-row"><button onClick={savePrompt}>Save prompt edits</button><button className="primary" onClick={copyPrompt}>Copy Prompt</button></div>}
      {activeRun.status === "awaiting-result" && <div className="result-form"><label>Returned result<textarea aria-label="Returned result" value={resultText} onChange={(event) => setResultText(event.target.value)} /></label><label>Output path<input aria-label="Result output path" value={resultPath} onChange={(event) => setResultPath(event.target.value)} /></label><label>Output content<textarea aria-label="Result output content" value={resultContent} onChange={(event) => setResultContent(event.target.value)} /></label><button onClick={previewResult}>Preview local changes</button></div>}
      {activeRun.status === "result-under-review" && activeRun.resultPreview && <div className="result-review" aria-label="Result change preview"><p><strong>{activeRun.resultPreview.path}</strong></p><div><pre>{activeRun.resultPreview.before ?? "(new file)"}</pre><pre>{activeRun.resultPreview.after}</pre></div><div className="button-row"><button className="primary" onClick={applyResult}>Apply reviewed output</button><button onClick={complete}>Mark externally complete</button>{activeRun.appliedOutput && <a href="/notes/">Open saved output</a>}</div></div>}
    </article>}

    <article className="panel handoff-card handoff-runs"><p className="card-label">HANDOFF RUNS</p><div aria-label="Handoff runs" className="compact-list">{runs.map((run) => <button key={run.id} className="list-choice" onClick={() => { setActiveRun(run); setPrompt(run.prompt); }}><strong>{run.client} · {run.status}</strong><small>{run.trigger} · {run.preferredModel}</small></button>)}</div></article>
    {message && <p className="save-message" role="status">{message}</p>}
  </div>;
}
