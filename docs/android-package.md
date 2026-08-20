# Trailbook Android package

The `android/` project is a deliberately small WebView wrapper around the same deployed Trailbook application. It adds Android `ACTION_VIEW` file association without adding an Android-side itinerary parser. The package is installable as a debug APK from CI; release distribution remains gated on product approval and signing ownership.

## Security and import flow

The exported activity advertises only `content://` URIs for the Trailbook MIME type and the two documented fallback MIME types (`application/octet-stream` and `application/json`). Android cannot safely combine a filename filter with arbitrary content-provider authorities: URI path matching requires a concrete host and a provider URI path is not the user-visible filename. The fallback MIME filters therefore remain provider-neutral, while the native policy requires the provider's `OpenableColumns.DISPLAY_NAME` to end in `.trailbook` before reading any bytes. It does not register `*/*`, `file://`, HTTP(S) app links, or broad storage access. The manifest grants only `INTERNET`.

At runtime the activity obtains the provider display name and size, rejects path-like names, unapproved MIME types, empty files, and declared files above 2 MiB, then copies at most 2 MiB through `ContentResolver.openInputStream`. It never resolves or reads a filesystem path. The bytes are delivered only after the WebView has loaded the pinned HTTPS origin and project path. JavaScript is never accepted from Android; the native payload is data encoded by `JSONObject` and Base64.

The web adapter creates a `File` and passes it to TRAVEL-95's `validateImportTransport`, `putPendingImport`, `claimPendingImport`, and `validateTrailbookImport` flow. The same schema-v1 validation, active-content checks, deduplication, preview, explicit confirmation, cancel behavior, and replace/keep-both conflict choices therefore apply. Attachments, credentials, HTML, and executable content are not imported or cached.

Cold starts queue the delivery until the app is ready. `singleTop` plus `onNewIntent` handles an already-running activity. Duplicate payloads converge on the existing SHA-256 pending-delivery key. Recreated activities clear the consumed `ACTION_VIEW` intent, avoiding replay. Chooser cancellation does not launch the activity and cannot mutate the collection.

The WebView uses its service worker and cache for offline reopening after one successful online load. External HTTPS navigation leaves the wrapper for the user's browser. TLS failures are not bypassed. If the deployed app cannot load, the dialog offers the normal browser/PWA URL and states that the file was not imported.

## Build and install

Requirements for local package work:

- JDK 17
- Android SDK platform 35 and build-tools 35.0.0
- Gradle 8.9 (CI provisions it; no generated wrapper binary is committed)

Run:

```text
npm run check:android
gradle --no-daemon -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

The application ID is `io.github.maxhenneberg.trailbook`. Version code/name live in `android/app/build.gradle`. Debug APKs are test artifacts only.

## Signing and Digital Asset Links

No keystore, password, signing property, or private key belongs in this repository. A release owner must generate or select the production key, preserve it outside Git, configure the release signing job in an approved secret store, and record the certificate rotation/recovery process.

`android/dal/assetlinks.json.template` declares the required package relationship. Render it with the actual release certificate fingerprint:

```text
TRAILBOOK_ANDROID_SHA256_CERT_FINGERPRINT=AA:BB:... npm run render:assetlinks -- path/to/assetlinks.json
```

Digital Asset Links must be served at `https://maxhenneberg.github.io/.well-known/assetlinks.json` with `application/json`, no redirect, and the exact release certificate fingerprint. This project Pages repository publishes below `/travel-app/`, so a release owner must place the rendered file in the owner-site repository or move the app to a controlled origin. Verify both directions before any TWA conversion or verified-link claim:

```text
keytool -list -v -keystore release.jks -alias trailbook
curl -fsS https://maxhenneberg.github.io/.well-known/assetlinks.json
adb shell pm verify-app-links --re-verify io.github.maxhenneberg.trailbook
adb shell pm get-app-links io.github.maxhenneberg.trailbook
```

Until that production fingerprint and origin-root publication are approved, the package remains the explicit WebView wrapper and the browser/PWA button is the safe fallback. It must not be described as a verified TWA.

## Compatibility and maintenance boundary

| Surface | Supported baseline | Verification |
| --- | --- | --- |
| Android OS | API 26 through target API 35 | CI compile/lint/unit; physical matrix still required |
| Android System WebView | Current supported stable channel | Shared browser tests; physical device still required |
| Trailbook schema | v1 only | Shared TRAVEL-95 validator and integration tests |
| Input | One `.trailbook`, custom MIME or documented fallback MIME | Native policy + shared web validation |
| Storage | Provider-granted `content://` stream only | Manifest/source contract checks |
| Offline | Reopen after one successful cached load | Web integration tests; packaged-device test required |

The Android layer owns intent routing, bounded URI copying, origin pinning, and packaging only. The web application owns parsing, validation, persistence, preview, conflicts, and UI. Do not add a native parser or native trip database. Re-test cold start, warm start, duplicate intent, chooser cancellation, invalid/spoofed/oversized input, offline reopen, and browser fallback on at least one API 26 device/emulator and one current Android device before release.

The Android workflow is separate from `pages.yml` and `pr-preview.yml`. Android SDK availability, signing, or DAL publication can fail or remain unconfigured without preventing the GitHub Pages web build and preview deployment.
