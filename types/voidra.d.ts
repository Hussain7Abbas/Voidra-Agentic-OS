import type { ServiceRequest, ServiceResponse, ServiceStateEvent } from "@/src/shared/contracts";
import type { ArtifactSource, ArtifactStagedWrite, ArtifactState, BrowserAction, BrowserActionResult, BrowserBounds, BrowserTabState } from "@/src/shared/browser-contracts";

declare global {
  interface Window {
    voidra?: {
      service: {
        request(request: ServiceRequest): Promise<ServiceResponse>;
        status(): Promise<{ state: ServiceStateEvent["state"] }>;
      };
      shell: {
        chooseDirectory(): Promise<{ canceled: boolean; path?: string }>;
        copyText(text: string): Promise<{ copied: true }>;
      };
      secrets: {
        openRouterStatus(): Promise<{ configured: boolean; secureStorageAvailable: boolean }>;
        setOpenRouter(value: string): Promise<{ configured: true }>;
        deleteOpenRouter(): Promise<{ configured: false }>;
        mcpStatus(connectionId: string): Promise<{ configured: boolean; secureStorageAvailable: boolean }>;
        setMcp(connectionId: string, value: string): Promise<{ configured: true }>;
        deleteMcp(connectionId: string): Promise<{ configured: false }>;
        elevenLabsStatus(): Promise<{ configured: boolean; secureStorageAvailable: boolean }>;
        setElevenLabs(value: string): Promise<{ configured: true }>;
        deleteElevenLabs(): Promise<{ configured: false }>;
      };
      events: {
        onServiceState(callback: (event: ServiceStateEvent) => void): () => void;
      };
      browser: {
        list(workspaceId: string, workspaceRoot: string): Promise<{ tabs: BrowserTabState[]; artifacts: ArtifactState[] }>;
        create(workspaceId: string, workspaceRoot: string, url?: string): Promise<BrowserTabState>;
        close(workspaceId: string, tabId: string): Promise<void>;
        activate(workspaceId: string, tabId: string, bounds: BrowserBounds): Promise<BrowserTabState>;
        setBounds(workspaceId: string, tabId: string, bounds: BrowserBounds): Promise<void>;
        hide(): Promise<void>;
        navigate(workspaceId: string, tabId: string, url: string): Promise<BrowserTabState>;
        back(workspaceId: string, tabId: string): Promise<void>;
        forward(workspaceId: string, tabId: string): Promise<void>;
        reload(workspaceId: string, tabId: string): Promise<void>;
        assign(workspaceId: string, tabId: string, taskId: string): Promise<BrowserTabState>;
        takeover(workspaceId: string, tabId: string): Promise<BrowserTabState>;
        resume(workspaceId: string, tabId: string): Promise<BrowserTabState>;
        action(workspaceId: string, tabId: string, taskId: string, documentId: string, action: BrowserAction): Promise<BrowserActionResult>;
        onUpdated(callback: (update: { workspaceId: string }) => void): () => void;
      };
      artifacts: {
        list(workspaceId: string, workspaceRoot: string): Promise<ArtifactState[]>;
        search(workspaceId: string, workspaceRoot: string, input: { query?: string; kind?: "legacy-html" | "component" | null; reviewState?: ArtifactState["reviewState"] | null; limit?: number }): Promise<ArtifactState[]>;
        create(workspaceId: string, workspaceRoot: string, input: { name: string; runId?: string | null; sourceNoteIds?: string[] }): Promise<ArtifactState>;
        read(workspaceId: string, workspaceRoot: string, artifactId: string, path: string): Promise<ArtifactSource>;
        save(workspaceId: string, workspaceRoot: string, artifactId: string, path: string, content: string, revision: string): Promise<ArtifactState>;
        preview(workspaceId: string, workspaceRoot: string, artifactId: string, bounds: BrowserBounds): Promise<ArtifactState>;
        setBounds(workspaceId: string, artifactId: string, bounds: BrowserBounds): Promise<void>;
        hide(): Promise<void>;
        export(workspaceId: string, workspaceRoot: string, artifactId: string): Promise<{ path: string; url: string }>;
        review(workspaceId: string, workspaceRoot: string, artifactId: string): Promise<ArtifactState>;
        rollback(workspaceId: string, workspaceRoot: string, artifactId: string, sourceDigest: string): Promise<ArtifactState>;
        convertLegacy(workspaceId: string, workspaceRoot: string, artifactId: string): Promise<ArtifactState>;
        grant(workspaceId: string, workspaceRoot: string, artifactId: string, capabilityId: string): Promise<ArtifactState>;
        revoke(workspaceId: string, workspaceRoot: string, artifactId: string, capabilityId: string): Promise<ArtifactState>;
        listStagedWrites(workspaceId: string, workspaceRoot: string): Promise<ArtifactStagedWrite[]>;
        applyStagedWrite(workspaceId: string, workspaceRoot: string, stagedWriteId: string): Promise<ArtifactStagedWrite>;
        rejectStagedWrite(workspaceId: string, workspaceRoot: string, stagedWriteId: string): Promise<ArtifactStagedWrite>;
      };
      diagnostics?: {
        simulateServiceCrash(): Promise<void>;
        runIsolationProbe(): Promise<{ hasBridge: boolean; automatableViaMain: boolean }>;
        readTestClipboard(): Promise<string>;
        setTestClipboard(text: string): Promise<void>;
      };
    };
  }
}

export {};
