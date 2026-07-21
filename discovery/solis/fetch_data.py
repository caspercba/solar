#!/usr/bin/env python3
"""SolisCloud API client (discovery spike) — sign and call the documented
SolisCloud Platform API to list stations/inverters and fetch realtime + day
data. Unlike ShineMonitor/Growatt, auth is an HMAC-SHA1 signed request using
an API key/secret (no username/password, no session cookie).

Environment:
  SOLIS_KEY_ID, SOLIS_KEY_SECRET — required (see ../README.md for how to
                                    obtain them from SolisCloud support)
  SOLIS_API_URL                  — optional, defaults to the global portal
  SOLIS_STATION_ID, SOLIS_INVERTER_ID — optional, skip discovery calls if set

NOTE: This script has not been run against a live SolisCloud account (no
test credentials were available for this spike). Field names follow the
published API spec — verify against a real response before relying on this
for anything beyond manual exploration.
"""

import base64
import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEFAULT_BASE_URL = "https://www.soliscloud.com:13333"


def rfc1123_date():
    return datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")


def content_md5(body_bytes):
    return base64.b64encode(hashlib.md5(body_bytes).digest()).decode("ascii")


def sign(key_secret, method, md5, content_type, date, resource):
    string_to_sign = f"{method}\n{md5}\n{content_type}\n{date}\n{resource}"
    digest = hmac.new(
        key_secret.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha1
    ).digest()
    return base64.b64encode(digest).decode("ascii")


def post(base_url, key_id, key_secret, path, body_dict):
    body_bytes = json.dumps(body_dict, separators=(",", ":")).encode("utf-8")
    content_type = "application/json;charset=UTF-8"
    date = rfc1123_date()
    md5 = content_md5(body_bytes)
    signature = sign(key_secret, "POST", md5, content_type, date, path)

    req = urllib.request.Request(
        f"{base_url}{path}",
        data=body_bytes,
        method="POST",
        headers={
            "Content-MD5": md5,
            "Content-Type": content_type,
            "Date": date,
            "Authorization": f"API {key_id}:{signature}",
        },
    )
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} calling {path}: {detail}") from exc


def main():
    key_id = os.environ.get("SOLIS_KEY_ID")
    key_secret = os.environ.get("SOLIS_KEY_SECRET")
    base_url = os.environ.get("SOLIS_API_URL", DEFAULT_BASE_URL)
    if not key_id or not key_secret:
        print("Set SOLIS_KEY_ID and SOLIS_KEY_SECRET", file=sys.stderr)
        sys.exit(1)

    station_id = os.environ.get("SOLIS_STATION_ID")
    inverter_id = os.environ.get("SOLIS_INVERTER_ID")

    if not station_id:
        print("=== Power Station List ===")
        stations = post(
            base_url, key_id, key_secret, "/v1/api/userStationList",
            {"pageNo": 1, "pageSize": 20},
        )
        print(json.dumps(stations, indent=2))
        records = (stations.get("data") or {}).get("page", {}).get("records", [])
        if not records:
            print("No stations returned — nothing else to fetch.", file=sys.stderr)
            return
        station_id = records[0].get("id")
        print(f"\nUsing first station id: {station_id}\n")

    print("=== Station Detail ===")
    detail = post(base_url, key_id, key_secret, "/v1/api/stationDetail", {"id": station_id})
    print(json.dumps(detail, indent=2))

    if not inverter_id:
        print("\n=== Inverter List ===")
        inverters = post(
            base_url, key_id, key_secret, "/v1/api/inverterList",
            {"stationId": station_id, "pageNo": 1, "pageSize": 20},
        )
        print(json.dumps(inverters, indent=2))
        records = (inverters.get("data") or {}).get("page", {}).get("records", [])
        if not records:
            print("No inverters returned — nothing else to fetch.", file=sys.stderr)
            return
        inverter_id = records[0].get("id")
        print(f"\nUsing first inverter id: {inverter_id}\n")

    print("=== Inverter Detail (realtime) ===")
    realtime = post(base_url, key_id, key_secret, "/v1/api/inverterDetail", {"id": inverter_id})
    print(json.dumps(realtime, indent=2))

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(f"\n=== Inverter Day ({today}) ===")
    day = post(
        base_url, key_id, key_secret, "/v1/api/inverterDay",
        {"id": inverter_id, "money": "USD", "time": today, "timeZone": 0},
    )
    print(json.dumps(day, indent=2))


if __name__ == "__main__":
    main()
