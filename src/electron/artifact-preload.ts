import { contextBridge, ipcRenderer } from "electron";

const ARTIFACT_CAPABILITY_CHANNEL = "voidra:artifact:capability";

function argument(name: string) {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`Missing ${name} artifact boundary argument.`);
  return decodeURIComponent(value);
}

const identity = Object.freeze({
  artifactId: argument("voidra-artifact-id"),
  workspaceId: argument("voidra-artifact-workspace"),
  workspaceRoot: argument("voidra-artifact-root"),
  sourceDigest: argument("voidra-artifact-digest"),
});

contextBridge.exposeInMainWorld("voidraArtifact", Object.freeze({
  request: (capabilityId: string, args: Record<string, unknown> = {}) => {
    if (typeof capabilityId !== "string" || capabilityId.length > 80 || !args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid artifact capability request.");
    return ipcRenderer.invoke(ARTIFACT_CAPABILITY_CHANNEL, identity, capabilityId, args);
  },
}));
