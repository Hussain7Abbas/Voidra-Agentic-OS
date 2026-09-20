import { EventEmitter } from "node:events";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { serviceMessageSchema, serviceRequestSchema, publicError, type HostRequest, type HostResponse, type ServiceEvent, type ServiceRequest, type ServiceResponse, type ServiceStateEvent } from "../shared/contracts";
import { ServiceLifecycle } from "../shared/service-lifecycle";

type PendingRequest = {
  resolve: (response: ServiceResponse) => void;
  timeout: NodeJS.Timeout;
};

export type SupervisorOptions = {
  entryPath: string;
  databasePath: string;
  requestTimeoutMs?: number;
  maxRestartAttempts?: number;
  restartWindowMs?: number;
  hostRequest?: (request: HostRequest) => Promise<unknown>;
  runtimeMode?: "production" | "test";
};

export class ServiceSupervisor extends EventEmitter {
  readonly #lifecycle = new ServiceLifecycle();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #restartTimes: number[] = [];
  readonly #credentials = new Map<string, string | null>();
  #child: ChildProcess | null = null;
  #stopping = false;

  constructor(private readonly options: SupervisorOptions) {
    super();
  }

  get status(): ServiceStateEvent {
    return { state: this.#lifecycle.state, generation: this.#lifecycle.generation };
  }

  async start(): Promise<void> {
    if (this.#child || this.#lifecycle.state === "starting" || this.#lifecycle.state === "ready") return;
    this.#stopping = false;
    this.#emitState(this.#lifecycle.transition("starting"));

    await new Promise<void>((resolve, reject) => {
      const child = fork(this.options.entryPath, [], {
        execPath: process.execPath,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          VOIDRA_SERVICE_DB_PATH: this.options.databasePath,
          VOIDRA_RUNTIME_MODE: this.options.runtimeMode ?? "production",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      this.#child = child;
      let settled = false;

      const startupTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        reject(new Error("Local service did not become ready in time."));
      }, 10_000);

      child.stdout?.on("data", (chunk) => this.emit("log", String(chunk)));
      child.stderr?.on("data", (chunk) => this.emit("log", String(chunk)));
      child.on("message", (raw) => {
        const parsed = serviceMessageSchema.safeParse(raw);
        if (!parsed.success) {
          this.emit("log", "Local service emitted an invalid message.");
          return;
        }
        const message = parsed.data;
        if (message.kind === "ready") {
          clearTimeout(startupTimeout);
          if (!settled) {
            settled = true;
            for (const [provider, value] of this.#credentials) child.send({ kind: "credential.update", provider, value });
            this.#emitState(this.#lifecycle.transition("ready"));
            resolve();
          }
        } else if (message.kind === "response") {
          this.#resolveResponse(message.response);
        } else if (message.kind === "host.request") {
          void this.#handleHostRequest(child, message);
        } else {
          this.emit("service-event", message.event as ServiceEvent);
        }
      });

      child.once("error", (error) => {
        clearTimeout(startupTimeout);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      child.once("exit", (code, signal) => {
        clearTimeout(startupTimeout);
        this.#child = null;
        this.#rejectPending();
        const reason = `Local service exited (${signal ?? code ?? "unknown"}).`;
        if (this.#stopping) {
          if (this.#lifecycle.state !== "stopped") this.#emitState(this.#lifecycle.transition("stopped"));
          return;
        }
        if (this.#lifecycle.state !== "crashed") this.#emitState(this.#lifecycle.transition("crashed", reason));
        if (!settled) {
          settled = true;
          reject(new Error(reason));
        }
        this.#scheduleRestart();
      });
    });
  }

  async request(input: unknown): Promise<ServiceResponse> {
    const parsed = serviceRequestSchema.safeParse(input);
    const requestId = parsed.success ? parsed.data.requestId : randomUUID();
    if (!parsed.success) return publicError(requestId, "INVALID_REQUEST", "The request did not match the service contract.");
    if (!this.#child || this.#lifecycle.state !== "ready" || !this.#child.connected) {
      return publicError(requestId, "SERVICE_UNAVAILABLE", "The local service is not ready.", true);
    }

    return new Promise<ServiceResponse>((resolve) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        resolve(publicError(requestId, "REQUEST_TIMEOUT", "The local service did not respond in time.", true));
      }, this.options.requestTimeoutMs ?? 15_000);
      this.#pending.set(requestId, { resolve, timeout });
      this.#child?.send(parsed.data as ServiceRequest, (error) => {
        if (!error) return;
        const pending = this.#pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.#pending.delete(requestId);
        pending.resolve(publicError(requestId, "SERVICE_UNAVAILABLE", "The local service connection failed.", true));
      });
    });
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (!this.#child) {
      if (this.#lifecycle.state === "crashed") this.#emitState(this.#lifecycle.transition("stopped"));
      return;
    }
    if (this.#lifecycle.state !== "stopping") this.#emitState(this.#lifecycle.transition("stopping"));
    const child = this.#child;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(force);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  debugCrash() {
    this.#child?.kill("SIGKILL");
  }

  setCredential(provider: string, value: string | null) {
    this.#credentials.set(provider, value);
    if (this.#child?.connected) this.#child.send({ kind: "credential.update", provider, value });
  }

  async #handleHostRequest(child: ChildProcess, request: HostRequest) {
    let response: HostResponse;
    try {
      if (!this.options.hostRequest) throw new Error("The requested desktop host capability is unavailable.");
      response = { kind: "host.response", requestId: request.requestId, ok: true, data: await this.options.hostRequest(request) };
    } catch (error) { response = { kind: "host.response", requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : "Desktop host request failed." }; }
    if (child.connected) child.send(response);
  }

  #resolveResponse(response: ServiceResponse) {
    const pending = this.#pending.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(response.requestId);
    pending.resolve(response);
  }

  #rejectPending() {
    for (const [requestId, pending] of this.#pending) {
      clearTimeout(pending.timeout);
      pending.resolve(publicError(requestId, "SERVICE_UNAVAILABLE", "The local service stopped before responding.", true));
    }
    this.#pending.clear();
  }

  #scheduleRestart() {
    const now = Date.now();
    const windowMs = this.options.restartWindowMs ?? 30_000;
    while (this.#restartTimes.length && this.#restartTimes[0] < now - windowMs) this.#restartTimes.shift();
    if (this.#restartTimes.length >= (this.options.maxRestartAttempts ?? 3)) {
      this.emit("restart-exhausted");
      return;
    }
    this.#restartTimes.push(now);
    setTimeout(() => void this.start().catch((error) => this.emit("log", error instanceof Error ? error.message : String(error))), 300);
  }

  #emitState(event: ServiceStateEvent) {
    this.emit("state", event);
  }
}
