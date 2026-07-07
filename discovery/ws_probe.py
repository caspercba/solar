#!/usr/bin/env python3
"""
Probe ws.shinemonitor.com — verify HTTP vs WebSocket transport.

The ShineMonitor portal names paths "ws" on ws.shinemonitor.com, but transport is
signed HTTP GET (jQuery ajax), not RFC 6455 WebSocket. This script demonstrates that.

Usage:
  python3 discovery/ws_probe.py --handshake-only
  SHINE_USER=... SHINE_PASSWORD=... python3 discovery/ws_probe.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import ssl
import sys
import time
import urllib.parse
import urllib.request
from typing import Any

WS_HOST = "ws.shinemonitor.com"
WS_HTTP_BASE = f"https://{WS_HOST}/"
PUBLIC_BASE = "https://web.shinemonitor.com/public/"
COMPANY_KEY = "bnrl_frRFjEz8Mkn"


def sha1_hex(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def encode_action(action: str) -> str:
    return action.replace("#", "%23").replace("'", "%27").replace(" ", "%20")


def get_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "User-Agent": "solar-ws-probe/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def auth(user: str, password: str) -> dict[str, Any]:
    pwd_sha1 = sha1_hex(password)
    salt = int(time.time() * 1000)
    usr_q = urllib.parse.quote(user, safe="").replace("+", "%2B").replace("'", "%27")
    action = f"&action=auth&usr={usr_q}&company-key={COMPANY_KEY}"
    sign = sha1_hex(str(salt) + pwd_sha1 + action)
    url = f"{PUBLIC_BASE}?sign={sign}&salt={salt}{action}"
    data = get_json(url)
    if data.get("err") != 0:
        raise RuntimeError(data.get("desc") or f"auth err {data.get('err')}")
    return {**data["dat"], "pwd_sha1": pwd_sha1}


def signed_get(base: str, prefix: str, session: dict[str, Any], action_core: str) -> dict[str, Any]:
    """prefix is '' for public/ or 'ws' for ws.shinemonitor.com/ws."""
    action = f"{action_core}&i18n=en_US&lang=en_US"
    salt = int(time.time() * 1000)
    sign = sha1_hex(str(salt) + session["secret"] + session["token"] + encode_action(action))
    enc = encode_action(action)
    if prefix:
        url = f"{base}{prefix}?sign={sign}&salt={salt}&token={session['token']}{enc}"
    else:
        url = f"{base}?sign={sign}&salt={salt}&token={session['token']}{enc}"
    return get_json(url)


def probe_websocket_handshake(host: str = WS_HOST, path: str = "/ws") -> None:
    """Send minimal Upgrade request; expect no 101 Switching Protocols."""
    print(f"\n=== WebSocket handshake probe: wss://{host}{path} ===")
    ctx = ssl.create_default_context()
    raw = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
        "\r\n"
    )
    with socket.create_connection((host, 443), timeout=15) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as tls:
            tls.sendall(raw.encode())
            tls.settimeout(10)
            chunk = tls.recv(4096).decode("utf-8", errors="replace")
    status_line = chunk.split("\r\n", 1)[0]
    print(f"Response: {status_line}")
    if "101" in status_line:
        print("RESULT: WebSocket upgrade accepted (unexpected)")
    else:
        print("RESULT: Not a WebSocket server (expected) — use signed HTTP GET instead.")


def list_plants(session: dict[str, Any]) -> list[dict[str, Any]]:
    data = signed_get(PUBLIC_BASE, "", session, "&action=queryPlantsInfo")
    if data.get("err", 0) != 0:
        raise RuntimeError(data.get("desc") or "queryPlantsInfo failed")
    return data.get("dat", {}).get("info") or []


def probe_legacy_ws_http(session: dict[str, Any], plant_id: str) -> None:
    print(f"\n=== Legacy HTTP on ws host (plantCurrentData, plant {plant_id}) ===")
    action = f"&action=plantCurrentData&id={plant_id}&par=ENERGY_TODAY,CURRENT_POWER,BATTERY_SOC"
    legacy = signed_get(WS_HTTP_BASE, "ws", session, action)
    print(f"err={legacy.get('err')} desc={legacy.get('desc')}")
    if legacy.get("err") == 0:
        keys = [item.get("key") for item in (legacy.get("dat") or [])]
        print(f"dat keys: {keys}")


def probe_public_http(session: dict[str, Any], plant_id: str) -> None:
    print(f"\n=== Modern public API (queryPlantCurrentData, plant {plant_id}) ===")
    action = f"&action=queryPlantCurrentData&plantid={plant_id}"
    resp = signed_get(PUBLIC_BASE, "", session, action)
    print(f"err={resp.get('err')} desc={resp.get('desc')}")
    if resp.get("err") == 0:
        keys = [item.get("key") for item in (resp.get("dat") or [])]
        print(f"dat keys (first 8): {keys[:8]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe ws.shinemonitor.com HTTP vs WebSocket")
    parser.add_argument(
        "--handshake-only",
        action="store_true",
        help="Only run WebSocket upgrade probe (no credentials)",
    )
    args = parser.parse_args()

    probe_websocket_handshake()

    if args.handshake_only:
        return 0

    user = os.environ.get("SHINE_USER")
    password = os.environ.get("SHINE_PASSWORD")
    if not user or not password:
        print(
            "\nSkipping HTTP comparison — set SHINE_USER and SHINE_PASSWORD to compare "
            "legacy ws host vs web/public host.",
            file=sys.stderr,
        )
        return 0

    print("\n=== Authenticating via web.shinemonitor.com/public/ ===")
    session = auth(user, password)
    plants = list_plants(session)
    if not plants:
        print("No plants on account.", file=sys.stderr)
        return 1
    plant_id = os.environ.get("SHINE_PLANT_ID") or str(plants[0]["pid"])
    print(f"Using plant id {plant_id}")

    probe_legacy_ws_http(session, plant_id)
    probe_public_http(session, plant_id)
    print("\nDone — both calls are HTTP GET; neither uses WebSocket frames.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
