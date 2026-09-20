"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RequestService } from "@/components/service-types";

type VoiceTurn = { utteranceId: string; transcriptId: string; text: string; response: string | null; createdAt: string };
type VoiceSession = { id: string; workspaceId: string; mode: "push-to-talk" | "conversation"; state: string; activeUtteranceId: string | null; partial: string; error: string | null; turns: VoiceTurn[] };
type VoiceRegistry = { wakeWordEnabled: boolean; muted: boolean; retainTranscripts: boolean; sessions: VoiceSession[] };

function blobAsBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(blob);
  });
}

export function VoicePanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [registry, setRegistry] = useState<VoiceRegistry | null>(null);
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [mode, setMode] = useState<"push-to-talk" | "conversation">("push-to-talk");
  const [model, setModel] = useState("openai/gpt-5.4");
  const [transcript, setTranscript] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [cancelTask, setCancelTask] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sessionRef = useRef<VoiceSession | null>(null);
  sessionRef.current = session;

  const load = useCallback(async () => {
    const [voiceResult, settingsResult] = await Promise.all([request("voice.list", {}, workspaceId), request("settings.get", {}, workspaceId)]);
    if (!voiceResult.ok) { setMessage(voiceResult.error.message); return; }
    const next = voiceResult.data as VoiceRegistry;
    setRegistry(next);
    setSession((current) => next.sessions.find(({ id }) => id === current?.id) ?? next.sessions.at(-1) ?? null);
    if (settingsResult.ok) setModel(String((settingsResult.data as Record<string, any>).effective.execution.preferredModel));
  }, [request, workspaceId]);

  useEffect(() => { setSession(null); setTranscript(""); void load(); }, [load, workspaceId]);
  useEffect(() => () => {
    audioRef.current?.pause();
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    const active = sessionRef.current;
    if (active && !["idle", "interrupted", "error", "muted"].includes(active.state)) void request("voice.interrupt", { sessionId: active.id, cancelTask: false }, workspaceId);
  }, [request, workspaceId]);

  const ensureSession = async () => {
    if (session && !["error", "muted"].includes(session.state)) return session;
    const result = await request("voice.start", { mode }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return null; }
    const created = result.data as VoiceSession;
    setSession(created);
    return created;
  };

  const play = async (active: VoiceSession, utteranceId: string, audioBase64: string) => {
    const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
    audioRef.current = audio;
    const complete = async () => {
      if (audioRef.current === audio) audioRef.current = null;
      await request("voice.played", { sessionId: active.id, utteranceId }, workspaceId);
      await load();
    };
    audio.onended = () => void complete();
    try { await audio.play(); }
    catch { setMessage("Speech was generated, but audio playback was unavailable."); await complete(); }
  };

  const finalize = async (active: VoiceSession, text: string, utteranceId = crypto.randomUUID(), transcriptId = crypto.randomUUID()) => {
    if (!text.trim()) return;
    setBusy(true);
    setMessage("Thinking…");
    const result = await request("voice.finalize", { sessionId: active.id, utteranceId, transcriptId, text: text.trim(), model }, workspaceId);
    setBusy(false);
    if (!result.ok) { setMessage(result.error.message); await load(); return; }
    const data = result.data as { session: VoiceSession; task?: { output?: string; status?: string }; audioBase64?: string | null; duplicate?: boolean };
    if (data.duplicate) setMessage("Duplicate final transcript ignored.");
    else if (data.session.error) setMessage(`${data.task?.output ? "Text response completed. " : ""}${data.session.error}`);
    else setMessage(data.audioBase64 ? "Speaking…" : `Response ${data.task?.status ?? "completed"}.`);
    setSession(data.session);
    if (data.audioBase64) await play(data.session, utteranceId, data.audioBase64);
    else await load();
  };

  const record = async () => {
    const active = await ensureSession();
    if (!active) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setMessage("Microphone capture is unavailable in this environment."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => void (async () => {
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) { setMessage("No microphone audio was captured."); return; }
        const utteranceId = crypto.randomUUID(); const transcriptId = crypto.randomUUID();
        setBusy(true); setMessage("Transcribing…");
        const result = await request("voice.transcribe", { sessionId: active.id, utteranceId, transcriptId, audioBase64: await blobAsBase64(blob), mimeType: blob.type || "audio/webm" }, workspaceId);
        setBusy(false);
        if (!result.ok) { setMessage(result.error.message); await load(); return; }
        const text = String((result.data as Record<string, unknown>).text ?? "");
        setTranscript(text);
        await finalize(active, text, utteranceId, transcriptId);
      })();
      recorder.start(250);
      setRecording(true);
      setMessage("Listening…");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Microphone access failed."); }
  };

  const interrupt = async () => {
    audioRef.current?.pause(); audioRef.current = null;
    if (recording) recorderRef.current?.stop();
    if (!session) return;
    const result = await request("voice.interrupt", { sessionId: session.id, cancelTask }, workspaceId);
    setMessage(result.ok ? cancelTask ? "Speech and task cancelled." : "Speech interrupted; the task may continue." : result.error.message);
    await load();
  };

  const configure = async (change: Partial<Pick<VoiceRegistry, "wakeWordEnabled" | "muted" | "retainTranscripts">>) => {
    if (change.muted) { audioRef.current?.pause(); audioRef.current = null; }
    setRegistry((current) => current ? { ...current, ...change } : current);
    const result = await request("voice.configure", change, workspaceId);
    if (!result.ok) setMessage(result.error.message);
    else setRegistry(result.data as VoiceRegistry);
    await load();
  };

  return <section className="panel voice-panel" aria-label="Voice assistant">
    <header className="voice-heading"><div><p className="card-label">VOICE</p><h2>Talk to this workspace</h2></div><output className={`voice-state ${session?.state ?? "idle"}`} data-testid="voice-state">{registry?.muted ? "muted" : session?.state ?? "idle"}</output></header>
    <div className="voice-controls">
      <label>Mode<select aria-label="Voice mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="push-to-talk">Push to talk</option><option value="conversation">Conversation</option></select></label>
      <label>Reasoning model<input aria-label="Voice reasoning model" value={model} onChange={(event) => setModel(event.target.value)} /></label>
      <button onClick={async () => { const created = await request("voice.start", { mode }, workspaceId); if (created.ok) { setSession(created.data as VoiceSession); setMessage("Voice session ready."); } else setMessage(created.error.message); }} disabled={busy || registry?.muted}>New session</button>
      {!recording ? <button className="primary" onClick={record} disabled={busy || registry?.muted}>Start microphone</button> : <button className="primary" onClick={() => recorderRef.current?.stop()}>Stop and send</button>}
      <button className="danger-button" onClick={interrupt} disabled={!session}>Interrupt</button>
    </div>
    <div className="voice-options">
      <label><input type="checkbox" aria-label="Voice muted" checked={registry?.muted ?? false} onChange={(event) => void configure({ muted: event.target.checked })} /> Mute microphone and speech</label>
      <label><input type="checkbox" aria-label="Wake word enabled" checked={registry?.wakeWordEnabled ?? false} onChange={(event) => void configure({ wakeWordEnabled: event.target.checked })} /> Wake word (local engine required)</label>
      <label><input type="checkbox" aria-label="Retain voice transcripts" checked={registry?.retainTranscripts ?? true} onChange={(event) => void configure({ retainTranscripts: event.target.checked })} /> Retain transcripts in this workspace</label>
      <label><input type="checkbox" aria-label="Cancel reasoning on interrupt" checked={cancelTask} onChange={(event) => setCancelTask(event.target.checked)} /> Also cancel reasoning</label>
    </div>
    <label className="voice-transcript">Transcript<textarea aria-label="Voice transcript" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Speak, or enter a transcript for keyboard-accessible voice testing." /></label>
    <div className="button-row"><button onClick={async () => { const active = await ensureSession(); if (!active) return; const utteranceId = crypto.randomUUID(); const transcriptId = crypto.randomUUID(); const result = await request("voice.partial", { sessionId: active.id, utteranceId, transcriptId, text: transcript }, workspaceId); setMessage(result.ok ? "Partial transcript updated; nothing executed." : result.error.message); await load(); }} disabled={!transcript || busy}>Send partial only</button><button className="primary" onClick={async () => { const active = await ensureSession(); if (active) await finalize(active, transcript); }} disabled={!transcript.trim() || busy || registry?.muted}>Finalize and run once</button></div>
    <small>Captured audio is sent to ElevenLabs for transcription and is not stored locally. Provider-side retention follows your ElevenLabs account and request terms.</small>
    <p className="voice-message" role="status">{message}</p>
    <div className="voice-history" aria-label="Voice transcript history">{session?.turns?.length ? session.turns.map((turn) => <article key={turn.transcriptId}><small>{new Date(turn.createdAt).toLocaleTimeString()}</small><p><strong>You:</strong> {turn.text}</p><p><strong>Voidra:</strong> {turn.response ?? "Waiting…"}</p></article>) : <small>No retained turns in this session.</small>}</div>
  </section>;
}
