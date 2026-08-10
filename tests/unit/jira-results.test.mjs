import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildComment, collectExecutionResults, parseJUnit, publishResults } from '../../scripts/lib/jira-results.mjs';

const mapping = {
  story: 'TRAVEL-3',
  cases: [
    { id: 'TA-TRAVEL-3-01', jiraKey: 'TRAVEL-18', story: 'TRAVEL-3', execution: ['pull-request'], profiles: ['chromium', 'android-chrome'] },
    { id: 'TA-TRAVEL-3-02', jiraKey: 'TRAVEL-19', story: 'TRAVEL-3', execution: ['post-deploy'], profiles: ['chromium'] },
  ],
};

function junit(cases) {
  return `<testsuites><testsuite hostname="chromium">${cases.join('')}</testsuite></testsuites>`;
}

test('parses stable IDs and JUnit outcomes', () => {
  const parsed = parseJUnit(junit([
    '<testcase name="TA-TRAVEL-3-01 works"></testcase>',
    '<testcase name="TA-TRAVEL-3-02 skipped"><skipped /></testcase>',
  ]));
  assert.deepEqual(parsed.map(({ id, status, profile }) => ({ id, status, profile })), [
    { id: 'TA-TRAVEL-3-01', status: 'PASSED', profile: 'chromium' },
    { id: 'TA-TRAVEL-3-02', status: 'SKIPPED', profile: 'chromium' },
  ]);
});

test('aggregates passed, failed, and skipped outcomes from actual profiles', () => {
  const failed = collectExecutionResults({
    mapping,
    execution: 'pull-request',
    junit: junit(['<testcase name="TA-TRAVEL-3-01 fails"><failure message="boom" /></testcase>']),
  });
  assert.equal(failed[0].outcome, 'FAILED');
  assert.deepEqual(failed[0].profiles, ['chromium']);

  const skipped = collectExecutionResults({
    mapping,
    execution: 'pull-request',
    junit: junit(['<testcase name="TA-TRAVEL-3-01 skipped"><skipped /></testcase>']),
  });
  assert.equal(skipped[0].outcome, 'SKIPPED');
  assert.deepEqual(skipped[0].profiles, ['chromium']);
});

test('fails on unknown, missing, and duplicate execution evidence', () => {
  assert.throws(
    () => collectExecutionResults({ mapping, execution: 'pull-request', junit: junit(['<testcase name="TA-TRAVEL-99-01 unknown" />']) }),
    /unknown test ID/,
  );
  assert.throws(
    () => collectExecutionResults({ mapping, execution: 'pull-request', junit: junit(['<testcase name="TA-TRAVEL-3-02 wrong environment" />']) }),
    /not mapped to execution environment/,
  );
  assert.throws(
    () => collectExecutionResults({
      mapping,
      execution: 'pull-request',
      junit: junit(['<testcase name="TA-TRAVEL-3-01 first" />', '<testcase name="TA-TRAVEL-3-01 duplicate" />']),
    }),
    /duplicate result/,
  );
});

test('builds linked, rerun-specific Jira comments', () => {
  const { marker, body } = buildComment({
    result: { id: 'TA-TRAVEL-3-01', outcome: 'PASSED', profiles: ['chromium'] },
    context: {
      repositoryUrl: 'https://github.com/example/travel-app',
      runUrl: 'https://github.com/example/travel-app/actions/runs/42',
      runId: '42', runNumber: '7', runAttempt: '2', sha: '1234567890abcdef', ref: 'feature/TRAVEL-17', pullRequest: '5',
      workflow: 'Integration tests', environment: 'pull-request', startedAt: '2026-08-10T10:00:00Z', finishedAt: '2026-08-10T10:01:00Z',
      artifactNames: ['playwright-pr-2'],
    },
  });
  assert.equal(marker, '[travel-test-result:42:2:TA-TRAVEL-3-01]');
  const serialized = JSON.stringify(body);
  assert.match(serialized, /https:\/\/github.com\/example\/travel-app\/commit\/1234567890abcdef/);
  assert.match(serialized, /https:\/\/github.com\/example\/travel-app\/pull\/5/);
  assert.match(serialized, /actions\/runs\/42#artifacts/);
});

test('creates then idempotently updates the same Jira comment', async () => {
  const requests = [];
  let existing = false;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if ((options.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({
        comments: existing ? [{ id: '99', body: { content: [{ text: '[travel-test-result:42:1:TA-TRAVEL-3-01]' }] } }] : [],
        total: existing ? 1 : 0,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    existing = true;
    return new Response(JSON.stringify({ id: '99' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const env = {
    JIRA_BASE_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'bot@example.com', JIRA_API_TOKEN: 'secret',
    GITHUB_REPOSITORY: 'example/travel-app', GITHUB_RUN_ID: '42', GITHUB_RUN_NUMBER: '7', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: '1234567890abcdef', GITHUB_WORKFLOW: 'Integration tests', GITHUB_HEAD_REF: 'feature/TRAVEL-17', GITHUB_PR_NUMBER: '5',
    TEST_EXECUTION: 'pull-request', TEST_ENVIRONMENT: 'pull-request production preview', TEST_STARTED_AT: '2026-08-10T10:00:00Z',
    TEST_JOB_STATUS: 'success', TEST_ARTIFACT_NAMES: 'playwright-pr-1',
  };
  const report = junit(['<testcase name="TA-TRAVEL-3-01 works" />']);

  await publishResults({ mapping, junit: report, env, fetchImpl });
  await publishResults({ mapping, junit: report, env, fetchImpl });

  assert.equal(requests.filter(({ options }) => options.method === 'POST').length, 1);
  assert.equal(requests.filter(({ options }) => options.method === 'PUT').length, 1);
  assert.ok(requests.every(({ url }) => !url.includes('secret')));
});

test('skips cancelled and superseded runs without contacting Jira', async () => {
  let called = false;
  const result = await publishResults({
    mapping,
    junit: junit(['<testcase name="TA-TRAVEL-3-01 works" />']),
    env: { TEST_JOB_STATUS: 'cancelled' },
    fetchImpl: async () => { called = true; },
  });
  assert.equal(result.skipped, true);
  assert.equal(called, false);
});
