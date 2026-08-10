# Trailbook travel app

An offline-first, installable travel itinerary for Android and the web. Trailbook renders versioned JSON itineraries, keeps downloaded and imported trips on-device, opens ordered places and routes in Google Maps, and shares immutable GitHub Pages-safe deep links.

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

## GitHub and Jira reporting

Set **Settings → Pages → Source** to **GitHub Actions**. The Pages workflow deploys pushes to the default branch and runs post-deployment Chromium and Android-profile smoke tests.

Jira validation and execution comments are enabled when `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` repository secrets exist. Traceability lives in `test-cases.json`; stable IDs must occur exactly once in the Playwright titles. CI optionally confirms that each mapped Jira task exists, has the `test-case` label, and relates to its Story.

The reporter publishes one idempotent comment per automated stable ID with the result, commit, branch or pull request, workflow run, artifacts, browser profiles, environment, timestamps, and retry. Physical Android cases remain manual and are never reported as automated.
