"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactSource, ArtifactState, BrowserAction, BrowserBounds, BrowserTabState } from "@/src/shared/browser-contracts";
import type { RequestService } from "@/components/service-types";

function boundsFor(element: HTMLElement): BrowserBounds {
  const bounds = element.getBoundingClientRect();
  return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
}

export function BrowserPanel({ workspace, request }: { workspace: { id: string; canonicalPath: string }; request: RequestService }) {
  const [mode, setMode] = useState<"browser" | "artifacts">("browser");
  const [tabs, setTabs] = useState<BrowserTabState[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");
  const [agentSelector, setAgentSelector] = useState("body");
  const [agentText, setAgentText] = useState("");
  const [agentResult, setAgentResult] = useState("");
  const [agentObjective, setAgentObjective] = useState("Inspect this page and complete the requested browser workflow.");
  const [agentModel, setAgentModel] = useState("openai/gpt-5.4");
  const [artifactName, setArtifactName] = useState("Interactive report");
  const [artifactMode, setArtifactMode] = useState<"source" | "preview">("preview");
  const [source, setSource] = useState<ArtifactSource | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeArtifact = artifacts.find((artifact) => artifact.id === activeArtifactId) ?? null;

  const load = useCallback(async () => {
    if (!window.voidra) return;
    try {
      const data = await window.voidra.browser.list(workspace.id, workspace.canonicalPath);
      let nextTabs = data.tabs;
      if (!nextTabs.length) nextTabs = [await window.voidra.browser.create(workspace.id, workspace.canonicalPath)];
      setTabs(nextTabs); setArtifacts(data.artifacts);
      setActiveTabId((current) => nextTabs.some((tab) => tab.id === current) ? current : nextTabs[0]?.id ?? null);
      setActiveArtifactId((current) => data.artifacts.some((artifact) => artifact.id === current) ? current : data.artifacts[0]?.id ?? null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Browser state could not be loaded."); }
  }, [workspace.canonicalPath, workspace.id]);

  useEffect(() => { void load(); const dispose = window.voidra?.browser.onUpdated((update) => { if (update.workspaceId === workspace.id) void load(); }); return () => { dispose?.(); void window.voidra?.browser.hide(); }; }, [load, workspace.id]);
  useEffect(() => { if (activeTab) setAddress(activeTab.url.startsWith("data:") ? "" : activeTab.url); }, [activeTab?.id, activeTab?.url]);

  const syncEmbeddedView = useCallback(() => {
    const element = viewport.current; if (!element || !window.voidra) return;
    const bounds = boundsFor(element);
    if (mode === "browser" && activeTabId) void window.voidra.browser.activate(workspace.id, activeTabId, bounds).catch((error) => setMessage(error.message));
    else if (mode === "artifacts" && artifactMode === "preview" && activeArtifactId) void window.voidra.artifacts.preview(workspace.id, workspace.canonicalPath, activeArtifactId, bounds).catch((error) => setMessage(error.message));
    else void window.voidra.browser.hide();
  }, [activeArtifactId, activeTabId, artifactMode, mode, workspace.canonicalPath, workspace.id]);

  useEffect(() => {
    syncEmbeddedView(); const element = viewport.current; if (!element) return;
    const observer = new ResizeObserver(syncEmbeddedView); observer.observe(element); window.addEventListener("resize", syncEmbeddedView); window.addEventListener("scroll", syncEmbeddedView, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", syncEmbeddedView); window.removeEventListener("scroll", syncEmbeddedView, true); void window.voidra?.browser.hide(); };
  }, [syncEmbeddedView]);

  const navigate = async () => {
    if (!activeTab) return; try { await window.voidra?.browser.navigate(workspace.id, activeTab.id, address); setMessage("Navigation started."); } catch (error) { setMessage(error instanceof Error ? error.message : "Navigation failed."); }
  };
  const createTab = async () => { const tab = await window.voidra?.browser.create(workspace.id, workspace.canonicalPath); if (tab) { setTabs((items) => [...items, tab]); setActiveTabId(tab.id); } };
  const closeTab = async (tabId: string) => { await window.voidra?.browser.close(workspace.id, tabId); if (activeTabId === tabId) setActiveTabId(tabs.find((tab) => tab.id !== tabId)?.id ?? null); await load(); };
  const assign = async () => { if (!activeTab) return; const taskId = crypto.randomUUID(); await window.voidra?.browser.assign(workspace.id, activeTab.id, taskId); setMessage(`Agent assigned to this tab (${taskId.slice(0, 8)}).`); await load(); };
  const startBrowserTask = async () => { if (!activeTab) return; setMessage("Starting browser task…"); const result = await request("agent.start", { objective: agentObjective, model: agentModel, maxSteps: 8, maxTokens: 50_000, maxRuntimeMs: 300_000, targetPaths: [], sources: [], browserTabId: activeTab.id }, workspace.id); setMessage(result.ok ? `Browser task ${String(result.data.status).replaceAll("-", " ")}. Review any requested action in Assistant.` : result.error.message); await load(); };
  const runAction = async (action: BrowserAction) => {
    if (!activeTab?.assignedTaskId) return;
    try { const result = await window.voidra?.browser.action(workspace.id, activeTab.id, activeTab.assignedTaskId, activeTab.documentId, action); setAgentResult(result?.text ?? (result?.uncertain ? "Action submitted; outcome is uncertain and will not be replayed automatically." : "Action completed.")); await load(); }
    catch (error) { setAgentResult(error instanceof Error ? error.message : "Agent action failed."); }
  };

  const createArtifact = async () => { try { const artifact = await window.voidra?.artifacts.create(workspace.id, workspace.canonicalPath, { name: artifactName }); if (artifact) { await load(); setActiveArtifactId(artifact.id); setArtifactMode("preview"); setMessage("Artifact bundle created."); } } catch (error) { setMessage(error instanceof Error ? error.message : "Artifact could not be created."); } };
  const openSource = async (path: string) => { if (!activeArtifact) return; try { const next = await window.voidra?.artifacts.read(workspace.id, workspace.canonicalPath, activeArtifact.id, path); if (next) { setSource(next); setArtifactMode("source"); } } catch (error) { setMessage(error instanceof Error ? error.message : "Asset could not be opened."); } };
  const saveSource = async () => { if (!source) return; try { const artifact = await window.voidra?.artifacts.save(workspace.id, workspace.canonicalPath, source.artifact.id, source.path, source.content, source.artifact.revision); if (artifact) { setSource({ ...source, artifact }); setArtifacts((items) => items.map((item) => item.id === artifact.id ? artifact : item)); setMessage("Artifact source saved and preview reloaded."); } } catch (error) { setMessage(error instanceof Error ? error.message : "Artifact source could not be saved."); } };

  return (
    <section className="browser-workbench" aria-label="Workspace browser and artifacts">
      <div className="segmented browser-mode" aria-label="Browser mode"><button className={mode === "browser" ? "selected" : ""} onClick={() => setMode("browser")}>Browser</button><button className={mode === "artifacts" ? "selected" : ""} onClick={() => setMode("artifacts")}>Artifacts</button></div>
      {mode === "browser" ? <>
        <div className="browser-tabs" aria-label="Browser tabs">{tabs.map((tab) => <button key={tab.id} className={tab.id === activeTabId ? "selected" : ""} onClick={() => setActiveTabId(tab.id)}><span>{tab.title || "New tab"}<small>{tab.control === "agent" ? "Agent controlling" : tab.control === "takeover" ? "User takeover" : "User"}</small></span><i role="button" aria-label={`Close ${tab.title || "tab"}`} onClick={(event) => { event.stopPropagation(); void closeTab(tab.id); }}>×</i></button>)}<button aria-label="New browser tab" onClick={createTab}>+</button></div>
        <div className="browser-toolbar"><button aria-label="Back" disabled={!activeTab?.canGoBack} onClick={() => activeTab && window.voidra?.browser.back(workspace.id, activeTab.id)}>←</button><button aria-label="Forward" disabled={!activeTab?.canGoForward} onClick={() => activeTab && window.voidra?.browser.forward(workspace.id, activeTab.id)}>→</button><button aria-label="Reload" onClick={() => activeTab && window.voidra?.browser.reload(workspace.id, activeTab.id)}>↻</button><input aria-label="Browser address" value={address} onChange={(event) => setAddress(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void navigate(); }} placeholder="https://example.com" /><button onClick={navigate}>Go</button></div>
        {activeTab && <div className="agent-browser-controls" aria-label="Agent browser controls"><strong>{activeTab.control === "agent" ? "Agent control active" : activeTab.control === "takeover" ? "Agent paused for user takeover" : "User control"}</strong>{!activeTab.assignedTaskId ? <button onClick={assign}>Assign temporary controller</button> : activeTab.control === "agent" ? <button onClick={async () => { await window.voidra?.browser.takeover(workspace.id, activeTab.id); await load(); }}>Take over</button> : <button onClick={async () => { await window.voidra?.browser.resume(workspace.id, activeTab.id); await load(); }}>Resume agent</button>}<input aria-label="Browser task objective" value={agentObjective} onChange={(event) => setAgentObjective(event.target.value)} /><input aria-label="Browser task model" value={agentModel} onChange={(event) => setAgentModel(event.target.value)} /><button disabled={!agentObjective.trim()} onClick={startBrowserTask}>Run with OpenRouter</button><input aria-label="Agent target selector" value={agentSelector} onChange={(event) => setAgentSelector(event.target.value)} /><input aria-label="Agent input text" value={agentText} onChange={(event) => setAgentText(event.target.value)} placeholder="Text or select value" /><button disabled={activeTab.control !== "agent"} onClick={() => runAction({ kind: "read" })}>Read page</button><button disabled={activeTab.control !== "agent"} onClick={() => runAction({ kind: "click", selector: agentSelector })}>Click target</button><button disabled={activeTab.control !== "agent"} onClick={() => runAction({ kind: "type", selector: agentSelector, text: agentText })}>Type text</button><output aria-label="Agent browser result">{agentResult}</output></div>}
      </> : <>
        <div className="artifact-toolbar"><input aria-label="Artifact name" value={artifactName} onChange={(event) => setArtifactName(event.target.value)} /><button onClick={createArtifact}>Create HTML bundle</button><select aria-label="Artifact bundle" value={activeArtifactId ?? ""} onChange={(event) => { setActiveArtifactId(event.target.value); setSource(null); }}><option value="">Choose artifact</option>{artifacts.map((artifact) => <option key={artifact.id} value={artifact.id}>{artifact.name}</option>)}</select>{activeArtifact && <><button className={artifactMode === "preview" ? "selected" : ""} onClick={() => setArtifactMode("preview")}>Preview</button><button onClick={async () => { const result = await window.voidra?.artifacts.export(workspace.id, workspace.canonicalPath, activeArtifact.id); if (result) setMessage(`Exported to ${result.path}`); }}>Export bundle</button></>}</div>
        {activeArtifact && <div className="artifact-files" aria-label="Artifact files">{activeArtifact.files.map((file) => <button key={file} onClick={() => openSource(file)}>{file}</button>)}</div>}
        {artifactMode === "source" && source && <div className="artifact-source"><header><strong>{source.path}</strong><button onClick={saveSource}>Save and reload</button></header><textarea aria-label="Artifact source" value={source.content} onChange={(event) => setSource({ ...source, content: event.target.value })} /></div>}
      </>}
      <div ref={viewport} className={`native-viewport ${mode === "artifacts" && artifactMode === "source" ? "hidden" : ""}`} aria-label={mode === "browser" ? "Browser viewport" : "Artifact preview"}><span>{mode === "browser" ? "Loading browser view…" : activeArtifact ? "Loading isolated preview…" : "Create or choose an artifact."}</span></div>
      {activeTab?.blockedReason && <p className="browser-warning" role="alert">{activeTab.blockedReason}</p>}
      {message && <p className="save-message" role="status">{message}</p>}
    </section>
  );
}
