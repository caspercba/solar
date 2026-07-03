import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchData } from "../src/services/growatt.js";
import { expectNormalizedShape } from "./helpers.js";

describe("growatt fetchData normalization", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns normalized output shape from mocked Growatt API responses", async () => {
    const systemConfig = {
      id: "growatt-1",
      name: "Growatt Home",
      credentials: {
        user: "growatt-user",
        password: "secret",
        plantId: "42",
        storageSn: "STORAGE-SN",
        nominalPower: 3500,
        nominalPV: 4000,
      },
    };

    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/login") && init?.method === "POST") {
        return new Response(JSON.stringify({ result: 1 }), {
          headers: { "set-cookie": "JSESSIONID=abc123; Path=/" },
        });
      }
      if (u.includes("getStorageStatusData")) {
        return Response.json({
          result: 1,
          obj: {
            panelPower: "1500",
            vPv1: "360",
            vBat: "51.2",
            capacity: "80",
            batPower: "200",
            loadPower: "900",
            loadPrecent: "25",
            gridPower: "100",
            vAcInput: "230",
            status: "5",
          },
        });
      }
      if (u.includes("getStorageTotalData")) {
        return Response.json({ result: 1, obj: { epvToday: "8.3" } });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const data = await fetchData(systemConfig);
    expectNormalizedShape(data);
    expect(data.service).toBe("growatt");
    expect(data.battery.soc).toBe(80);
    expect(data.solar.power).toBe(1500);
    expect(data.energyToday).toBe(8.3);
    expect(data.status).toBe("PV Charging");
  });
});
