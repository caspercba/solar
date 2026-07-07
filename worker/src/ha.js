/**
 * Home Assistant REST bridge — stable flat JSON from normalized realtime data.
 *
 * Schema version 1: snake_case keys, one level deep, suitable for HA REST sensors
 * without nested value_template paths. Breaking changes require bumping schema_version.
 */

export const HA_SCHEMA_VERSION = 1;

/**
 * @param {Record<string, unknown>} data
 * @returns {Record<string, string | number | boolean | null>}
 */
export function toHaPayload(data) {
  const battery = data.battery || {};
  const solar = data.solar || {};
  const load = data.load || {};
  const grid = data.grid || {};
  const inverter = data.inverter || {};

  return {
    schema_version: HA_SCHEMA_VERSION,
    system_id: data.systemId ?? null,
    name: data.name ?? null,
    service: data.service ?? null,
    timestamp: data.timestamp ?? null,
    battery_soc: numOrNull(battery.soc),
    battery_voltage: numOrNull(battery.voltage),
    battery_current: numOrNull(battery.current),
    battery_power: numOrNull(battery.power),
    solar_power: numOrNull(solar.power),
    solar_voltage: numOrNull(solar.voltage),
    load_power: numOrNull(load.power),
    load_percent: numOrNull(load.percent),
    grid_power: numOrNull(grid.power),
    grid_voltage: numOrNull(grid.voltage),
    grid_active: grid.active === true,
    inverter_rated_power: numOrNull(inverter.ratedPower),
    inverter_nominal_pv: numOrNull(inverter.nominalPV),
    status: data.status ?? null,
    energy_today_kwh: numOrNull(data.energyToday),
  };
}

function numOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
