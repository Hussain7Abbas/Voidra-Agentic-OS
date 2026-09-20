import type { ServiceRequest, ServiceResponse, ServiceStateEvent } from "@/src/shared/contracts";

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
      };
      events: {
        onServiceState(callback: (event: ServiceStateEvent) => void): () => void;
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
