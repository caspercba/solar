#!/usr/bin/env python3
"""Deye / Solarman cloud API client (discovery spike).

Mints a bearer token with AppId/AppSecret + portal credentials (password
SHA-256), then lists stations, fetches station realtime, optional device
list/realtime, and a one-day history sample.

Supports two closely related OpenAPI dialects via DEYE_API_FLAVOR:

  solarman  — classic Solarman hosts (api.solarmanpv.com /
              globalapi.solarmanpv.com) with /…/v1.0/… paths
  deyecloud — DeyeCloud developer hosts (eu1/us1-developer.deyecloud.com/v1.0)
              with paths relative to that /v1.0 base

Environment:
  DEYE_APP_ID, DEYE_APP_SECRET     — required (developer application)
  DEYE_PASSWORD or DEYE_PASSWORD_SHA256 — required
  DEYE_EMAIL or DEYE_USERNAME or DEYE_MOBILE — one required
  DEYE_COUNTRY_CODE                — required when using DEYE_MOBILE (e.g. 86)
  DEYE_API_FLAVOR                  — solarman | deyecloud (default: solarman)
  DEYE_API_URL                     — override base URL
  DEYE_STATION_ID                  — optional, skip station list
  DEYE_DEVICE_SN                   — optional, fetch device realtime
  DEYE_ORG_ID / DEYE_COMPANY_ID    — optional merchant/business token
  DEYE_DATE                        — optional YYYY-MM-DD for history
                                     (default: today UTC)

NOTE: This script has not been run against a live account (no AppId was
available for this spike). Paths and field names follow published OpenAPI /
DeyeCloud samples — verify before relying on this beyond manual exploration.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DEFAULT_SOLARMAN_URL = "https://globalapi.solarmanpv.com"
DEFAULT_DEYECLOUD_URL = "https://eu1-developer.deyecloud.com/v1.0"


def _sha256_hex(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def _urlopen_json(req: urllib.request.Request, timeout: int = 30):
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            if not body:
                return None
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {req.full_url}: {detail}") from exc


def _post_json(url: str, body: dict, headers: dict | None = None):
    data = json.dumps(body).encode("utf-8")
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, method="POST", headers=hdrs)
    return _urlopen_json(req)


def paths_for(flavor: str) -> dict[str, str]:
    """Return path suffixes (appended to DEYE_API_URL)."""
    if flavor == "deyecloud":
        return {
            "token": "/account/token",
            "station_list": "/station/list",
            "station_realtime": "/station/latest",
            "station_device": "/station/device",
            "station_history": "/station/history",
            "device_realtime": "/device/latest",
        }
    # solarman classic
    return {
        "token": "/account/v1.0/token",
        "station_list": "/station/v1.0/list",
        "station_realtime": "/station/v1.0/realTime",
        "station_device": "/station/v1.0/device",
        "station_history": "/station/v1.0/history",
        "device_realtime": "/device/v1.0/currentData",
    }


def obtain_token(base_url: str, flavor: str, app_id: str, app_secret: str, creds: dict):
    paths = paths_for(flavor)
    qs = urllib.parse.urlencode({"appId": app_id, "language": "en"})
    url = f"{base_url.rstrip('/')}{paths['token']}?{qs}"
    body = {"appSecret": app_secret, "password": creds["password_sha256"]}
    if creds.get("email"):
        body["email"] = creds["email"]
    if creds.get("username"):
        body["username"] = creds["username"]
    if creds.get("mobile"):
        body["mobile"] = creds["mobile"]
        if creds.get("country_code"):
            body["countryCode"] = creds["country_code"]
    if flavor == "deyecloud" and creds.get("company_id") is not None:
        body["companyId"] = creds["company_id"]
    elif flavor == "solarman" and creds.get("org_id") is not None:
        body["orgId"] = creds["org_id"]
    return _post_json(url, body)


def auth_headers(access_token: str) -> dict:
    # Solarman/Deye docs require lowercase "bearer" + space.
    return {
        "Content-Type": "application/json",
        "Authorization": f"bearer {access_token}",
    }


def api_post(base_url: str, path: str, token: str, body: dict, language: bool = True):
    url = f"{base_url.rstrip('/')}{path}"
    if language:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}language=en"
    return _post_json(url, body, headers=auth_headers(token))


def normalize_hint_from_station(station_rt: dict) -> dict:
    """Best-effort PLAN.md §3.1-ish preview from station realtime (unverified)."""
    bat_w = station_rt.get("batteryPower")
    if bat_w is None:
        discharge = station_rt.get("dischargePower") or 0
        charge = station_rt.get("chargePower") or 0
        try:
            bat_w = float(discharge) - float(charge)
        except (TypeError, ValueError):
            bat_w = None
    soc = station_rt.get("batterySoc")
    if soc is None:
        soc = station_rt.get("batterySOC")
    grid = station_rt.get("purchasePower")
    if grid is None:
        grid = station_rt.get("wirePower")
    if grid is None:
        grid = station_rt.get("gridPower")
    try:
        grid_active = abs(float(grid)) > 5 if grid is not None else False
    except (TypeError, ValueError):
        grid_active = False
    return {
        "solar": {"power": station_rt.get("generationPower")},
        "load": {"power": station_rt.get("usePower")},
        "battery": {"soc": soc, "power": bat_w, "socSource": "api"},
        "grid": {"power": grid, "active": grid_active},
        "timestamp": station_rt.get("lastUpdateTime"),
        "_note": "Unverified mapping — confirm signs/units against a live plant",
    }


def main():
    flavor = os.environ.get("DEYE_API_FLAVOR", "solarman").strip().lower()
    if flavor not in ("solarman", "deyecloud"):
        print("DEYE_API_FLAVOR must be 'solarman' or 'deyecloud'", file=sys.stderr)
        sys.exit(1)

    app_id = os.environ.get("DEYE_APP_ID")
    app_secret = os.environ.get("DEYE_APP_SECRET")
    if not app_id or not app_secret:
        print("Set DEYE_APP_ID and DEYE_APP_SECRET", file=sys.stderr)
        sys.exit(1)

    password_sha = os.environ.get("DEYE_PASSWORD_SHA256")
    if not password_sha:
        plaintext = os.environ.get("DEYE_PASSWORD")
        if not plaintext:
            print("Set DEYE_PASSWORD or DEYE_PASSWORD_SHA256", file=sys.stderr)
            sys.exit(1)
        password_sha = _sha256_hex(plaintext)

    email = os.environ.get("DEYE_EMAIL")
    username = os.environ.get("DEYE_USERNAME")
    mobile = os.environ.get("DEYE_MOBILE")
    if not (email or username or mobile):
        print("Set DEYE_EMAIL, DEYE_USERNAME, or DEYE_MOBILE", file=sys.stderr)
        sys.exit(1)

    default_url = DEFAULT_DEYECLOUD_URL if flavor == "deyecloud" else DEFAULT_SOLARMAN_URL
    base_url = os.environ.get("DEYE_API_URL", default_url)
    paths = paths_for(flavor)

    creds = {
        "password_sha256": password_sha,
        "email": email,
        "username": username,
        "mobile": mobile,
        "country_code": os.environ.get("DEYE_COUNTRY_CODE"),
        "org_id": os.environ.get("DEYE_ORG_ID"),
        "company_id": os.environ.get("DEYE_COMPANY_ID"),
    }
    if creds["org_id"] is not None:
        try:
            creds["org_id"] = int(creds["org_id"])
        except ValueError:
            pass

    print(f"=== Flavor: {flavor}  Base: {base_url} ===\n")
    print("=== Obtain Token ===")
    token_resp = obtain_token(base_url, flavor, app_id, app_secret, creds)
    # Redact secrets in printed output
    safe = dict(token_resp or {})
    for k in ("access_token", "refresh_token"):
        if safe.get(k):
            safe[k] = f"{str(safe[k])[:12]}…(redacted)"
    print(json.dumps(safe, indent=2))
    access = (token_resp or {}).get("access_token")
    if not access:
        print("No access_token in response — aborting.", file=sys.stderr)
        sys.exit(1)

    station_id = os.environ.get("DEYE_STATION_ID")
    if station_id:
        try:
            station_id = int(station_id)
        except ValueError:
            pass
    else:
        print("\n=== Station List ===")
        stations = api_post(
            base_url, paths["station_list"], access, {"page": 1, "size": 20}
        )
        print(json.dumps(stations, indent=2))
        station_list = (stations or {}).get("stationList") or []
        if not station_list:
            # Some DeyeCloud envelopes nest differently
            data = (stations or {}).get("data")
            if isinstance(data, list):
                station_list = data
            elif isinstance(data, dict):
                station_list = data.get("stationList") or data.get("list") or []
        if not station_list:
            print("No stations returned — nothing else to fetch.", file=sys.stderr)
            return
        station_id = station_list[0].get("id")
        print(f"\nUsing first station id: {station_id}\n")

    print("=== Station Realtime ===")
    realtime = api_post(
        base_url, paths["station_realtime"], access, {"stationId": station_id}
    )
    print(json.dumps(realtime, indent=2))
    print("\n=== Normalize hint (unverified) ===")
    print(json.dumps(normalize_hint_from_station(realtime or {}), indent=2))

    print("\n=== Station Devices ===")
    if flavor == "deyecloud":
        device_body = {"page": 1, "size": 10, "stationIds": [station_id]}
    else:
        device_body = {
            "page": 1,
            "size": 10,
            "stationId": station_id,
            "deviceType": "INVERTER",
        }
    devices = api_post(base_url, paths["station_device"], access, device_body)
    print(json.dumps(devices, indent=2))

    device_sn = os.environ.get("DEYE_DEVICE_SN")
    if not device_sn:
        items = (devices or {}).get("deviceListItems") or (devices or {}).get(
            "deviceList"
        ) or []
        data = (devices or {}).get("data")
        if isinstance(data, list):
            items = items or data
        elif isinstance(data, dict):
            items = items or data.get("deviceListItems") or data.get("list") or []
        if items:
            device_sn = items[0].get("deviceSn")

    if device_sn:
        print(f"\n=== Device Realtime ({device_sn}) ===")
        if flavor == "deyecloud":
            body = {"deviceList": [device_sn]}
        else:
            body = {"deviceSn": device_sn}
        print(json.dumps(api_post(base_url, paths["device_realtime"], access, body), indent=2))

    day = os.environ.get("DEYE_DATE") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(f"\n=== Station History (day={day}) ===")
    if flavor == "deyecloud":
        hist_body = {
            "stationId": station_id,
            "granularity": 2,
            "startAt": day,
            "endAt": day,
        }
    else:
        hist_body = {
            "stationId": station_id,
            "timeType": 2,
            "startTime": day,
            "endTime": day,
        }
    print(json.dumps(api_post(base_url, paths["station_history"], access, hist_body), indent=2))


if __name__ == "__main__":
    main()
