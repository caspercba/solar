#!/usr/bin/env python3
"""
ShineMonitor / Eybond public web API — fetch plant metrics as JSON.

See discovery/README.md and discovery/API.md for full documentation and example responses.

Auth and signing match www.shinemonitor.com (see index_en.html + js/loginIndex.js + js/libhttp.js):
  - pwd_sha1 = hex(SHA1(utf-8 password))
  - auth: sign = hex(SHA1(salt + pwd_sha1 + action))
    action = "&action=auth&usr=" + encoded_usr + "&company-key=bnrl_frRFjEz8Mkn"
  - authenticated GET: sign = hex(SHA1(salt + secret + token + action))
    action must use the same encoding as the site (# -> %23, ' -> %27, space -> %20)
    and include &i18n=...&lang=... (appended by http_async_request_public in libhttp.js).

Environment:
  SHINE_USER, SHINE_PASSWORD — required
  SHINE_PLANT_ID — optional (default: discovered plant id)
  SHINE_LANG — optional, default en_US
  SHINE_INCLUDE_DAY_SERIES — if set, include full 5-min power series for today
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import urllib.parse
from typing import Any
from urllib.request import Request, urlopen

BASE = "https://web.shinemonitor.com/public/"
COMPANY_KEY = "bnrl_frRFjEz8Mkn"  # www.shinemonitor.com (loginIndex.js)


def sha1_hex(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def encode_action_piece(action: str) -> str:
    """Match libhttp.js http_async_request_public URL encoding."""
    return (
        action.replace("#", "%23")
        .replace("'", "%27")
        .replace(" ", "%20")
    )


def sign_authenticated(salt_ms: int, secret: str, token: str, action: str) -> str:
    a = encode_action_piece(action)
    payload = str(salt_ms) + secret + token + a
    return sha1_hex(payload)


def sign_auth(salt_ms: int, pwd_sha1: str, action: str) -> str:
    return sha1_hex(str(salt_ms) + pwd_sha1 + action)


def get_json(url: str) -> dict[str, Any]:
    req = Request(
        url,
        headers={
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "User-Agent": "solar-discovery/1.0",
        },
    )
    with urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def auth(user: str, password: str) -> dict[str, Any]:
    pwd_sha1 = sha1_hex(password)
    salt = int(time.time() * 1000)
    usr_q = urllib.parse.quote(user, safe="").replace("+", "%2B").replace("'", "%27")
    action = f"&action=auth&usr={usr_q}&company-key={COMPANY_KEY}"
    sign = sign_auth(salt, pwd_sha1, action)
    url = f"{BASE}?sign={sign}&salt={salt}{action}"
    data = get_json(url)
    if data.get("err") != 0:
        raise SystemExit(f"auth failed: {data}")
    return data["dat"]


def public_get(token: str, secret: str, action_core: str, lang: str) -> dict[str, Any]:
    """action_core starts with &action=... and must NOT include i18n/lang."""
    action = f"{action_core}&i18n={lang}&lang={lang}"
    salt = int(time.time() * 1000)
    sign = sign_authenticated(salt, secret, token, action)
    enc = encode_action_piece(action)
    url = f"{BASE}?sign={sign}&salt={salt}&token={token}{enc}"
    return get_json(url)


def main() -> None:
    user = os.environ.get("SHINE_USER")
    password = os.environ.get("SHINE_PASSWORD")
    plant_id = os.environ.get("SHINE_PLANT_ID", "77218")
    lang = os.environ.get("SHINE_LANG", "en_US")

    if not user or not password:
        print("Set SHINE_USER and SHINE_PASSWORD", file=sys.stderr)
        sys.exit(1)

    session = auth(user, password)
    token = session["token"]
    secret = session["secret"]

    plants = public_get(
        token,
        secret,
        "&action=queryPlantsInfo",
        lang,
    )
    current = public_get(
        token,
        secret,
        "&action=queryPlantCurrentData&plantid="
        + plant_id
        + "&par="
        + ",".join(
            [
                "CURRENT_POWER",
                "BATTERY_SOC",
                "ENERGY_TODAY",
                "ENERGY_TOTAL",
            ]
        ),
        lang,
    )
    day = public_get(
        token,
        secret,
        f"&action=queryPlantActiveOuputPowerOneDay&plantid={plant_id}&date="
        + time.strftime("%Y-%m-%d"),
        lang,
    )
    series = (day.get("dat") or {}).get("outputPower") or []

    out: dict[str, Any] = {
        "plant_id": int(plant_id),
        "session_uid": session.get("uid"),
        "plants_info": plants.get("dat"),
        "plant_current": current.get("dat"),
    }
    if os.environ.get("SHINE_INCLUDE_DAY_SERIES"):
        out["output_power_today_kw_series"] = day.get("dat")
    else:
        out["output_power_today_summary"] = {
            "samples": len(series),
            "last_kw": series[-1]["val"] if series else None,
            "last_ts": series[-1]["ts"] if series else None,
        }

    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
