# Release Notes

## Unreleased

## v1.1.0

- Add skeleton shimmer loading state on all card values and progress bars during
  first load and when switching between systems.
- Add pull-to-refresh gesture on the dashboard with visual arrow indicator.
- Use plant timezone offset for device data date queries instead of UTC.
- Add fallback to yesterday's date when today's device data is not yet available.

## v1.0.0

Initial release of the Solar Dashboard.

### Dashboard
- Real-time monitoring cards for Battery (SOC, voltage, current, charge rate),
  Solar (power, PV voltage), Load (power, percent), and Generator (status, power, voltage).
- Energy flow diagram view with animated paths showing power direction between
  solar, battery, generator, and house.
- Cards / Flow view toggle with persistent preference.
- Auto-login via URL query parameters (`proxy`, `token`) for home-screen bookmarks.

### Multi-system support
- Cloudflare Worker proxy with token-based authentication.
- Add, remove, and switch between multiple solar systems.
- ShineMonitor and Growatt service adapters with normalized data output.
- System discovery: automatic detection of plants, devices, and nominal power.

### Infrastructure
- Static frontend (HTML/CSS/JS) with no build step.
- Cloudflare Worker backend with KV storage for system credentials and session
  caching.
- 60-second polling interval with connection status indicator.
