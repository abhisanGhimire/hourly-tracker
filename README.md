# Hourly Activity Log (PWA)

Offline-first web app: **log each hour in your own time**—no popups. **Local storage** only, **day table** (24 rows), **All days** list with previews, **PDF** export, **install** on Android (Chrome).

## Run locally

Serve over **HTTP(S)** (required for service worker). From this folder:

```bash
npx --yes serve -l 8080 .
```

Open `http://localhost:8080` (or your LAN IP from the phone on the same Wi‑Fi).

## Install on Android (Chrome)

1. Open the site in **Chrome**.
2. **Menu → Install app** or **Add to Home screen**.

## Notes

- **Data** lives in the browser’s **local storage** (and survives offline after first load). Clearing site data or uninstalling removes logs.
- **No hourly popups**—type in the table whenever you want. Optional **Skip** checkbox per hour.
- **PDF** needs the jsPDF script once online; it is cached for later offline use.

## Privacy

No server, no analytics, no cloud sync—everything stays on the device.
