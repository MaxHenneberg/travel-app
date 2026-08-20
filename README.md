# Trailbook travel app

An offline-first, installable travel itinerary for Android and the web. Trailbook renders versioned JSON itineraries, keeps downloaded and imported trips on-device, shows ordered day routes in the app, opens individual places in Google Maps, and shares immutable GitHub Pages-safe deep links.

## Vue architecture and offline lifecycle

Trailbook is a static Vue 3 PWA built with Vite and strict TypeScript. `src/app` owns the Vue shell and hash router; `src/features` contains lazy feature boundaries; `src/composables` owns typed lifecycle behavior; `src/stores` is only for genuinely shared Pinia state; `src/domain` defines schema-v1.1 boundaries; and `src/repositories` owns persistence. The compatibility feature preserves the established DOM, stored values, and IndexedDB contracts while feature slices move to Vue SFCs. New UI uses `<script setup lang="ts">` and keeps feature-local state out of Pinia.

The Workbox `injectManifest` service worker uses explicitly versioned caches. A newly installed worker waits while an existing version controls the page; the accessible Vue update prompt lets the user postpone it or explicitly activate the complete precached build before reloading. Published JSON and bounded public images may be cached; private attachment blobs and pending shared files remain device-local in IndexedDB and never enter a runtime cache or upload path. Share-target files stop at confirmation before validation/import. Optional background work follows document visibility. Map and truthful globe-fallback components remain dynamic imports and are checked by CI bundle budgets.

## Local development

```sh
npm ci
npm run dev
```

The default production base path is `/travel-app/`. Override it for another repository name:

```sh
BASE_PATH=/another-repository/ npm run build
```

Run the same checks used by pull requests:

```sh
npm run build
npx playwright install chromium
npm test
```

## Published itineraries

Immutable revisions live at `public/data/itineraries/{itineraryId}/v{revision}.json` and open through hash routes that survive GitHub Pages refreshes:

```text
#/trip/{itineraryId}/v/{revision}
#/trip/{itineraryId}/v/{revision}/day/{dayId}
```

Route identifiers are restricted to safe path characters. Every fetched or locally imported document is validated before it is displayed or stored. The current schema supports ordered days and activities with local times, durations, descriptions, multiline notes, reservations, costs, transport details, locations, and safe external links.

## Offline and installation

The repository-scoped web manifest and service worker make the deployed app installable and cache the application shell plus successfully loaded same-origin resources. Itineraries are retained by immutable revision in IndexedDB, with graceful local fallbacks. A trip must be opened online once before its deep link can be reopened offline.

Optional stop pictures use either HTTPS metadata or the keyless Wikimedia Commons provider (`provider: "wikimediaCommons"` with one `commonsFile` or precise `commonsQuery`, plus required `alt`). Commons references resolve near the viewport through the official CORS-enabled MediaWiki API (`origin=*`); the thumbnail, description, creator credit, and Commons source page are read from `imageinfo`/`extmetadata`. Resolved metadata is retained in a 48-entry app cache for offline reuse. Pictures are skipped when data saving is enabled, use a no-referrer policy, reserve a 16:9 layout area, and degrade to a stable placeholder. Successfully decoded image responses are kept in `trailbook-stop-images-v1`, capped at 24 entries, 5 MiB per image, and 32 MiB total with deterministic oldest-first eviction. Failed, non-image, opaque, and oversized responses are not retained. Offline rendering never calls the Commons API: it uses cached metadata and image responses when both exist, otherwise it keeps the placeholder without a network attempt.

## GitHub and Jira reporting

Set **Settings → Pages → Source** to **GitHub Actions**. The Pages workflow deploys pushes to the default branch and runs post-deployment Chromium and Android-profile smoke tests.

Jira validation and execution comments are enabled when `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` repository secrets exist. Traceability lives in `test-cases.json`; stable IDs must occur exactly once in the Playwright titles. CI optionally confirms that each mapped Jira task exists, has the `test-case` label, and relates to its Story.

The reporter publishes one idempotent comment per automated stable ID with the result, commit, branch or pull request, workflow run, artifacts, browser profiles, environment, timestamps, and retry. Physical Android cases remain manual and are never reported as automated.

Before a production release, run the [physical Android release checklist](docs/release-checklist.md) against the exact deployed commit. Its install, offline-reopen, local-import, accessibility, and controlled-update evidence belongs to the manual Jira case only.
