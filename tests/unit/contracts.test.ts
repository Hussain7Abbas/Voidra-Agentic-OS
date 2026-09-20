import { describe, expect, it } from "vitest";
import { serviceRequestSchema, WORKSPACE_ID_EXAMPLE } from "../../src/shared/contracts";

const validRequest = {
  requestId: "7d957abe-b57c-47fd-83c1-6bb69aaf2706",
  workspaceId: WORKSPACE_ID_EXAMPLE,
  sessionId: "57359854-b7cd-4d3d-8f84-ac579257c579",
  operation: "system.ping",
  payload: {},
};

describe("service request contract", () => {
  it("accepts a valid workspace-bound request", () => {
    expect(serviceRequestSchema.parse(validRequest)).toEqual(validRequest);
  });

  it.each([
    ["unknown operation", { ...validRequest, operation: "shell.execute" }],
    ["invalid workspace", { ...validRequest, workspaceId: "personal" }],
    ["unknown field", { ...validRequest, token: "must-not-cross" }],
    ["relative directory", { ...validRequest, operation: "workspace.validateDirectory", payload: { path: "relative/path" } }],
  ])("rejects %s", (_label, request) => {
    expect(serviceRequestSchema.safeParse(request).success).toBe(false);
  });
});
