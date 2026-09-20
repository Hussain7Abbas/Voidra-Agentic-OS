import { describe, expect, it, vi } from "vitest";
import { applyOpenRouterChunk, createStreamAccumulator, decodeOpenRouterStream, OpenRouterAdapter, ProviderError } from "../../src/service/openrouter";

function stream(parts: string[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } });
}

describe("OpenRouter streaming adapter", () => {
  it("decodes split text, usage, and fragmented tool arguments", async () => {
    const deltas: string[] = [];
    const result = await decodeOpenRouterStream(stream([
      'data: {"model":"fixture/model","choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo","tool_calls":[{"index":0,"id":"call-1","function":{"name":"write_","arguments":"{\\"pa"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"th\\":\\"a.md\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4,"completion_tokens":5,"total_tokens":9}}\n\n',
      "data: [DONE]\n\n",
    ]), (delta) => deltas.push(delta));
    expect(result).toEqual({ text: "Hello", toolCalls: [{ id: "call-1", name: "write_file", argumentsText: '{"path":"a.md"}' }], model: "fixture/model", usage: { promptTokens: 4, completionTokens: 5, totalTokens: 9 }, finishReason: "tool_calls" });
    expect(deltas).toEqual(["Hel", "lo"]);
  });

  it("rejects malformed chunks without producing actions", async () => {
    await expect(decodeOpenRouterStream(stream(["data: {bad}\n\n"]))).rejects.toMatchObject({ category: "malformed", retryable: false });
    expect(() => applyOpenRouterChunk(createStreamAccumulator(), null)).toThrow(ProviderError);
    const empty = createStreamAccumulator();
    applyOpenRouterChunk(empty, { model: "fixture/model", choices: [] });
    expect(empty.model).toBe("fixture/model");
  });

  it("classifies missing keys, auth, unsupported models, rate limits, and offline errors", async () => {
    const signal = new AbortController().signal;
    const base = { model: "fixture/model", messages: [], tools: [], signal };
    await expect(new OpenRouterAdapter({ apiKey: () => null }).chat(base)).rejects.toMatchObject({ category: "missing-key" });
    for (const [status, category] of [[401, "auth"], [422, "unsupported"], [429, "rate-limit"], [503, "server"]] as const) {
      const adapter = new OpenRouterAdapter({ apiKey: () => "test", fetch: vi.fn(async () => new Response("fixture error", { status })) as typeof fetch });
      await expect(adapter.chat(base)).rejects.toMatchObject({ category });
    }
    const offline = new OpenRouterAdapter({ apiKey: () => "test", fetch: vi.fn(async () => { throw new Error("offline"); }) as typeof fetch });
    await expect(offline.chat(base)).rejects.toBeInstanceOf(ProviderError);
  });
});
