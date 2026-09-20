import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  sourcemap: true,
  external: ["electron", "better-sqlite3"],
  logLevel: "info",
};

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/electron/main.ts"],
    outfile: "dist/electron/main.cjs",
  }),
  build({
    ...common,
    entryPoints: ["src/electron/preload.ts"],
    outfile: "dist/electron/preload.cjs",
  }),
  build({
    ...common,
    entryPoints: ["src/service/process.ts"],
    outfile: "dist/service/process.cjs",
  }),
]);
