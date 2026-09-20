import { describe, expect, it } from "vitest";
import { allowsLoopbackRemoteFixture, isTestRuntime } from "../../src/domain/runtime-mode";

describe("release runtime mode", () => {
  it("does not enable test routes from legacy flags in a production process", () => {
    const production = { NODE_ENV: "production", VOIDRA_RUNTIME_MODE: "production", VOIDRA_E2E: "1", VOIDRA_REMOTE_GATEWAY_TEST: "1" } as NodeJS.ProcessEnv;
    expect(isTestRuntime(production)).toBe(false);
    expect(allowsLoopbackRemoteFixture(production)).toBe(false);
  });

  it("allows the loopback companion only in an explicit test runtime", () => {
    expect(allowsLoopbackRemoteFixture({ NODE_ENV: "test", VOIDRA_RUNTIME_MODE: "test", VOIDRA_REMOTE_GATEWAY_TEST: "1" })).toBe(true);
    expect(allowsLoopbackRemoteFixture({ NODE_ENV: "test", VOIDRA_RUNTIME_MODE: "test" })).toBe(false);
  });
});
