import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { ARTIFACT_DESIGN_TOKENS, ARTIFACT_FACADE_CSS, ARTIFACT_PRIMITIVES, HOST_DESIGN_TOKENS, REQUIRED_ARTIFACT_STATES, designTokenSchema, inspectDesignTokenUsage } from "../../src/shared/design-system";

describe("versioned V2 design system", () => {
  test("keeps host and artifact facades compatible and bounded", () => {
    expect(designTokenSchema.parse(HOST_DESIGN_TOKENS).version).toBe("2.0.0");
    expect(ARTIFACT_DESIGN_TOKENS.version).toBe("1");
    expect(ARTIFACT_DESIGN_TOKENS.colors.accent).toBe(HOST_DESIGN_TOKENS.colors.accent);
    expect(ARTIFACT_PRIMITIVES).toEqual(expect.arrayContaining(["PermissionPrompt", "ReviewAction", "EmptyState"]));
    expect(REQUIRED_ARTIFACT_STATES).toEqual(["empty", "error", "stale", "permission", "review"]);
    expect(inspectDesignTokenUsage(ARTIFACT_FACADE_CSS, "artifact")).toEqual([]);
  });

  test("rejects malformed tokens and reports legacy or host-only artifact usage", () => {
    expect(() => designTokenSchema.parse({ ...HOST_DESIGN_TOKENS, version: "unversioned" })).toThrow();
    expect(inspectDesignTokenUsage(":root{--v:#7ff0cf}.x{color:var(--v2-private)}", "artifact")).toEqual(expect.arrayContaining(["Artifact facade references a host-only token", "Legacy token #7ff0cf", "Undefined token --v2-private"]));
  });

  test("contains no reachable V1 shell selectors or deprecated color tokens", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/\.(?:sidebar|topbar|workspace-switcher|runtime-card|hero-card|orb)\b/);
    expect(inspectDesignTokenUsage(css, "host").filter((finding) => finding.startsWith("Legacy"))).toEqual([]);
  });
});
