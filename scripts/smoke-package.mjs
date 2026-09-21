import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const appBinary = join(root, "release", "mac-arm64", "Voidra.app", "Contents", "MacOS", "Voidra");
const temporary = await mkdtemp(join(tmpdir(), "voidra-smoke-"));
const marker = join(temporary, "smoke.json");
const artifactBuilderRoot = join(root, "release", "mac-arm64", "Voidra.app", "Contents", "Resources", "artifact-builder");

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
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      reject(new Error("Packaged application did not report ready within 30 seconds."));
    }, 30_000);
    timeout.unref();
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  if (exitCode !== 0) {
    throw new Error(`Packaged application exited with code ${exitCode}`);
  }

  const result = JSON.parse(await readFile(marker, "utf8"));
  if (result.status !== "ready" || result.packaged !== true || result.diagnosticsExposed !== false) {
    throw new Error(`Unexpected smoke marker: ${JSON.stringify(result)}`);
  }

  const requireFromPackage = createRequire(join(artifactBuilderRoot, "runtime.cjs"));
  const { build } = requireFromPackage("esbuild");
  const artifactEntry = join(temporary, "artifact.tsx");
  const artifactBundle = join(temporary, "artifact.js");
  await writeFile(artifactEntry, 'import React from "react";import{createRoot}from"react-dom/client";createRoot(document.body).render(React.createElement("strong",null,"Voidra artifact"));\n');
  await build({
    entryPoints: [artifactEntry],
    bundle: true,
    outfile: artifactBundle,
    platform: "browser",
    nodePaths: [join(artifactBuilderRoot, "node_modules")],
    logLevel: "silent",
  });
  const bundle = await readFile(artifactBundle, "utf8");
  if (bundle.length < 1_000 || !bundle.includes("Voidra artifact")) throw new Error("Packaged artifact compiler produced an invalid bundle.");

  const builderEntry = join(root, "release", "mac-arm64", "Voidra.app", "Contents", "Resources", "app.asar", "dist", "service", "artifact-builder.cjs");
  const builderWorkspace = join(temporary, "component-builder");
  await mkdir(join(builderWorkspace, "src"), { recursive: true });
  await writeFile(join(builderWorkspace, "src", "Artifact.tsx"), '"use client";import{Canvas,Module}from"@voidra/artifact-ui";export default function Artifact(){return <Canvas><Module title="Packaged worker">Safe component</Module></Canvas>}\n');
  const builder = spawn(appBinary, ["--max-old-space-size=256", builderEntry], {
    env: { ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", NO_COLOR: "1", TERM: "dumb", TMPDIR: tmpdir(), NODE_PATH: join(artifactBuilderRoot, "node_modules") },
    stdio: ["pipe", "pipe", "pipe"],
  });
  builder.stdin.end(JSON.stringify({ root: builderWorkspace, name: "Packaged worker smoke" }));
  const builderOutput = await new Promise((resolve, reject) => {
    let output = ""; let diagnostic = "";
    const timeout = setTimeout(() => { builder.kill("SIGKILL"); reject(new Error("Packaged artifact builder worker timed out.")); }, 20_000);
    builder.stdout.on("data", (chunk) => { output += String(chunk); }); builder.stderr.on("data", (chunk) => { diagnostic += String(chunk); });
    builder.once("error", reject); builder.once("close", (code) => { clearTimeout(timeout); code === 0 ? resolve(output) : reject(new Error(diagnostic || `Packaged artifact builder exited with ${code}`)); });
  });
  const builderReceipt = JSON.parse(builderOutput);
  if (!/^[a-f0-9]{64}$/.test(builderReceipt.bundleDigest) || JSON.stringify(builderReceipt.files) !== JSON.stringify(["dist/artifact.js", "dist/artifact.css", "dist/index.html"])) throw new Error("Packaged artifact builder returned invalid evidence.");
  const workerHtml = await readFile(join(builderWorkspace, "dist", "index.html"), "utf8");
  if (!workerHtml.includes("connect-src 'none'") || !workerHtml.includes("Packaged worker smoke")) throw new Error("Packaged artifact builder did not emit the constrained runtime shell.");

  const reviewerEntry = join(root, "release", "mac-arm64", "Voidra.app", "Contents", "Resources", "app.asar", "dist", "service", "artifact-reviewer.cjs");
  const reviewer = spawn(appBinary, [reviewerEntry], { env: { ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", NO_COLOR: "1", TERM: "dumb" }, stdio: ["pipe", "pipe", "pipe"] });
  const reviewPayload = { manifest: { schemaVersion: 1, id: "018f0f73-89db-7a63-a1b2-5d46f598ed01", name: "Smoke artifact", version: "1.0.0", entry: "src/Artifact.tsx", artifactUiVersion: "1", layout: { minWidth: 320, idealWidth: 720, minHeight: 320 }, requestedCapabilities: [] }, files: { "src/Artifact.tsx": 'export default function Artifact(){return <div>Safe</div>}' }, sourceDigest: "a".repeat(64), bundleDigest: "b".repeat(64) };
  reviewer.stdin.end(JSON.stringify(reviewPayload));
  const reviewOutput = await new Promise((resolve, reject) => {
    let output = ""; let diagnostic = "";
    const timeout = setTimeout(() => { reviewer.kill("SIGKILL"); reject(new Error("Packaged independent reviewer timed out.")); }, 10_000);
    reviewer.stdout.on("data", (chunk) => { output += String(chunk); }); reviewer.stderr.on("data", (chunk) => { diagnostic += String(chunk); });
    reviewer.once("error", reject); reviewer.once("close", (code) => { clearTimeout(timeout); code === 0 ? resolve(output) : reject(new Error(diagnostic || `Packaged reviewer exited with ${code}`)); });
  });
  const review = JSON.parse(reviewOutput);
  if (review.reviewer !== "voidra-isolated-security-agent/v1" || review.verdict !== "pass" || review.sourceDigest !== reviewPayload.sourceDigest) throw new Error("Packaged independent reviewer returned invalid evidence.");
  process.stdout.write(`Packaged startup, disposable artifact builder, compiler, and isolated reviewer smoke passed (${result.arch}).\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
