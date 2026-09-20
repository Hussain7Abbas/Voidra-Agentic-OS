import { describe, expect, it } from "vitest";
import { resolveSettings, settingsOverrideSchema, workspaceSettingsFileSchema } from "../../src/domain/settings";

describe("settings inheritance", () => {
  it("resolves application, global, and workspace values per field", () => {
    const resolved = resolveSettings(
      {
        execution: { preferredModel: "global/model", enabledTools: ["calendar"] },
        voice: { enabled: true, voiceId: "global-voice" },
        assistant: { persona: "Global persona" },
      },
      {
        execution: { preferredModel: "", enabledTools: [] },
        voice: { enabled: false, voiceId: null },
      },
    );

    expect(resolved.effective.execution.preferredModel).toBe("");
    expect(resolved.effective.execution.enabledTools).toEqual([]);
    expect(resolved.effective.voice).toEqual({ enabled: false, voiceId: null });
    expect(resolved.effective.assistant.persona).toBe("Global persona");
    expect(resolved.origins.execution.preferredModel).toBe("workspace");
    expect(resolved.origins.assistant.persona).toBe("global");
    expect(resolved.origins.appearance.theme).toBe("application");
  });

  it("restores global inheritance when workspace fields are absent", () => {
    const before = resolveSettings({ appearance: { reduceMotion: true } }, { appearance: { reduceMotion: false } });
    const reset = resolveSettings({ appearance: { reduceMotion: true } }, {});
    expect(before.effective.appearance.reduceMotion).toBe(false);
    expect(reset.effective.appearance.reduceMotion).toBe(true);
    expect(reset.origins.appearance.reduceMotion).toBe("global");
  });

  it.each([
    ["unknown settings key", { secret: "no" }],
    ["unknown nested key", { voice: { enabled: true, token: "no" } }],
    ["wrong schema version", { schemaVersion: 2, overrides: {} }],
  ])("rejects %s", (_label, input) => {
    const schema = "schemaVersion" in input ? workspaceSettingsFileSchema : settingsOverrideSchema;
    expect(schema.safeParse(input).success).toBe(false);
  });
});
