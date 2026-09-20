# P04 — Skills, routines, and manual subscription handoffs

Implementation status: complete as of 2026-09-20. Architecture decisions are recorded in [ADR 0005](../docs/architecture/0005-manual-handoff-boundary.md), with automated and measured evidence in [the P04 report](../docs/verification/p04.md).

[Plan index](main.md) · Previous: [P03](phase-03-shared-knowledge-graph-memory.md) · Next: [P05](phase-05-openrouter-agent-runtime.md)

## Outcome and prerequisites

A user can configure a reusable skill/routine, select Claude or Codex and a preferred model, and copy a complete scoped prompt without an API key. This is the first assistant workflow usable independently of automatic inference.

Prerequisites: P01 settings/rules, P02 storage, P03 scoped context/memory. Scheduling comes in P07; this phase defines its manual-job behavior. Model names are user-maintained preferences or "use current client model," not a guaranteed subscription catalog.

## Domain design

- Skill: stable ID/version, description, instructions, input definitions, expected outputs, supporting resource references, and optional default execution preference. Use editable Markdown instructions with versioned metadata; keep client export adapters separate.
- Routine: skill reference/version policy, workspace, input bindings, output destinations, execution mode/client/model, schedule reference, and permission preferences. A routine may use inline instructions when no reusable skill is needed.
- Run: originating routine/version, resolved settings/rules, selected context revisions, generated prompt, destination, timestamps, status, and imported result references.
- Manual states: Draft → Ready to Copy → Awaiting Result → Result Under Review → Completed/Cancelled. Copy success is recorded separately from external execution or completion.
- Effective execution defaults inherit global then workspace values; explicit skill/routine choice wins for that run. Switching workspace after creation does not change its prompt owner.

## Prompt assembly contract

Compose locally from task objective, required inputs, persona, root-to-target rules with scope labels, chosen skill, selected source excerpts, constraints, output locations/format, and completion criteria. Prefer exact keyword/tag/graph selection; do not silently call embeddings or a model to improve a prompt.

Distinguish instructions from quoted source material. Show the exact editable prompt and included-source manifest. Exclude credentials and unrelated workspace data. Let users reduce context or export attachments when the result is too large; never silently omit applicable rules.

For clients with file access, identify the selected directory and instruct the client to read applicable rules. For ordinary chat clients, embed relevant rule/context text or list required attachments. Local paths do not imply that a remote client can read them. Preferred model selection must be applied by the user in the destination client.

## Stories and tasks

| Story | Points | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| P04-01: Define and customize skills/routines | 5 | P01–P03 | Form creates/duplicates/edits versioned instructions and inputs; operation needs no model key |
| P04-02: Compile a scoped manual prompt | 5 | P04-01 | Same inputs compile deterministically; correct persona/rules/context appear; wrong-workspace data and secrets do not |
| P04-03: Select subscription client/model and copy | 3 | P04-02 | Claude/Codex preference persists per routine; Copy writes the reviewed text; run remains Awaiting Result |
| P04-04: Review returned results | 5 | P04-03 | Paste/attach/mark-external-complete options exist; local file changes are previewed before applying; outputs retain run/source links |
| P04-05: Define manual schedule handoff contract | 3 | P04-02/03 | Schedule-trigger fixture prepares a draft/notification without API calls, submission, clipboard overwrite, or false completion |

UI includes a skill library/editor, routine editor, execution selector, input/context selector, prompt preview, Copy Prompt, and result review. No automation of external client login, model clicking, pasting, or submission belongs to this feature.

## Unit and integration tests

- Settings precedence and saved routine version produce a stable run snapshot; later edits affect new runs only.
- Prompt fixtures cover root/nested/sibling instructions, duplicate filenames, shared read-only context, non-English content, oversized context, and revoked attachments.
- Compile without network/model adapters installed; fail the test if any inference/embedding transport is invoked.
- State transition tests reject Copy→Completed and background-trigger→ClipboardWrite; explicit user result status remains distinguishable from independently verified effects.
- Result imports validate paths, file conflicts, workspace ownership, and output types. A pasted instruction cannot silently execute a tool.

## Playwright E2E

1. With no API keys configured and external model endpoints blocked, create a routine, choose Claude, preview/copy its prompt, and verify exact clipboard text.
2. Duplicate it for Codex with a different preferred model; restart and verify both preferences and unchanged workspace ownership.
3. Compile a nested-scope task and inspect inclusion of root/child rules plus absence of sibling/private content.
4. Trigger scheduled-manual preparation through the test clock; clipboard sentinel remains unchanged and status awaits the user.
5. Import a returned note, review changes, apply, and navigate from run to saved output; reject a path outside granted outputs.

Use an isolated clipboard adapter for parallel tests; a serial macOS smoke can validate the real clipboard and restore it afterward. This distinction must appear in test evidence.

## Failure and recovery

Clipboard errors leave the editable prompt available. Large prompts require explicit context selection/export. Missing source files show unavailable inputs rather than invented context. Prompt drafts and handoff state survive restart. Do not switch to OpenRouter when a manual client is unavailable.

## Exit criteria

Both manual destinations work without API credentials/calls; every copied prompt is scoped and reviewable; status accurately reflects manual execution; instruction-file references are compatible with the target client's actual access.
