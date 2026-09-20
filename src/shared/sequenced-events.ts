import type { ServiceEvent } from "./contracts";

export type SequenceDecision =
  | { kind: "accepted"; event: ServiceEvent }
  | { kind: "duplicate"; event: ServiceEvent }
  | { kind: "gap"; event: ServiceEvent; expected: number };

export class SequencedEventCursor {
  #lastSequence = 0;

  get lastSequence() {
    return this.#lastSequence;
  }

  accept(event: ServiceEvent): SequenceDecision {
    if (event.sequence <= this.#lastSequence) return { kind: "duplicate", event };
    if (event.sequence > this.#lastSequence + 1) {
      const expected = this.#lastSequence + 1;
      this.#lastSequence = event.sequence;
      return { kind: "gap", event, expected };
    }
    this.#lastSequence = event.sequence;
    return { kind: "accepted", event };
  }

  reset() {
    this.#lastSequence = 0;
  }
}
