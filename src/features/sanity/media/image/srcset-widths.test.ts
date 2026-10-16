import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { srcSetWidths } from "./srcset-widths";

const STEPS = [600, 1024, 1440, 2048];

describe("srcSetWidths", () => {
  it("ends on the original when it falls between two steps", () => {
    assert.deepEqual(srcSetWidths(STEPS, 1568), [600, 1024, 1440, 1568]);
  });

  it("caps a wide original at the widest step, once", () => {
    assert.deepEqual(srcSetWidths(STEPS, 4000), STEPS);
  });

  it("does not repeat an original that lands on a step", () => {
    assert.deepEqual(srcSetWidths(STEPS, 1440), [600, 1024, 1440]);
  });

  it("keeps every step when the original width is unknown", () => {
    assert.deepEqual(srcSetWidths(STEPS, undefined), STEPS);
  });
});
