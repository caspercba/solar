#!/usr/bin/env python3
"""SMA Monitoring API client (discovery spike) — OAuth2 client_credentials
token + plant list + EnergyBalance Recent/Day.

Unlike ShineMonitor/Growatt, auth is application client_id/secret issued by
SMA Developer Support, plus plant-owner consent (see API.md §1). This script
implements the token + Monitoring calls only; consent (bc-authorize) is an
optional helper when SMA_LOGIN_HINT is set.

Environment:
  SMA_CLIENT_ID, SMA_CLIENT_SECRET — required
  SMA_AUTH_URL                     — optional (default production auth host)
  SMA_MONITORING_URL               — optional (default production monitoring)
  SMA_BC_AUTH_URL                  — optional (backchannel consent host)
  SMA_PLANT_ID                     — optional, skip plant list if set
  SMA_LOGIN_HINT                   — optional owner email; if set, POST/GET
                                     bc-authorize before plant calls
  SMA_DATE                         — optional YYYY-MM-DD for Day history
                                     (default: today UTC)

NOTE: This script has not been run against a live SMA account (no client
credentials were available for this spike). Paths and field names follow the
published OpenAPI — verify against sandbox Swagger before relying on this
beyond manual exploration.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DEFAULT_AUTH_URL = "https://auth.smaapis.de"
DEFAULT_MONITORING_URL = "https://monitoring.smaapis.de"
DEFAULT_BC_AUTH_URL = "https://async-auth.smaapis.de"


def _urlopen_json(req, timeout=30):
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            if not body:
                return None
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {req.full_url}: {detail}") from exc


def get_client_token(auth_url, client_id, client_secret):
    data = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "client_credentials",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{auth_url.rstrip('/')}/oauth2/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    return _urlopen_json(req)


def refresh_token(auth_url, client_id, client_secret, refresh):
    data = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{auth_url.rstrip('/')}/oauth2/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    return _urlopen_json(req)


def api_get(base_url, path, access_token, query=None):
    qs = f"?{urllib.parse.urlencode(query)}" if query else ""
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}{qs}",
        method="GET",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        },
    )
    return _urlopen_json(req)


def bc_authorize(bc_url, access_token, login_hint):
    body = json.dumps({"loginHint": login_hint}).encode("utf-8")
    req = urllib.request.Request(
        f"{bc_url.rstrip('/')}/oauth2/v2/bc-authorize",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    return _urlopen_json(req)


def bc_authorize_status(bc_url, access_token, login_hint):
    encoded = urllib.parse.quote(login_hint, safe="")
    return api_get(bc_url, f"/oauth2/v2/bc-authorize/{encoded}", access_token)


def normalize_energy_balance_set(eb):
    """Map one EnergyBalance point toward PLAN.md §3.1 (best-effort)."""
    if not eb:
        return None
    # OpenAPI: Recent may return set as object or list depending on version —
    # accept both.
    points = eb.get("set")
    if isinstance(points, list):
        point = points[0] if points else {}
    elif isinstance(points, dict):
        point = points
    else:
        point = {}

    charge = float(point.get("batteryCharging") or 0)
    discharge = float(point.get("batteryDischarging") or 0)
    grid_in = float(point.get("gridConsumption") or 0)
    grid_out = float(point.get("gridFeedIn") or 0)
    diesel = float(point.get("dieselGeneration") or 0)

    return {
        "timestamp": point.get("time"),
        "solar": {"power": point.get("pvGeneration")},
        "load": {"power": point.get("totalConsumption")},
        "battery": {
            "soc": point.get("batteryStateOfCharge"),
            "socSource": "api" if point.get("batteryStateOfCharge") is not None else None,
            # PLAN.md: negative = charging, positive = discharging
            "power": discharge - charge,
        },
        "grid": {
            "power": grid_in - grid_out,
            "dieselGeneration": diesel,
            "active": diesel > 5 or (grid_in > 5 or grid_out > 5),
        },
        "raw": point,
    }


def main():
    client_id = os.environ.get("SMA_CLIENT_ID")
    client_secret = os.environ.get("SMA_CLIENT_SECRET")
    auth_url = os.environ.get("SMA_AUTH_URL", DEFAULT_AUTH_URL)
    monitoring_url = os.environ.get("SMA_MONITORING_URL", DEFAULT_MONITORING_URL)
    bc_url = os.environ.get("SMA_BC_AUTH_URL", DEFAULT_BC_AUTH_URL)
    plant_id = os.environ.get("SMA_PLANT_ID")
    login_hint = os.environ.get("SMA_LOGIN_HINT")
    day = os.environ.get("SMA_DATE") or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if not client_id or not client_secret:
        print("Set SMA_CLIENT_ID and SMA_CLIENT_SECRET", file=sys.stderr)
        print(
            "Obtain sandbox credentials from SMA Developer Support "
            "(see discovery/sma/README.md).",
            file=sys.stderr,
        )
        sys.exit(1)

    print("=== OAuth2 client_credentials ===")
    token = get_client_token(auth_url, client_id, client_secret)
    print(json.dumps({k: token.get(k) for k in ("token_type", "expires_in", "refresh_expires_in") if token}, indent=2))
    access = token["access_token"]

    if login_hint:
        print(f"\n=== Backchannel consent request ({login_hint}) ===")
        try:
            created = bc_authorize(bc_url, access, login_hint)
            print(json.dumps(created, indent=2))
        except RuntimeError as exc:
            print(f"(bc-authorize POST failed — may already exist) {exc}", file=sys.stderr)
        print("\n=== Backchannel consent status ===")
        status = bc_authorize_status(bc_url, access, login_hint)
        print(json.dumps(status, indent=2))
        if (status or {}).get("state") != "accepted":
            print(
                "Consent not accepted yet — plant list will likely be empty. "
                "Wait for owner email approval (or sandbox PUT …/status).",
                file=sys.stderr,
            )

    if not plant_id:
        print("\n=== Plant list ===")
        plants = api_get(
            monitoring_url,
            "/v1/plants",
            access,
            {"WithStatus": "true", "WithInstallation": "true"},
        )
        print(json.dumps(plants, indent=2))
        # Response shape varies (list vs {plants: [...]}) across OpenAPI versions
        records = plants if isinstance(plants, list) else (
            (plants or {}).get("plants")
            or (plants or {}).get("PlantStatusList")
            or (plants or {}).get("items")
            or []
        )
        if isinstance(records, dict):
            records = records.get("plants") or records.get("items") or []
        if not records:
            print(
                "No plants returned — check owner consent / credentials. "
                "Nothing else to fetch.",
                file=sys.stderr,
            )
            return
        first = records[0]
        plant_id = first.get("plantId") or first.get("id") or first.get("PlantId")
        print(f"\nUsing first plant id: {plant_id}\n")

    print("=== Plant detail ===")
    detail = api_get(monitoring_url, f"/v1/plants/{plant_id}", access)
    print(json.dumps(detail, indent=2))

    print("\n=== EnergyBalance / Recent (realtime candidate) ===")
    recent = api_get(
        monitoring_url,
        f"/v1/plants/{plant_id}/measurements/sets/EnergyBalance/Recent",
        access,
    )
    print(json.dumps(recent, indent=2))
    print("\n--- Normalized sketch ---")
    print(json.dumps(normalize_energy_balance_set(recent), indent=2))

    print(f"\n=== EnergyBalance / Day ({day}) ===")
    day_data = api_get(
        monitoring_url,
        f"/v1/plants/{plant_id}/measurements/sets/EnergyBalance/Day",
        access,
        {"Date": day, "WithTotal": "true"},
    )
    print(json.dumps(day_data, indent=2))


if __name__ == "__main__":
    main()
