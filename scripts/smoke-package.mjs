import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const appBinary = join(root, "release", "mac-arm64", "Voidra.app", "Contents", "MacOS", "Voidra");
const temporary = await mkdtemp(join(tmpdir(), "voidra-smoke-"));
const marker = join(temporary, "smoke.json");

try {
  const child = spawn(appBinary, [], {
    env: {
      ...process.env,
      VOIDRA_E2E: "1",
      VOIDRA_USER_DATA_DIR: join(temporary, "profile"),
      VOIDRA_SMOKE_MARKER: marker,
    },
    stdio: "inherit",
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`Packaged application exited with code ${exitCode}`);
  }

  const result = JSON.parse(await readFile(marker, "utf8"));
  if (result.status !== "ready" || result.packaged !== true || result.diagnosticsExposed !== false) {
    throw new Error(`Unexpected smoke marker: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`Packaged smoke passed (${result.arch}).\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
