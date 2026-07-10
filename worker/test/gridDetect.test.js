import { describe, it, expect } from "vitest";
import {
  DEFAULT_GRID_DETECT,
  normalizeGridDetect,
  isGridActive,
  publicGridDetect,
} from "../src/gridDetect.js";

describe("normalizeGridDetect", () => {
  it("returns defaults when unset", () => {
    expect(normalizeGridDetect()).toEqual(DEFAULT_GRID_DETECT);
    expect(normalizeGridDetect({})).toEqual(DEFAULT_GRID_DETECT);
  });

  it("clamps invalid and out-of-range values", () => {
    expect(normalizeGridDetect({ voltageMin: -5, powerMin: "bad" })).toEqual({
      voltageMin: 0,
      powerMin: 5,
    });
    expect(normalizeGridDetect({ voltageMin: 999, powerMin: 100_000 })).toEqual({
      voltageMin: 500,
      powerMin: 50_000,
    });
  });
});

describe("isGridActive", () => {
  it("uses default thresholds when gridDetect is unset", () => {
    expect(isGridActive(35, 10)).toBe(true);
    expect(isGridActive(30, 10)).toBe(false);
    expect(isGridActive(35, 5)).toBe(false);
  });

  it("honors custom voltage and power thresholds", () => {
    const custom = { voltageMin: 20, powerMin: 2 };
    expect(isGridActive(25, 3, custom)).toBe(true);
    expect(isGridActive(25, 1, custom)).toBe(false);
    expect(isGridActive(18, 10, custom)).toBe(false);
  });

  it("supports absolute power for bidirectional grid flow", () => {
    expect(isGridActive(40, -10, null, { useAbsPower: true })).toBe(true);
    expect(isGridActive(40, -10, null, { useAbsPower: false })).toBe(false);
  });
});

describe("publicGridDetect", () => {
  it("returns normalized settings for API responses", () => {
    expect(publicGridDetect({ voltageMin: 25 })).toEqual({
      voltageMin: 25,
      powerMin: 5,
    });
  });
});
