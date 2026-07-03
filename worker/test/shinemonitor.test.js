import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveBatterySoc } from "../src/services/shinemonitor.js";

describe("resolveBatterySoc", () => {
  it("uses API BATTERY_SOC when present and valid", () => {
    const plantCurrent = [
      { key: "CURRENT_POWER", val: "0.1370" },
      { key: "BATTERY_SOC", val: 72 },
    ];
    assert.deepEqual(resolveBatterySoc(plantCurrent, 48.0), { soc: 72, socSource: "api" });
  });

  it("uses API BATTERY_SOC from string values", () => {
    const plantCurrent = [{ key: "BATTERY_SOC", val: "85.4" }];
    assert.deepEqual(resolveBatterySoc(plantCurrent, 48.0), { soc: 85, socSource: "api" });
  });

  it("falls back to voltage estimate when BATTERY_SOC is -1", () => {
    const plantCurrent = [{ key: "BATTERY_SOC", val: -1 }];
    assert.deepEqual(resolveBatterySoc(plantCurrent, 47.75), { soc: 50, socSource: "estimated" });
  });

  it("falls back to voltage estimate when BATTERY_SOC is missing", () => {
    const plantCurrent = [{ key: "CURRENT_POWER", val: "0.5" }];
    assert.deepEqual(resolveBatterySoc(plantCurrent, 53.5), { soc: 100, socSource: "estimated" });
  });

  it("falls back to voltage estimate when plantCurrent is not an array", () => {
    assert.deepEqual(resolveBatterySoc(null, 42.0), { soc: 0, socSource: "estimated" });
  });

  it("accepts 0% from API", () => {
    const plantCurrent = [{ key: "BATTERY_SOC", val: 0 }];
    assert.deepEqual(resolveBatterySoc(plantCurrent, 50.0), { soc: 0, socSource: "api" });
  });
});
