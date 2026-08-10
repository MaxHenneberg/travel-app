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

Jira validation and execution comments are enabled when these repository secrets exist: `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`. Use a least-privilege Jira service account with browse-project and add-comment access. Invalid credentials and Jira API failures fail the reporting step without printing credentials.

Traceability lives in `test-cases.json`; stable IDs must occur exactly once in the Playwright test titles. CI optionally confirms that every mapped Jira task exists, carries the `test-case` label, and relates to TRAVEL-3.

### Jira execution evidence

The automated reporter reads the retained Playwright JUnit file and fails closed when an ID is missing, duplicated, unknown, assigned to the wrong execution environment, or run on an unexpected browser profile. It posts one comment per executed stable ID using standard Jira Cloud REST endpoints. Each comment contains linked commit, pull request or branch, workflow run, retained artifacts, the actual browser profiles, outcome, environment, timestamps, and retry number.

The idempotency key is the GitHub run ID, run attempt, and stable test ID. Re-running the reporter in one attempt updates the existing comment; a new attempt creates distinct evidence. Cancelled or superseded runs are not published. Pull requests from forks run without Jira secrets and skip the reporting step.

Environment names remain explicit: `pull-request production preview` and `github-pages` are automated. Release workflows should use a `release` execution mapping and a release-specific `TEST_ENVIRONMENT`. Physical Android evidence is manual, must be added by a human or a dedicated manual workflow, and is rejected by the automated reporter when `TEST_EVIDENCE_SOURCE=manual`.
