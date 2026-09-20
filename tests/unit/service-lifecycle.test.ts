import { describe, expect, it } from "vitest";
import { ServiceLifecycle } from "../../src/shared/service-lifecycle";

describe("ServiceLifecycle", () => {
  it("tracks generations across crash recovery", () => {
    const lifecycle = new ServiceLifecycle();
    expect(lifecycle.transition("starting")).toMatchObject({ state: "starting", generation: 1 });
    lifecycle.transition("ready");
    lifecycle.transition("crashed", "fixture crash");
    expect(lifecycle.transition("starting")).toMatchObject({ state: "starting", generation: 2 });
  });

  it("rejects impossible and duplicate transitions", () => {
    const lifecycle = new ServiceLifecycle();
    expect(() => lifecycle.transition("ready")).toThrow(/stopped -> ready/);
    lifecycle.transition("starting");
    expect(() => lifecycle.transition("starting")).toThrow(/starting -> starting/);
  });
});
