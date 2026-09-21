import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, Tray, WebContentsView } from "electron";
import { IPC_CHANNELS, WORKSPACE_ID_EXAMPLE, type HostRequest, type ServiceRequest, type ServiceStateEvent } from "../shared/contracts";
import type { ArtifactSemanticReview, ArtifactState, BrowserAction } from "../shared/browser-contracts";
import { installAppProtocol, registerAppScheme } from "./app-protocol";
import { BrowserManager } from "./browser-manager";
import { NativeAutomationHost } from "./native-automation";
import { ServiceSupervisor } from "./service-supervisor";

registerAppScheme();

if (process.env.VOIDRA_USER_DATA_DIR) {
  mkdirSync(process.env.VOIDRA_USER_DATA_DIR, { recursive: true });
  app.setPath("userData", process.env.VOIDRA_USER_DATA_DIR);
}

const isTestMode = process.env.VOIDRA_E2E === "1" && !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let supervisor: ServiceSupervisor;
let browserManager: BrowserManager;
const nativeAutomation = new NativeAutomationHost();
let folderResults: Array<string | null> = [];
let testClipboard = "";
const notifiedOccurrences = new Set<string>();

function openRouterCredentialPath() { return join(app.getPath("userData"), "secrets", "openrouter.bin"); }
function elevenLabsCredentialPath() { return join(app.getPath("userData"), "secrets", "elevenlabs.bin"); }
function mcpCredentialDirectory() { return join(app.getPath("userData"), "secrets", "mcp"); }
function assertConnectionId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid MCP connection identity.");
}
function mcpCredentialPath(connectionId: string) { return join(mcpCredentialDirectory(), `${connectionId}.bin`); }

function readOpenRouterCredential() {
  if (process.env.VOIDRA_OPENROUTER_TEST_KEY) return process.env.VOIDRA_OPENROUTER_TEST_KEY;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try { return safeStorage.decryptString(readFileSync(openRouterCredentialPath())); }
  catch { return null; }
}

function writeOpenRouterCredential(value: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this Mac.");
  const path = openRouterCredentialPath();
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, safeStorage.encryptString(value), { mode: 0o600 });
}
function readElevenLabsCredential() { if (process.env.VOIDRA_ELEVENLABS_TEST_KEY) return process.env.VOIDRA_ELEVENLABS_TEST_KEY; if (!safeStorage.isEncryptionAvailable()) return null; try { return safeStorage.decryptString(readFileSync(elevenLabsCredentialPath())); } catch { return null; } }
function writeElevenLabsCredential(value: string) { if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this Mac."); const path = elevenLabsCredentialPath(); mkdirSync(resolve(path, ".."), { recursive: true }); writeFileSync(path, safeStorage.encryptString(value), { mode: 0o600 }); }

function readMcpCredential(connectionId: string) {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try { return safeStorage.decryptString(readFileSync(mcpCredentialPath(connectionId))); }
  catch { return null; }
}

function writeMcpCredential(connectionId: string, value: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this Mac.");
  mkdirSync(mcpCredentialDirectory(), { recursive: true });
  writeFileSync(mcpCredentialPath(connectionId), safeStorage.encryptString(value), { mode: 0o600 });
}

function restoreMcpCredentials() {
  try {
    for (const entry of readdirSync(mcpCredentialDirectory())) {
      const connectionId = entry.endsWith(".bin") ? entry.slice(0, -4) : "";
      try { assertConnectionId(connectionId); }
      catch { continue; }
      supervisor.setCredential(`mcp:${connectionId}`, readMcpCredential(connectionId));
    }
  } catch { /* No MCP credentials have been configured. */ }
}

if (isTestMode && process.env.VOIDRA_TEST_FOLDER_RESULTS) {
  try {
    folderResults = JSON.parse(process.env.VOIDRA_TEST_FOLDER_RESULTS) as Array<string | null>;
  } catch {
    folderResults = [];
  }
}

function assertTrustedSender(url: string | undefined) {
  if (!url?.startsWith("app://voidra/")) throw new Error("Untrusted renderer origin.");
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    title: "Voidra",
    backgroundColor: "#050505",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: isTestMode ? ["--voidra-e2e"] : [],
    },
  });

  window.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => webContents === window.webContents && permission === "media" && requestingOrigin.startsWith("app://voidra"));
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => callback(webContents === window.webContents && permission === "media" && details.requestingUrl.startsWith("app://voidra/")));
  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (process.platform === "darwin" && !quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void window.loadURL("app://voidra/index.html");
  mainWindow = window;
  return window;
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path d="M2 2l7 14 7-14h-3L9 10 5 2z" fill="white"/></svg>').toString("base64"),
  );
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Voidra");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Voidra", click: () => { mainWindow?.show(); app.focus(); } },
    { label: "Local runtime", enabled: false },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", () => mainWindow?.show());
}

function broadcastState(event: ServiceStateEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.serviceState, event);
  }
}

function broadcastBrowserUpdate(workspaceId: string) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.browserUpdated, { workspaceId });
  }
}

async function handleHostRequest(request: HostRequest) {
  if (request.operation === "native.status") return nativeAutomation.status();
  if (request.operation === "native.takeover") return nativeAutomation.takeover();
  if (request.operation === "native.action") return nativeAutomation.action(request.workspaceId, request.taskId, { operation: String(request.payload.operation ?? ""), target: request.payload.target && typeof request.payload.target === "object" && !Array.isArray(request.payload.target) ? request.payload.target as Record<string, unknown> : {} });
  if (request.operation === "browser.assign") return browserManager.assign(request.workspaceId, String(request.payload.tabId ?? ""), request.taskId);
  if (request.operation === "browser.list") return browserManager.assignedTabs(request.workspaceId, request.taskId);
  const kind = String(request.payload.action ?? "") as BrowserAction["kind"];
  let action: BrowserAction;
  if (kind === "navigate") action = { kind, url: String(request.payload.url ?? "") };
  else if (kind === "read") action = { kind };
  else if (kind === "click") action = { kind, selector: String(request.payload.selector ?? "") };
  else if (kind === "type") action = { kind, selector: String(request.payload.selector ?? ""), text: String(request.payload.text ?? "") };
  else if (kind === "select") action = { kind, selector: String(request.payload.selector ?? ""), value: String(request.payload.value ?? "") };
  else if (kind === "wait") action = { kind, selector: String(request.payload.selector ?? ""), timeoutMs: typeof request.payload.timeoutMs === "number" ? request.payload.timeoutMs : undefined };
  else throw new Error("Unsupported browser action.");
  return browserManager.action(request.workspaceId, String(request.payload.tabId ?? ""), request.taskId, String(request.payload.documentId ?? ""), action);
}

function registerIpc() {
  ipcMain.handle(IPC_CHANNELS.serviceRequest, (event, input: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return supervisor.request(input);
  });
  ipcMain.handle(IPC_CHANNELS.serviceStatus, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return supervisor.status;
  });
  ipcMain.handle(IPC_CHANNELS.chooseDirectory, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    let selectedPath: string | undefined;
    if (isTestMode) {
      selectedPath = folderResults.shift() ?? undefined;
    } else {
      const selection = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"] });
      selectedPath = selection.canceled ? undefined : selection.filePaths[0];
    }
    if (!selectedPath) return { canceled: true };
    const request: ServiceRequest = {
      requestId: randomUUID(),
      workspaceId: WORKSPACE_ID_EXAMPLE,
      sessionId: randomUUID(),
      operation: "workspace.validateDirectory",
      payload: { path: selectedPath },
    };
    const response = await supervisor.request(request);
    if (!response.ok) return { canceled: true };
    return { canceled: false, path: response.data.canonicalPath as string };
  });
  ipcMain.handle(IPC_CHANNELS.copyText, (event, text: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof text !== "string" || text.length > 250_000) throw new Error("Invalid clipboard text.");
    if (isTestMode) testClipboard = text;
    else clipboard.writeText(text);
    return { copied: true };
  });
  ipcMain.handle(IPC_CHANNELS.openRouterCredentialStatus, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return { configured: Boolean(readOpenRouterCredential()), secureStorageAvailable: safeStorage.isEncryptionAvailable() };
  });
  ipcMain.handle(IPC_CHANNELS.setOpenRouterCredential, (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof value !== "string" || value.trim().length < 12 || value.length > 500) throw new Error("The OpenRouter credential is invalid.");
    writeOpenRouterCredential(value.trim());
    supervisor.setCredential("openrouter", value.trim());
    return { configured: true };
  });
  ipcMain.handle(IPC_CHANNELS.deleteOpenRouterCredential, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    rmSync(openRouterCredentialPath(), { force: true });
    supervisor.setCredential("openrouter", null);
    return { configured: false };
  });
  ipcMain.handle(IPC_CHANNELS.mcpCredentialStatus, (event, connectionId: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    assertConnectionId(connectionId);
    return { configured: Boolean(readMcpCredential(connectionId)), secureStorageAvailable: safeStorage.isEncryptionAvailable() };
  });
  ipcMain.handle(IPC_CHANNELS.setMcpCredential, (event, connectionId: unknown, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    assertConnectionId(connectionId);
    if (typeof value !== "string" || !value.trim() || value.length > 20_000) throw new Error("The MCP credential is invalid.");
    writeMcpCredential(connectionId, value.trim());
    supervisor.setCredential(`mcp:${connectionId}`, value.trim());
    return { configured: true };
  });
  ipcMain.handle(IPC_CHANNELS.deleteMcpCredential, (event, connectionId: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    assertConnectionId(connectionId);
    rmSync(mcpCredentialPath(connectionId), { force: true });
    supervisor.setCredential(`mcp:${connectionId}`, null);
    return { configured: false };
  });
  ipcMain.handle(IPC_CHANNELS.elevenLabsCredentialStatus, (event) => { assertTrustedSender(event.senderFrame?.url); return { configured: Boolean(readElevenLabsCredential()), secureStorageAvailable: safeStorage.isEncryptionAvailable() }; });
  ipcMain.handle(IPC_CHANNELS.setElevenLabsCredential, (event, value: unknown) => { assertTrustedSender(event.senderFrame?.url); if (typeof value !== "string" || value.trim().length < 8 || value.length > 500) throw new Error("The ElevenLabs credential is invalid."); writeElevenLabsCredential(value.trim()); supervisor.setCredential("elevenlabs", value.trim()); return { configured: true }; });
  ipcMain.handle(IPC_CHANNELS.deleteElevenLabsCredential, (event) => { assertTrustedSender(event.senderFrame?.url); rmSync(elevenLabsCredentialPath(), { force: true }); supervisor.setCredential("elevenlabs", null); return { configured: false }; });
  const browserArgs = (event: Electron.IpcMainInvokeEvent, workspaceId: unknown, workspaceRoot: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof workspaceId !== "string" || typeof workspaceRoot !== "string") throw new Error("Invalid browser workspace context.");
    return { workspaceId, workspaceRoot };
  };
  ipcMain.handle(IPC_CHANNELS.browserList, (event, workspaceId, workspaceRoot) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.list(value.workspaceId, value.workspaceRoot); });
  ipcMain.handle(IPC_CHANNELS.browserCreate, (event, workspaceId, workspaceRoot, url) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.create(value.workspaceId, value.workspaceRoot, typeof url === "string" ? url : undefined); });
  ipcMain.handle(IPC_CHANNELS.browserClose, (event, workspaceId, tabId) => { assertTrustedSender(event.senderFrame?.url); return browserManager.close(String(workspaceId), String(tabId)); });
  ipcMain.handle(IPC_CHANNELS.browserActivate, (event, workspaceId, tabId, bounds) => { assertTrustedSender(event.senderFrame?.url); return browserManager.activate(String(workspaceId), String(tabId), bounds); });
  ipcMain.handle(IPC_CHANNELS.browserBounds, (event, workspaceId, tabId, bounds) => { assertTrustedSender(event.senderFrame?.url); return browserManager.setBounds(String(workspaceId), String(tabId), bounds); });
  ipcMain.handle(IPC_CHANNELS.browserNavigate, (event, workspaceId, tabId, url) => { assertTrustedSender(event.senderFrame?.url); return browserManager.navigate(String(workspaceId), String(tabId), String(url)); });
  ipcMain.handle(IPC_CHANNELS.browserBack, (event, workspaceId, tabId) => { assertTrustedSender(event.senderFrame?.url); return browserManager.back(String(workspaceId), String(tabId)); });
  ipcMain.handle(IPC_CHANNELS.browserForward, (event, workspaceId, tabId) => { assertTrustedSender(event.senderFrame?.url); return browserManager.forward(String(workspaceId), String(tabId)); });
  ipcMain.handle(IPC_CHANNELS.browserReload, (event, workspaceId, tabId) => { assertTrustedSender(event.senderFrame?.url); return browserManager.reload(String(workspaceId), String(tabId)); });
  ipcMain.handle(IPC_CHANNELS.browserAssign, (event, workspaceId, tabId, taskId) => { assertTrustedSender(event.senderFrame?.url); return browserManager.assign(String(workspaceId), String(tabId), String(taskId)); });
  ipcMain.handle(IPC_CHANNELS.browserTakeover, (event, workspaceId, tabId) => { assertTrustedSender(event.senderFrame?.url); return browserManager.takeover(String(workspaceId), String(tabId)); });
  ipcMain.handle(IPC_CHANNELS.browserResume, (event, workspaceId, tabId) => { assertTrustedSender(event.senderFrame?.url); return browserManager.resume(String(workspaceId), String(tabId)); });
  ipcMain.handle(IPC_CHANNELS.browserAction, (event, workspaceId, tabId, taskId, documentId, action) => { assertTrustedSender(event.senderFrame?.url); return browserManager.action(String(workspaceId), String(tabId), String(taskId), String(documentId), action); });
  ipcMain.handle(IPC_CHANNELS.artifactList, (event, workspaceId, workspaceRoot) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.listArtifacts(value.workspaceId, value.workspaceRoot); });
  ipcMain.handle(IPC_CHANNELS.artifactSearch, (event, workspaceId, workspaceRoot, input) => { const value = browserArgs(event, workspaceId, workspaceRoot); const query = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {}; return browserManager.searchArtifacts(value.workspaceId, value.workspaceRoot, { query: typeof query.query === "string" ? query.query.slice(0, 1000) : "", kind: query.kind === "component" || query.kind === "legacy-html" ? query.kind : null, reviewState: ["draft", "legacy", "quarantined", "approved", "blocked", "superseded"].includes(String(query.reviewState)) ? query.reviewState as ArtifactState["reviewState"] : null, limit: typeof query.limit === "number" ? query.limit : undefined }); });
  ipcMain.handle(IPC_CHANNELS.artifactCreate, (event, workspaceId, workspaceRoot, input) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.createArtifact(value.workspaceId, value.workspaceRoot, input); });
  ipcMain.handle(IPC_CHANNELS.artifactRead, (event, workspaceId, workspaceRoot, artifactId, path) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.readArtifact(value.workspaceId, value.workspaceRoot, String(artifactId), String(path)); });
  ipcMain.handle(IPC_CHANNELS.artifactSave, (event, workspaceId, workspaceRoot, artifactId, path, content, revision) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.saveArtifact(value.workspaceId, value.workspaceRoot, String(artifactId), String(path), String(content), String(revision)); });
  ipcMain.handle(IPC_CHANNELS.artifactPreview, (event, workspaceId, workspaceRoot, artifactId, bounds) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.previewArtifact(value.workspaceId, value.workspaceRoot, String(artifactId), bounds); });
  ipcMain.handle(IPC_CHANNELS.artifactBounds, (event, workspaceId, artifactId, bounds) => { assertTrustedSender(event.senderFrame?.url); return browserManager.setArtifactBounds(String(workspaceId), String(artifactId), bounds); });
  ipcMain.handle(IPC_CHANNELS.artifactHide, (event) => { assertTrustedSender(event.senderFrame?.url); return browserManager.hide(); });
  ipcMain.handle(IPC_CHANNELS.artifactExport, (event, workspaceId, workspaceRoot, artifactId) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.exportArtifact(value.workspaceId, value.workspaceRoot, String(artifactId)); });
  ipcMain.handle(IPC_CHANNELS.artifactReview, (event, workspaceId, workspaceRoot, artifactId) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.reviewArtifact(value.workspaceId, value.workspaceRoot, String(artifactId)); });
  ipcMain.handle(IPC_CHANNELS.artifactRollback, (event, workspaceId, workspaceRoot, artifactId, sourceDigest) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.rollbackArtifact(value.workspaceId, value.workspaceRoot, String(artifactId), String(sourceDigest)); });
  ipcMain.handle(IPC_CHANNELS.artifactConvertLegacy, (event, workspaceId, workspaceRoot, artifactId) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.convertLegacyArtifact(value.workspaceId, value.workspaceRoot, String(artifactId)); });
  ipcMain.handle(IPC_CHANNELS.artifactGrant, (event, workspaceId, workspaceRoot, artifactId, capabilityId) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.grantArtifactCapability(value.workspaceId, value.workspaceRoot, String(artifactId), String(capabilityId)); });
  ipcMain.handle(IPC_CHANNELS.artifactRevoke, (event, workspaceId, workspaceRoot, artifactId, capabilityId) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.revokeArtifactCapability(value.workspaceId, value.workspaceRoot, String(artifactId), String(capabilityId)); });
  ipcMain.handle(IPC_CHANNELS.artifactCapability, (event, identity, capabilityId, args) => {
    if (!identity || typeof identity !== "object" || !args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid artifact capability request.");
    const value = identity as Record<string, unknown>;
    return browserManager.artifactCapability(event.sender.id, String(value.workspaceId ?? ""), String(value.workspaceRoot ?? ""), String(value.artifactId ?? ""), String(value.sourceDigest ?? ""), String(capabilityId), args as Record<string, unknown>);
  });
  ipcMain.handle(IPC_CHANNELS.artifactWriteList, (event, workspaceId, workspaceRoot) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.listArtifactWrites(value.workspaceId, value.workspaceRoot); });
  ipcMain.handle(IPC_CHANNELS.artifactWriteApply, (event, workspaceId, workspaceRoot, stagedWriteId) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.applyArtifactWrite(value.workspaceId, value.workspaceRoot, String(stagedWriteId)); });
  ipcMain.handle(IPC_CHANNELS.artifactWriteReject, (event, workspaceId, workspaceRoot, stagedWriteId) => { const value = browserArgs(event, workspaceId, workspaceRoot); return browserManager.rejectArtifactWrite(value.workspaceId, value.workspaceRoot, String(stagedWriteId)); });

  if (isTestMode) {
    ipcMain.handle(IPC_CHANNELS.testCrash, (event) => {
      assertTrustedSender(event.senderFrame?.url);
      supervisor.debugCrash();
    });
    ipcMain.handle(IPC_CHANNELS.isolationProbe, async (event) => {
      assertTrustedSender(event.senderFrame?.url);
      const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
      mainWindow?.contentView.addChildView(view);
      view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
      try {
        await view.webContents.loadURL("data:text/html,<title>Voidra isolation probe</title>");
        const hasBridge = await view.webContents.executeJavaScript('typeof window.voidra !== "undefined"');
        return { hasBridge, automatableViaMain: true };
      } finally {
        mainWindow?.contentView.removeChildView(view);
        view.webContents.close();
      }
    });
    ipcMain.handle(IPC_CHANNELS.testReadClipboard, (event) => {
      assertTrustedSender(event.senderFrame?.url);
      return testClipboard;
    });
    ipcMain.handle(IPC_CHANNELS.testSetClipboard, (event, text: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      if (typeof text !== "string") throw new Error("Invalid clipboard sentinel.");
      testClipboard = text;
    });
  }
}

async function writeSmokeMarkerWhenReady(window: BrowserWindow) {
  const marker = process.env.VOIDRA_SMOKE_MARKER;
  if (!marker) return;
  await new Promise<void>((resolveLoaded) => {
    if (!window.webContents.isLoading()) resolveLoaded();
    else window.webContents.once("did-finish-load", () => resolveLoaded());
  });
  const diagnosticsExposed = await window.webContents.executeJavaScript("Boolean(window.voidra?.diagnostics)");
  mkdirSync(resolve(marker, ".."), { recursive: true });
  writeFileSync(marker, JSON.stringify({ status: "ready", packaged: app.isPackaged, arch: process.arch, diagnosticsExposed }));
  quitting = true;
  app.quit();
}

app.whenReady().then(async () => {
  const exportRoot = join(app.getAppPath(), "out");
  installAppProtocol(exportRoot);
  supervisor = new ServiceSupervisor({
    entryPath: join(__dirname, "../service/process.cjs"),
    databasePath: join(app.getPath("userData"), "state", "foundation.sqlite"),
    runtimeMode: isTestMode ? "test" : "production",
    hostRequest: handleHostRequest,
  });
  supervisor.on("state", broadcastState);
  supervisor.on("log", (message) => console.error(`[local-service] ${message}`));
  supervisor.on("service-event", (event) => {
    if (event.type !== "schedule.occurrence" || !Notification.isSupported()) return;
    const occurrenceId = typeof event.payload.occurrenceId === "string" ? event.payload.occurrenceId : "";
    if (!occurrenceId || notifiedOccurrences.has(occurrenceId)) return;
    notifiedOccurrences.add(occurrenceId);
    const notification = new Notification({ title: String(event.payload.scheduleName ?? "Voidra routine"), body: event.payload.state === "ready-to-copy" ? "A manual handoff is ready for review and copy." : `Scheduled run: ${String(event.payload.state ?? "updated")}` });
    notification.on("click", () => { mainWindow?.show(); app.focus(); });
    notification.show();
  });
  supervisor.setCredential("openrouter", readOpenRouterCredential());
  supervisor.setCredential("elevenlabs", readElevenLabsCredential());
  restoreMcpCredentials();
  registerIpc();
  createTray();
  const window = createWindow();
  browserManager = new BrowserManager(window, app.getPath("userData"), broadcastBrowserUpdate, async (workspaceId, operation, scope, args) => {
    const connectionId = String(scope.connectionId ?? "");
    const name = String(scope.name ?? "");
    const listing = await supervisor.request({ requestId: randomUUID(), workspaceId, sessionId: randomUUID(), operation: "mcp.list", payload: {} });
    if (!listing.ok) throw new Error(listing.error.message);
    const connections = (listing.data as { connections?: Array<Record<string, unknown>> }).connections ?? [];
    const connection = connections.find((item) => item.id === connectionId);
    if (!connection || connection.status !== "ready" || connection.fingerprint !== scope.serverFingerprint) throw new Error("The pinned MCP server identity changed or is unavailable; suspend this artifact grant and review it again.");
    const capabilities = connection.capabilities as { tools?: Array<Record<string, unknown>>; resources?: Array<Record<string, unknown>> } | undefined;
    const current = operation === "mcp.callTool" ? capabilities?.tools?.find((item) => item.name === name) : capabilities?.resources?.find((item) => item.uri === name);
    if (!current || current.schemaDigest !== scope.schemaDigest) throw new Error("The pinned MCP tool/resource schema changed; suspend this artifact grant and review it again.");
    const request: ServiceRequest = operation === "mcp.callTool"
      ? { requestId: randomUUID(), workspaceId, sessionId: randomUUID(), operation: "mcp.prepareTool", payload: { connectionId, name, arguments: args } }
      : { requestId: randomUUID(), workspaceId, sessionId: randomUUID(), operation: "mcp.readResource", payload: { connectionId, uri: name } };
    const response = await supervisor.request(request);
    if (!response.ok) throw new Error(response.error.message);
    return operation === "mcp.callTool" ? { operation, state: "awaiting-review", action: response.data } : { operation, state: "completed", result: response.data };
  }, async (workspaceId, input) => {
    const request: ServiceRequest = { requestId: randomUUID(), workspaceId, sessionId: randomUUID(), operation: "artifact.semanticReview", payload: input };
    const response = await supervisor.request(request);
    if (!response.ok) throw new Error(response.error.message);
    return response.data as ArtifactSemanticReview;
  });
  await browserManager.initialize();
  await supervisor.start();
  await writeSmokeMarkerWhenReady(window);
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else mainWindow.show();
});

app.on("before-quit", () => {
  quitting = true;
  browserManager?.destroy();
  void supervisor?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
