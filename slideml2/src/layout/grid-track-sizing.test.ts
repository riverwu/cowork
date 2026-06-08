import { describe, expect, it } from "vitest";
import { normalizeTrackWeights, resolveGridColumnTracks, resolveGridRowTracks } from "./grid-track-sizing.js";

describe("grid track sizing", () => {
  it("resolves weighted column tracks", () => {
    expect(resolveGridColumnTracks({ count: 3, available: 12, weights: [2, 1, 1] }))
      .toEqual([6, 3, 3]);
  });

  it("preserves absolute column sizes when they fit the available width", () => {
    expect(resolveGridColumnTracks({ count: 2, available: 10, explicitSizes: [4, 5] }))
      .toEqual([4, 5]);
  });

  it("treats small explicit column values as proportions", () => {
    const tracks = resolveGridColumnTracks({ count: 2, available: 11.2, explicitSizes: [0.12, 1] });

    expect(tracks[0]).toBeCloseTo(1.2);
    expect(tracks[1]).toBeCloseTo(10);
  });

  it("distributes row-span pressure across every covered row", () => {
    const tracks = resolveGridRowTracks({
      count: 2,
      available: 6,
      contributions: [
        { start: 0, span: 2, basis: 5, min: 4 },
        { start: 1, basis: 1, min: 1 },
      ],
    });

    expect(tracks[0]).toBeGreaterThanOrEqual(2);
    expect(tracks[1]).toBeGreaterThanOrEqual(2);
    expect(tracks[0] + tracks[1]).toBeCloseTo(6);
  });

  it("uses explicit row weights to distribute free space", () => {
    const tracks = resolveGridRowTracks({
      count: 2,
      available: 8,
      weights: [3, 1],
      contributions: [
        { start: 0, basis: 1, min: 0.5 },
        { start: 1, basis: 1, min: 0.5 },
      ],
    });

    expect(tracks[0]).toBeCloseTo(5.5);
    expect(tracks[1]).toBeCloseTo(2.5);
  });

  it("normalizes invalid track weights back to equal tracks", () => {
    expect(normalizeTrackWeights([0, -1, Number.NaN], 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });
});
