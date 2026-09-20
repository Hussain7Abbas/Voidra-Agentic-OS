import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { shell, systemPreferences } from "electron";

type CapabilityState = "granted" | "denied" | "restricted" | "not-determined" | "unsupported";

export class NativeAutomationHost {
  #queue: Promise<void> = Promise.resolve();
  #takeoverEpoch = 0;
  #leaseOwner: { workspaceId: string; actionId: string } | null = null;
  #queueDepth = 0;
  #fixtureRevision = 1;
  #fixtureTarget = { appId: "dev.voidra.fixture", windowId: "fixture-window", controlId: "fixture-control" };

  status() {
    if (process.env.VOIDRA_NATIVE_FIXTURE === "1") return { adapter: "deterministic-fixture", accessibility: (process.env.VOIDRA_NATIVE_ACCESSIBILITY as CapabilityState) || "granted", screen: (process.env.VOIDRA_NATIVE_SCREEN as CapabilityState) || "granted", automation: (process.env.VOIDRA_NATIVE_AUTOMATION as CapabilityState) || "granted", leaseOwner: this.#leaseOwner, queueDepth: this.#queueDepth };
    if (process.platform !== "darwin") return { adapter: "unsupported-platform", accessibility: "unsupported", screen: "unsupported", automation: "unsupported" };
    return { adapter: "electron-macos", accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied", screen: systemPreferences.getMediaAccessStatus("screen"), automation: "not-determined" };
  }

  takeover() { this.#takeoverEpoch += 1; return { interrupted: true, epoch: this.#takeoverEpoch }; }

  action(workspaceId: string, actionId: string, input: { operation: string; target: Record<string, unknown> }) {
    const epoch = this.#takeoverEpoch;
    this.#queueDepth += 1;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const run = async () => {
        this.#queueDepth -= 1; this.#leaseOwner = { workspaceId, actionId };
        try { resolve(await this.#execute(workspaceId, actionId, input, epoch)); }
        catch (error) { reject(error); }
        finally { if (this.#leaseOwner?.actionId === actionId) this.#leaseOwner = null; }
      };
      this.#queue = this.#queue.catch(() => undefined).then(run);
    });
  }

  async #execute(workspaceId: string, actionId: string, input: { operation: string; target: Record<string, unknown> }, epoch: number) {
    if (epoch !== this.#takeoverEpoch) return { interrupted: true, reason: "user-takeover-before-action" };
    const status = this.status();
    if (process.env.VOIDRA_NATIVE_FIXTURE === "1") {
      const delay = Math.min(5_000, Math.max(0, Number(process.env.VOIDRA_NATIVE_ACTION_DELAY_MS ?? 0))); if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (epoch !== this.#takeoverEpoch) return { interrupted: true, reason: "user-takeover" };
      if (status.automation !== "granted") throw new Error(`Automation permission is ${status.automation}.`);
      if ((input.operation === "inspect-target" || input.operation === "activate-control") && status.accessibility !== "granted") throw new Error(`Accessibility permission is ${status.accessibility}.`);
      if (input.operation === "inspect-target") return { workspaceId, actionId, ...this.#fixtureTarget, revision: String(this.#fixtureRevision) };
      if (input.operation === "activate-control") {
        const expected = { appId: String(input.target.appId ?? ""), windowId: String(input.target.windowId ?? ""), controlId: String(input.target.controlId ?? ""), revision: String(input.target.revision ?? "") };
        if (expected.appId !== this.#fixtureTarget.appId || expected.windowId !== this.#fixtureTarget.windowId || expected.controlId !== this.#fixtureTarget.controlId || expected.revision !== String(this.#fixtureRevision)) throw new Error("The target changed after inspection; inspect it again before acting.");
        this.#fixtureRevision += 1; return { workspaceId, actionId, activated: expected.controlId, revision: String(this.#fixtureRevision) };
      }
      if (input.operation === "open-path" || input.operation === "open-app") return { workspaceId, actionId, opened: String(input.target.path ?? input.target.appPath ?? "fixture") };
      throw new Error("Unsupported native fixture operation.");
    }
    if (input.operation === "open-path") {
      const path = String(input.target.path ?? ""); if (!isAbsolute(path)) throw new Error("Open Path requires an absolute path."); await access(path); const error = await shell.openPath(path); if (error) throw new Error(error); return { workspaceId, actionId, opened: path };
    }
    if (input.operation === "open-app") {
      const appPath = String(input.target.appPath ?? ""); if (!isAbsolute(appPath) || !(appPath.startsWith("/Applications/") || appPath.startsWith("/System/Applications/")) || !appPath.endsWith(".app")) throw new Error("Only an explicitly named application bundle may be opened."); await access(appPath); const error = await shell.openPath(appPath); if (error) throw new Error(error); return { workspaceId, actionId, opened: appPath };
    }
    throw new Error("Accessibility control requires the signed native helper, which is not installed in this build.");
  }
}
