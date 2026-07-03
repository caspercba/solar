/** Sample API payloads for E2E / integration — no real credentials. */

export const MOCK_SYSTEM_ID = "e2e-mock-home-001";
export const MOCK_SYSTEM_ID_2 = "e2e-mock-cabin-002";

export const MOCK_TOKEN = "e2e-test-token";

/** Date query param that returns empty intraday history (chart empty state). */
export const EMPTY_HISTORY_DATE = "2026-01-01";

export const health = {
  ok: true,
  version: "1.2.0-mock",
};

export const defaultAlerts = {
  enabled: false,
  webhookUrl: "",
  lowSocThreshold: 20,
  notifyLowSoc: true,
  notifyGenerator: true,
  cooldownMinutes: 60,
  webhookConfigured: false,
};

export const systems = [
  {
    id: MOCK_SYSTEM_ID,
    name: "Mock Home Solar",
    service: "shinemonitor",
    alerts: { ...defaultAlerts },
  },
  {
    id: MOCK_SYSTEM_ID_2,
    name: "Mock Cabin",
    service: "growatt",
    alerts: { ...defaultAlerts },
  },
];

/** Normalized realtime shape (PLAN.md §3.1). */
export function realtimeData(systemId) {
  const sys = systems.find((s) => s.id === systemId) || systems[0];
  const charging = systemId !== MOCK_SYSTEM_ID_2;

  return {
    systemId: sys.id,
    name: sys.name,
    service: sys.service,
    timestamp: "2026-07-03 14:32:00",
    battery: {
      voltage: 48.2,
      soc: charging ? 72 : 45,
      current: charging ? -15 : 22,
      power: charging ? -723 : 1056,
    },
    solar: {
      power: 1200,
      voltage: 95,
    },
    load: {
      power: 850,
      percent: 24,
    },
    grid: {
      power: 0,
      voltage: 0,
      active: false,
    },
    inverter: {
      ratedPower: 3500,
      nominalPV: 5000,
    },
    status: charging ? "PV Charging" : "Battery Discharge",
    energyToday: 12.4,
  };
}

/** Intraday history shape (PLAN.md §3.2). */
export function historyData(systemId, date) {
  const sys = systems.find((s) => s.id === systemId) || systems[0];
  const queryDate = date || "2026-07-03";

  if (queryDate === EMPTY_HISTORY_DATE) {
    return {
      systemId: sys.id,
      name: sys.name,
      service: sys.service,
      date: queryDate,
      timezoneOffset: -6,
      intervalMinutes: 5,
      points: [],
    };
  }

  return {
    systemId: sys.id,
    name: sys.name,
    service: sys.service,
    date: queryDate,
    timezoneOffset: -6,
    intervalMinutes: 5,
    points: [
      { time: "06:00", solar: 0, load: 120, battery: -45, soc: 68 },
      { time: "08:00", solar: 450, load: 180, battery: -270, soc: 70 },
      { time: "10:00", solar: 1100, load: 320, battery: -780, soc: 74 },
      { time: "12:00", solar: 1800, load: 410, battery: -1390, soc: 82 },
      { time: "14:00", solar: 1200, load: 850, battery: 350, soc: 72 },
      { time: "16:00", solar: 600, load: 920, battery: 320, soc: 65 },
      { time: "18:00", solar: 80, load: 780, battery: 700, soc: 58 },
      { time: "20:00", solar: 0, load: 650, battery: 650, soc: 52 },
    ],
  };
}

/** Multi-day summary shape (PLAN.md §3.3). */
export function historySummary(systemId, days = 7, endDate = "2026-07-03") {
  const sys = systems.find((s) => s.id === systemId) || systems[0];
  const n = Math.min(Math.max(1, days), 90);
  const series = [];

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(`${endDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const solarKwh = 14 + (n - i) * 0.8 + (sys.id === MOCK_SYSTEM_ID_2 ? 2 : 0);
    const loadKwh = 11 + (n - i) * 0.5;
    series.push({
      date,
      solarKwh: Math.round(solarKwh * 10) / 10,
      loadKwh: Math.round(loadKwh * 10) / 10,
      peakSolarW: 1800 + i * 50,
      minSoc: 42 + i,
      maxSoc: 88 + (i % 3),
      source: "vendor",
    });
  }

  return {
    systemId: sys.id,
    days: n,
    endDate,
    series,
  };
}
