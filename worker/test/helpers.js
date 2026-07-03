import { expect } from "vitest";

/** In-memory KV mock for route tests. */
export function createMockKV(initial = {}) {
  const store = new Map(Object.entries(initial));

  return {
    async get(key, type) {
      const value = store.get(key);
      if (value == null) return null;
      if (type === "json") return JSON.parse(value);
      return value;
    },
    async put(key, value) {
      store.set(key, typeof value === "string" ? value : JSON.stringify(value));
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

/** Assert the normalized multi-day history summary shape (PLAN §3.3). */
export function expectHistorySummaryShape(summary) {
  expect(summary).toMatchObject({
    systemId: expect.any(String),
    days: expect.any(Number),
    endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    series: expect.any(Array),
  });
  for (const day of summary.series) {
    expect(day).toMatchObject({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(day).toHaveProperty("solarKwh");
    expect(day).toHaveProperty("loadKwh");
    expect(day).toHaveProperty("minSoc");
    expect(day).toHaveProperty("maxSoc");
  }
}

/** Assert the canonical normalized system data shape shared by adapters. */
export function expectNormalizedShape(data) {
  expect(data).toMatchObject({
    systemId: expect.any(String),
    name: expect.any(String),
    service: expect.stringMatching(/^(shinemonitor|growatt)$/),
    timestamp: expect.any(String),
    battery: {
      voltage: expect.any(Number),
      soc: expect.any(Number),
      current: expect.any(Number),
      power: expect.any(Number),
    },
    solar: { power: expect.any(Number), voltage: expect.any(Number) },
    load: { power: expect.any(Number), percent: expect.any(Number) },
    grid: {
      power: expect.any(Number),
      voltage: expect.any(Number),
      active: expect.any(Boolean),
    },
    inverter: {
      ratedPower: expect.any(Number),
      nominalPV: expect.any(Number),
    },
    status: expect.any(String),
  });
}
