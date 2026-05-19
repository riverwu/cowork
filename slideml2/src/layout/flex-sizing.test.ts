import { describe, expect, it } from "vitest";
import { resolveFlexMainTargets, type FlexMainSpec } from "./flex-sizing.js";

const spec = (overrides: Partial<FlexMainSpec>): FlexMainSpec => ({
  basis: 1,
  min: 0,
  max: Number.POSITIVE_INFINITY,
  weight: 1,
  grow: false,
  fixed: false,
  ...overrides,
});

describe("resolveFlexMainTargets", () => {
  it("starts from flex-basis clamped by semantic min/max", () => {
    expect(resolveFlexMainTargets([
      spec({ basis: 0.4, min: 1.2 }),
      spec({ basis: 4, max: 2.5 }),
    ], 20)).toEqual([1.2, 2.5]);
  });

  it("distributes positive free space by grow weights after fixed items freeze", () => {
    const targets = resolveFlexMainTargets([
      spec({ basis: 2, min: 2, max: 2, fixed: true }),
      spec({ basis: 1, grow: true, weight: 2 }),
      spec({ basis: 1, grow: true, weight: 1 }),
    ], 10);

    expect(targets[0]).toBeCloseTo(2);
    expect(targets[1]).toBeCloseTo(5);
    expect(targets[2]).toBeCloseTo(3);
  });

  it("shrinks overflowing flexible items against semantic minimum capacity", () => {
    const targets = resolveFlexMainTargets([
      spec({ basis: 5, min: 3 }),
      spec({ basis: 3, min: 1 }),
    ], 6);

    expect(targets[0]).toBeCloseTo(4);
    expect(targets[1]).toBeCloseTo(2);
  });

  it("freezes children at max while growing remaining siblings", () => {
    const targets = resolveFlexMainTargets([
      spec({ basis: 2, grow: true, max: 3, weight: 1 }),
      spec({ basis: 2, grow: true, weight: 1 }),
    ], 8);

    expect(targets[0]).toBeCloseTo(3);
    expect(targets[1]).toBeCloseTo(5);
  });

  it("can auto-fill slack with non-fixed children when requested", () => {
    const targets = resolveFlexMainTargets([
      spec({ basis: 2 }),
      spec({ basis: 2 }),
    ], 6, { autoFillSlack: true });

    expect(targets).toEqual([3, 3]);
  });

  it("reports unresolved overflow and scales non-fixed children as a last resort", () => {
    const overflows: Array<{ overflow: number; available: number }> = [];
    const targets = resolveFlexMainTargets([
      spec({ basis: 3, min: 3, fixed: true }),
      spec({ basis: 3, min: 3 }),
    ], 4, {
      onOverflow: (overflow, available) => overflows.push({ overflow, available }),
    });

    expect(overflows).toHaveLength(1);
    expect(overflows[0]!.available).toBeCloseTo(4);
    expect(targets[0]).toBeCloseTo(3);
    expect(targets[1]).toBeCloseTo(1);
  });
});
