import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Tray, WebContentsView } from "electron";
import { IPC_CHANNELS, WORKSPACE_ID_EXAMPLE, type ServiceRequest, type ServiceStateEvent } from "../shared/contracts";
import { installAppProtocol, registerAppScheme } from "./app-protocol";
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
let folderResults: Array<string | null> = [];
let testClipboard = "";

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
    backgroundColor: "#090d15",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: isTestMode ? ["--voidra-e2e"] : [],
    },
  });

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
  });
  supervisor.on("state", broadcastState);
  supervisor.on("log", (message) => console.error(`[local-service] ${message}`));
  registerIpc();
  createTray();
  const window = createWindow();
  await supervisor.start();
  await writeSmokeMarkerWhenReady(window);
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else mainWindow.show();
});

app.on("before-quit", () => {
  quitting = true;
  void supervisor?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
