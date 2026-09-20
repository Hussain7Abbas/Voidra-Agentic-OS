import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { ServiceDatabase } from "./database";
import { ServiceRuntime } from "./runtime";
import type { ServiceMessage } from "../shared/contracts";

const databasePath = process.env.VOIDRA_SERVICE_DB_PATH;
if (!databasePath) throw new Error("VOIDRA_SERVICE_DB_PATH is required");
mkdirSync(dirname(databasePath), { recursive: true });

const database = new ServiceDatabase(databasePath);
let sequence = 0;
const runtime = new ServiceRuntime(database, (event) => send({ kind: "event", event: { ...event, sequence: ++sequence } }));

function send(message: ServiceMessage) {
  if (process.send) process.send(message);
}

process.on("message", async (input: unknown) => {
  if (typeof input === "object" && input !== null && "kind" in input && input.kind === "credential.update" && "provider" in input && typeof input.provider === "string" && "value" in input && (typeof input.value === "string" || input.value === null)) {
    runtime.setCredential(input.provider, input.value);
    return;
  }
  const response = await runtime.handle(input);
  send({ kind: "response", response });
  if (response.ok && typeof input === "object" && input !== null && "workspaceId" in input && typeof input.workspaceId === "string") {
    send({
      kind: "event",
      event: {
        sequence: ++sequence,
        type: "request.completed",
        workspaceId: input.workspaceId,
        payload: { requestId: response.requestId },
      },
    });
  }
});

async function shutdown() {
  await runtime.close();
  database.close();
  process.exit(0);
}

process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
send({ kind: "ready", pid: process.pid });
