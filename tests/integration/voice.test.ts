import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentTaskManager } from "../../src/service/agents";
import { ServiceDatabase } from "../../src/service/database";
import { OpenRouterAdapter } from "../../src/service/openrouter";
import { VoiceManager } from "../../src/service/voice";
import { WorkspaceManager } from "../../src/service/workspaces";

const temporaryDirectories: string[] = [];

function complete(text = "A calm response") {
  const body = `data: ${JSON.stringify({ model: "fixture/model", choices: [{ delta: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 } })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function fixture(openRouterFetch: typeof fetch = vi.fn().mockResolvedValue(complete()) as typeof fetch, speechFetch: typeof fetch = vi.fn() as typeof fetch) {
  const directory = await mkdtemp(join(tmpdir(), "voidra-voice-")); temporaryDirectories.push(directory);
  const database = new ServiceDatabase(join(directory, "state.sqlite"));
  const workspaces = new WorkspaceManager(database);
  const workPath = join(directory, "Work"); const personalPath = join(directory, "Personal");
  await Promise.all([mkdir(workPath), mkdir(personalPath)]);
  const work = await workspaces.create("Work", workPath); const personal = await workspaces.create("Personal", personalPath);
  const agents = new AgentTaskManager(new OpenRouterAdapter({ baseUrl: "http://openrouter.fixture", apiKey: () => "openrouter-key", fetch: openRouterFetch }));
  const voice = new VoiceManager(workspaces, agents, () => "elevenlabs-key", speechFetch, "http://elevenlabs.fixture");
  return { database, workspaces, agents, voice, work, personal };
}

afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("VoiceManager", () => {
  it("never executes partial transcripts and executes each final transcript once", async () => {
    const provider = vi.fn().mockResolvedValue(complete("Only once"));
    const { database, voice, work } = await fixture(provider as typeof fetch);
    const session = await voice.start(work, "push-to-talk"); const utteranceId = crypto.randomUUID(); const transcriptId = "final-1";
    await voice.partial(work, { sessionId: session.id, utteranceId, transcriptId: "partial-1", text: "Draft phrase" });
    expect(provider).not.toHaveBeenCalled();
    const completed = await voice.finalize(work, { sessionId: session.id, utteranceId, transcriptId, text: "Final phrase", model: "fixture/model" });
    expect(completed).toMatchObject({ session: { state: "idle", turns: [{ text: "Final phrase", response: "Only once" }] }, task: { status: "completed" } });
    const duplicate = await voice.finalize(work, { sessionId: session.id, utteranceId, transcriptId, text: "Final phrase", model: "fixture/model" });
    expect(duplicate).toMatchObject({ duplicate: true, audioBase64: null });
    expect(provider).toHaveBeenCalledTimes(1);
    database.close();
  });

  it("transcribes recorded audio and synthesizes the selected workspace voice", async () => {
    const speech = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "مرحبا من بغداد", language_code: "ara" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
    const { database, workspaces, voice, work } = await fixture(undefined, speech as typeof fetch);
    await workspaces.updateWorkspaceSettings(work.id, { voice: { enabled: true, voiceId: "iraqi-voice" } });
    const session = await voice.start(work, "conversation"); const utteranceId = crypto.randomUUID(); const transcriptId = "arabic-1";
    const transcript = await voice.transcribe(work, { sessionId: session.id, utteranceId, transcriptId, audioBase64: Buffer.from("audio").toString("base64"), mimeType: "audio/webm" });
    expect(transcript).toMatchObject({ text: "مرحبا من بغداد", languageCode: "ara" });
    const result = await voice.finalize(work, { sessionId: session.id, utteranceId, transcriptId, text: transcript.text, model: "fixture/model" });
    expect(result).toMatchObject({ audioBase64: "AQID", session: { state: "speaking" } });
    expect(JSON.parse(await readFile(join(work.canonicalPath, ".voidra", "voice.json"), "utf8")).sessions.at(-1).audioBase64).toBeNull();
    expect(String(speech.mock.calls[0]![0])).toBe("http://elevenlabs.fixture/v1/speech-to-text");
    expect(String(speech.mock.calls[1]![0])).toContain("/v1/text-to-speech/iraqi-voice/stream?output_format=mp3_44100_128");
    await voice.played(work, session.id, utteranceId);
    expect((await voice.list(work)).sessions.at(-1)?.state).toBe("idle");
    database.close();
  });

  it("distinguishes stopping speech from cancelling reasoning and discards stale audio", async () => {
    const provider = vi.fn(async (_url, init) => new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
      setTimeout(() => resolve(complete("Late response")), 1_000);
    }));
    const { database, voice, work } = await fixture(provider as typeof fetch);
    const session = await voice.start(work, "conversation");
    const pending = voice.finalize(work, { sessionId: session.id, utteranceId: crypto.randomUUID(), transcriptId: "cancel-1", text: "Long task", model: "fixture/model" });
    while (!(await voice.list(work)).sessions.at(-1)?.activeTaskId) await new Promise((resolve) => setTimeout(resolve, 2));
    await voice.interrupt(work, session.id, true);
    expect(await pending).toMatchObject({ task: { status: "cancelled" }, session: { state: "interrupted", audioBase64: null } });
    database.close();
  });

  it("keeps configuration, transcripts, wake state, and session ownership workspace-scoped", async () => {
    const { database, voice, work, personal } = await fixture();
    const session = await voice.start(work, "conversation");
    await voice.configure(work, { wakeWordEnabled: true, retainTranscripts: false, muted: true });
    expect(await voice.list(work)).toMatchObject({ wakeWordEnabled: true, retainTranscripts: false, muted: true });
    expect(await voice.list(personal)).toMatchObject({ wakeWordEnabled: false, retainTranscripts: true, muted: false, sessions: [] });
    await expect(voice.interrupt(personal, session.id, false)).rejects.toMatchObject({ code: "WORKSPACE_CONFLICT" });
    await expect(voice.partial(work, { sessionId: session.id, utteranceId: crypto.randomUUID(), transcriptId: "muted", text: "ignored" })).rejects.toMatchObject({ code: "VOICE_STATE_CONFLICT" });
    database.close();
  });

  it("preserves the text result when speech generation fails", async () => {
    const { database, workspaces, voice, work } = await fixture(undefined, vi.fn().mockResolvedValue(new Response("denied", { status: 401 })) as typeof fetch);
    await workspaces.updateWorkspaceSettings(work.id, { voice: { enabled: true, voiceId: "configured" } });
    const session = await voice.start(work, "push-to-talk");
    const result = await voice.finalize(work, { sessionId: session.id, utteranceId: crypto.randomUUID(), transcriptId: "speech-failure", text: "Keep my answer", model: "fixture/model" });
    expect(result).toMatchObject({ task: { status: "completed", output: "A calm response" }, audioBase64: null, session: { state: "error", error: "ElevenLabs speech failed (401)." } });
    database.close();
  });
});
