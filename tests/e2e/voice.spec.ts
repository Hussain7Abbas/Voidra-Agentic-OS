import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let temporaryRoot: string; let application: ElectronApplication | undefined; let provider: Server | undefined;
test.beforeEach(async () => { temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-voice-e2e-")); });
test.afterEach(async () => { if (application) await application.close().catch(() => undefined); application = undefined; if (provider) await new Promise<void>((resolve) => provider!.close(() => resolve())); provider = undefined; await rm(temporaryRoot, { recursive: true, force: true }); });

async function fixture(ttsStatus = 200) {
  let reasoningCalls = 0; let speechCalls = 0;
  provider = createServer((request, response) => {
    let raw = ""; request.on("data", (chunk) => { raw += chunk; }); request.on("end", () => {
      if (request.url?.startsWith("/chat/completions")) {
        reasoningCalls += 1; JSON.parse(raw);
        const event = { model: "fixture/voice", choices: [{ delta: { content: "Your workspace answer is ready." }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 } };
        response.writeHead(200, { "Content-Type": "text/event-stream" }); response.end(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`); return;
      }
      if (request.url?.startsWith("/v1/text-to-speech/")) {
        speechCalls += 1; response.writeHead(ttsStatus, { "Content-Type": ttsStatus === 200 ? "audio/mpeg" : "text/plain" }); response.end(ttsStatus === 200 ? Buffer.from([1, 2, 3, 4]) : "denied"); return;
      }
      response.writeHead(404); response.end();
    });
  });
  await new Promise<void>((resolve) => provider!.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); if (!address || typeof address === "string") throw new Error("Voice fixture did not bind.");
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls: () => ({ reasoningCalls, speechCalls }) };
}

async function launch(profile: string, folders: string[], baseUrl: string) { return electron.launch({ args: [process.cwd()], env: { ...process.env, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile, VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify(folders), VOIDRA_OPENROUTER_BASE_URL: baseUrl, VOIDRA_OPENROUTER_TEST_KEY: "fixture-openrouter", VOIDRA_ELEVENLABS_BASE_URL: baseUrl, VOIDRA_ELEVENLABS_TEST_KEY: "fixture-elevenlabs" } }); }
async function onboard(window: Page, name: string) { await window.getByLabel("Workspace name").fill(name); await window.getByRole("button", { name: "Choose workspace folder" }).click(); await window.getByRole("button", { name: "Create workspace" }).click(); await expect(window.getByTestId("workspace-dialog")).toBeHidden(); }
async function request(window: Page, workspaceId: string, operation: string, payload: Record<string, unknown> = {}) { return window.evaluate(({ workspaceId, operation, payload }) => globalThis.window.voidra!.service.request({ requestId: crypto.randomUUID(), workspaceId, sessionId: crypto.randomUUID(), operation, payload } as any), { workspaceId, operation, payload }); }

test("executes only the final transcript and keeps the voice turn visible", async () => {
  const fixtureServer = await fixture(); const root = join(temporaryRoot, "Work"); await mkdir(root);
  application = await launch(join(temporaryRoot, "profile"), [root], fixtureServer.baseUrl); const window = await application.firstWindow(); await onboard(window, "Work"); const workspaceId = await window.getByLabel("Current workspace").inputValue();
  await request(window, workspaceId, "settings.updateWorkspace", { overrides: { voice: { enabled: true, voiceId: "fixture-voice" } } });
  await window.getByRole("link", { name: "Assistant" }).click(); await window.getByRole("button", { name: "New session" }).click(); await window.getByLabel("Voice reasoning model").fill("fixture/voice"); await window.getByRole("textbox", { name: "Voice transcript", exact: true }).fill("Final request from voice");
  await window.getByRole("button", { name: "Send partial only" }).click(); await expect(window.locator(".voice-message")).toContainText("nothing executed"); expect(fixtureServer.calls().reasoningCalls).toBe(0);
  await window.getByRole("button", { name: "Finalize and run once" }).click(); await expect(window.getByLabel("Voice transcript history")).toContainText("Final request from voice"); await expect(window.getByLabel("Voice transcript history")).toContainText("Your workspace answer is ready");
  expect(fixtureServer.calls()).toEqual({ reasoningCalls: 1, speechCalls: 1 });
  const sessions = await request(window, workspaceId, "voice.list") as any; const retained = sessions.data.sessions.at(-1); expect(retained.turns).toHaveLength(1);
  const duplicate = await request(window, workspaceId, "voice.finalize", { sessionId: retained.id, utteranceId: retained.turns[0].utteranceId, transcriptId: retained.turns[0].transcriptId, text: retained.turns[0].text, model: "fixture/voice" }) as any;
  expect(duplicate).toMatchObject({ ok: true, data: { duplicate: true } }); expect(fixtureServer.calls().reasoningCalls).toBe(1);
});

test("stops the prior workspace session and keeps text usable when speech fails", async () => {
  const fixtureServer = await fixture(401); const workRoot = join(temporaryRoot, "Work"); const personalRoot = join(temporaryRoot, "Personal"); await Promise.all([mkdir(workRoot), mkdir(personalRoot)]);
  application = await launch(join(temporaryRoot, "profile"), [workRoot, personalRoot], fixtureServer.baseUrl); const window = await application.firstWindow(); await onboard(window, "Work"); const workId = await window.getByLabel("Current workspace").inputValue();
  await request(window, workId, "settings.updateWorkspace", { overrides: { voice: { enabled: true, voiceId: "fixture-voice" } } }); await window.getByRole("link", { name: "Assistant" }).click(); await window.getByRole("button", { name: "New session" }).click();
  const workSession = ((await request(window, workId, "voice.list") as any).data.sessions.at(-1));
  await window.getByRole("button", { name: "Add workspace" }).click(); await onboard(window, "Personal"); const personalId = await window.getByLabel("Current workspace").inputValue(); expect(personalId).not.toBe(workId);
  await expect.poll(async () => ((await request(window, workId, "voice.list") as any).data.sessions.find((entry: any) => entry.id === workSession.id)?.state)).toBe("interrupted");
  await request(window, personalId, "settings.updateWorkspace", { overrides: { voice: { enabled: true, voiceId: "fixture-voice" } } }); await window.getByLabel("Voice reasoning model").fill("fixture/voice"); await window.getByRole("textbox", { name: "Voice transcript", exact: true }).fill("Answer despite speech failure"); await window.getByRole("button", { name: "Finalize and run once" }).click();
  await expect(window.getByLabel("Voice transcript history")).toContainText("Your workspace answer is ready"); await expect(window.locator(".voice-message")).toContainText("Text response completed"); await expect(window.getByTestId("voice-state")).toHaveText("error");
  await request(window, personalId, "voice.configure", { wakeWordEnabled: true }); const wake = await request(window, personalId, "voice.wake", { phrase: "Voidra" }) as any; expect(wake).toMatchObject({ ok: true, data: { activated: true, phrase: "Voidra", session: { workspaceId: personalId } } });
});
