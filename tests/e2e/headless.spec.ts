import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";

let temporaryRoot: string;
let application: ElectronApplication | undefined;

async function createWorkspace(window: Page, name: string) {
  await window.getByLabel("Workspace name").fill(name);
  await window.getByRole("button", { name: "Choose workspace folder" }).click();
  await window.getByRole("button", { name: "Create workspace" }).click();
  await expect(window.getByTestId("workspace-dialog")).toBeHidden();
}

test.beforeEach(async () => { temporaryRoot = await mkdtemp(join(tmpdir(), "voidra-headless-e2e-")); });
test.afterEach(async () => { if (application) await application.close().catch(() => undefined); application = undefined; await rm(temporaryRoot, { recursive: true, force: true }); });

test("runs Codex in a staged snapshot and applies only the reviewed writeback", async () => {
  const profile = join(temporaryRoot, "profile"); const workspace = join(temporaryRoot, "Work"); const bin = join(temporaryRoot, "bin");
  await Promise.all([mkdir(workspace), mkdir(bin)]);
  await writeFile(join(workspace, "note.md"), "canonical original\n");
  const executable = join(bin, "codex");
  await writeFile(executable, `#!/usr/bin/env node
const fs=require("node:fs");
if(process.argv.includes("--version")){console.log("codex fixture 1.0");process.exit(0)}
process.stdin.resume();
process.stdin.on("end",()=>{fs.writeFileSync("note.md","reviewed staged update\\n");fs.writeFileSync("report.md","generated report\\n");console.log(JSON.stringify({type:"result",usage:{output_tokens:4}}))});
`);
  await chmod(executable, 0o755);
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, VOIDRA_E2E: "1", VOIDRA_USER_DATA_DIR: profile, VOIDRA_TEST_FOLDER_RESULTS: JSON.stringify([workspace]) } });
  const window = await application.firstWindow(); await createWorkspace(window, "Work");
  await window.getByRole("link", { name: "Jobs", exact: true }).click();
  const panel = window.getByRole("region", { name: "Headless Claude and Codex" }); await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Codex" }).click();
  await expect(panel.getByLabel("Headless executable path")).toHaveValue(await realpath(executable));
  await panel.getByLabel("Headless filesystem profile").selectOption("staged-write");
  await panel.getByLabel("Headless prompt").fill("Update the staged note and produce a report.");
  await panel.getByRole("button", { name: "Review acknowledged — run headlessly" }).click();
  await expect(panel.getByText("pending-review", { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await readFile(join(workspace, "note.md"), "utf8")).toBe("canonical original\n");
  await expect(readFile(join(workspace, "report.md"), "utf8")).rejects.toThrow();
  await expect(panel.getByText("modifiednote.md", { exact: false })).toBeVisible();
  await expect(panel.getByText("addedreport.md", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Apply 2 reviewed change(s)" }).click();
  await expect.poll(() => readFile(join(workspace, "note.md"), "utf8")).toBe("reviewed staged update\n");
  expect(await readFile(join(workspace, "report.md"), "utf8")).toBe("generated report\n");
});
