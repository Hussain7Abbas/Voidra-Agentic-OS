import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, session, WebContentsView, type Session } from "electron";
import type { ArtifactSource, ArtifactState, BrowserAction, BrowserActionResult, BrowserBounds, BrowserTabState } from "../shared/browser-contracts";
import { BROWSER_START_URL as START_URL, BrowserBoundaryError, containsPath, decodeArtifactPath, normalizeBrowserUrl } from "../domain/browser-policy";

type PersistedTab = Pick<BrowserTabState, "id" | "workspaceId" | "url" | "title">;
type TabRuntime = { state: BrowserTabState; view: WebContentsView; workspaceRoot: string; busy: boolean; allowedOrigins: Set<string> };
type ArtifactRecord = ArtifactState & { root: string };
type ArtifactRuntime = { record: ArtifactRecord; view: WebContentsView; protocolInstalled: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEXT_EXTENSIONS = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".txt", ".svg"]);
const MIME_TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

function cleanBounds(input: BrowserBounds): BrowserBounds {
  const values = [input.x, input.y, input.width, input.height];
  if (values.some((value) => !Number.isFinite(value))) throw new BrowserBoundaryError("Invalid embedded view bounds.");
  return { x: Math.max(0, Math.round(input.x)), y: Math.max(0, Math.round(input.y)), width: Math.max(1, Math.round(input.width)), height: Math.max(1, Math.round(input.height)) };
}

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function safeName(value: string) { return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "artifact"; }
function publicArtifact(record: ArtifactRecord): ArtifactState { const { root: _root, ...state } = record; return state; }

export class BrowserManager {
  readonly #tabs = new Map<string, TabRuntime>();
  readonly #sessions = new Map<string, Session>();
  readonly #artifacts = new Map<string, ArtifactRuntime>();
  readonly #statePath: string;
  #activeView: WebContentsView | null = null;
  #persistQueue: Promise<void> = Promise.resolve();

  constructor(private readonly window: BrowserWindow, userDataPath: string, private readonly onUpdate: (workspaceId: string) => void) {
    this.#statePath = join(userDataPath, "browser", "tabs.json");
  }

  async initialize() {
    let tabs: PersistedTab[] = [];
    try { tabs = JSON.parse(await readFile(this.#statePath, "utf8")) as PersistedTab[]; } catch { /* First launch or invalid stale state. */ }
    for (const tab of tabs) {
      if (!UUID.test(tab.id) || !UUID.test(tab.workspaceId)) continue;
      this.#createRuntime(tab.workspaceId, "", tab.url, tab.id, tab.title);
    }
  }

  async #assertWorkspace(workspaceId: string, workspaceRoot: string) {
    if (!UUID.test(workspaceId) || !isAbsolute(workspaceRoot)) throw new BrowserBoundaryError("Invalid workspace identity.");
    const canonical = await realpath(workspaceRoot);
    const manifest = JSON.parse(await readFile(join(canonical, ".voidra", "workspace.json"), "utf8")) as { workspaceId?: string };
    if (manifest.workspaceId !== workspaceId) throw new BrowserBoundaryError("Workspace path does not match its identity.");
    return canonical;
  }

  #session(workspaceId: string, workspaceRoot: string) {
    const existing = this.#sessions.get(workspaceId);
    if (existing) return existing;
    const browserSession = session.fromPartition(`persist:voidra-workspace-${workspaceId}`);
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.on("will-download", (_event, item, webContents) => {
      const tab = [...this.#tabs.values()].find((candidate) => candidate.view.webContents.id === webContents.id);
      if (!tab || !tab.workspaceRoot) { item.cancel(); return; }
      const directory = join(tab.workspaceRoot, "Downloads");
      const filename = basename(item.getFilename()).replace(/[^A-Za-z0-9._ -]/g, "_") || `download-${Date.now()}`;
      try { mkdirSync(directory, { recursive: true }); item.setSavePath(join(directory, filename)); } catch { item.cancel(); }
    });
    this.#sessions.set(workspaceId, browserSession);
    return browserSession;
  }

  #createRuntime(workspaceId: string, workspaceRoot: string, url = START_URL, id: string = randomUUID(), title = "New tab") {
    const view = new WebContentsView({ webPreferences: { session: this.#session(workspaceId, workspaceRoot), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, safeDialogs: true } });
    const state: BrowserTabState = { id, workspaceId, sessionId: `workspace-${workspaceId}`, url, title, documentId: randomUUID(), canGoBack: false, canGoForward: false, loading: false, crashed: false, control: "user", assignedTaskId: null, blockedReason: null };
    const runtime: TabRuntime = { state, view, workspaceRoot, busy: false, allowedOrigins: new Set() };
    this.#tabs.set(id, runtime);
    view.webContents.setWindowOpenHandler((details) => { state.blockedReason = `Popup blocked: ${details.url}`; this.#emit(state.workspaceId); return { action: "deny" }; });
    view.webContents.on("will-navigate", (event, target) => {
      try {
        const normalized = normalizeBrowserUrl(target);
        if (state.control === "agent" && !this.#agentOriginAllowed(runtime, normalized)) throw new BrowserBoundaryError("Agent navigation left its approved origin.");
      } catch (error) { event.preventDefault(); state.blockedReason = error instanceof Error ? error.message : "Navigation blocked."; this.#emit(state.workspaceId); }
    });
    view.webContents.on("will-redirect", (event, target) => {
      try {
        const normalized = normalizeBrowserUrl(target);
        if (state.control === "agent" && !this.#agentOriginAllowed(runtime, normalized)) throw new BrowserBoundaryError("Redirect left the agent's approved origin.");
      } catch (error) { event.preventDefault(); state.blockedReason = error instanceof Error ? error.message : "Redirect blocked."; this.#emit(state.workspaceId); }
    });
    view.webContents.on("did-start-loading", () => { state.loading = true; this.#emit(state.workspaceId); });
    view.webContents.on("did-stop-loading", () => { state.loading = false; this.#refreshState(runtime); });
    view.webContents.on("did-navigate", (_event, target) => { state.url = target; state.documentId = randomUUID(); state.crashed = false; this.#refreshState(runtime); });
    view.webContents.on("did-navigate-in-page", (_event, target) => { state.url = target; state.documentId = randomUUID(); this.#refreshState(runtime); });
    view.webContents.on("page-title-updated", (_event, nextTitle) => { state.title = nextTitle || state.url; this.#emit(state.workspaceId); });
    view.webContents.on("render-process-gone", () => { state.crashed = true; state.loading = false; state.blockedReason = "The page renderer stopped. Reload to recover."; this.#emit(state.workspaceId); });
    void view.webContents.loadURL(normalizeBrowserUrl(url)).catch((error) => { state.loading = false; state.blockedReason = error.message; this.#emit(state.workspaceId); });
    return runtime;
  }

  #agentOriginAllowed(runtime: TabRuntime, target: string) {
    if (target === START_URL) return true;
    try { return runtime.allowedOrigins.has(new URL(target).origin); } catch { return false; }
  }

  #refreshState(runtime: TabRuntime) {
    const contents = runtime.view.webContents;
    if (!contents.isDestroyed()) {
      runtime.state.url = contents.getURL() || runtime.state.url;
      runtime.state.title = contents.getTitle() || runtime.state.title;
      runtime.state.canGoBack = contents.navigationHistory.canGoBack();
      runtime.state.canGoForward = contents.navigationHistory.canGoForward();
    }
    this.#emit(runtime.state.workspaceId);
  }

  #emit(workspaceId: string) { this.#persistQueue = this.#persistQueue.then(() => this.#persist()).catch(() => undefined); this.onUpdate(workspaceId); }
  async #persist() {
    await mkdir(resolve(this.#statePath, ".."), { recursive: true });
    const temporary = `${this.#statePath}.tmp`;
    const state: PersistedTab[] = [...this.#tabs.values()].map(({ state: tab }) => ({ id: tab.id, workspaceId: tab.workspaceId, url: tab.url, title: tab.title }));
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temporary, this.#statePath);
  }

  async list(workspaceId: string, workspaceRoot: string) {
    const canonical = await this.#assertWorkspace(workspaceId, workspaceRoot);
    for (const runtime of this.#tabs.values()) if (runtime.state.workspaceId === workspaceId && !runtime.workspaceRoot) runtime.workspaceRoot = canonical;
    const tabs = [...this.#tabs.values()].filter(({ state }) => state.workspaceId === workspaceId).map(({ state }) => ({ ...state }));
    const artifacts = await this.listArtifacts(workspaceId, canonical);
    return { tabs, artifacts };
  }

  async create(workspaceId: string, workspaceRoot: string, url?: string) {
    const canonical = await this.#assertWorkspace(workspaceId, workspaceRoot);
    const runtime = this.#createRuntime(workspaceId, canonical, normalizeBrowserUrl(url ?? START_URL));
    this.#emit(workspaceId);
    return { ...runtime.state };
  }

  #require(workspaceId: string, tabId: string) {
    const runtime = this.#tabs.get(tabId);
    if (!runtime || runtime.state.workspaceId !== workspaceId) throw new BrowserBoundaryError("Browser tab does not belong to this workspace.");
    return runtime;
  }

  activate(workspaceId: string, tabId: string, bounds: BrowserBounds) {
    const runtime = this.#require(workspaceId, tabId);
    this.#showView(runtime.view, bounds);
    return { ...runtime.state };
  }

  setBounds(workspaceId: string, tabId: string, bounds: BrowserBounds) { const runtime = this.#require(workspaceId, tabId); if (this.#activeView === runtime.view) runtime.view.setBounds(cleanBounds(bounds)); }
  hide() { if (this.#activeView) this.window.contentView.removeChildView(this.#activeView); this.#activeView = null; }
  #showView(view: WebContentsView, bounds: BrowserBounds) { this.hide(); this.window.contentView.addChildView(view); view.setBounds(cleanBounds(bounds)); this.#activeView = view; }

  close(workspaceId: string, tabId: string) {
    const runtime = this.#require(workspaceId, tabId);
    if (runtime.busy) throw new BrowserBoundaryError("The tab has an action in progress.");
    if (this.#activeView === runtime.view) this.hide();
    runtime.view.webContents.close(); this.#tabs.delete(tabId); this.#emit(workspaceId);
  }

  async navigate(workspaceId: string, tabId: string, url: string) { const runtime = this.#require(workspaceId, tabId); runtime.state.control = "user"; runtime.state.assignedTaskId = null; runtime.allowedOrigins.clear(); await runtime.view.webContents.loadURL(normalizeBrowserUrl(url)); return { ...runtime.state }; }
  back(workspaceId: string, tabId: string) { const runtime = this.#require(workspaceId, tabId); if (runtime.view.webContents.navigationHistory.canGoBack()) runtime.view.webContents.navigationHistory.goBack(); }
  forward(workspaceId: string, tabId: string) { const runtime = this.#require(workspaceId, tabId); if (runtime.view.webContents.navigationHistory.canGoForward()) runtime.view.webContents.navigationHistory.goForward(); }
  reload(workspaceId: string, tabId: string) { const runtime = this.#require(workspaceId, tabId); runtime.state.crashed = false; runtime.state.blockedReason = null; runtime.view.webContents.reload(); }

  assign(workspaceId: string, tabId: string, taskId: string) {
    if (!UUID.test(taskId)) throw new BrowserBoundaryError("Invalid task identity.");
    const runtime = this.#require(workspaceId, tabId);
    if (runtime.busy) throw new BrowserBoundaryError("The tab has an action in progress.");
    runtime.state.control = "agent"; runtime.state.assignedTaskId = taskId; runtime.allowedOrigins.clear();
    try { runtime.allowedOrigins.add(new URL(runtime.state.url).origin); } catch { /* New tab has no remote origin. */ }
    this.#emit(workspaceId); return { ...runtime.state };
  }
  takeover(workspaceId: string, tabId: string) { const runtime = this.#require(workspaceId, tabId); runtime.state.control = "takeover"; this.#emit(workspaceId); return { ...runtime.state }; }
  resume(workspaceId: string, tabId: string) { const runtime = this.#require(workspaceId, tabId); if (!runtime.state.assignedTaskId) throw new BrowserBoundaryError("No agent task is assigned."); runtime.state.control = "agent"; this.#emit(workspaceId); return { ...runtime.state }; }

  assignedTabs(workspaceId: string, taskId: string) {
    return [...this.#tabs.values()].filter(({ state }) => state.workspaceId === workspaceId && state.assignedTaskId === taskId && state.control === "agent").map(({ state }) => ({ id: state.id, url: state.url, title: state.title, documentId: state.documentId }));
  }

  async action(workspaceId: string, tabId: string, taskId: string, expectedDocumentId: string, action: BrowserAction): Promise<BrowserActionResult> {
    const runtime = this.#require(workspaceId, tabId);
    if (runtime.busy) throw new BrowserBoundaryError("The tab already has an action in progress.");
    if (runtime.state.control !== "agent" || runtime.state.assignedTaskId !== taskId) throw new BrowserBoundaryError("Agent control is paused or assigned to another task.");
    if (runtime.state.documentId !== expectedDocumentId) throw new BrowserBoundaryError("The page changed; inspect the current document before acting again.");
    runtime.busy = true;
    try {
      if (action.kind === "navigate") {
        const target = normalizeBrowserUrl(action.url); runtime.allowedOrigins.add(new URL(target).origin); await runtime.view.webContents.loadURL(target);
      } else if (action.kind === "read") {
        const text = await runtime.view.webContents.executeJavaScript("document.body?.innerText?.slice(0, 100000) ?? ''");
        return { documentId: runtime.state.documentId, url: runtime.view.webContents.getURL(), title: runtime.view.webContents.getTitle(), text };
      } else if (action.kind === "wait") {
        const timeout = Math.min(10_000, Math.max(50, action.timeoutMs ?? 5_000));
        await runtime.view.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+${timeout};const tick=()=>{if(document.querySelector(${JSON.stringify(action.selector)}))resolve(true);else if(Date.now()>=end)reject(new Error('Timed out waiting for selector'));else setTimeout(tick,50)};tick()})`);
      } else {
        const payload = JSON.stringify(action);
        const outcome = await runtime.view.webContents.executeJavaScript(`(()=>{const a=${payload};const el=document.querySelector(a.selector);if(!el)throw new Error('Target not found');if(a.kind==='click'){const uncertain=el.matches('button[type=submit],input[type=submit]')||Boolean(el.closest('form'));el.click();return {uncertain}}if(a.kind==='type'){el.focus();el.value=a.text;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:a.text}));el.dispatchEvent(new Event('change',{bubbles:true}));return {uncertain:false}}if(a.kind==='select'){el.value=a.value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return {uncertain:false}}throw new Error('Unsupported action')})()`);
        return { documentId: runtime.state.documentId, url: runtime.view.webContents.getURL(), title: runtime.view.webContents.getTitle(), uncertain: Boolean(outcome?.uncertain) };
      }
      this.#refreshState(runtime);
      return { documentId: runtime.state.documentId, url: runtime.view.webContents.getURL(), title: runtime.view.webContents.getTitle() };
    } finally { runtime.busy = false; }
  }

  async #artifactRegistry(workspaceRoot: string): Promise<ArtifactRecord[]> {
    try {
      const records = JSON.parse(await readFile(join(workspaceRoot, ".voidra", "artifacts.json"), "utf8")) as ArtifactRecord[];
      return Array.isArray(records) ? records : [];
    } catch { return []; }
  }

  async #writeArtifactRegistry(workspaceRoot: string, records: ArtifactRecord[]) {
    const target = join(workspaceRoot, ".voidra", "artifacts.json"); const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`); await rename(temporary, target);
  }

  async #artifactFiles(root: string) {
    const output: string[] = [];
    const walk = async (directory: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name); const relativePath = relative(root, path).split(sep).join("/");
        if (entry.isSymbolicLink()) throw new BrowserBoundaryError("Artifact bundles cannot contain symbolic links.");
        if (entry.isDirectory()) await walk(path); else if (entry.isFile()) output.push(relativePath);
      }
    };
    await walk(root); return output.sort();
  }

  async #artifactRevision(root: string, files: string[]) {
    const digest = createHash("sha256");
    for (const file of files) { digest.update(file); digest.update(await readFile(join(root, file))); }
    return digest.digest("hex");
  }

  async listArtifacts(workspaceId: string, workspaceRoot: string) {
    const canonical = await this.#assertWorkspace(workspaceId, workspaceRoot);
    const records = (await this.#artifactRegistry(canonical)).filter((record) => record.workspaceId === workspaceId && containsPath(canonical, record.root));
    return records.map(publicArtifact);
  }

  async createArtifact(workspaceId: string, workspaceRoot: string, input: { name: string; runId?: string | null; sourceNoteIds?: string[] }) {
    const canonical = await this.#assertWorkspace(workspaceId, workspaceRoot); const id = randomUUID();
    const root = join(canonical, ".voidra", "artifacts", id); await mkdir(root, { recursive: true });
    await writeFile(join(root, "index.html"), `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="style.css"><title>${safeName(input.name)}</title></head><body><main><h1>${safeName(input.name)}</h1><button id="demo">Interactive preview</button><output id="result"></output></main><script src="script.js"></script></body></html>\n`);
    await writeFile(join(root, "style.css"), "body { font-family: system-ui; padding: 2rem; background: #f7f9fc; color: #172033; }\nbutton { padding: .65rem 1rem; }\n");
    await writeFile(join(root, "script.js"), "document.querySelector('#demo')?.addEventListener('click', () => { document.querySelector('#result').textContent = ' Script ran in the isolated preview.'; });\n");
    const files = await this.#artifactFiles(root); const now = new Date().toISOString();
    const record: ArtifactRecord = { id, workspaceId, runId: input.runId && UUID.test(input.runId) ? input.runId : null, name: input.name.trim().slice(0, 120) || "Artifact", entryFile: "index.html", sourceNoteIds: (input.sourceNoteIds ?? []).slice(0, 100), files, revision: await this.#artifactRevision(root, files), createdAt: now, updatedAt: now, root };
    const records = await this.#artifactRegistry(canonical); records.push(record); await this.#writeArtifactRegistry(canonical, records); return publicArtifact(record);
  }

  async #requireArtifact(workspaceId: string, workspaceRoot: string, artifactId: string) {
    const canonical = await this.#assertWorkspace(workspaceId, workspaceRoot);
    const record = (await this.#artifactRegistry(canonical)).find((candidate) => candidate.id === artifactId && candidate.workspaceId === workspaceId);
    if (!record || !containsPath(canonical, record.root)) throw new BrowserBoundaryError("Artifact does not belong to this workspace.");
    const root = await realpath(record.root); if (!containsPath(canonical, root)) throw new BrowserBoundaryError("Artifact root escaped its workspace.");
    return { canonical, record: { ...record, root } };
  }

  async #artifactPath(root: string, relativePath: string) {
    const safe = decodeArtifactPath(`/${relativePath}`); const candidate = resolve(root, safe);
    if (!containsPath(root, candidate)) throw new BrowserBoundaryError("Artifact path escapes are not allowed.");
    const info = await lstat(candidate); if (info.isSymbolicLink()) throw new BrowserBoundaryError("Artifact symbolic links are not allowed.");
    const canonical = await realpath(candidate); if (!containsPath(root, canonical)) throw new BrowserBoundaryError("Artifact path escaped through a symbolic link.");
    return canonical;
  }

  async readArtifact(workspaceId: string, workspaceRoot: string, artifactId: string, path: string): Promise<ArtifactSource> {
    const { record } = await this.#requireArtifact(workspaceId, workspaceRoot, artifactId); const candidate = await this.#artifactPath(record.root, path);
    if (!TEXT_EXTENSIONS.has(extname(candidate).toLowerCase())) throw new BrowserBoundaryError("This artifact asset is not editable as text.");
    return { artifact: publicArtifact(record), path, content: await readFile(candidate, "utf8") };
  }

  async saveArtifact(workspaceId: string, workspaceRoot: string, artifactId: string, path: string, content: string, expectedRevision: string) {
    if (content.length > 5_000_000) throw new BrowserBoundaryError("Artifact source is too large.");
    const { canonical, record } = await this.#requireArtifact(workspaceId, workspaceRoot, artifactId);
    if (record.revision !== expectedRevision) throw new BrowserBoundaryError("Artifact changed on disk; reload before saving.");
    const candidate = await this.#artifactPath(record.root, path); if (!TEXT_EXTENSIONS.has(extname(candidate).toLowerCase())) throw new BrowserBoundaryError("This artifact asset is not editable as text.");
    await writeFile(candidate, content, "utf8"); record.files = await this.#artifactFiles(record.root); record.revision = await this.#artifactRevision(record.root, record.files); record.updatedAt = new Date().toISOString();
    const records = await this.#artifactRegistry(canonical); const index = records.findIndex((item) => item.id === artifactId); records[index] = record; await this.#writeArtifactRegistry(canonical, records);
    const runtime = this.#artifacts.get(artifactId); if (runtime && !runtime.view.webContents.isDestroyed()) { runtime.record = record; runtime.view.webContents.reloadIgnoringCache(); }
    return publicArtifact(record);
  }

  async previewArtifact(workspaceId: string, workspaceRoot: string, artifactId: string, bounds: BrowserBounds) {
    const { record } = await this.#requireArtifact(workspaceId, workspaceRoot, artifactId); let runtime = this.#artifacts.get(artifactId);
    if (!runtime) {
      const previewSession = session.fromPartition(`voidra-artifact-${artifactId}`);
      previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); previewSession.setPermissionCheckHandler(() => false);
      const view = new WebContentsView({ webPreferences: { session: previewSession, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, safeDialogs: true } });
      runtime = { record, view, protocolInstalled: false }; this.#artifacts.set(artifactId, runtime);
      await previewSession.protocol.handle("voidra-artifact", async (request) => {
        try {
          const url = new URL(request.url); if (url.hostname !== artifactId) return new Response("Not found", { status: 404 });
          const candidate = await this.#artifactPath(runtime!.record.root, url.pathname); const body = await readFile(candidate);
          return new Response(body, { headers: { "Content-Type": MIME_TYPES[extname(candidate).toLowerCase()] ?? "application/octet-stream", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" } });
        } catch { return new Response("Not found", { status: 404 }); }
      });
      runtime.protocolInstalled = true;
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      view.webContents.on("will-navigate", (event, target) => { if (!target.startsWith(`voidra-artifact://${artifactId}/`)) event.preventDefault(); });
      await view.webContents.loadURL(`voidra-artifact://${artifactId}/${record.entryFile}`);
    } else runtime.record = record;
    this.#showView(runtime.view, bounds); return publicArtifact(record);
  }

  setArtifactBounds(workspaceId: string, artifactId: string, bounds: BrowserBounds) { const runtime = this.#artifacts.get(artifactId); if (!runtime || runtime.record.workspaceId !== workspaceId) throw new BrowserBoundaryError("Artifact preview does not belong to this workspace."); if (this.#activeView === runtime.view) runtime.view.setBounds(cleanBounds(bounds)); }

  async exportArtifact(workspaceId: string, workspaceRoot: string, artifactId: string) {
    const { canonical, record } = await this.#requireArtifact(workspaceId, workspaceRoot, artifactId); const destinationRoot = join(canonical, "Artifact Exports"); await mkdir(destinationRoot, { recursive: true });
    const destination = join(destinationRoot, `${safeName(record.name)}-${record.revision.slice(0, 8)}`); try { await stat(destination); throw new BrowserBoundaryError("This artifact revision was already exported."); } catch (error) { if (error instanceof BrowserBoundaryError) throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await cp(record.root, destination, { recursive: true, errorOnExist: true, force: false }); return { path: destination, url: pathToFileURL(join(destination, record.entryFile)).toString() };
  }

  destroy() { this.hide(); for (const runtime of this.#tabs.values()) if (!runtime.view.webContents.isDestroyed()) runtime.view.webContents.close(); for (const runtime of this.#artifacts.values()) if (!runtime.view.webContents.isDestroyed()) runtime.view.webContents.close(); this.#tabs.clear(); this.#artifacts.clear(); }
}
