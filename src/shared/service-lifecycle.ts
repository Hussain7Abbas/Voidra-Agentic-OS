import type { ServiceStateEvent } from "./contracts";

export type ServiceState = ServiceStateEvent["state"];

const transitions: Record<ServiceState, ReadonlySet<ServiceState>> = {
  stopped: new Set(["starting"]),
  starting: new Set(["ready", "crashed", "stopping"]),
  ready: new Set(["crashed", "stopping"]),
  crashed: new Set(["starting", "stopping", "stopped"]),
  stopping: new Set(["stopped", "crashed"]),
};

export class ServiceLifecycle {
  #state: ServiceState = "stopped";
  #generation = 0;

  get state() { return this.#state; }
  get generation() { return this.#generation; }

  transition(next: ServiceState, reason?: string): ServiceStateEvent {
    if (!transitions[this.#state].has(next)) {
      throw new Error(`Invalid service transition: ${this.#state} -> ${next}`);
    }
    if (next === "starting") this.#generation += 1;
    this.#state = next;
    return { state: next, generation: this.#generation, ...(reason ? { reason } : {}) };
  }
}
