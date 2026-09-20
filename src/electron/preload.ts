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
