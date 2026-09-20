import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Client, StreamableHTTPClientTransport, type Transport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";
import type { WorkspaceRecord } from "./database";
import { ServiceDatabase } from "./database";
import { DomainError } from "./workspaces";

const capabilitySchema = z.object({
  tools: z.array(z.record(z.string(), z.unknown())),
  resources: z.array(z.record(z.string(), z.unknown())),
  prompts: z.array(z.record(z.string(), z.unknown())),
}).strict();
const configSchema = z.object({ transport: z.enum(["stdio", "streamable-http"]), command: z.string().nullable(), args: z.array(z.string()), cwd: z.string().nullable(), env: z.record(z.string(), z.string()), url: z.string().nullable() }).strict();

const connectionSchema = z.object({
  id: z.uuid(), workspaceId: z.uuid(), name: z.string(), transport: z.enum(["stdio", "streamable-http"]), enabled: z.boolean(),
  command: z.string().nullable(), args: z.array(z.string()), cwd: z.string().nullable(), env: z.record(z.string(), z.string()), url: z.string().nullable(),
  previousConfig: configSchema.nullable().default(null),
  status: z.enum(["configured", "starting", "ready", "authorization-required", "degraded", "stopped", "failed"]),
  serverInfo: z.object({ name: z.string(), version: z.string() }).nullable(), protocolVersion: z.string().nullable(), capabilities: capabilitySchema,
  diagnostic: z.string().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();

const actionSchema = z.object({
  id: z.uuid(), workspaceId: z.uuid(), connectionId: z.uuid(), tool: z.string(), arguments: z.record(z.string(), z.unknown()), capabilityHash: z.string(),
  state: z.enum(["awaiting-approval", "running", "completed", "failed", "uncertain", "cancelled"]), result: z.unknown().nullable(), error: z.string().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();

const registrySchema = z.object({ schemaVersion: z.literal(1), connections: z.array(connectionSchema), actions: z.array(actionSchema) }).strict();
type Registry = z.infer<typeof registrySchema>;
type Connection = z.infer<typeof connectionSchema>;
type Action = z.infer<typeof actionSchema>;
type Config = z.infer<typeof configSchema>;
type Session = { client: Client; transport: Transport };

const catalogCacheSchema = z.object({ fetchedAt: z.iso.datetime(), entries: z.array(z.object({
  id: z.string(), name: z.string(), description: z.string(), version: z.string(), source: z.literal("official-registry"), transports: z.array(z.string()), setup: z.array(z.string()), launchOptions: z.array(z.record(z.string(), z.unknown())).default([]), reviewStatus: z.literal("declared-unverified"),
}).strict()) }).strict();

function json(value: unknown) { return `${JSON.stringify(value, null, 2)}\n`; }
function emptyCapabilities() { return { tools: [], resources: [], prompts: [] } satisfies z.infer<typeof capabilitySchema>; }
function cloneRecords(value: unknown[]) { return JSON.parse(JSON.stringify(value)) as Array<Record<string, unknown>>; }
function capabilityHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function records(value: unknown) { return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object") : []; }
function declaredLaunchOptions(server: { packages?: Array<Record<string, unknown>>; remotes?: Array<Record<string, unknown>> }) {
  const local = (server.packages ?? []).flatMap((entry) => {
    const transport = entry.transport && typeof entry.transport === "object" ? entry.transport as Record<string, unknown> : {};
    if (transport.type !== "stdio" || entry.registryType !== "npm" || typeof entry.identifier !== "string" || typeof entry.version !== "string") return [];
    const runtimeArguments = records(entry.runtimeArguments).map(({ value }) => String(value ?? "")).filter(Boolean);
    const requirements = [...records(entry.environmentVariables).map(({ name, isSecret, isRequired }) => ({ kind: "environment", name: String(name ?? ""), secret: Boolean(isSecret), required: Boolean(isRequired) })), ...records(entry.packageArguments).map(({ name, isRequired }) => ({ kind: "argument", name: String(name ?? ""), secret: false, required: Boolean(isRequired) }))];
    return [{ kind: "stdio", command: typeof entry.runtimeHint === "string" ? entry.runtimeHint : "npx", args: [...runtimeArguments, `${entry.identifier}@${entry.version}`], requirements }];
  });
  const remote = (server.remotes ?? []).flatMap((entry) => entry.type === "streamable-http" && typeof entry.url === "string" ? [{ kind: "streamable-http", url: entry.url, requirements: records(entry.headers).map(({ name, isSecret, isRequired }) => ({ kind: "header", name: String(name ?? ""), secret: Boolean(isSecret), required: Boolean(isRequired) })) }] : []);
  return [...local, ...remote];
}

async function atomicWrite(path: string, content: string) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try { await rename(temporary, path); } catch (error) { await rm(temporary, { force: true }); throw error; }
}

function within(parent: string, child: string) {
  const fromParent = relative(parent, child);
  return fromParent === "" || (!fromParent.startsWith(`..${sep}`) && fromParent !== ".." && !isAbsolute(fromParent));
}

function safeRemoteUrl(raw: string) {
  const url = new URL(raw);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new DomainError("MCP_STATE_CONFLICT", "Remote MCP URLs must use HTTPS, except for loopback fixtures.");
  if (url.username || url.password) throw new DomainError("MCP_STATE_CONFLICT", "Put credentials in secure storage, not in the MCP URL.");
  return url;
}

export class McpManager {
  readonly #registries = new Map<string, Registry>();
  readonly #sessions = new Map<string, Session>();
  readonly #saveQueues = new Map<string, Promise<void>>();
  #closing = false;

  constructor(
    private readonly database: ServiceDatabase,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly credential: (connectionId: string) => string | null = () => null,
    private readonly catalogBaseUrl = "https://registry.modelcontextprotocol.io",
    private readonly timeouts = { connect: 5_000, discovery: 5_000, request: 15_000 },
  ) {}

  async catalog(query: string) {
    const url = new URL("/v0.1/servers", this.catalogBaseUrl);
    url.searchParams.set("limit", "50");
    url.searchParams.set("version", "latest");
    if (query.trim()) url.searchParams.set("search", query.trim());
    try {
      const response = await this.fetchImpl(url);
      if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}.`);
      const body = z.object({ servers: z.array(z.object({ server: z.object({ name: z.string(), title: z.string().optional(), description: z.string().optional(), version: z.string(), packages: z.array(z.record(z.string(), z.unknown())).optional(), remotes: z.array(z.record(z.string(), z.unknown())).optional() }).passthrough() }).passthrough()) }).passthrough().parse(await response.json());
      const fetchedAt = new Date().toISOString();
      const entries = body.servers.map(({ server }) => ({
        id: server.name, name: server.title ?? server.name, description: server.description ?? "No description supplied.", version: server.version, source: "official-registry" as const,
        transports: [...new Set([...(server.packages ?? []).map(() => "stdio"), ...(server.remotes ?? []).map((remote) => String(remote.type ?? "remote"))])],
        setup: [...(server.packages ?? []).map((entry) => `package:${String(entry.registryType ?? entry.registry ?? "declared")}`), ...(server.remotes ?? []).map((entry) => `remote:${String(entry.url ?? "declared")}`)],
        launchOptions: declaredLaunchOptions(server),
        reviewStatus: "declared-unverified" as const,
      }));
      this.database.setMetadata("mcp_catalog_cache", json({ fetchedAt, entries }));
      return { entries, fetchedAt, stale: false, source: "official-registry" };
    } catch {
      const cached = this.database.getMetadata("mcp_catalog_cache");
      if (!cached) return { entries: [], fetchedAt: null, stale: true, source: "offline", diagnostic: "Official registry is unavailable; custom setup remains available." };
      const parsed = catalogCacheSchema.parse(JSON.parse(cached));
      const lowered = query.trim().toLocaleLowerCase();
      const entries = lowered ? parsed.entries.filter((entry) => `${entry.id} ${entry.name} ${entry.description}`.toLocaleLowerCase().includes(lowered)) : parsed.entries;
      return { entries, fetchedAt: parsed.fetchedAt, stale: true, source: "cached", diagnostic: "Showing cached registry metadata; availability is not verified." };
    }
  }

  async list(workspace: WorkspaceRecord) {
    const registry = await this.#registry(workspace);
    return { connections: registry.connections, actions: registry.actions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }

  async addStdio(workspace: WorkspaceRecord, input: { name: string; command: string; args: string[]; cwd?: string | null; env?: Record<string, string> }) {
    const registry = await this.#registry(workspace);
    if (!input.command.trim() || input.command.includes("\0")) throw new DomainError("MCP_STATE_CONFLICT", "A direct executable is required.");
    const env = input.env ?? {};
    for (const [key, value] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(key) || value.length > 10_000) throw new DomainError("MCP_STATE_CONFLICT", "Only non-secret, valid environment values may be stored in MCP configuration.");
    }
    const cwd = await this.#cwd(workspace, input.cwd ?? null);
    const connection = this.#newConnection(workspace, input.name, { transport: "stdio", command: input.command.trim(), args: input.args, cwd, env, url: null });
    registry.connections.push(connection);
    await this.#save(workspace, registry);
    return connection;
  }

  async addRemote(workspace: WorkspaceRecord, input: { name: string; url: string }) {
    const registry = await this.#registry(workspace);
    const url = safeRemoteUrl(input.url).toString();
    const connection = this.#newConnection(workspace, input.name, { transport: "streamable-http", command: null, args: [], cwd: null, env: {}, url });
    registry.connections.push(connection);
    await this.#save(workspace, registry);
    return connection;
  }

  async update(workspace: WorkspaceRecord, connectionId: string, input: { name: string; transport: "stdio"; command: string; args: string[]; cwd?: string | null; env?: Record<string, string> } | { name: string; transport: "streamable-http"; url: string }) {
    const registry = await this.#registry(workspace);
    const connection = this.#connection(registry, workspace.id, connectionId);
    const previous = this.#config(connection);
    let next: Config;
    if (input.transport === "stdio") {
      if (!input.command.trim() || input.command.includes("\0")) throw new DomainError("MCP_STATE_CONFLICT", "A direct executable is required.");
      const env = input.env ?? {};
      for (const [key, value] of Object.entries(env)) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(key) || value.length > 10_000) throw new DomainError("MCP_STATE_CONFLICT", "Only non-secret, valid environment values may be stored in MCP configuration.");
      next = { transport: "stdio", command: input.command.trim(), args: input.args, cwd: await this.#cwd(workspace, input.cwd ?? null), env, url: null };
    } else next = { transport: "streamable-http", command: null, args: [], cwd: null, env: {}, url: safeRemoteUrl(input.url).toString() };
    await this.#closeSession(connection.id);
    Object.assign(connection, next, { name: input.name.trim(), previousConfig: previous, status: "configured", serverInfo: null, protocolVersion: null, capabilities: emptyCapabilities(), diagnostic: null });
    this.#touch(connection);
    await this.#save(workspace, registry);
    return connection;
  }

  async rollback(workspace: WorkspaceRecord, connectionId: string) {
    const registry = await this.#registry(workspace);
    const connection = this.#connection(registry, workspace.id, connectionId);
    if (!connection.previousConfig) throw new DomainError("MCP_STATE_CONFLICT", "This connection has no previous configuration to restore.");
    await this.#closeSession(connection.id);
    Object.assign(connection, connection.previousConfig, { previousConfig: null, status: "configured", serverInfo: null, protocolVersion: null, capabilities: emptyCapabilities(), diagnostic: "Previous configuration restored; reconnect to test it." });
    this.#touch(connection);
    await this.#save(workspace, registry);
    return connection;
  }

  async connect(workspace: WorkspaceRecord, connectionId: string) {
    const registry = await this.#registry(workspace);
    const connection = this.#connection(registry, workspace.id, connectionId);
    if (!connection.enabled) throw new DomainError("MCP_STATE_CONFLICT", "This MCP connection is disabled.");
    await this.#closeSession(connection.id);
    connection.status = "starting";
    connection.diagnostic = null;
    this.#touch(connection);
    await this.#save(workspace, registry);
    let client: Client | undefined;
    try {
      client = new Client({ name: "voidra", version: "0.1.0" }, { enforceStrictCapabilities: true, listMaxPages: 64, cachePartition: workspace.id });
      let transport: Transport;
      if (connection.transport === "stdio") {
        transport = new StdioClientTransport({ command: connection.command!, args: connection.args, cwd: connection.cwd ?? workspace.canonicalPath, env: { ...getDefaultEnvironment(), ...connection.env }, stderr: "pipe" });
        const stderr = (transport as StdioClientTransport).stderr;
        stderr?.on("data", (chunk) => {
          if (this.#closing) return;
          connection.diagnostic = this.#redact(connection, String(chunk)).slice(-4000);
          this.#touch(connection);
          void this.#save(workspace, registry).catch(() => undefined);
        });
      } else {
        const token = this.credential(connection.id);
        transport = new StreamableHTTPClientTransport(safeRemoteUrl(connection.url!), token ? { authProvider: { token: async () => token } } : undefined);
      }
      await client.connect(transport, { timeout: this.timeouts.connect });
      this.#sessions.set(connection.id, { client, transport });
      client.onclose = () => {
        if (!this.#sessions.has(connection.id)) return;
        this.#sessions.delete(connection.id);
        connection.status = "degraded";
        connection.diagnostic = "The MCP server connection closed unexpectedly.";
        this.#touch(connection);
        void this.#save(workspace, registry).catch(() => undefined);
      };
      client.onerror = (error) => {
        if (!this.#sessions.has(connection.id)) return;
        connection.diagnostic = this.#redact(connection, error.message);
        this.#touch(connection);
        void this.#save(workspace, registry).catch(() => undefined);
      };
      connection.capabilities = await this.#discover(client);
      const info = client.getServerVersion();
      connection.serverInfo = info ? { name: info.name, version: info.version } : null;
      connection.protocolVersion = client.getNegotiatedProtocolVersion() ?? null;
      connection.status = "ready";
      connection.previousConfig = null;
      connection.diagnostic = null;
      this.#touch(connection);
      await this.#save(workspace, registry);
      return connection;
    } catch (error) {
      await client?.close().catch(() => undefined);
      this.#sessions.delete(connection.id);
      connection.status = this.#authorizationError(error) ? "authorization-required" : "failed";
      connection.diagnostic = this.#redact(connection, error instanceof Error ? error.message : String(error));
      this.#touch(connection);
      await this.#save(workspace, registry);
      return connection;
    }
  }

  async refresh(workspace: WorkspaceRecord, connectionId: string) {
    const registry = await this.#registry(workspace);
    const connection = this.#connection(registry, workspace.id, connectionId);
    const session = this.#readySession(connection);
    try { connection.capabilities = await this.#discover(session.client, "refresh"); connection.status = "ready"; connection.diagnostic = null; }
    catch (error) { connection.status = this.#authorizationError(error) ? "authorization-required" : "degraded"; connection.diagnostic = this.#redact(connection, error instanceof Error ? error.message : String(error)); }
    this.#touch(connection);
    await this.#save(workspace, registry);
    return connection;
  }

  async stop(workspace: WorkspaceRecord, connectionId: string) {
    const registry = await this.#registry(workspace);
    const connection = this.#connection(registry, workspace.id, connectionId);
    await this.#closeSession(connection.id);
    connection.status = "stopped";
    connection.diagnostic = null;
    this.#touch(connection);
    await this.#save(workspace, registry);
    return connection;
  }

  async setEnabled(workspace: WorkspaceRecord, connectionId: string, enabled: boolean) {
    const registry = await this.#registry(workspace);
    const connection = this.#connection(registry, workspace.id, connectionId);
    if (!enabled) await this.#closeSession(connection.id);
    connection.enabled = enabled;
    connection.status = enabled ? "configured" : "stopped";
    this.#touch(connection);
    await this.#save(workspace, registry);
    return connection;
  }

  async remove(workspace: WorkspaceRecord, connectionId: string) {
    const registry = await this.#registry(workspace);
    this.#connection(registry, workspace.id, connectionId);
    await this.#closeSession(connectionId);
    registry.connections = registry.connections.filter(({ id }) => id !== connectionId);
    for (const action of registry.actions.filter(({ connectionId: owner, state }) => owner === connectionId && state === "awaiting-approval")) { action.state = "cancelled"; this.#touch(action); }
    await this.#save(workspace, registry);
    return { removed: true };
  }

  async readResource(workspace: WorkspaceRecord, connectionId: string, uri: string) {
    const { connection, session } = await this.#scope(workspace, connectionId);
    const refreshed = await session.client.listResources(undefined, { cacheMode: "refresh", timeout: this.timeouts.discovery });
    if (!refreshed.resources.some((resource) => resource.uri === uri)) throw new DomainError("MCP_STATE_CONFLICT", "The resource is no longer advertised by this server.");
    const result = await session.client.readResource({ uri }, { cacheMode: "bypass", timeout: this.timeouts.request });
    connection.capabilities.resources = cloneRecords(refreshed.resources);
    return { connectionId, uri, contents: result.contents };
  }

  async getPrompt(workspace: WorkspaceRecord, connectionId: string, name: string, args: Record<string, string>) {
    const { connection, session } = await this.#scope(workspace, connectionId);
    const refreshed = await session.client.listPrompts(undefined, { cacheMode: "refresh", timeout: this.timeouts.discovery });
    if (!refreshed.prompts.some((prompt) => prompt.name === name)) throw new DomainError("MCP_STATE_CONFLICT", "The prompt is no longer advertised by this server.");
    const result = await session.client.getPrompt({ name, arguments: args }, { timeout: this.timeouts.request });
    connection.capabilities.prompts = cloneRecords(refreshed.prompts);
    return { connectionId, name, description: result.description, messages: result.messages };
  }

  async prepareTool(workspace: WorkspaceRecord, connectionId: string, name: string, args: Record<string, unknown>) {
    const registry = await this.#registry(workspace);
    const connection = this.#connection(registry, workspace.id, connectionId);
    const session = this.#readySession(connection);
    const refreshed = await session.client.listTools(undefined, { cacheMode: "refresh", timeout: this.timeouts.discovery });
    const tool = refreshed.tools.find((candidate) => candidate.name === name);
    if (!tool) throw new DomainError("MCP_STATE_CONFLICT", "The tool is no longer advertised by this server.");
    connection.capabilities.tools = cloneRecords(refreshed.tools);
    const now = new Date().toISOString();
    const action: Action = { id: randomUUID(), workspaceId: workspace.id, connectionId, tool: name, arguments: args, capabilityHash: capabilityHash(tool), state: "awaiting-approval", result: null, error: null, createdAt: now, updatedAt: now };
    registry.actions.push(action);
    await this.#save(workspace, registry);
    return action;
  }

  async agentTools(workspace: WorkspaceRecord) {
    const registry = await this.#registry(workspace);
    return registry.connections.filter((connection) => connection.enabled && connection.status === "ready" && this.#sessions.has(connection.id)).flatMap((connection) => connection.capabilities.tools.map((tool) => ({
      connectionId: connection.id,
      connectionName: connection.name,
      name: String(tool.name),
      description: typeof tool.description === "string" ? tool.description : "No description supplied.",
      inputSchema: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema as Record<string, unknown> : { type: "object" },
    })));
  }

  async callForAgent(workspace: WorkspaceRecord, connectionId: string, name: string, args: Record<string, unknown>) {
    const { session } = await this.#scope(workspace, connectionId);
    const refreshed = await session.client.listTools(undefined, { cacheMode: "refresh", timeout: this.timeouts.discovery });
    const tool = refreshed.tools.find((candidate) => candidate.name === name);
    if (!tool) throw new DomainError("MCP_STATE_CONFLICT", "The MCP tool is no longer advertised by this server.");
    return session.client.callTool({ name, arguments: args }, { timeout: this.timeouts.request, toolDefinition: tool });
  }

  async approveTool(workspace: WorkspaceRecord, actionId: string) {
    const registry = await this.#registry(workspace);
    const action = registry.actions.find(({ id, workspaceId }) => id === actionId && workspaceId === workspace.id);
    if (!action || action.state !== "awaiting-approval") throw new DomainError("MCP_STATE_CONFLICT", "This MCP action is not awaiting approval.");
    const connection = this.#connection(registry, workspace.id, action.connectionId);
    const session = this.#readySession(connection);
    const refreshed = await session.client.listTools(undefined, { cacheMode: "refresh", timeout: this.timeouts.discovery });
    const tool = refreshed.tools.find((candidate) => candidate.name === action.tool);
    if (!tool || capabilityHash(tool) !== action.capabilityHash) throw new DomainError("MCP_STATE_CONFLICT", "The tool capability changed after review; prepare a new action.");
    connection.capabilities.tools = cloneRecords(refreshed.tools);
    action.state = "running";
    this.#touch(action);
    await this.#save(workspace, registry);
    try {
      const result = await session.client.callTool({ name: action.tool, arguments: action.arguments }, { timeout: this.timeouts.request, toolDefinition: tool });
      action.state = result.isError ? "failed" : "completed";
      action.result = JSON.parse(JSON.stringify(result));
      action.error = result.isError ? "The MCP tool reported an error." : null;
    } catch (error) {
      action.state = "uncertain";
      action.error = this.#redact(connection, error instanceof Error ? error.message : String(error));
    }
    this.#touch(action);
    await this.#save(workspace, registry);
    return action;
  }

  async close() {
    this.#closing = true;
    await Promise.all([...this.#sessions].map(([id]) => this.#closeSession(id)));
    await Promise.all([...this.#saveQueues.values()].map((pending) => pending.catch(() => undefined)));
  }

  #newConnection(workspace: WorkspaceRecord, name: string, config: Pick<Connection, "transport" | "command" | "args" | "cwd" | "env" | "url">): Connection {
    const now = new Date().toISOString();
    return { id: randomUUID(), workspaceId: workspace.id, name: name.trim(), enabled: true, ...config, previousConfig: null, status: "configured", serverInfo: null, protocolVersion: null, capabilities: emptyCapabilities(), diagnostic: null, createdAt: now, updatedAt: now };
  }

  #config(connection: Connection): Config { return { transport: connection.transport, command: connection.command, args: [...connection.args], cwd: connection.cwd, env: { ...connection.env }, url: connection.url }; }

  async #scope(workspace: WorkspaceRecord, connectionId: string) {
    const registry = await this.#registry(workspace);
    const connection = this.#connection(registry, workspace.id, connectionId);
    return { connection, session: this.#readySession(connection) };
  }

  #connection(registry: Registry, workspaceId: string, connectionId: string) {
    const connection = registry.connections.find(({ id, workspaceId: owner }) => id === connectionId && owner === workspaceId);
    if (!connection) throw new DomainError("WORKSPACE_CONFLICT", "The MCP connection does not exist in this workspace.");
    return connection;
  }

  #readySession(connection: Connection) {
    const session = this.#sessions.get(connection.id);
    if (!connection.enabled || connection.status !== "ready" || !session) throw new DomainError("MCP_STATE_CONFLICT", "The MCP connection is not ready.", true);
    return session;
  }

  async #discover(client: Client, cacheMode: "use" | "refresh" = "use") {
    const [tools, resources, prompts] = await Promise.all([
      client.listTools(undefined, { cacheMode, timeout: this.timeouts.discovery }), client.listResources(undefined, { cacheMode, timeout: this.timeouts.discovery }), client.listPrompts(undefined, { cacheMode, timeout: this.timeouts.discovery }),
    ]);
    return { tools: cloneRecords(tools.tools), resources: cloneRecords(resources.resources), prompts: cloneRecords(prompts.prompts) };
  }

  async #cwd(workspace: WorkspaceRecord, requested: string | null) {
    if (!requested) return workspace.canonicalPath;
    const candidate = resolve(workspace.canonicalPath, requested);
    const canonical = await realpath(candidate).catch(() => { throw new DomainError("MCP_STATE_CONFLICT", "The MCP working directory is unavailable."); });
    if (!within(workspace.canonicalPath, canonical) || !(await stat(canonical)).isDirectory()) throw new DomainError("MCP_STATE_CONFLICT", "The MCP working directory must be inside its workspace.");
    return canonical;
  }

  #authorizationError(error: unknown) { return /401|unauthori[sz]ed|authorization required/i.test(error instanceof Error ? error.message : String(error)); }
  #redact(connection: Connection, text: string) { return Object.values(connection.env).reduce((value, secret) => secret ? value.replaceAll(secret, "[REDACTED]") : value, text).slice(0, 4000); }
  #touch(record: Connection | Action) { record.updatedAt = new Date().toISOString(); }
  #path(workspace: WorkspaceRecord) { return join(workspace.canonicalPath, ".voidra", "mcp.json"); }

  async #registry(workspace: WorkspaceRecord) {
    const cached = this.#registries.get(workspace.id);
    if (cached) return cached;
    let registry: Registry;
    try { registry = registrySchema.parse(JSON.parse(await readFile(this.#path(workspace), "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new DomainError("INCOMPATIBLE_SCHEMA", "MCP connection metadata requires recovery.");
      registry = { schemaVersion: 1, connections: [], actions: [] };
    }
    for (const connection of registry.connections) if (["starting", "ready", "degraded"].includes(connection.status)) { connection.status = "stopped"; connection.diagnostic = "Reconnect after local service restart."; this.#touch(connection); }
    this.#registries.set(workspace.id, registry);
    await this.#save(workspace, registry);
    return registry;
  }

  async #save(workspace: WorkspaceRecord, registry: Registry) {
    const content = json(registry);
    const prior = this.#saveQueues.get(workspace.id) ?? Promise.resolve();
    const pending = prior.catch(() => undefined).then(() => atomicWrite(this.#path(workspace), content));
    this.#saveQueues.set(workspace.id, pending);
    try { await pending; }
    finally { if (this.#saveQueues.get(workspace.id) === pending) this.#saveQueues.delete(workspace.id); }
  }
  async #closeSession(id: string) { const session = this.#sessions.get(id); this.#sessions.delete(id); await session?.client.close().catch(() => undefined); }
}
