#!/usr/bin/env python3
"""Growatt API client — fetch real-time data for SPF 3500 ES storage inverter."""

import json
import sys
import urllib.request
import urllib.parse
import http.cookiejar

BASE = "https://mqtt.growatt.com"
PLANT_ID = "10489936"
STORAGE_SN = "JQK8NYB00S"

STATUS_MAP = {
    "-1": "Offline", "0": "Standby",
    "1": "PV&Grid Supporting Loads", "2": "Battery Discharging",
    "3": "Fault", "4": "Flash", "5": "PV Charging",
    "6": "Grid Charging", "7": "PV&Grid Charging",
    "8": "PV&Grid Charging+Grid Bypass", "9": "PV Charging+Grid Bypass",
    "10": "Grid Charging+Grid Bypass", "11": "Grid Bypass",
    "12": "PV Charging+Loads Supporting", "13": "PV Discharging",
    "14": "PV&Battery Discharging", "15": "Gen Charging",
    "16": "Gen Charging+Gen Bypass", "17": "PV&Gen Charging",
    "18": "PV&Gen Charging+Gen Bypass", "19": "PV Charging+Gen Bypass",
    "20": "Gen Bypass",
}


def create_session():
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    return opener


def login(opener, account, password):
    data = urllib.parse.urlencode({
        "account": account,
        "password": password,
        "validateCode": "",
        "isReadPact": "0",
        "lang": "en",
    }).encode()
    req = urllib.request.Request(f"{BASE}/login", data=data,
                                headers={"Content-Type": "application/x-www-form-urlencoded"})
    resp = opener.open(req, timeout=15)
    result = json.loads(resp.read().decode())
    if result.get("result") != 1:
        raise RuntimeError(f"Login failed: {result}")
    return result


def post_json(opener, path, body_dict=None):
    data = urllib.parse.urlencode(body_dict or {}).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=data,
                                headers={"Content-Type": "application/x-www-form-urlencoded",
                                          "X-Requested-With": "XMLHttpRequest"})
    resp = opener.open(req, timeout=15)
    return json.loads(resp.read().decode())


def main():
    account = sys.argv[1] if len(sys.argv) > 1 else "riodelmedio"
    password = sys.argv[2] if len(sys.argv) > 2 else "rio2909"

    opener = create_session()
    print("Logging in...")
    login(opener, account, password)
    print("OK\n")

    # Real-time status
    print("=== Real-Time Status ===")
    status = post_json(opener,
                       f"/panel/storage/getStorageStatusData?plantId={PLANT_ID}",
                       {"storageSn": STORAGE_SN})
    d = status["obj"]
    st = STATUS_MAP.get(d["status"], f"Unknown ({d['status']})")
    print(f"  Status:       {st}")
    print(f"  PV Power:     {d['panelPower']} W  (PV1={d['ppv1']}W  PV2={d['ppv2']}W)")
    print(f"  Battery:      {d['vBat']} V  SOC={d['capacity']}%  Power={d['batPower']} W")
    print(f"  Load:         {d['loadPower']} W  ({d['loadPrecent']}%)")
    print(f"  Grid:         {d['gridPower']} W  (Input: {d['vAcInput']}V {d['fAcInput']}Hz)")
    print(f"  AC Output:    {d['vAcOutput']} V  {d['fAcOutput']} Hz")
    print()

    # Energy totals
    print("=== Energy Totals ===")
    totals = post_json(opener,
                       f"/panel/storage/getStorageTotalData?plantId={PLANT_ID}",
                       {"storageSn": STORAGE_SN})
    t = totals["obj"]
    print(f"  PV Production:   Today {t['epvToday']} kWh  |  Total {t['epvTotal']} kWh")
    print(f"  Bat Charge:      Today {t['chargeToday']} kWh  |  Total {t['chargeTotal']} kWh")
    print(f"  Bat Discharge:   Today {t['eDischargeToday']} kWh  |  Total {t['eDischargeTotal']} kWh")
    print(f"  Load Consumed:   Today {t['useEnergyToday']} kWh  |  Total {t['useEnergyTotal']} kWh")
    print(f"  Grid Import:     Today {t['eToUserToday']} kWh  |  Total {t['eToUserTotal']} kWh")
    print(f"  Grid Export:     Today {t['eToGridToday']} kWh  |  Total {t['eToGridTotal']} kWh")
    print()

    # Plant info
    print("=== Plant Info ===")
    plant = post_json(opener, f"/panel/getPlantData?plantId={PLANT_ID}")
    p = plant["obj"]
    print(f"  Name:         {p['plantName']}")
    print(f"  Location:     {p['city']}, {p['country']}")
    print(f"  Nominal PV:   {p['nominalPower']} W")
    print(f"  CO2 Saved:    {p['co2']} kg")


if __name__ == "__main__":
    main()
