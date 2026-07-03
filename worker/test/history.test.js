import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHistoryRows, localDate } from "../src/services/shinemonitor.js";

describe("parseHistoryRows", () => {
  const titles = [
    { title: "Timestamp" },
    { title: "Battery Voltage" },
    { title: "Batt Current" },
    { title: "Charger Power" },
    { title: "PLoad" },
  ];

  it("maps ShineMonitor fields to normalized points", () => {
    const rows = [
      { field: ["2026-04-04 18:19:48", "51.6", "-62", "110", "283"] },
      { field: ["2026-04-04 06:00:00", "50.0", "10", "0", "120"] },
    ];
    assert.deepEqual(parseHistoryRows(titles, rows), [
      { time: "18:19", solar: 110, load: 283, battery: -3199 },
      { time: "06:00", solar: 0, load: 120, battery: 500 },
    ]);
  });

  it("returns empty array for no rows", () => {
    assert.deepEqual(parseHistoryRows(titles, []), []);
  });
});

describe("localDate", () => {
  it("formats plant-local calendar date from offset seconds", () => {
    const utcMidnight = Date.UTC(2026, 3, 4, 2, 0, 0);
    const originalNow = Date.now;
    Date.now = () => utcMidnight;
    try {
      assert.equal(localDate(-10800), "2026-04-03");
      assert.equal(localDate(0), "2026-04-04");
    } finally {
      Date.now = originalNow;
    }
  });
});
