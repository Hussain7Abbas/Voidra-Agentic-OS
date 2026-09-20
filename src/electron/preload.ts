import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, serviceStateEventSchema, type ServiceRequest } from "../shared/contracts";

const api: NonNullable<Window["voidra"]> = {
  service: {
    request: (request: ServiceRequest) => ipcRenderer.invoke(IPC_CHANNELS.serviceRequest, request),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.serviceStatus),
  },
  shell: {
    chooseDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.chooseDirectory),
    copyText: (text) => ipcRenderer.invoke(IPC_CHANNELS.copyText, text),
  },
  secrets: {
    openRouterStatus: () => ipcRenderer.invoke(IPC_CHANNELS.openRouterCredentialStatus),
    setOpenRouter: (value) => ipcRenderer.invoke(IPC_CHANNELS.setOpenRouterCredential, value),
    deleteOpenRouter: () => ipcRenderer.invoke(IPC_CHANNELS.deleteOpenRouterCredential),
    mcpStatus: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.mcpCredentialStatus, connectionId),
    setMcp: (connectionId, value) => ipcRenderer.invoke(IPC_CHANNELS.setMcpCredential, connectionId, value),
    deleteMcp: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.deleteMcpCredential, connectionId),
    elevenLabsStatus: () => ipcRenderer.invoke(IPC_CHANNELS.elevenLabsCredentialStatus),
    setElevenLabs: (value) => ipcRenderer.invoke(IPC_CHANNELS.setElevenLabsCredential, value),
    deleteElevenLabs: () => ipcRenderer.invoke(IPC_CHANNELS.deleteElevenLabsCredential),
  },
  events: {
    onServiceState: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, raw: unknown) => {
        const parsed = serviceStateEventSchema.safeParse(raw);
        if (parsed.success) callback(parsed.data);
      };
      ipcRenderer.on(IPC_CHANNELS.serviceState, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.serviceState, listener);
    },
  },
  browser: {
    list: (workspaceId, workspaceRoot) => ipcRenderer.invoke(IPC_CHANNELS.browserList, workspaceId, workspaceRoot),
    create: (workspaceId, workspaceRoot, url) => ipcRenderer.invoke(IPC_CHANNELS.browserCreate, workspaceId, workspaceRoot, url),
    close: (workspaceId, tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserClose, workspaceId, tabId),
    activate: (workspaceId, tabId, bounds) => ipcRenderer.invoke(IPC_CHANNELS.browserActivate, workspaceId, tabId, bounds),
    setBounds: (workspaceId, tabId, bounds) => ipcRenderer.invoke(IPC_CHANNELS.browserBounds, workspaceId, tabId, bounds),
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.artifactHide),
    navigate: (workspaceId, tabId, url) => ipcRenderer.invoke(IPC_CHANNELS.browserNavigate, workspaceId, tabId, url),
    back: (workspaceId, tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserBack, workspaceId, tabId),
    forward: (workspaceId, tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserForward, workspaceId, tabId),
    reload: (workspaceId, tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserReload, workspaceId, tabId),
    assign: (workspaceId, tabId, taskId) => ipcRenderer.invoke(IPC_CHANNELS.browserAssign, workspaceId, tabId, taskId),
    takeover: (workspaceId, tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserTakeover, workspaceId, tabId),
    resume: (workspaceId, tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserResume, workspaceId, tabId),
    action: (workspaceId, tabId, taskId, documentId, action) => ipcRenderer.invoke(IPC_CHANNELS.browserAction, workspaceId, tabId, taskId, documentId, action),
    onUpdated: (callback) => { const listener = (_event: Electron.IpcRendererEvent, update: { workspaceId: string }) => callback(update); ipcRenderer.on(IPC_CHANNELS.browserUpdated, listener); return () => ipcRenderer.removeListener(IPC_CHANNELS.browserUpdated, listener); },
  },
  artifacts: {
    list: (workspaceId, workspaceRoot) => ipcRenderer.invoke(IPC_CHANNELS.artifactList, workspaceId, workspaceRoot),
    create: (workspaceId, workspaceRoot, input) => ipcRenderer.invoke(IPC_CHANNELS.artifactCreate, workspaceId, workspaceRoot, input),
    read: (workspaceId, workspaceRoot, artifactId, path) => ipcRenderer.invoke(IPC_CHANNELS.artifactRead, workspaceId, workspaceRoot, artifactId, path),
    save: (workspaceId, workspaceRoot, artifactId, path, content, revision) => ipcRenderer.invoke(IPC_CHANNELS.artifactSave, workspaceId, workspaceRoot, artifactId, path, content, revision),
    preview: (workspaceId, workspaceRoot, artifactId, bounds) => ipcRenderer.invoke(IPC_CHANNELS.artifactPreview, workspaceId, workspaceRoot, artifactId, bounds),
    setBounds: (workspaceId, artifactId, bounds) => ipcRenderer.invoke(IPC_CHANNELS.artifactBounds, workspaceId, artifactId, bounds),
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.artifactHide),
    export: (workspaceId, workspaceRoot, artifactId) => ipcRenderer.invoke(IPC_CHANNELS.artifactExport, workspaceId, workspaceRoot, artifactId),
  },
};

if (process.argv.includes("--voidra-e2e")) {
  api.diagnostics = {
    simulateServiceCrash: () => ipcRenderer.invoke(IPC_CHANNELS.testCrash),
    runIsolationProbe: () => ipcRenderer.invoke(IPC_CHANNELS.isolationProbe),
    readTestClipboard: () => ipcRenderer.invoke(IPC_CHANNELS.testReadClipboard),
    setTestClipboard: (text) => ipcRenderer.invoke(IPC_CHANNELS.testSetClipboard, text),
  };
}

contextBridge.exposeInMainWorld("voidra", Object.freeze(api));
