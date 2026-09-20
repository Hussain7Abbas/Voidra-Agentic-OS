import { z } from "zod";

export const effectiveSettingsSchema = z.object({
  execution: z.object({
    mode: z.enum(["automatic", "manual-claude", "manual-codex"]),
    preferredModel: z.string().max(200),
    enabledTools: z.array(z.string().max(120)).max(200),
  }).strict(),
  voice: z.object({
    enabled: z.boolean(),
    voiceId: z.string().max(200).nullable(),
  }).strict(),
  appearance: z.object({
    theme: z.enum(["system", "dark", "light"]),
    reduceMotion: z.boolean(),
  }).strict(),
  assistant: z.object({
    persona: z.string().max(100_000),
  }).strict(),
}).strict();

export type EffectiveSettings = z.infer<typeof effectiveSettingsSchema>;

export const settingsOverrideSchema = z.object({
  execution: z.object({
    mode: effectiveSettingsSchema.shape.execution.shape.mode.optional(),
    preferredModel: effectiveSettingsSchema.shape.execution.shape.preferredModel.optional(),
    enabledTools: effectiveSettingsSchema.shape.execution.shape.enabledTools.optional(),
  }).strict().optional(),
  voice: z.object({
    enabled: z.boolean().optional(),
    voiceId: z.string().max(200).nullable().optional(),
  }).strict().optional(),
  appearance: z.object({
    theme: effectiveSettingsSchema.shape.appearance.shape.theme.optional(),
    reduceMotion: z.boolean().optional(),
  }).strict().optional(),
  assistant: z.object({
    persona: z.string().max(100_000).optional(),
  }).strict().optional(),
}).strict();

export type SettingsOverride = z.infer<typeof settingsOverrideSchema>;
export type SettingsOrigin = "application" | "global" | "workspace";

export const APPLICATION_DEFAULTS: EffectiveSettings = {
  execution: {
    mode: "automatic",
    preferredModel: "openrouter/auto",
    enabledTools: [],
  },
  voice: {
    enabled: false,
    voiceId: null,
  },
  appearance: {
    theme: "system",
    reduceMotion: false,
  },
  assistant: {
    persona: "You are a thoughtful, capable personal assistant.",
  },
};

export type SettingsOriginMap = {
  execution: Record<keyof EffectiveSettings["execution"], SettingsOrigin>;
  voice: Record<keyof EffectiveSettings["voice"], SettingsOrigin>;
  appearance: Record<keyof EffectiveSettings["appearance"], SettingsOrigin>;
  assistant: Record<keyof EffectiveSettings["assistant"], SettingsOrigin>;
};

function resolveLeaf<T>(application: T, global: T | undefined, workspace: T | undefined) {
  if (workspace !== undefined) return { value: workspace, origin: "workspace" as const };
  if (global !== undefined) return { value: global, origin: "global" as const };
  return { value: application, origin: "application" as const };
}

export function resolveSettings(globalInput: unknown, workspaceInput: unknown) {
  const global = settingsOverrideSchema.parse(globalInput);
  const workspace = settingsOverrideSchema.parse(workspaceInput);
  const executionMode = resolveLeaf(APPLICATION_DEFAULTS.execution.mode, global.execution?.mode, workspace.execution?.mode);
  const preferredModel = resolveLeaf(APPLICATION_DEFAULTS.execution.preferredModel, global.execution?.preferredModel, workspace.execution?.preferredModel);
  const enabledTools = resolveLeaf(APPLICATION_DEFAULTS.execution.enabledTools, global.execution?.enabledTools, workspace.execution?.enabledTools);
  const voiceEnabled = resolveLeaf(APPLICATION_DEFAULTS.voice.enabled, global.voice?.enabled, workspace.voice?.enabled);
  const voiceId = resolveLeaf(APPLICATION_DEFAULTS.voice.voiceId, global.voice?.voiceId, workspace.voice?.voiceId);
  const theme = resolveLeaf(APPLICATION_DEFAULTS.appearance.theme, global.appearance?.theme, workspace.appearance?.theme);
  const reduceMotion = resolveLeaf(APPLICATION_DEFAULTS.appearance.reduceMotion, global.appearance?.reduceMotion, workspace.appearance?.reduceMotion);
  const persona = resolveLeaf(APPLICATION_DEFAULTS.assistant.persona, global.assistant?.persona, workspace.assistant?.persona);

  const effective: EffectiveSettings = {
    execution: { mode: executionMode.value, preferredModel: preferredModel.value, enabledTools: [...enabledTools.value] },
    voice: { enabled: voiceEnabled.value, voiceId: voiceId.value },
    appearance: { theme: theme.value, reduceMotion: reduceMotion.value },
    assistant: { persona: persona.value },
  };
  const origins: SettingsOriginMap = {
    execution: { mode: executionMode.origin, preferredModel: preferredModel.origin, enabledTools: enabledTools.origin },
    voice: { enabled: voiceEnabled.origin, voiceId: voiceId.origin },
    appearance: { theme: theme.origin, reduceMotion: reduceMotion.origin },
    assistant: { persona: persona.origin },
  };
  return { effective, origins, global, workspace };
}

export const workspaceSettingsFileSchema = z.object({
  schemaVersion: z.literal(1),
  overrides: settingsOverrideSchema,
}).strict();

export type WorkspaceSettingsFile = z.infer<typeof workspaceSettingsFileSchema>;
