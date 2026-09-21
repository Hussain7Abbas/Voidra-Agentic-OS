import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { build, type PluginBuild } from "esbuild";
import { ARTIFACT_FACADE_CSS, ARTIFACT_SDK_MODULE_SOURCE, ARTIFACT_UI_MODULE_SOURCE } from "../shared/design-system";

type BuildRequest = { root: string; name: string };

function within(parent: string, child: string) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += String(chunk);
    if (Buffer.byteLength(raw) > 64_000) throw new Error("Artifact builder request exceeded 64 KB.");
  }
  const input = JSON.parse(raw) as BuildRequest;
  if (!input || typeof input.root !== "string" || typeof input.name !== "string" || !isAbsolute(input.root) || input.name.length > 120) throw new Error("Invalid artifact builder request.");
  const root = await realpath(input.root);
  const temporaryRoot = await realpath(tmpdir());
  if (!within(temporaryRoot, root)) throw new Error("Artifact builder only accepts disposable temporary roots.");

  const artifactUiPlugin = {
    name: "voidra-artifact-facades",
    setup(buildContext: PluginBuild) {
      buildContext.onResolve({ filter: /^@voidra\/artifact-(?:ui|sdk)$/ }, (args) => ({ path: args.path, namespace: "voidra-artifact" }));
      buildContext.onLoad({ filter: /.*/, namespace: "voidra-artifact" }, (args) => ({ contents: args.path.endsWith("-ui") ? ARTIFACT_UI_MODULE_SOURCE : ARTIFACT_SDK_MODULE_SOURCE, loader: "jsx", resolveDir: root }));
    },
  };

  const dist = join(root, "dist");
  await build({
    stdin: { contents: `import React from "react";import{createRoot}from"react-dom/client";import Artifact from "./src/Artifact.tsx";const root=document.getElementById("artifact-root");if(!root)throw new Error("Artifact root missing");createRoot(root).render(React.createElement(Artifact));`, resolveDir: root, sourcefile: "voidra-artifact-entry.tsx", loader: "tsx" },
    absWorkingDir: root,
    bundle: true,
    outfile: join(dist, "artifact.js"),
    platform: "browser",
    format: "iife",
    target: ["chrome128"],
    jsx: "automatic",
    nodePaths: process.env.NODE_PATH ? process.env.NODE_PATH.split(":").filter(Boolean) : [],
    plugins: [artifactUiPlugin],
    logLevel: "silent",
  });
  await writeFile(join(dist, "artifact.css"), ARTIFACT_FACADE_CSS);
  await writeFile(join(dist, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="artifact.css"><title>${escapeHtml(input.name)}</title></head><body><div id="artifact-root"></div><script src="artifact.js"></script></body></html>\n`);
  const bundle = await readFile(join(dist, "artifact.js"));
  process.stdout.write(`${JSON.stringify({ bundleDigest: createHash("sha256").update(bundle).digest("hex"), files: ["dist/artifact.js", "dist/artifact.css", "dist/index.html"] })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Artifact build failed."}\n`);
  process.exitCode = 1;
});
