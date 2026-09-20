import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";

const root = process.cwd();
const appPath = join(root, "release", "mac-arm64", "Voidra.app");
const outputPath = join(root, "release", "release-manifest.json");

async function digestFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function inventory(directory, entries = []) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(directory, entry.name);
    const path = relative(appPath, absolute).split("/").join("/");
    const details = await lstat(absolute);
    if (entry.isDirectory()) await inventory(absolute, entries);
    else if (entry.isSymbolicLink()) entries.push({ path, kind: "symlink", target: await readlink(absolute), bytes: 0 });
    else if (entry.isFile()) entries.push({ path, kind: "file", sha256: await digestFile(absolute), bytes: details.size });
  }
  return entries;
}

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const lockSha256 = await digestFile(join(root, "pnpm-lock.yaml"));
const entries = await inventory(appPath);
const treeHash = createHash("sha256");
for (const entry of entries) treeHash.update(`${entry.kind}\0${entry.path}\0${entry.sha256 ?? entry.target}\0${entry.bytes}\n`);
const executable = join(appPath, "Contents", "MacOS", "Voidra");
const executableInspection = execFileSync("file", [executable], { encoding: "utf8" }).trim();
const executableDescription = executableInspection.slice(executableInspection.indexOf(":") + 1).trim();
if (!/arm64/.test(executableDescription)) throw new Error(`Packaged executable is not arm64: ${executableDescription}`);
const generatedAt = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : new Date().toISOString();

const manifest = {
  schemaVersion: 1,
  generatedAt,
  application: { name: packageJson.build.productName, version: packageJson.version, appId: packageJson.build.appId },
  platform: { os: "macOS", architecture: "arm64", distribution: "unsigned personal development build" },
  schemas: { database: 3, workspace: 1, backup: 1 },
  inputs: { node: process.version, pnpm: packageJson.packageManager, lockSha256 },
  artifact: {
    path: "release/mac-arm64/Voidra.app",
    treeSha256: treeHash.digest("hex"),
    fileCount: entries.filter(({ kind }) => kind === "file").length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    executableDescription,
  },
  verification: {
    signed: false,
    notarized: false,
    testOnlyRendererDiagnosticsIncluded: false,
    remoteTransport: "disabled unless TLS certificate and key are explicitly configured",
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Release manifest written to ${outputPath}\n${manifest.artifact.treeSha256}  Voidra.app\n`);
