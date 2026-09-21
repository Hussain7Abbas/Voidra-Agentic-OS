import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { appendFile, chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, session, WebContentsView, type Session } from "electron";
import type { ArtifactCapabilityGrant, ArtifactCapabilityRequest, ArtifactReviewDecision, ArtifactSecurityReview, ArtifactSemanticReview, ArtifactSource, ArtifactStagedWrite, ArtifactState, BrowserAction, BrowserActionResult, BrowserBounds, BrowserTabState } from "../shared/browser-contracts";
import { BROWSER_START_URL as START_URL, BrowserBoundaryError, containsPath, decodeArtifactPath, normalizeBrowserUrl } from "../domain/browser-policy";
import { ArtifactSecurityReviewAgent, artifactManifestSchema } from "../domain/artifact-security";

type PersistedTab = Pick<BrowserTabState, "id" | "workspaceId" | "url" | "title">;
type TabRuntime = { state: BrowserTabState; view: WebContentsView; workspaceRoot: string; busy: boolean; allowedOrigins: Set<string> };
type ArtifactRecord = ArtifactState & { root: string };
type ArtifactRuntime = { record: ArtifactRecord; view: WebContentsView; protocolInstalled: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTIFACT_RENDERER_PAGE_LIMIT = 500;
const TEXT_EXTENSIONS = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".txt", ".svg", ".ts", ".tsx", ".md"]);
const MIME_TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

function cleanBounds(input: BrowserBounds): BrowserBounds {
  const values = [input.x, input.y, input.width, input.height];
  if (values.some((value) => !Number.isFinite(value))) throw new BrowserBoundaryError("Invalid embedded view bounds.");
  return { x: Math.max(0, Math.round(input.x)), y: Math.max(0, Math.round(input.y)), width: Math.max(1, Math.round(input.width)), height: Math.max(1, Math.round(input.height)) };
}

function hash(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function safeName(value: string) { return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "artifact"; }
function publicArtifact(record: ArtifactRecord): ArtifactState { const { root: _root, ...state } = record; return state; }

async function isolatedArtifactBuild(root: string, name: string) {
  const entry = join(__dirname, "..", "service", "artifact-builder.cjs");
  const dependencyRoot = app.isPackaged ? join(process.resourcesPath, "artifact-builder", "node_modules") : resolve(__dirname, "..", "..", "node_modules");
  const child = spawn(process.execPath, ["--max-old-space-size=256", entry], {
    cwd: app.getPath("temp"),
    env: { ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", NO_COLOR: "1", TERM: "dumb", NODE_PATH: dependencyRoot, TMPDIR: app.getPath("temp") },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify({ root, name }));
  return await new Promise<{ bundleDigest: string; files: string[] }>((resolvePromise, rejectPromise) => {
    let output = ""; let diagnostic = ""; let exceeded = false;
    const timeout = setTimeout(() => { child.kill("SIGKILL"); rejectPromise(new Error("Disposable artifact build exceeded its 20 second limit.")); }, 20_000);
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); if (output.length > 64_000) { exceeded = true; child.kill("SIGKILL"); } });
    child.stderr.on("data", (chunk: Buffer) => { diagnostic = `${diagnostic}${chunk.toString("utf8")}`.slice(-20_000); });
    child.once("error", (error) => { clearTimeout(timeout); rejectPromise(error); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (exceeded) { rejectPromise(new Error("Disposable artifact builder produced excessive output.")); return; }
      if (code !== 0) { rejectPromise(new Error(diagnostic.trim() || `Disposable artifact builder exited with code ${code}.`)); return; }
      try {
        const result = JSON.parse(output) as { bundleDigest?: unknown; files?: unknown };
        if (typeof result.bundleDigest !== "string" || !/^[a-f0-9]{64}$/.test(result.bundleDigest) || !Array.isArray(result.files) || result.files.some((file) => typeof file !== "string" || !file.startsWith("dist/"))) throw new Error("Disposable artifact builder returned an invalid receipt.");
        resolvePromise(result as { bundleDigest: string; files: string[] });
      } catch (error) { rejectPromise(error); }
    });
  });
}

async function isolatedArtifactReview(input: { manifest: unknown; files: Record<string, string>; sourceDigest: string; bundleDigest: string | null }) {
  const entry = join(__dirname, "..", "service", "artifact-reviewer.cjs");
  const child = spawn(process.execPath, [entry], {
    cwd: app.getPath("temp"),
    env: { ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", NO_COLOR: "1", TERM: "dumb" },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify(input));
  return await new Promise<ArtifactSecurityReview>((resolvePromise, rejectPromise) => {
    let output = ""; let diagnostic = "";
    const timeout = setTimeout(() => { child.kill("SIGKILL"); rejectPromise(new Error("Independent artifact security review timed out.")); }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); if (output.length > 2_000_000) child.kill("SIGKILL"); });
    child.stderr.on("data", (chunk: Buffer) => { diagnostic = `${diagnostic}${chunk.toString("utf8")}`.slice(-10_000); });
    child.once("error", (error) => { clearTimeout(timeout); rejectPromise(error); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) { rejectPromise(new Error(diagnostic.trim() || `Independent reviewer exited with code ${code}.`)); return; }
      try {
        const review = JSON.parse(output) as ArtifactSecurityReview;
        if (review.sourceDigest !== input.sourceDigest || review.bundleDigest !== input.bundleDigest || review.reviewer !== "voidra-isolated-security-agent/v1") throw new Error("Independent reviewer returned a mismatched identity or digest.");
        resolvePromise(review);
      } catch (error) { rejectPromise(error); }
    });
  });
}

export class BrowserManager {
  readonly #tabs = new Map<string, TabRuntime>();
  readonly #sessions = new Map<string, Session>();
  readonly #artifacts = new Map<string, ArtifactRuntime>();
  readonly #statePath: string;
  #activeView: WebContentsView | null = null;
  #persistQueue: Promise<void> = Promise.resolve();
  readonly #securityReviewer = new ArtifactSecurityReviewAgent();
  readonly #reviewKeyPath: string;
  readonly #capabilityAuditPath: string;
  #reviewKey: Buffer | null = null;
  #auditQueue: Promise<void> = Promise.resolve();
  readonly #capabilityWindows = new Map<string, number[]>();
  readonly #capabilityInflight = new Map<string, number>();

  constructor(
    private readonly window: BrowserWindow,
    userDataPath: string,
    private readonly onUpdate: (workspaceId: string) => void,
    private readonly prepareServiceCapability?: (workspaceId: string, operation: "mcp.callTool" | "mcp.readResource", scope: Record<string, unknown>, args: Record<string, unknown>) => Promise<unknown>,
    private readonly requestSemanticReview?: (workspaceId: string, input: { artifactId: string; purpose: string; manifest: Record<string, unknown>; files: Record<string, string>; sourceDigest: string; bundleDigest: string; staticReview: Pick<ArtifactSecurityReview, "reviewer" | "policyVersion" | "findings" | "filesExamined"> & { verdict: "pass" | "pass-with-low-risk-notes" } }) => Promise<ArtifactSemanticReview>,
  ) {
    this.#statePath = join(userDataPath, "browser", "tabs.json");
    this.#reviewKeyPath = join(userDataPath, "security", "artifact-review.key");
    this.#capabilityAuditPath = join(userDataPath, "security", "artifact-capability-journal.jsonl");
  }

  async initialize() {
    await this.#loadReviewKey();
    let tabs: PersistedTab[] = [];
    try { tabs = JSON.parse(await readFile(this.#statePath, "utf8")) as PersistedTab[]; } catch { /* First launch or invalid stale state. */ }
    for (const tab of tabs) {
      if (!UUID.test(tab.id) || !UUID.test(tab.workspaceId)) continue;
      this.#createRuntime(tab.workspaceId, "", tab.url, tab.id, tab.title);
    }
  }

  async #loadReviewKey() {
    await mkdir(dirname(this.#reviewKeyPath), { recursive: true });
    try { this.#reviewKey = await readFile(this.#reviewKeyPath); }
    catch {
      const key = randomBytes(32);
      try { await writeFile(this.#reviewKeyPath, key, { flag: "wx", mode: 0o600 }); }
      catch { /* Another app instance may have created it. */ }
      this.#reviewKey = await readFile(this.#reviewKeyPath);
    }
    if (this.#reviewKey.length !== 32) throw new BrowserBoundaryError("The artifact review signing key is invalid.");
  }

  #decisionPayload(decision: Omit<ArtifactReviewDecision, "signature">) { return JSON.stringify(decision); }

  #decisionSignature(decision: Omit<ArtifactReviewDecision, "signature">) {
    if (!this.#reviewKey) throw new BrowserBoundaryError("The artifact review signer is unavailable.");
    return createHmac("sha256", this.#reviewKey).update(this.#decisionPayload(decision)).digest("hex");
  }

  #beginCapabilityCall(artifactId: string, capabilityId: string, args: Record<string, unknown>) {
    let encoded: string;
    try { encoded = JSON.stringify(args); } catch { throw new BrowserBoundaryError("Artifact capability arguments must be serializable."); }
    if (Buffer.byteLength(encoded) > 256_000) throw new BrowserBoundaryError("Artifact capability arguments exceed the 256 KB limit.");
    const key = `${artifactId}:${capabilityId}`; const now = Date.now(); const recent = (this.#capabilityWindows.get(key) ?? []).filter((timestamp) => now - timestamp < 60_000);
    if (recent.length >= 30) throw new BrowserBoundaryError("Artifact capability rate limit exceeded.");
    if ((this.#capabilityInflight.get(key) ?? 0) >= 2) throw new BrowserBoundaryError("Too many concurrent artifact capability calls.");
    recent.push(now); this.#capabilityWindows.set(key, recent); this.#capabilityInflight.set(key, (this.#capabilityInflight.get(key) ?? 0) + 1);
    return { argsDigest: hash(encoded), release: () => this.#capabilityInflight.set(key, Math.max(0, (this.#capabilityInflight.get(key) ?? 1) - 1)) };
  }

  async #auditCapability(input: { workspaceId: string; artifactId: string; capabilityId: string; argsDigest: string; outcome: "allowed" | "denied"; reason: string | null }) {
    const record = { id: randomUUID(), at: new Date().toISOString(), ...input };
    const append = this.#auditQueue.then(() => appendFile(this.#capabilityAuditPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" }));
    this.#auditQueue = append.then(() => undefined, () => undefined); await append;
  }

  async #finalDecision(workspaceRoot: string, record: ArtifactRecord, staticReview: ArtifactSecurityReview, semanticReview: ArtifactSemanticReview) {
    if (!record.sourceDigest || !record.bundleDigest) throw new BrowserBoundaryError("Exact artifact digests are required for a final decision.");
    const journalPath = join(workspaceRoot, ".voidra", "artifact-review-journal.jsonl");
    let previousSignature: string | null = null;
    try {
      const lines = (await readFile(journalPath, "utf8")).trim().split("\n").filter(Boolean);
      if (lines.length) previousSignature = String((JSON.parse(lines.at(-1)!) as { signature?: unknown }).signature ?? "") || null;
    } catch { /* First decision. */ }
    const createdAt = new Date().toISOString();
    const blocking = semanticReview.verdict === "block" || semanticReview.findings.some((finding) => finding.severity !== "low");
    const incomplete = semanticReview.verdict === "incomplete" || semanticReview.unresolvedQuestions.length > 0 || semanticReview.checklist.some((item) => item.status === "unresolved");
    const verdict: ArtifactReviewDecision["verdict"] = incomplete ? "incomplete" : blocking ? "blocked" : "approved";
    const unsigned: Omit<ArtifactReviewDecision, "signature"> = {
      id: randomUUID(), policyVersion: "artifact-decision-policy-1", artifactId: record.id, workspaceId: record.workspaceId,
      sourceDigest: record.sourceDigest, bundleDigest: record.bundleDigest, staticReviewer: staticReview.reviewer, semanticReviewId: semanticReview.id,
      verdict, rationale: verdict === "approved" ? ["Deterministic, isolated build, semantic, exact-digest, and sandbox policy gates passed."] : verdict === "incomplete" ? ["Independent semantic review was incomplete or unresolved."] : ["Independent semantic review found a blocking risk."],
      createdAt, expiresAt: new Date(Date.parse(createdAt) + 30 * 24 * 60 * 60 * 1000).toISOString(), keyId: hash(this.#reviewKey!.toString("hex")).slice(0, 16), previousSignature,
    };
    const decision: ArtifactReviewDecision = { ...unsigned, signature: this.#decisionSignature(unsigned) };
    const append = this.#auditQueue.then(() => appendFile(journalPath, `${JSON.stringify({ ...decision, semanticReviewer: semanticReview.reviewer, evidenceMode: semanticReview.evidenceMode })}\n`, { encoding: "utf8", flag: "a" }));
    this.#auditQueue = append.then(() => undefined, () => undefined); await append;
    return decision;
  }

  async #assertApproved(record: ArtifactRecord) {
    const decision = record.reviewDecision;
    if (!decision || !record.semanticReview || !record.securityReview || !record.sourceDigest || !record.bundleDigest) throw new BrowserBoundaryError("The artifact has no complete final security decision.");
    const { signature, ...unsigned } = decision;
    const expected = Buffer.from(this.#decisionSignature(unsigned), "hex"); const received = Buffer.from(signature, "hex");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new BrowserBoundaryError("The artifact security decision signature is invalid.");
    if (decision.verdict !== "approved" || Date.parse(decision.expiresAt) <= Date.now()) throw new BrowserBoundaryError("The artifact security decision is blocked or expired.");
    if (decision.artifactId !== record.id || decision.workspaceId !== record.workspaceId || decision.sourceDigest !== record.sourceDigest || decision.bundleDigest !== record.bundleDigest || decision.semanticReviewId !== record.semanticReview.id) throw new BrowserBoundaryError("The artifact security decision does not match this exact version.");
    const input = await this.#componentInput(record);
    if (input.sourceDigest !== record.sourceDigest) throw new BrowserBoundaryError("Artifact source changed after security approval.");
    const builtDigest = hash(await readFile(join(record.root, "dist", "artifact.js")));
    if (builtDigest !== record.bundleDigest) throw new BrowserBoundaryError("Artifact bundle changed after security approval.");
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
      if (!Array.isArray(records)) return [];
      return records.map((record) => record.kind ? { ...record, versions: record.versions ?? [], legacySourceId: record.legacySourceId ?? null } : { ...record, kind: "legacy-html", reviewState: "legacy", sourceDigest: record.revision, bundleDigest: null, requestedCapabilities: [], grants: [], securityReview: null, semanticReview: null, reviewDecision: null, versions: [], legacySourceId: null });
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
    return this.searchArtifacts(workspaceId, workspaceRoot, {});
  }

  async searchArtifacts(workspaceId: string, workspaceRoot: string, input: { query?: string; kind?: "legacy-html" | "component" | null; reviewState?: ArtifactState["reviewState"] | null; limit?: number }) {
    const canonical = await this.#assertWorkspace(workspaceId, workspaceRoot);
    const records = (await this.#artifactRegistry(canonical)).filter((record) => record.workspaceId === workspaceId && containsPath(canonical, record.root));
    const query = input.query?.trim().toLowerCase() ?? "";
    return records.filter((record) => (!input.kind || record.kind === input.kind) && (!input.reviewState || record.reviewState === input.reviewState) && (!query || [record.name, record.kind ?? "legacy-html", record.reviewState ?? "legacy", record.runId ?? "", ...record.sourceNoteIds, ...record.files].join(" ").toLowerCase().includes(query))).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)).slice(0, Math.min(ARTIFACT_RENDERER_PAGE_LIMIT, Math.max(1, input.limit ?? ARTIFACT_RENDERER_PAGE_LIMIT))).map(publicArtifact);
  }

  async createArtifact(workspaceId: string, workspaceRoot: string, input: { name: string; runId?: string | null; sourceNoteIds?: string[] }) {
    const canonical = await this.#assertWorkspace(workspaceId, workspaceRoot); const id = randomUUID();
    const root = join(canonical, ".voidra", "artifacts", id); await mkdir(join(root, "src"), { recursive: true });
    const name = input.name.trim().slice(0, 120) || "Artifact";
    const manifest = { schemaVersion: 1, id, name, version: "1.0.0", entry: "src/Artifact.tsx", artifactUiVersion: "1", sdkVersion: "1", producer: { kind: "user", name: "Voidra artifact editor", model: null }, inputs: { noteIds: (input.sourceNoteIds ?? []).filter((value) => UUID.test(value)).slice(0, 100), runIds: input.runId && UUID.test(input.runId) ? [input.runId] : [], workspacePaths: [] }, output: { kind: "component", entryFile: "dist/index.html" }, assets: [], accessibility: { requiredStates: ["empty", "error", "stale", "permission", "review"], keyboardActions: ["Tab reaches every interactive control", "Enter or Space activates buttons"] }, networkPolicy: "broker-only", layout: { minWidth: 320, idealWidth: 720, minHeight: 320 }, requestedCapabilities: [] };
    await writeFile(join(root, "artifact.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(root, "src", "Artifact.tsx"), `"use client";\n\nimport { useState } from "react";\nimport { Action, Canvas, Metric, Module, Status } from "@voidra/artifact-ui";\n\nexport default function Artifact() {\n  const [count, setCount] = useState(0);\n  return (\n    <Canvas title=${JSON.stringify(name)} subtitle="Reviewed Voidra component artifact">\n      <Module label="LIVE COMPONENT">\n        <Metric value={String(count)} label="local interactions" />\n        <Status tone="ready">No capability requested</Status>\n        <Action onClick={() => setCount((value) => value + 1)}>Interact</Action>\n      </Module>\n    </Canvas>\n  );\n}\n`);
    await writeFile(join(root, "README.md"), `# ${name}\n\nThis React component artifact remains quarantined until its exact source and bundle digests pass deterministic and independent semantic security review.\n\n## Authoring contract\n\n- Import only \`react\`, \`@voidra/artifact-ui\`, or \`@voidra/artifact-sdk\`.\n- Use Canvas, Module, Metric, Status, Action, EmptyState, ErrorState, StaleState, PermissionPrompt, and ReviewAction instead of redefining host chrome.\n- Direct network, ambient storage, Node/Electron globals, raw HTML injection, workers, and unbounded timers are forbidden.\n- Declare every filesystem or MCP operation in \`artifact.json\`; capabilities are denied until the user grants the exact reviewed digest.\n- Writes are staged for review. Include keyboard operation, visible focus, reduced-motion behavior, and explicit empty/error/stale/permission/review states.\n`);
    const files = await this.#artifactFiles(root); const now = new Date().toISOString();
    const sourceDigest = await this.#artifactRevision(root, files);
    const record: ArtifactRecord = { id, workspaceId, runId: input.runId && UUID.test(input.runId) ? input.runId : null, name, entryFile: "dist/index.html", sourceNoteIds: (input.sourceNoteIds ?? []).slice(0, 100), files, revision: sourceDigest, createdAt: now, updatedAt: now, root, kind: "component", reviewState: "quarantined", sourceDigest, bundleDigest: null, requestedCapabilities: [], grants: [], securityReview: null, semanticReview: null, reviewDecision: null, versions: [], legacySourceId: null };
    const records = await this.#artifactRegistry(canonical); records.push(record); await this.#writeArtifactRegistry(canonical, records); return publicArtifact(record);
  }

  async convertLegacyArtifact(workspaceId: string, workspaceRoot: string, artifactId: string) {
    const { record: legacy } = await this.#requireArtifact(workspaceId, workspaceRoot, artifactId);
    if (legacy.kind !== "legacy-html") throw new BrowserBoundaryError("Only read-only legacy HTML artifacts need conversion.");
    const converted = await this.createArtifact(workspaceId, workspaceRoot, { name: `${legacy.name} component`, runId: legacy.runId, sourceNoteIds: legacy.sourceNoteIds });
    const { canonical, record } = await this.#requireArtifact(workspaceId, workspaceRoot, converted.id);
    const component = `"use client";\n\nimport { Action, Canvas, EmptyState, Module, ReviewAction, Status } from "@voidra/artifact-ui";\n\nexport default function Artifact() {\n  return (\n    <Canvas title=${JSON.stringify(`${legacy.name} component`)} subtitle="Guided conversion from a read-only legacy artifact">\n      <Module label="CONVERSION SCAFFOLD">\n        <Status tone="warning">Original HTML remains unchanged and isolated</Status>\n        <ReviewAction title="Rebuild with trusted primitives" description="Translate the useful data and interactions into reviewed React components. Do not copy scripts, raw HTML, credentials, or network behavior.">\n          <Action type="button">Review source contract</Action>\n        </ReviewAction>\n        <EmptyState title="No legacy behavior was executed" description="Add only the behavior this component needs, then request an exact-digest security review." />\n      </Module>\n    </Canvas>\n  );\n}\n`;
    await writeFile(join(record.root, "src", "Artifact.tsx"), component);
    const manifestPath = join(record.root, "artifact.json"); const manifest = JSON.parse(await readFile(manifestPath, "utf8")); manifest.producer = { kind: "legacy-conversion", name: "Voidra guided converter", model: null }; await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(record.root, "README.md"), `# ${record.name}\n\nGuided conversion scaffold for legacy artifact \`${legacy.id}\`. The original HTML is preserved read-only and was not copied or executed during conversion. Rebuild intended behavior using the Voidra artifact primitives and explicit capabilities, then run the security review.\n`);
    record.legacySourceId = legacy.id; record.files = await this.#artifactFiles(record.root); record.revision = await this.#artifactRevision(record.root, record.files); record.sourceDigest = record.revision; record.updatedAt = new Date().toISOString();
    const records = await this.#artifactRegistry(canonical); const index = records.findIndex((item) => item.id === record.id); records[index] = record; await this.#writeArtifactRegistry(canonical, records); this.#emit(workspaceId); return publicArtifact(record);
  }

  async #componentInput(record: ArtifactRecord) {
    const manifest = JSON.parse(await readFile(join(record.root, "artifact.json"), "utf8")) as unknown;
    const files: Record<string, string> = {};
    const sourceFiles = (await this.#artifactFiles(record.root)).filter((path) => !path.startsWith("dist/"));
    if (sourceFiles.length > 500) throw new BrowserBoundaryError("Component artifacts are limited to 500 source files.");
    let totalBytes = 0;
    for (const path of sourceFiles) {
      const info = await stat(join(record.root, path));
      if (info.size > 5_000_000) throw new BrowserBoundaryError(`Artifact source file exceeds the 5 MB limit: ${path}`);
      totalBytes += info.size;
      if (totalBytes > 25_000_000) throw new BrowserBoundaryError("Component artifact source exceeds the 25 MB limit.");
      const extension = extname(path).toLowerCase();
      if (TEXT_EXTENSIONS.has(extension)) files[path] = await readFile(join(record.root, path), "utf8");
    }
    const sourceDigest = await this.#artifactRevision(record.root, sourceFiles);
    return { manifest, files, sourceFiles, sourceDigest };
  }

  async #buildComponent(record: ArtifactRecord, sourceFiles: string[], expectedSourceDigest: string) {
    const temporary = await mkdtemp(join(app.getPath("temp"), "voidra-artifact-build-"));
    try {
      for (const path of sourceFiles) {
        const target = join(temporary, path);
        await mkdir(dirname(target), { recursive: true });
        await cp(join(record.root, path), target, { recursive: false, dereference: false, errorOnExist: true, force: false });
      }
      const copiedDigest = await this.#artifactRevision(temporary, sourceFiles);
      if (copiedDigest !== expectedSourceDigest) throw new BrowserBoundaryError("Artifact source changed while preparing its disposable build.");
      const receipt = await isolatedArtifactBuild(temporary, record.name);
      const builtFiles = await this.#artifactFiles(join(temporary, "dist"));
      if (builtFiles.join("\n") !== ["artifact.css", "artifact.js", "index.html"].join("\n")) throw new BrowserBoundaryError("Disposable artifact build emitted an unexpected file set.");
      const actualBundleDigest = hash(await readFile(join(temporary, "dist", "artifact.js")));
      if (actualBundleDigest !== receipt.bundleDigest) throw new BrowserBoundaryError("Disposable artifact build receipt did not match its bundle.");
      const dist = join(record.root, "dist");
      await rm(dist, { recursive: true, force: true });
      await cp(join(temporary, "dist"), dist, { recursive: true, dereference: false, errorOnExist: true, force: false });
      return actualBundleDigest;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }

  async #freezeTree(root: string) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) { await this.#freezeTree(path); await chmod(path, 0o755); }
      else if (entry.isFile()) await chmod(path, 0o444);
    }
    await chmod(root, 0o755);
  }

  async #snapshotApprovedArtifact(workspaceRoot: string, record: ArtifactRecord) {
    if (!record.sourceDigest || !record.bundleDigest || !record.reviewDecision || record.reviewDecision.verdict !== "approved") return;
    if (record.versions?.some((version) => version.sourceDigest === record.sourceDigest && version.bundleDigest === record.bundleDigest)) return;
    const relativePath = join(".voidra", "artifact-versions", record.id, record.sourceDigest).split(sep).join("/");
    const target = join(workspaceRoot, relativePath);
    try { await stat(target); throw new BrowserBoundaryError("An immutable snapshot already exists for this digest but is absent from the registry."); }
    catch (error) { if (error instanceof BrowserBoundaryError || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = dirname(target); await mkdir(parent, { recursive: true });
    const staging = join(parent, `.snapshot-${randomUUID()}`);
    try {
      await cp(record.root, staging, { recursive: true, dereference: false, errorOnExist: true, force: false });
      const snapshotFiles = await this.#artifactFiles(staging);
      const sourceFiles = snapshotFiles.filter((path) => !path.startsWith("dist/"));
      if (await this.#artifactRevision(staging, sourceFiles) !== record.sourceDigest || hash(await readFile(join(staging, "dist", "artifact.js"))) !== record.bundleDigest) throw new BrowserBoundaryError("Immutable artifact snapshot did not match the approved digests.");
      await this.#freezeTree(staging);
      await rename(staging, target);
    } catch (error) { await rm(staging, { recursive: true, force: true }).catch(() => undefined); throw error; }
    record.versions = [...(record.versions ?? []), { sourceDigest: record.sourceDigest, bundleDigest: record.bundleDigest, reviewDecisionId: record.reviewDecision.id, createdAt: new Date().toISOString(), snapshotRelativePath: relativePath }];
  }

  async rollbackArtifact(workspaceId: string, workspaceRoot: string, artifactId: string, sourceDigest: string) {
    const { canonical, record } = await this.#requireArtifact(workspaceId, workspaceRoot, artifactId);
    if (record.kind !== "component") throw new BrowserBoundaryError("Only component artifacts have immutable versions.");
    const version = record.versions?.find((candidate) => candidate.sourceDigest === sourceDigest);
    if (!version || !/^[a-f0-9]{64}$/.test(sourceDigest)) throw new BrowserBoundaryError("The requested immutable artifact version does not exist.");
    const expectedPath = join(canonical, ".voidra", "artifact-versions", artifactId, sourceDigest);
    const snapshot = await realpath(resolve(canonical, version.snapshotRelativePath));
    if (snapshot !== await realpath(expectedPath) || !containsPath(canonical, snapshot)) throw new BrowserBoundaryError("The artifact version snapshot path is invalid.");
    const staging = join(dirname(record.root), `.restore-${randomUUID()}`);
    const backup = join(dirname(record.root), `.rollback-${randomUUID()}`);
    await cp(snapshot, staging, { recursive: true, dereference: false, errorOnExist: true, force: false });
    await chmod(staging, 0o755);
    const makeWritable = async (root: string) => { for (const entry of await readdir(root, { withFileTypes: true })) { const path = join(root, entry.name); if (entry.isDirectory()) { await chmod(path, 0o755); await makeWritable(path); } else if (entry.isFile()) await chmod(path, 0o644); } };
    await makeWritable(staging);
    const stagedFiles = await this.#artifactFiles(staging); const stagedSourceFiles = stagedFiles.filter((path) => !path.startsWith("dist/"));
    if (await this.#artifactRevision(staging, stagedSourceFiles) !== version.sourceDigest || hash(await readFile(join(staging, "dist", "artifact.js"))) !== version.bundleDigest) { await rm(staging, { recursive: true, force: true }); throw new BrowserBoundaryError("The immutable artifact snapshot failed digest verification."); }
    try {
      await rename(record.root, backup); await rename(staging, record.root);
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      try { await stat(backup); await rename(backup, record.root); } catch { /* Preserve the original error. */ }
      await rm(staging, { recursive: true, force: true }).catch(() => undefined); throw error;
    }
    record.files = await this.#artifactFiles(record.root); record.revision = await this.#artifactRevision(record.root, record.files); record.sourceDigest = version.sourceDigest; record.bundleDigest = null; record.reviewState = "quarantined"; record.securityReview = null; record.semanticReview = null; record.reviewDecision = null; record.grants = []; record.updatedAt = new Date().toISOString();
    const records = await this.#artifactRegistry(canonical); const index = records.findIndex((item) => item.id === artifactId); records[index] = record; await this.#writeArtifactRegistry(canonical, records); this.#artifacts.get(artifactId)?.view.webContents.reloadIgnoringCache(); this.#emit(workspaceId); return publicArtifact(record);
  }

  async reviewArtifact(workspaceId: string, workspaceRoot: string, artifactId: string) {
    const { canonical, record } = await this.#requireArtifact(workspaceId, workspaceRoot, artifactId);
    if (record.kind !== "component") throw new BrowserBoundaryError("Legacy HTML cannot be promoted; convert it to a component artifact first.");
    const input = await this.#componentInput(record);
    const preflight = this.#securityReviewer.review({ ...input, bundleDigest: null });
    if (preflight.verdict === "block" || preflight.verdict === "incomplete") {
      record.reviewState = preflight.verdict === "incomplete" ? "quarantined" : "blocked"; record.sourceDigest = input.sourceDigest; record.bundleDigest = null; record.securityReview = preflight; record.semanticReview = null; record.reviewDecision = null; record.grants = [];
    } else {
      try {
        const bundleDigest = await this.#buildComponent(record, input.sourceFiles, input.sourceDigest);
        const finalReview = await isolatedArtifactReview({ ...input, bundleDigest });
        record.sourceDigest = input.sourceDigest; record.bundleDigest = bundleDigest; record.securityReview = finalReview;
        record.requestedCapabilities = artifactManifestSchema.parse(input.manifest).requestedCapabilities;
        record.grants = [];
        if (finalReview.verdict !== "pass" && finalReview.verdict !== "pass-with-low-risk-notes") {
          record.reviewState = finalReview.verdict === "incomplete" ? "quarantined" : "blocked"; record.semanticReview = null; record.reviewDecision = null;
        } else {
          if (!this.requestSemanticReview) throw new BrowserBoundaryError("The independent semantic security reviewer is unavailable.");
          const semanticReview = await this.requestSemanticReview(workspaceId, {
            artifactId: record.id, purpose: record.name, manifest: artifactManifestSchema.parse(input.manifest) as unknown as Record<string, unknown>, files: input.files, sourceDigest: input.sourceDigest, bundleDigest,
            staticReview: { reviewer: finalReview.reviewer, policyVersion: finalReview.policyVersion, verdict: finalReview.verdict as "pass" | "pass-with-low-risk-notes", findings: finalReview.findings, filesExamined: finalReview.filesExamined },
          });
          if (semanticReview.sourceDigest !== input.sourceDigest || semanticReview.bundleDigest !== bundleDigest) throw new BrowserBoundaryError("The semantic reviewer returned mismatched artifact digests.");
          record.semanticReview = semanticReview;
          record.reviewDecision = await this.#finalDecision(canonical, record, finalReview, semanticReview);
          record.reviewState = record.reviewDecision.verdict === "approved" ? "approved" : record.reviewDecision.verdict === "blocked" ? "blocked" : "quarantined";
          if (record.reviewState === "approved") await this.#snapshotApprovedArtifact(canonical, record);
        }
      } catch (error) {
        record.reviewState = "quarantined"; record.grants = []; record.semanticReview = null; record.reviewDecision = null;
        record.securityReview = { ...preflight, verdict: "incomplete", findings: [...preflight.findings, { severity: "high", category: "review-pipeline", file: "src/Artifact.tsx", evidence: error instanceof Error ? error.message.slice(0, 500) : "Artifact review pipeline failed", remediation: "Restore the build and independent reviewer, then request a new review." }] };
      }
    }
    record.files = await this.#artifactFiles(record.root); record.revision = await this.#artifactRevision(record.root, record.files); record.updatedAt = new Date().toISOString();
    const records = await this.#artifactRegistry(canonical); const index = records.findIndex((item) => item.id === artifactId); records[index] = record; await this.#writeArtifactRegistry(canonical, records); this.#emit(workspaceId);
    return publicArtifact(record);
  }

  async grantArtifactCapability(workspaceId: string, workspaceRoot: string, artifactId: string, capabilityId: string) {
    const { canonical, record } = await this.#requireArtifact(workspaceId, workspaceRoot, artifactId);
    if (record.kind !== "component" || record.reviewState !== "approved" || !record.sourceDigest) throw new BrowserBoundaryError("Only an approved component digest can receive capabilities.");
    await this.#assertApproved(record);
    const request = record.requestedCapabilities?.find((item) => item.id === capabilityId);
    if (!request) throw new BrowserBoundaryError("The artifact did not declare this capability.");
    const grant: ArtifactCapabilityGrant = { ...request, artifactDigest: record.sourceDigest, grantedAt: new Date().toISOString(), expiresAt: record.reviewDecision!.expiresAt, revokedAt: null };
    record.grants = [...(record.grants ?? []).filter((item) => item.id !== capabilityId), grant]; record.updatedAt = new Date().toISOString();
    const records = await this.#artifactRegistry(canonical); const index = records.findIndex((item) => item.id === artifactId); records[index] = record; await this.#writeArtifactRegistry(canonical, records); return publicArtifact(record);
  }

  async revokeArtifactCapability(workspaceId: string, workspaceRoot: string, artifactId: string, capabilityId: string) {
    const { canonical, record } = await this.#requireArtifact(workspaceId, workspaceRoot, artifactId); const revokedAt = new Date().toISOString();
    record.grants = (record.grants ?? []).map((item) => item.id === capabilityId ? { ...item, revokedAt } : item); record.updatedAt = revokedAt;
    const records = await this.#artifactRegistry(canonical); const index = records.findIndex((item) => item.id === artifactId); records[index] = record; await this.#writeArtifactRegistry(canonical, records); return publicArtifact(record);
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
    if (record.kind !== "component") throw new BrowserBoundaryError("Legacy HTML artifacts are read-only. Convert them to a component artifact before editing.");
    if (path.startsWith("dist/")) throw new BrowserBoundaryError("Compiled artifact output is immutable; edit component source instead.");
    if (record.revision !== expectedRevision) throw new BrowserBoundaryError("Artifact changed on disk; reload before saving.");
    const candidate = await this.#artifactPath(record.root, path); if (!TEXT_EXTENSIONS.has(extname(candidate).toLowerCase())) throw new BrowserBoundaryError("This artifact asset is not editable as text.");
    await writeFile(candidate, content, "utf8"); await rm(join(record.root, "dist"), { recursive: true, force: true }); record.files = await this.#artifactFiles(record.root); record.revision = await this.#artifactRevision(record.root, record.files); record.sourceDigest = record.revision; record.bundleDigest = null; record.reviewState = "quarantined"; record.securityReview = null; record.semanticReview = null; record.reviewDecision = null; record.grants = []; record.updatedAt = new Date().toISOString();
    const records = await this.#artifactRegistry(canonical); const index = records.findIndex((item) => item.id === artifactId); records[index] = record; await this.#writeArtifactRegistry(canonical, records);
    const runtime = this.#artifacts.get(artifactId); if (runtime && !runtime.view.webContents.isDestroyed()) { runtime.record = record; runtime.view.webContents.reloadIgnoringCache(); }
    return publicArtifact(record);
  }

  async previewArtifact(workspaceId: string, workspaceRoot: string, artifactId: string, bounds: BrowserBounds) {
    const { record } = await this.#requireArtifact(workspaceId, workspaceRoot, artifactId); let runtime = this.#artifacts.get(artifactId);
    if (record.kind === "component" && record.reviewState !== "approved") throw new BrowserBoundaryError("This component is quarantined until its exact source digest passes security review.");
    if (record.kind === "component" && (!record.bundleDigest || !record.securityReview || record.securityReview.sourceDigest !== record.sourceDigest)) throw new BrowserBoundaryError("The artifact review no longer matches its source digest.");
    if (record.kind === "component") await this.#assertApproved(record);
    if (!runtime) {
      const previewSession = session.fromPartition(`voidra-artifact-${artifactId}`);
      previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); previewSession.setPermissionCheckHandler(() => false);
      const encoded = (value: string) => encodeURIComponent(value);
      const view = new WebContentsView({ webPreferences: { session: previewSession, preload: join(__dirname, "artifact-preload.cjs"), additionalArguments: [`--voidra-artifact-id=${encoded(artifactId)}`, `--voidra-artifact-workspace=${encoded(workspaceId)}`, `--voidra-artifact-root=${encoded(workspaceRoot)}`, `--voidra-artifact-digest=${encoded(record.sourceDigest ?? record.revision)}`], contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, safeDialogs: true } });
      runtime = { record, view, protocolInstalled: false }; this.#artifacts.set(artifactId, runtime);
      if (!previewSession.protocol.isProtocolHandled("voidra-artifact")) {
        try {
          await previewSession.protocol.handle("voidra-artifact", async (request) => {
            try {
              const url = new URL(request.url); if (url.hostname !== artifactId) return new Response("Not found", { status: 404 });
              const candidate = await this.#artifactPath(runtime!.record.root, url.pathname); const body = await readFile(candidate);
              return new Response(body, { headers: { "Content-Type": MIME_TYPES[extname(candidate).toLowerCase()] ?? "application/octet-stream", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" } });
            } catch { return new Response("Not found", { status: 404 }); }
          });
        } catch (error) {
          if (!previewSession.protocol.isProtocolHandled("voidra-artifact")) throw error;
        }
      }
      runtime.protocolInstalled = true;
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      view.webContents.on("will-navigate", (event, target) => { if (!target.startsWith(`voidra-artifact://${artifactId}/`)) event.preventDefault(); });
      await view.webContents.loadURL(`voidra-artifact://${artifactId}/${record.entryFile}`);
    } else runtime.record = record;
    this.#showView(runtime.view, bounds); return publicArtifact(record);
  }

  setArtifactBounds(workspaceId: string, artifactId: string, bounds: BrowserBounds) { const runtime = this.#artifacts.get(artifactId); if (!runtime || runtime.record.workspaceId !== workspaceId) throw new BrowserBoundaryError("Artifact preview does not belong to this workspace."); if (this.#activeView === runtime.view) runtime.view.setBounds(cleanBounds(bounds)); }

  async artifactCapability(webContentsId: number, workspaceId: string, workspaceRoot: string, artifactId: string, sourceDigest: string, capabilityId: string, args: Record<string, unknown>) {
    let call: { argsDigest: string; release: () => void } | null = null;
    try {
      call = this.#beginCapabilityCall(artifactId, capabilityId, args);
      const result = await this.#performArtifactCapability(webContentsId, workspaceId, workspaceRoot, artifactId, sourceDigest, capabilityId, args);
      if (Buffer.byteLength(JSON.stringify(result)) > 2_000_000) throw new BrowserBoundaryError("Artifact capability result exceeds the 2 MB limit.");
      await this.#auditCapability({ workspaceId, artifactId, capabilityId, argsDigest: call.argsDigest, outcome: "allowed", reason: null });
      return result;
    } catch (error) {
      let argsDigest = "unserializable"; try { argsDigest = hash(JSON.stringify(args)); } catch { /* Redacted audit marker only. */ }
      await this.#auditCapability({ workspaceId, artifactId, capabilityId, argsDigest: call?.argsDigest ?? argsDigest, outcome: "denied", reason: error instanceof Error ? error.message.slice(0, 500) : "Capability denied." });
      throw error;
    } finally { call?.release(); }
  }

  async #performArtifactCapability(webContentsId: number, workspaceId: string, workspaceRoot: string, artifactId: string, sourceDigest: string, capabilityId: string, args: Record<string, unknown>) {
    const runtime = this.#artifacts.get(artifactId);
    if (!runtime || runtime.view.webContents.id !== webContentsId) throw new BrowserBoundaryError("Artifact capability sender is not trusted.");
    const { record } = await this.#requireArtifact(workspaceId, workspaceRoot, artifactId);
    if (record.reviewState !== "approved" || record.sourceDigest !== sourceDigest || runtime.record.sourceDigest !== sourceDigest) throw new BrowserBoundaryError("Artifact approval does not match the running source digest.");
    await this.#assertApproved(record);
    const grant = record.grants?.find((item) => item.id === capabilityId && item.artifactDigest === sourceDigest && !item.revokedAt && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now()));
    if (!grant) throw new BrowserBoundaryError("Artifact capability is not granted for this version.");
    if (grant.operation === "fs.readText") {
      const path = String(args.path ?? ""); const allowed = typeof grant.scope.path === "string" ? [grant.scope.path] : Array.isArray(grant.scope.paths) ? grant.scope.paths.filter((item): item is string => typeof item === "string") : [];
      if (!allowed.includes(path)) throw new BrowserBoundaryError("The requested file is outside the artifact grant.");
      const target = resolve(workspaceRoot, path); if (!containsPath(workspaceRoot, target)) throw new BrowserBoundaryError("Artifact file request escaped the workspace.");
      const info = await lstat(target); if (info.isSymbolicLink() || !info.isFile() || info.size > 1_000_000) throw new BrowserBoundaryError("Artifact file request violates the grant limits.");
      const canonical = await realpath(target); if (!containsPath(workspaceRoot, canonical)) throw new BrowserBoundaryError("Artifact file request escaped through a link.");
      return { operation: grant.operation, path, content: await readFile(canonical, "utf8") };
    }
    if (grant.operation === "fs.list") {
      const path = String(args.path ?? ""); const allowedPath = typeof grant.scope.path === "string" ? grant.scope.path : "";
      if (path !== allowedPath) throw new BrowserBoundaryError("The requested directory is outside the artifact grant.");
      const target = resolve(workspaceRoot, path); if (!containsPath(workspaceRoot, target)) throw new BrowserBoundaryError("Artifact directory request escaped the workspace.");
      const entries = await readdir(target, { withFileTypes: true }); return { operation: grant.operation, path, entries: entries.slice(0, 200).filter((entry) => !entry.isSymbolicLink()).map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? "directory" : "file" })) };
    }
    if (grant.operation === "fs.writeStagedText") {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      const allowed = typeof grant.scope.path === "string" ? [grant.scope.path] : Array.isArray(grant.scope.paths) ? grant.scope.paths.filter((item): item is string => typeof item === "string") : [];
      if (!allowed.includes(path)) throw new BrowserBoundaryError("The staged write is outside the artifact grant.");
      if (Buffer.byteLength(content) > 1_000_000) throw new BrowserBoundaryError("Staged artifact writes are limited to 1 MB.");
      const target = resolve(workspaceRoot, path);
      if (!containsPath(workspaceRoot, target)) throw new BrowserBoundaryError("The staged write escaped the workspace.");
      let current: string | null = null;
      try {
        const info = await lstat(target); if (info.isSymbolicLink() || !info.isFile()) throw new BrowserBoundaryError("The staged write target must be a regular file.");
        const canonical = await realpath(target); if (!containsPath(workspaceRoot, canonical)) throw new BrowserBoundaryError("The staged write escaped through a link.");
        current = await readFile(canonical, "utf8");
      } catch (error) { if (error instanceof BrowserBoundaryError || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const now = new Date().toISOString();
      const staged: ArtifactStagedWrite = { id: randomUUID(), workspaceId, artifactId, artifactDigest: sourceDigest, capabilityId, path, content, expectedRevision: current === null ? null : hash(current), state: "awaiting-review", createdAt: now, updatedAt: now };
      const writes = await this.#artifactWrites(workspaceRoot); writes.push(staged); await this.#writeArtifactWrites(workspaceRoot, writes); this.#emit(workspaceId);
      return { operation: grant.operation, state: "awaiting-review", stagedWriteId: staged.id, path };
    }
    if (!this.prepareServiceCapability) throw new BrowserBoundaryError("The service capability broker is unavailable.");
    return this.prepareServiceCapability(workspaceId, grant.operation, grant.scope, args);
  }

  async listArtifactWrites(workspaceId: string, workspaceRoot: string) {
    const canonical = await this.#assertWorkspace(workspaceId, workspaceRoot);
    return (await this.#artifactWrites(canonical)).filter((write) => write.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async applyArtifactWrite(workspaceId: string, workspaceRoot: string, stagedWriteId: string) {
    const canonical = await this.#assertWorkspace(workspaceId, workspaceRoot);
    const writes = await this.#artifactWrites(canonical);
    const staged = writes.find((write) => write.id === stagedWriteId && write.workspaceId === workspaceId);
    if (!staged || staged.state !== "awaiting-review") throw new BrowserBoundaryError("This staged artifact write is not awaiting review.");
    const { record } = await this.#requireArtifact(workspaceId, canonical, staged.artifactId);
    const grant = record.grants?.find((item) => item.id === staged.capabilityId && item.artifactDigest === staged.artifactDigest && !item.revokedAt);
    if (record.reviewState !== "approved" || record.sourceDigest !== staged.artifactDigest || !grant) throw new BrowserBoundaryError("The artifact or capability changed after this write was staged.");
    await this.#assertApproved(record);
    const target = resolve(canonical, staged.path);
    if (!containsPath(canonical, target)) throw new BrowserBoundaryError("The staged write escaped the workspace.");
    let current: string | null = null;
    try {
      const info = await lstat(target); if (info.isSymbolicLink() || !info.isFile()) throw new BrowserBoundaryError("The staged write target must be a regular file.");
      const physical = await realpath(target); if (!containsPath(canonical, physical)) throw new BrowserBoundaryError("The staged write escaped through a link.");
      current = await readFile(physical, "utf8");
    } catch (error) { if (error instanceof BrowserBoundaryError || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if ((current === null ? null : hash(current)) !== staged.expectedRevision) { staged.state = "stale"; staged.updatedAt = new Date().toISOString(); await this.#writeArtifactWrites(canonical, writes); throw new BrowserBoundaryError("The target changed after staging. Review a new write."); }
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.voidra-stage-${randomUUID()}`; await writeFile(temporary, staged.content, { encoding: "utf8", flag: "wx" }); await rename(temporary, target);
    staged.state = "applied"; staged.updatedAt = new Date().toISOString(); await this.#writeArtifactWrites(canonical, writes); this.#emit(workspaceId); return staged;
  }

  async rejectArtifactWrite(workspaceId: string, workspaceRoot: string, stagedWriteId: string) {
    const canonical = await this.#assertWorkspace(workspaceId, workspaceRoot); const writes = await this.#artifactWrites(canonical);
    const staged = writes.find((write) => write.id === stagedWriteId && write.workspaceId === workspaceId);
    if (!staged || staged.state !== "awaiting-review") throw new BrowserBoundaryError("This staged artifact write is not awaiting review.");
    staged.state = "rejected"; staged.updatedAt = new Date().toISOString(); await this.#writeArtifactWrites(canonical, writes); this.#emit(workspaceId); return staged;
  }

  async #artifactWrites(workspaceRoot: string): Promise<ArtifactStagedWrite[]> {
    try { const value = JSON.parse(await readFile(join(workspaceRoot, ".voidra", "artifact-staged-writes.json"), "utf8")); return Array.isArray(value) ? value as ArtifactStagedWrite[] : []; }
    catch { return []; }
  }

  async #writeArtifactWrites(workspaceRoot: string, writes: ArtifactStagedWrite[]) {
    const target = join(workspaceRoot, ".voidra", "artifact-staged-writes.json"); const temporary = `${target}.tmp-${randomUUID()}`;
    await writeFile(temporary, `${JSON.stringify(writes, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); await rename(temporary, target);
  }

  async exportArtifact(workspaceId: string, workspaceRoot: string, artifactId: string) {
    const { canonical, record } = await this.#requireArtifact(workspaceId, workspaceRoot, artifactId); const destinationRoot = join(canonical, "Artifact Exports"); await mkdir(destinationRoot, { recursive: true });
    const destination = join(destinationRoot, `${safeName(record.name)}-${record.revision.slice(0, 8)}`); try { await stat(destination); throw new BrowserBoundaryError("This artifact revision was already exported."); } catch (error) { if (error instanceof BrowserBoundaryError) throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await cp(record.root, destination, { recursive: true, errorOnExist: true, force: false }); return { path: destination, url: pathToFileURL(join(destination, record.entryFile)).toString() };
  }

  destroy() { this.hide(); for (const runtime of this.#tabs.values()) if (!runtime.view.webContents.isDestroyed()) runtime.view.webContents.close(); for (const runtime of this.#artifacts.values()) if (!runtime.view.webContents.isDestroyed()) runtime.view.webContents.close(); this.#tabs.clear(); this.#artifacts.clear(); }
}
