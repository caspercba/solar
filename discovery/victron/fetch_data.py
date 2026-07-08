#!/usr/bin/env python3
"""Victron VRM API client — discovery spike, list installations + latest diagnostics.

Not validated against a live account (see README.md). Endpoint shapes and the
X-Authorization header format are compiled from public docs / community reports and may
need adjustment once run against a real VRM site.

Environment:
  VRM_TOKEN                    — Personal Access Token (preferred; create at
                                  https://vrm.victronenergy.com/access-tokens)
  VRM_USERNAME, VRM_PASSWORD   — fallback login (fails on accounts with 2FA enabled)
"""

import json
import os
import sys
import urllib.request
import urllib.error
import urllib.parse

BASE = "https://vrmapi.victronenergy.com/v2"


def request(path, token, token_scheme, method="GET", params=None, body=None):
    url = f"{BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {"X-Authorization": f"{token_scheme} {token}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {detail}") from exc
    return json.loads(resp.read().decode())


def login(username, password):
    """POST /v2/auth/login — returns (token, idUser). Fails on 2FA-enabled accounts."""
    url = f"{BASE}/auth/login"
    body = json.dumps({"username": username, "password": password}).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        resp = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"Login failed: HTTP {exc.code}: {detail}") from exc
    result = json.loads(resp.read().decode())
    if result.get("verification_mode") not in (None, "", "password"):
        raise RuntimeError(
            f"Account requires 2FA ({result.get('verification_mode')}); "
            "use a Personal Access Token (VRM_TOKEN) instead"
        )
    return result["token"], result["idUser"]


def get_installations(id_user, token, token_scheme):
    """GET /v2/users/{idUser}/installations — list of sites for this account."""
    result = request(
        f"/users/{id_user}/installations", token, token_scheme, params={"extended": 1}
    )
    return result.get("records", [])


def get_diagnostics(id_site, token, token_scheme, count=50):
    """GET /v2/installations/{idSite}/diagnostics — latest per-attribute values."""
    result = request(
        f"/installations/{id_site}/diagnostics", token, token_scheme, params={"count": count}
    )
    return result.get("records", [])


def resolve_token():
    """Prefer a Personal Access Token; fall back to username/password login."""
    pat = os.environ.get("VRM_TOKEN")
    if pat:
        return pat, "Token", None

    username = os.environ.get("VRM_USERNAME")
    password = os.environ.get("VRM_PASSWORD")
    if not username or not password:
        print(
            "Set VRM_TOKEN (preferred), or VRM_USERNAME and VRM_PASSWORD",
            file=sys.stderr,
        )
        sys.exit(1)

    print("Logging in with username/password...")
    token, id_user = login(username, password)
    print("OK\n")
    return token, "Bearer", id_user


def main():
    token, token_scheme, id_user = resolve_token()

    if id_user is None:
        # PAT path — VRM's /me or /users/me endpoint would normally resolve idUser;
        # since this wasn't verified live, allow overriding via env for the spike.
        id_user = os.environ.get("VRM_USER_ID")
        if not id_user:
            print(
                "VRM_TOKEN auth needs a numeric VRM_USER_ID until the account-lookup "
                "endpoint is confirmed against a live account (see API.md)",
                file=sys.stderr,
            )
            sys.exit(1)

    print("=== Installations ===")
    installations = get_installations(id_user, token, token_scheme)
    if not installations:
        print("  (none returned)")
        return

    for site in installations:
        print(f"  {site.get('idSite')}: {site.get('name')} ({site.get('identifier')})")

    first_site_id = installations[0].get("idSite")
    print(f"\n=== Diagnostics (site {first_site_id}) ===")
    records = get_diagnostics(first_site_id, token, token_scheme)
    for rec in records:
        print(
            f"  instance={rec.get('instance')} code={rec.get('code')} "
            f"value={rec.get('formattedValue')} ({rec.get('description')})"
        )


if __name__ == "__main__":
    main()
