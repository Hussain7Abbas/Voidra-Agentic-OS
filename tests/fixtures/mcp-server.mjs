import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

serveStdio(() => {
  const server = new McpServer({ name: "voidra-fixture", version: "1.0.0" });
  server.registerTool("echo", {
    title: "Echo",
    description: "Echo fixture text.",
    inputSchema: z.object({ text: z.string() }),
  }, async ({ text }) => ({ content: [{ type: "text", text: `${process.env.VOIDRA_FIXTURE_LABEL ?? "fixture"}:${text}` }] }));
  server.registerTool("crash", { title: "Crash fixture", description: "Terminate the disposable fixture process." }, async () => { process.exit(17); });
  server.registerTool("hang", { title: "Hang fixture", description: "Never resolve, for timeout recovery tests." }, async () => new Promise(() => undefined));
  server.registerTool("fail", { title: "Fail fixture", description: "Return a known tool failure." }, async () => ({ isError: true, content: [{ type: "text", text: "fixture failure" }] }));
  if (process.env.VOIDRA_CALENDAR_STATE_PATH) server.registerTool("calendar_apply_changes", {
    title: "Apply calendar changes",
    description: "Apply exact reviewed fixture calendar changes with an idempotency key.",
    inputSchema: z.object({ changes: z.array(z.record(z.string(), z.unknown())), idempotencyKey: z.string() }),
  }, async ({ changes, idempotencyKey }) => {
    const path = process.env.VOIDRA_CALENDAR_STATE_PATH;
    let state = { keys: [], events: [] };
    try { state = JSON.parse(await readFile(path, "utf8")); } catch { /* First fixture write. */ }
    if (!state.keys.includes(idempotencyKey)) { state.keys.push(idempotencyKey); state.events.push(...changes); await writeFile(path, JSON.stringify(state)); }
    return { content: [{ type: "text", text: `applied:${changes.length}` }], structuredContent: { applied: state.keys.includes(idempotencyKey), eventCount: state.events.length } };
  });
  server.registerResource("workspace-label", "fixture://workspace", {
    title: "Workspace label",
    description: "Reports the fixture's workspace-scoped environment.",
    mimeType: "text/plain",
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: process.env.VOIDRA_FIXTURE_LABEL ?? "fixture" }] }));
  server.registerPrompt("summarize", {
    title: "Summarize",
    description: "Build a summary prompt.",
    argsSchema: z.object({ topic: z.string() }),
  }, async ({ topic }) => ({ messages: [{ role: "user", content: { type: "text", text: `Summarize ${topic}` } }] }));
  return server;
});
