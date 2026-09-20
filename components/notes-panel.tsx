"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { RequestService } from "./service-types";

type DocumentSummary = { id: string; path: string; title: string; revision: string; modifiedMs: number };
type LinkView = { target: string; alias: string | null; anchor: string | null; kind: string; resolvedId: string | null; status: string };
type Backlink = { id: string; path: string; title: string };
type OpenDocument = DocumentSummary & { content: string; links: LinkView[]; backlinks: Backlink[] };
type Revision = { id: string; createdAt: string; kind: string; contentHash: string };
type Conflict = { disk: OpenDocument; editorContent: string };

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderMarkdown(content: string) {
  const withWikiLinks = content.replace(/\[\[([^\]\n]+)\]\]/g, (_whole, inside: string) => {
    const [targetWithAnchor, alias] = inside.split("|", 2);
    const [target] = targetWithAnchor.split("#", 1);
    const label = alias?.trim() || targetWithAnchor.trim();
    return `<a href="#" data-note-target="${escapeHtml(target.trim())}">${escapeHtml(label)}</a>`;
  });
  const raw = marked.parse(withWikiLinks, { async: false }) as string;
  return DOMPurify.sanitize(raw, { ADD_ATTR: ["data-note-target"], FORBID_TAGS: ["script", "style", "iframe", "object", "embed"] });
}

export function NotesPanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [current, setCurrent] = useState<OpenDocument | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [savedRevision, setSavedRevision] = useState("");
  const [mode, setMode] = useState<"source" | "split" | "preview">("split");
  const [saveState, setSaveState] = useState("Saved");
  const [newPath, setNewPath] = useState("");
  const [renamePath, setRenamePath] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [searchResults, setSearchResults] = useState<DocumentSummary[]>([]);
  const [history, setHistory] = useState<Revision[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [mergeContent, setMergeContent] = useState("");
  const [indexState, setIndexState] = useState("idle");
  const [message, setMessage] = useState("");
  const [listAttempt, setListAttempt] = useState(0);
  const preview = useMemo(() => renderMarkdown(editorContent), [editorContent]);
  const dirty = Boolean(current && editorContent !== current.content);
  const candidateDocuments = searchResults.length || query || tag ? searchResults : documents;
  const displayedDocuments = candidateDocuments.slice(0, 250);

  const loadDocuments = useCallback(async () => {
    const result = await request("notes.list", {}, workspaceId);
    if (!result.ok) {
      setMessage(result.error.message);
      if (result.error.retryable) window.setTimeout(() => setListAttempt((attempt) => attempt + 1), 1_000);
      return;
    }
    setDocuments((result.data.documents as DocumentSummary[]) ?? []);
  }, [request, workspaceId]);

  const openDocument = useCallback(async (documentId: string) => {
    const result = await request("notes.read", { documentId }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    const document = result.data as unknown as OpenDocument;
    setCurrent(document);
    setEditorContent(document.content);
    setSavedRevision(document.revision);
    setRenamePath(document.path);
    setSaveState("Saved");
    setConflict(null);
    const historyResult = await request("notes.history", { documentId }, workspaceId);
    if (historyResult.ok) setHistory((historyResult.data.revisions as Revision[]) ?? []);
  }, [request, workspaceId]);

  useEffect(() => {
    setCurrent(null);
    setEditorContent("");
    setSearchResults([]);
    void loadDocuments();
  }, [loadDocuments, workspaceId, listAttempt]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const result = await request("notes.indexStatus", {}, workspaceId);
      if (result.ok) setIndexState(String(result.data.state));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [request, workspaceId]);

  const createNote = async () => {
    const path = newPath.trim().toLocaleLowerCase().endsWith(".md") ? newPath.trim() : `${newPath.trim()}.md`;
    if (!path || path === ".md") return;
    const title = path.split("/").at(-1)!.replace(/\.md$/i, "");
    const result = await request("notes.create", { path, content: `# ${title}\n\n` }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    setNewPath("");
    await loadDocuments();
    await openDocument(String(result.data.id));
  };

  const save = useCallback(async () => {
    if (!current || !dirty) return;
    setSaveState("Saving…");
    const result = await request("notes.save", { documentId: current.id, content: editorContent, expectedRevision: savedRevision }, workspaceId);
    if (!result.ok) { setSaveState("Save failed"); setMessage(result.error.message); return; }
    if (result.data.status === "conflict") {
      const nextConflict = result.data as unknown as { disk: OpenDocument; editorContent: string };
      setConflict(nextConflict);
      setMergeContent(`${nextConflict.disk.content}\n\n---\n\n${nextConflict.editorContent}`);
      setSaveState("Conflict");
      return;
    }
    const document = result.data.document as unknown as OpenDocument;
    setCurrent(document);
    setEditorContent(document.content);
    setSavedRevision(document.revision);
    setSaveState("Saved");
    await loadDocuments();
    const historyResult = await request("notes.history", { documentId: current.id }, workspaceId);
    if (historyResult.ok) setHistory((historyResult.data.revisions as Revision[]) ?? []);
  }, [current, dirty, editorContent, loadDocuments, request, savedRevision, workspaceId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") { event.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  const resolveConflict = async (strategy: "disk" | "editor" | "merge") => {
    if (!current || !conflict) return;
    const result = await request("notes.resolveConflict", {
      documentId: current.id,
      strategy,
      expectedDiskRevision: conflict.disk.revision,
      editorContent: conflict.editorContent,
      mergedContent: mergeContent,
    }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    if (result.data.status === "conflict") {
      setConflict(result.data as unknown as Conflict);
      setMessage("The disk changed again. Review the newest conflict.");
      return;
    }
    const document = result.data.document as unknown as OpenDocument;
    setCurrent(document);
    setEditorContent(document.content);
    setSavedRevision(document.revision);
    setConflict(null);
    setSaveState("Saved");
    const historyResult = await request("notes.history", { documentId: current.id }, workspaceId);
    if (historyResult.ok) setHistory((historyResult.data.revisions as Revision[]) ?? []);
  };

  const renameNote = async () => {
    if (!current || renamePath === current.path) return;
    const result = await request("notes.rename", { documentId: current.id, newPath: renamePath }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    await loadDocuments();
    await openDocument(current.id);
  };

  const search = async () => {
    const result = await request("notes.search", { query, ...(tag.trim() ? { tag: tag.trim() } : {}) }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    setSearchResults((result.data.results as DocumentSummary[]) ?? []);
  };

  const restore = async (revisionId: string) => {
    if (!current) return;
    const result = await request("notes.restore", { documentId: current.id, revisionId }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    await openDocument(current.id);
  };

  const openResolvedLink = (target: string) => {
    const link = current?.links.find((candidate) => candidate.target.toLocaleLowerCase() === target.toLocaleLowerCase() && candidate.status === "resolved");
    if (link?.resolvedId) void openDocument(link.resolvedId);
    else setMessage(`Link “${target}” is ${link?.status ?? "unresolved"}.`);
  };

  return (
    <section className="notes-workbench">
      <aside className="note-explorer">
        <div className="note-toolbar"><input aria-label="New note path" placeholder="New note.md" value={newPath} onChange={(event) => setNewPath(event.target.value)} /><button onClick={createNote} disabled={!newPath.trim()}>+</button></div>
        <div className="note-search"><input aria-label="Search notes" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} /><input aria-label="Filter tag" placeholder="#tag" value={tag} onChange={(event) => setTag(event.target.value)} /><button onClick={search}>Search</button></div>
        <div className="note-list" aria-label="Notes">
          {displayedDocuments.map((document) => <button key={document.id} className={current?.id === document.id ? "selected" : ""} onClick={() => void openDocument(document.id)}><strong>{document.title}</strong><small>{document.path}</small></button>)}
        </div>
        {candidateDocuments.length > displayedDocuments.length && <small className="note-list-limit">Showing first {displayedDocuments.length.toLocaleString()} of {candidateDocuments.length.toLocaleString()} notes. Search to narrow the list.</small>}
        <div className="index-status"><span className={`status-light ${indexState === "error" ? "crashed" : "ready"}`} /> Index {indexState}</div>
      </aside>

      <div className="note-main">
        {current ? <>
          <header className="editor-toolbar">
            <input aria-label="Note path" value={renamePath} onChange={(event) => setRenamePath(event.target.value)} />
            <button onClick={renameNote} disabled={renamePath === current.path}>Rename</button>
            <div className="view-toggle">{(["source", "split", "preview"] as const).map((view) => <button key={view} className={mode === view ? "selected" : ""} onClick={() => setMode(view)}>{view}</button>)}</div>
            <span data-testid="save-state">{dirty ? "Unsaved" : saveState}</span>
            <button className="primary compact" onClick={save} disabled={!dirty}>Save</button>
          </header>
          <div className={`editor-layout ${mode}`}>
            {mode !== "preview" && <div className="source-pane"><CodeMirror value={editorContent} height="100%" theme="dark" extensions={[markdown()]} onChange={(value) => { setEditorContent(value); setSaveState("Unsaved"); }} basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: false }} /></div>}
            {mode !== "source" && <article className="markdown-preview" onClick={(event) => { const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-note-target]"); if (anchor) { event.preventDefault(); openResolvedLink(anchor.dataset.noteTarget ?? ""); } }} dangerouslySetInnerHTML={{ __html: preview }} />}
          </div>
          <footer className="note-context">
            <details open><summary>Backlinks ({current.backlinks.length})</summary>{current.backlinks.map((backlink) => <button key={backlink.id} onClick={() => void openDocument(backlink.id)}>{backlink.title} · {backlink.path}</button>)}</details>
            <details><summary>Outgoing links ({current.links.length})</summary>{current.links.map((link, index) => <button key={`${link.target}-${index}`} onClick={() => link.resolvedId && void openDocument(link.resolvedId)} disabled={!link.resolvedId}>{link.alias ?? link.target} · {link.status}</button>)}</details>
            <details><summary>History ({history.length})</summary>{history.map((revision) => <button key={revision.id} onClick={() => void restore(revision.id)}>{revision.kind} · {new Date(revision.createdAt).toLocaleString()}</button>)}</details>
          </footer>
        </> : <div className="empty-editor"><span>◇</span><h2>Select or create a Markdown note</h2><p>Files stay ordinary and portable inside this workspace’s knowledge folder.</p></div>}
      </div>

      {conflict && <div className="conflict-panel" role="dialog" aria-modal="true" aria-labelledby="conflict-title"><h2 id="conflict-title">This note changed on disk</h2><p>Neither version was overwritten. Choose one or edit a merged result.</p><div className="conflict-versions"><pre>{conflict.disk.content}</pre><pre>{conflict.editorContent}</pre></div><textarea aria-label="Merged note content" value={mergeContent} onChange={(event) => setMergeContent(event.target.value)} /><div className="button-row"><button onClick={() => void resolveConflict("disk")}>Use disk version</button><button onClick={() => void resolveConflict("editor")}>Keep my version</button><button className="primary compact" onClick={() => void resolveConflict("merge")}>Save merged version</button></div></div>}
      {message && <div className="toast" role="status" onClick={() => setMessage("")}>{message}</div>}
    </section>
  );
}
