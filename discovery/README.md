# Discovery

This folder holds reverse-engineered vendor API docs, Python validation scripts, and the **adapter development guide** for adding new inverter brands to the Solar Dashboard.

| File / folder | Description |
|---------------|-------------|
| [**ADAPTER_GUIDE.md**](./ADAPTER_GUIDE.md) | **How to add a new brand** — discovery layout, adapter interface, normalized JSON, Worker registration, tests, CI |
| [**API.md**](./API.md) | ShineMonitor API reference: hosts, auth, signing, endpoints, example responses |
| [**fetch_plant_json.py**](./fetch_plant_json.py) | ShineMonitor Python client (login + sample queries) |
| [**growatt/**](./growatt/) | Growatt API reference + `fetch_data.py` |

---

## ShineMonitor

This section documents how the **ShineMonitor** web portal ([www.shinemonitor.com](https://www.shinemonitor.com/)) loads plant data, so you can pull the same information as JSON without driving the browser.

## Quick start

1. Set credentials (never commit real passwords):

   ```bash
   export SHINE_USER='your_username'
   export SHINE_PASSWORD='your_password'
   ```

2. Optional: `SHINE_PLANT_ID` (override the default plant id in the script), `SHINE_LANG` (default `en_US`).

3. Run:

   ```bash
   python3 discovery/fetch_plant_json.py
   ```

4. For the **full** 5‑minute power series for today (large JSON):

   ```bash
   export SHINE_INCLUDE_DAY_SERIES=1
   python3 discovery/fetch_plant_json.py
   ```

Output is a single JSON object: plant list metadata, `queryPlantCurrentData` metrics (`CURRENT_POWER`, `BATTERY_SOC`, etc.), and either a short summary or the full day series.

## Background

- The original hostname **`http://smartclient.eybond.com`** did not resolve publicly (DNS `NXDOMAIN`); the working cloud UI for this stack is **ShineMonitor** over **HTTPS**.
- Data plane: **`https://web.shinemonitor.com/public/`** — GET requests with `sign`, `salt`, and after login `token`.
- Auth uses **SHA1** of the password (hex), then **SHA1** over concatenated fields; authenticated calls use `secret` + `token` from the auth response. Details and examples are in [API.md](./API.md).

## Security

- Treat `token` / `secret` like session credentials; they expire (see `expire` in auth `dat`).
- Prefer environment variables or a secrets manager over hard-coding passwords in scripts or git.
- Rotate passwords if they have appeared in chat, logs, or shared terminals.

## Next steps (project)

- **Part 2:** Map `CURRENT_POWER`, optional `BATTERY_SOC`, and any **load** / **battery voltage** fields from device-level APIs (if needed when plant-level `BATTERY_SOC` is `-1`) into a small dashboard.

For every endpoint and copy-pasteable JSON samples, use **[API.md](./API.md)**.
