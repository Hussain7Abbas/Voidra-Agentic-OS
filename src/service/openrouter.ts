export type ProviderToolCall = { id: string; name: string; argumentsText: string };
export type ProviderUsage = { promptTokens: number; completionTokens: number; totalTokens: number };
export type ProviderResult = { text: string; toolCalls: ProviderToolCall[]; model: string; usage: ProviderUsage | null; finishReason: string | null };

export class ProviderError extends Error {
  constructor(readonly category: "missing-key" | "unsupported" | "auth" | "rate-limit" | "offline" | "malformed" | "server", message: string, readonly retryable: boolean) {
    super(message);
    this.name = "ProviderError";
  }
}

type StreamAccumulator = {
  text: string;
  model: string;
  finishReason: string | null;
  usage: ProviderUsage | null;
  calls: Map<number, ProviderToolCall>;
};

export function createStreamAccumulator(): StreamAccumulator {
  return { text: "", model: "", finishReason: null, usage: null, calls: new Map() };
}

export function applyOpenRouterChunk(accumulator: StreamAccumulator, value: unknown) {
  if (!value || typeof value !== "object") throw new ProviderError("malformed", "The provider returned a malformed stream event.", false);
  const chunk = value as Record<string, unknown>;
  if (typeof chunk.model === "string") accumulator.model = chunk.model;
  const usage = chunk.usage as Record<string, unknown> | undefined;
  if (usage) accumulator.usage = {
    promptTokens: Number(usage.prompt_tokens ?? 0),
    completionTokens: Number(usage.completion_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? 0),
  };
  const choice = Array.isArray(chunk.choices) ? chunk.choices[0] as Record<string, unknown> | undefined : undefined;
  if (!choice) return;
  if (typeof choice.finish_reason === "string") accumulator.finishReason = choice.finish_reason;
  const delta = choice.delta as Record<string, unknown> | undefined;
  if (!delta) return;
  if (typeof delta.content === "string") accumulator.text += delta.content;
  if (!Array.isArray(delta.tool_calls)) return;
  for (const raw of delta.tool_calls as Array<Record<string, unknown>>) {
    const index = Number(raw.index ?? 0);
    const current = accumulator.calls.get(index) ?? { id: "", name: "", argumentsText: "" };
    if (typeof raw.id === "string") current.id = raw.id;
    const fn = raw.function as Record<string, unknown> | undefined;
    if (typeof fn?.name === "string") current.name += fn.name;
    if (typeof fn?.arguments === "string") current.argumentsText += fn.arguments;
    accumulator.calls.set(index, current);
  }
}

export async function decodeOpenRouterStream(body: ReadableStream<Uint8Array>, onText?: (delta: string) => void): Promise<ProviderResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const accumulator = createStreamAccumulator();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? "" : lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let parsed: unknown;
      try { parsed = JSON.parse(data); }
      catch { throw new ProviderError("malformed", "The provider returned invalid streaming JSON.", false); }
      const before = accumulator.text.length;
      applyOpenRouterChunk(accumulator, parsed);
      const delta = accumulator.text.slice(before);
      if (delta) onText?.(delta);
    }
    if (done) break;
  }
  return { text: accumulator.text, toolCalls: [...accumulator.calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call), model: accumulator.model, usage: accumulator.usage, finishReason: accumulator.finishReason };
}

export class OpenRouterAdapter {
  constructor(private readonly options: { baseUrl?: string; apiKey: () => string | null; fetch?: typeof fetch } ) {}

  async chat(input: { model: string; messages: Array<Record<string, unknown>>; tools: Array<Record<string, unknown>>; signal: AbortSignal; onText?: (delta: string) => void }) {
    const key = this.options.apiKey();
    if (!key) throw new ProviderError("missing-key", "Configure an OpenRouter API key before starting an automatic task.", false);
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`${this.options.baseUrl ?? "https://openrouter.ai/api/v1"}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: input.model, messages: input.messages, tools: input.tools, parallel_tool_calls: false, stream: true, stream_options: { include_usage: true } }),
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal.aborted) throw error;
      throw new ProviderError("offline", "OpenRouter is unreachable. Check the network and retry the task.", true);
    }
    if (!response.ok) {
      const message = (await response.text()).slice(0, 500);
      if (response.status === 401 || response.status === 403) throw new ProviderError("auth", "OpenRouter rejected the configured credential.", false);
      if (response.status === 404 || response.status === 422) throw new ProviderError("unsupported", `The selected model or tool combination is unsupported. ${message}`.trim(), false);
      if (response.status === 429) throw new ProviderError("rate-limit", "OpenRouter rate-limited the task. Retry after the provider window resets.", true);
      throw new ProviderError("server", `OpenRouter failed with HTTP ${response.status}.`, response.status >= 500 || response.status === 408);
    }
    if (!response.body) throw new ProviderError("malformed", "OpenRouter returned no stream body.", true);
    return decodeOpenRouterStream(response.body, input.onText);
  }
}
