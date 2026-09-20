import { describe, expect, it } from "vitest";
import { SequencedEventCursor } from "../../src/shared/sequenced-events";
import { WORKSPACE_ID_EXAMPLE, type ServiceEvent } from "../../src/shared/contracts";

const event = (sequence: number): ServiceEvent => ({
  sequence,
  type: "request.completed",
  workspaceId: WORKSPACE_ID_EXAMPLE,
  payload: {},
});

describe("SequencedEventCursor", () => {
  it("accepts ordered events, ignores duplicates, and identifies gaps", () => {
    const cursor = new SequencedEventCursor();
    expect(cursor.accept(event(1)).kind).toBe("accepted");
    expect(cursor.accept(event(1)).kind).toBe("duplicate");
    expect(cursor.accept(event(3))).toMatchObject({ kind: "gap", expected: 2 });
    expect(cursor.lastSequence).toBe(3);
    cursor.reset();
    expect(cursor.lastSequence).toBe(0);
  });
});
