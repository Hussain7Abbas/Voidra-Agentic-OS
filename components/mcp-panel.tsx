"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestService } from "@/components/service-types";

type Capability = { name?: string; title?: string; description?: string; uri?: string; inputSchema?: Record<string, unknown>; arguments?: Array<{ name: string }> };
type Connection = { id: string; name: string; transport: string; enabled: boolean; command: string | null; args: string[]; cwd: string | null; env: Record<string, string>; url: string | null; previousConfig: Record<string, unknown> | null; status: string; diagnostic: string | null; serverInfo: { name: string; version: string } | null; protocolVersion: string | null; capabilities: { tools: Capability[]; resources: Capability[]; prompts: Capability[] } };
type Action = { id: string; connectionId: string; tool: string; arguments: Record<string, unknown>; state: string; result: unknown; error: string | null };

function parseObject(value: string) {
  const parsed: unknown = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Arguments must be a JSON object.");
  return parsed as Record<string, unknown>;
}

function parseEnvironment(value: string) {
  const parsed = parseObject(value);
  if (Object.values(parsed).some((entry) => typeof entry !== "string")) throw new Error("Environment must be a JSON object containing string values.");
  return parsed as Record<string, string>;
}

export function McpPanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalog, setCatalog] = useState<Array<Record<string, unknown>>>([]);
  const [catalogStatus, setCatalogStatus] = useState("");
  const [transport, setTransport] = useState<"stdio" | "streamable-http">("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [cwd, setCwd] = useState("");
  const [environment, setEnvironment] = useState("{}");
  const [url, setUrl] = useState("");
  const [editingId, setEditingId] = useState("");
  const [invocationArgs, setInvocationArgs] = useState("{}");
  const [credentialStatus, setCredentialStatus] = useState<Record<string, boolean>>({});
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [output, setOutput] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const result = await request("mcp.list", {}, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    setConnections((result.data.connections as Connection[]) ?? []);
    setActions((result.data.actions as Action[]) ?? []);
  }, [request, workspaceId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => void load(), 750); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => {
    void Promise.all(connections.filter(({ transport }) => transport === "streamable-http").map(async ({ id }) => [id, Boolean((await window.voidra?.secrets.mcpStatus(id))?.configured)] as const)).then((entries) => setCredentialStatus(Object.fromEntries(entries)));
  }, [connections]);

  const run = async (operation: Parameters<RequestService>[0], payload: Record<string, unknown>) => {
    const result = await request(operation, payload, workspaceId);
    setMessage(result.ok ? "MCP configuration updated." : result.error.message);
    await load();
    return result;
  };

  const add = async () => {
    try {
      if (transport === "stdio") {
        const parsedArgs = JSON.parse(args || "[]") as unknown;
        if (!Array.isArray(parsedArgs) || parsedArgs.some((entry) => typeof entry !== "string")) throw new Error("Arguments must be a JSON string array.");
        const env = parseEnvironment(environment);
        if (editingId) await run("mcp.update", { connectionId: editingId, configuration: { transport, name, command, args: parsedArgs, cwd: cwd || null, env } });
        else await run("mcp.addStdio", { name, command, args: parsedArgs, cwd: cwd || null, env });
      } else {
        if (editingId) await run("mcp.update", { connectionId: editingId, configuration: { transport, name, url } });
        else await run("mcp.addRemote", { name, url });
      }
      setName(""); setCommand(""); setArgs("[]"); setCwd(""); setEnvironment("{}"); setUrl(""); setEditingId("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid MCP configuration."); }
  };

  const searchCatalog = async () => {
    const result = await request("mcp.catalog", { query: catalogQuery }, workspaceId);
    if (!result.ok) { setMessage(result.error.message); return; }
    setCatalog((result.data.entries as Array<Record<string, unknown>>) ?? []);
    setCatalogStatus(result.data.stale ? String(result.data.diagnostic ?? "Cached metadata") : `Official Registry · fetched ${String(result.data.fetchedAt)}`);
  };

  const useCatalogEntry = (entry: Record<string, unknown>) => {
    const option = Array.isArray(entry.launchOptions) ? entry.launchOptions[0] as Record<string, unknown> | undefined : undefined;
    if (!option) { setMessage("This declaration has no directly supported stdio or Streamable HTTP launch option."); return; }
    setName(String(entry.name));
    if (option.kind === "stdio") { setTransport("stdio"); setCommand(String(option.command ?? "")); setArgs(JSON.stringify(option.args ?? [], null, 2)); }
    else { setTransport("streamable-http"); setUrl(String(option.url ?? "")); }
    const requirements = Array.isArray(option.requirements) ? option.requirements : [];
    setMessage(requirements.length ? `Review and supply declared requirements before connecting: ${requirements.map((requirement) => String((requirement as Record<string, unknown>).name)).join(", ")}` : "Declared setup copied for review. Add it explicitly to continue.");
  };

  const prepareTool = async (connectionId: string, tool: string) => {
    try { await run("mcp.prepareTool", { connectionId, name: tool, arguments: parseObject(invocationArgs) }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Invalid tool arguments."); }
  };

  return <article className="panel settings-card mcp-card">
    <p className="card-label">MCP MARKETPLACE & CONNECTIONS</p>
    <small>Registry metadata is descriptive and unverified. Connecting or installing never executes catalog text as a shell command.</small>
    <div className="inline-fields"><input aria-label="MCP catalog search" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search the official registry" /><button onClick={searchCatalog}>Search registry</button></div>
    <small data-testid="mcp-catalog-status">{catalogStatus}</small>
    <div className="compact-list" aria-label="MCP catalog results">{catalog.map((entry) => <div key={String(entry.id)}><span><strong>{String(entry.name)}</strong><small>{String(entry.id)} · {String(entry.version)} · declared/unverified<br />{String(entry.description)}</small></span><button onClick={() => useCatalogEntry(entry)}>Use declared setup</button></div>)}</div>

    <hr />
    <div className="segmented" aria-label="MCP transport"><button className={transport === "stdio" ? "selected" : ""} onClick={() => setTransport("stdio")}>Local stdio</button><button className={transport === "streamable-http" ? "selected" : ""} onClick={() => setTransport("streamable-http")}>Remote HTTP</button></div>
    <label>Connection name<input aria-label="MCP connection name" value={name} onChange={(event) => setName(event.target.value)} /></label>
    {transport === "stdio" ? <>
      <label>Executable<input aria-label="MCP executable" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="/usr/local/bin/node" /></label>
      <label>Arguments as JSON array<textarea aria-label="MCP arguments" value={args} onChange={(event) => setArgs(event.target.value)} /></label>
      <label>Workspace-relative working directory<input aria-label="MCP working directory" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder=". (workspace root)" /></label>
      <label>Non-secret environment as JSON object<textarea aria-label="MCP environment" value={environment} onChange={(event) => setEnvironment(event.target.value)} /></label>
    </> : <label>Streamable HTTP URL<input aria-label="MCP remote URL" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" /></label>}
    <div className="button-row"><button onClick={add} disabled={!name.trim() || (transport === "stdio" ? !command.trim() : !url.trim())}>{editingId ? "Update connection" : "Add custom connection"}</button>{editingId && <button onClick={() => { setEditingId(""); setName(""); setCommand(""); setArgs("[]"); setCwd(""); setEnvironment("{}"); setUrl(""); }}>Cancel edit</button>}</div>
    <small>Plain environment values are workspace configuration. Secret-like values are rejected; remote bearer tokens use encrypted per-connection storage below.</small>

    <div className="compact-list mcp-connections" aria-label="MCP connections">{connections.map((connection) => <div key={connection.id} className="mcp-connection">
      <span><strong>{connection.name} · {connection.status}</strong><small>{connection.transport}{connection.serverInfo ? ` · ${connection.serverInfo.name}@${connection.serverInfo.version}` : ""}{connection.protocolVersion ? ` · ${connection.protocolVersion}` : ""}<br />{connection.diagnostic}</small></span>
      <div className="button-row">{connection.status !== "ready" && connection.enabled && <button onClick={() => run("mcp.connect", { connectionId: connection.id })}>Connect</button>}{connection.status === "ready" && <button onClick={() => run("mcp.refresh", { connectionId: connection.id })}>Refresh</button>}{connection.status === "ready" && <button onClick={() => run("mcp.stop", { connectionId: connection.id })}>Stop</button>}<button onClick={() => { setEditingId(connection.id); setName(connection.name); if (connection.transport === "stdio") { setTransport("stdio"); setCommand(connection.command ?? ""); setArgs(JSON.stringify(connection.args, null, 2)); setCwd(connection.cwd ?? ""); setEnvironment(JSON.stringify(connection.env, null, 2)); } else { setTransport("streamable-http"); setUrl(connection.url ?? ""); } }}>Edit</button>{connection.previousConfig && <button onClick={() => run("mcp.rollback", { connectionId: connection.id })}>Rollback</button>}<button onClick={() => run("mcp.setEnabled", { connectionId: connection.id, enabled: !connection.enabled })}>{connection.enabled ? "Disable" : "Enable"}</button><button className="danger-button" onClick={async () => { await window.voidra?.secrets.deleteMcp(connection.id); await run("mcp.remove", { connectionId: connection.id }); }}>Remove</button></div>
      {connection.transport === "streamable-http" && <div className="inline-fields mcp-credential"><input aria-label={`${connection.name} bearer token`} type="password" autoComplete="off" value={tokens[connection.id] ?? ""} onChange={(event) => setTokens((current) => ({ ...current, [connection.id]: event.target.value }))} placeholder={credentialStatus[connection.id] ? "Configured — enter replacement" : "Optional bearer token"} /><button disabled={!tokens[connection.id]} onClick={async () => { await window.voidra?.secrets.setMcp(connection.id, tokens[connection.id]!); setTokens((current) => ({ ...current, [connection.id]: "" })); setCredentialStatus((current) => ({ ...current, [connection.id]: true })); setMessage("MCP credential stored securely."); }}>Save token</button>{credentialStatus[connection.id] && <button onClick={async () => { await window.voidra?.secrets.deleteMcp(connection.id); setCredentialStatus((current) => ({ ...current, [connection.id]: false })); setMessage("MCP credential removed."); }}>Remove token</button>}</div>}
      {connection.status === "ready" && <div className="mcp-capabilities">
        <label>Tool arguments JSON<textarea aria-label={`${connection.name} tool arguments`} value={invocationArgs} onChange={(event) => setInvocationArgs(event.target.value)} /></label>
        <div className="compact-list" aria-label={`${connection.name} tools`}>{connection.capabilities.tools.map((tool) => <button key={tool.name} onClick={() => prepareTool(connection.id, String(tool.name))}><span><strong>{tool.title ?? tool.name}</strong><small>{tool.description}</small></span><span>Review call</span></button>)}</div>
        <div className="compact-list" aria-label={`${connection.name} resources`}>{connection.capabilities.resources.map((resource) => <button key={resource.uri} onClick={async () => { const result = await request("mcp.readResource", { connectionId: connection.id, uri: resource.uri }, workspaceId); setOutput(result.ok ? JSON.stringify(result.data, null, 2) : result.error.message); }}><span><strong>{resource.title ?? resource.name}</strong><small>{resource.uri}</small></span><span>Read</span></button>)}</div>
        <div className="compact-list" aria-label={`${connection.name} prompts`}>{connection.capabilities.prompts.map((prompt) => <button key={prompt.name} onClick={async () => { try { const raw = parseObject(invocationArgs); const promptArgs = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, String(value)])); const result = await request("mcp.getPrompt", { connectionId: connection.id, name: prompt.name, arguments: promptArgs }, workspaceId); setOutput(result.ok ? JSON.stringify(result.data, null, 2) : result.error.message); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid prompt arguments."); } }}><span><strong>{prompt.title ?? prompt.name}</strong><small>{prompt.description}</small></span><span>Get prompt</span></button>)}</div>
      </div>}
    </div>)}</div>
    <div className="compact-list" aria-label="MCP action reviews">{actions.filter(({ state }) => state === "awaiting-approval").map((action) => <div key={action.id}><span><strong>{action.tool}</strong><small>{JSON.stringify(action.arguments)}</small></span><button className="primary" onClick={async () => { const result = await run("mcp.approveTool", { actionId: action.id }); if (result.ok) setOutput(JSON.stringify(result.data, null, 2)); }}>Approve exact call</button></div>)}</div>
    {output && <pre aria-label="MCP result">{output}</pre>}
    {message && <p className="save-message" role="status">{message}</p>}
  </article>;
}
