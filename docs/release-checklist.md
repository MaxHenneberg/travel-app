# Trailbook Android release checklist

Run this checklist for each release candidate against the real GitHub Pages deployment on a physical, supported Android phone. Record device, Android/Chrome versions, deployed commit, URL, tester, timestamp, and PASS/FAIL evidence in Jira test case **TA-TRAVEL-12-04** (TRAVEL-49). This case is manual release evidence and must never be reported by the automated Playwright/JUnit reporter.

## Preconditions

- Use the exact release commit deployed below `/travel-app/`, not a local server or PR preview.
- Start online with an empty browser profile and keep a valid local schema-v1 itinerary file available in Android Files.
- Use realistic trip data with multiple days, map-capable stops, long labels, and at least one day without optional detail.

## Physical Android checks

- [ ] **Hello World deployment:** open the deployed root, confirm Trailbook renders, refresh it, and confirm there are no broken assets or console-equivalent browser errors.
- [ ] **JSON load:** open the published Lisbon trip and confirm its title, overview, dates, and activities match the deployed JSON.
- [ ] **Day navigation:** move between every day using touch and keyboard/switch access where available; confirm the URL, selected state, heading, and content stay synchronized.
- [ ] **Maps links:** open one place and one route link; confirm Android hands off a correctly ordered destination/route to Google Maps without losing Trailbook state.
- [ ] **Install:** install Trailbook from Chrome, launch it from the home screen, and confirm standalone presentation, icon, name, start URL, and repository scope.
- [ ] **Offline reopen:** after opening a populated day online, close Trailbook, disable connectivity, relaunch it from the home screen, and confirm the same day and locally retained data remain readable.
- [ ] **Local import:** import the prepared JSON through Android Files, confirm it is validated and rendered, then reload and confirm the trip persists only on the device.
- [ ] **Accessibility/quality:** check portrait and landscape at Android-phone sizes, 200% text, visible focus, TalkBack names/order, reduced-motion preference, touch targets, contrast, wrapping, and absence of horizontal scrolling.
- [ ] **Update:** while viewing a populated day, deploy the approved follow-up build; confirm the polite update notice does not move focus or interrupt the itinerary, “Later” keeps the current version usable, and “Update now” reloads one internally consistent build that also reopens offline.

Any failed row blocks release. Attach screenshots/video and exact reproduction details; do not convert this physical-device case into automated evidence.
