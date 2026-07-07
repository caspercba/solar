import { describe, it, expect } from "vitest";
import { toHaPayload, HA_SCHEMA_VERSION } from "../src/ha.js";

describe("toHaPayload", () => {
  const sample = {
    systemId: "abc-123",
    name: "Cabin",
    service: "growatt",
    timestamp: "2026-07-03 14:32:00",
    battery: { voltage: 48.2, soc: 72, current: -15, power: -723 },
    solar: { power: 1200, voltage: 95 },
    load: { power: 850, percent: 24 },
    grid: { power: 0, voltage: 0, active: false },
    inverter: { ratedPower: 3500, nominalPV: 5000 },
    status: "PV Charging",
    energyToday: 12.4,
  };

  it("flattens nested realtime data into snake_case HA schema", () => {
    expect(toHaPayload(sample)).toEqual({
      schema_version: HA_SCHEMA_VERSION,
      system_id: "abc-123",
      name: "Cabin",
      service: "growatt",
      timestamp: "2026-07-03 14:32:00",
      battery_soc: 72,
      battery_voltage: 48.2,
      battery_current: -15,
      battery_power: -723,
      solar_power: 1200,
      solar_voltage: 95,
      load_power: 850,
      load_percent: 24,
      grid_power: 0,
      grid_voltage: 0,
      grid_active: false,
      inverter_rated_power: 3500,
      inverter_nominal_pv: 5000,
      status: "PV Charging",
      energy_today_kwh: 12.4,
    });
  });

  it("uses null for missing numeric fields and false for missing grid_active", () => {
    expect(toHaPayload({ systemId: "x", service: "shinemonitor" })).toMatchObject({
      schema_version: HA_SCHEMA_VERSION,
      system_id: "x",
      battery_soc: null,
      grid_active: false,
      energy_today_kwh: null,
    });
  });

  it("coerces string numbers from vendor payloads", () => {
    expect(
      toHaPayload({
        battery: { soc: "55", voltage: "51.0" },
        solar: { power: "100" },
      }),
    ).toMatchObject({
      battery_soc: 55,
      battery_voltage: 51,
      solar_power: 100,
    });
  });
});
