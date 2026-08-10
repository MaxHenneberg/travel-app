# Travel app

A deliberately small deployment baseline for TRAVEL-3. The production bundle is safe to host below a GitHub Pages repository path and includes automated Chromium and Android-profile smoke coverage.

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

## GitHub setup

Set **Settings → Pages → Source** to **GitHub Actions**. The Pages workflow deploys pushes to the repository's default branch, then runs the post-deployment Chromium and Android-profile smoke tests.

Jira validation and execution comments are enabled when these repository secrets exist: `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`. Use a least-privilege Jira service account with browse-project and add-comment access.

Traceability lives in `test-cases.json`; stable IDs must occur exactly once in the Playwright test titles. CI optionally confirms that every mapped Jira task exists, carries the `test-case` label, and relates to TRAVEL-3.
