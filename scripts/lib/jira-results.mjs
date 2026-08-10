const TEST_ID = /\bTA-[A-Z][A-Z0-9]*-\d+-\d{2}\b/g;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function decodeXml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function attribute(source, name) {
  const match = source.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

export function parseJUnit(junit) {
  const results = [];
  const suites = [...junit.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g)];
  assert(suites.length > 0, 'JUnit report contains no test suites');

  for (const [, suiteAttributes, suiteBody] of suites) {
    const profile = attribute(suiteAttributes, 'hostname');
    assert(profile, 'Every JUnit test suite must identify its browser profile in hostname');
    const cases = [...suiteBody.matchAll(/<testcase\b([^>]*)(?:\/>|>([\s\S]*?)<\/testcase>)/g)];

    for (const [, caseAttributes, caseBody = ''] of cases) {
      const name = attribute(caseAttributes, 'name') ?? '';
      const ids = [...name.matchAll(TEST_ID)].map(([id]) => id);
      assert(ids.length === 1, `JUnit test case must contain exactly one stable test ID: ${name || '(unnamed)'}`);
      const status = /<(failure|error)\b/.test(caseBody)
        ? 'FAILED'
        : /<skipped\b/.test(caseBody)
          ? 'SKIPPED'
          : 'PASSED';
      results.push({ id: ids[0], name, profile, status });
    }
  }

  assert(results.length > 0, 'JUnit report contains no test cases');
  return results;
}

export function validateMapping(mapping) {
  assert(mapping && Array.isArray(mapping.cases), 'Mapping must contain a cases array');
  const ids = new Set();
  const jiraKeys = new Set();

  for (const item of mapping.cases) {
    assert(item.id && item.jiraKey && item.story, 'Every mapping needs id, jiraKey, and story');
    assert(!ids.has(item.id), `Duplicate mapping for ${item.id}`);
    assert(!jiraKeys.has(item.jiraKey), `Jira task ${item.jiraKey} is mapped more than once`);
    assert(Array.isArray(item.execution) && item.execution.length > 0, `${item.id} has no execution environment`);
    assert(Array.isArray(item.profiles) && item.profiles.length > 0, `${item.id} has no browser profile`);
    ids.add(item.id);
    jiraKeys.add(item.jiraKey);
  }

  return new Map(mapping.cases.map((item) => [item.id, item]));
}

export function collectExecutionResults({ mapping, junit, execution }) {
  assert(execution, 'TEST_EXECUTION is required');
  const mapped = validateMapping(mapping);
  const parsed = parseJUnit(junit);
  const expected = mapping.cases.filter((item) => item.execution.includes(execution));
  assert(expected.length > 0, `No test cases are mapped to execution environment ${execution}`);
  const expectedIds = new Set(expected.map((item) => item.id));
  const seenProfile = new Set();

  for (const result of parsed) {
    assert(mapped.has(result.id), `JUnit contains unknown test ID ${result.id}`);
    assert(expectedIds.has(result.id), `${result.id} is not mapped to execution environment ${execution}`);
    const unique = `${result.id}:${result.profile}`;
    assert(!seenProfile.has(unique), `JUnit contains duplicate result for ${result.id} on ${result.profile}`);
    seenProfile.add(unique);
    const item = mapped.get(result.id);
    if (result.status !== 'SKIPPED') {
      assert(item.profiles.includes(result.profile), `${result.id} executed on unexpected profile ${result.profile}`);
    }
  }

  const grouped = new Map();
  for (const item of expected) grouped.set(item.id, []);
  for (const result of parsed) grouped.get(result.id).push(result);

  return expected.map((item) => {
    const cases = grouped.get(item.id);
    assert(cases.length > 0, `JUnit is missing mapped test ID ${item.id}`);
    const outcome = cases.some((item) => item.status === 'FAILED')
      ? 'FAILED'
      : cases.some((item) => item.status === 'PASSED')
        ? 'PASSED'
        : 'SKIPPED';
    const executedProfiles = [...new Set(cases.filter((item) => item.status !== 'SKIPPED').map((item) => item.profile))];
    return {
      ...item,
      outcome,
      profiles: executedProfiles.length ? executedProfiles : [...new Set(cases.map((item) => item.profile))],
    };
  });
}

function text(value, href) {
  const node = { type: 'text', text: String(value) };
  if (href) node.marks = [{ type: 'link', attrs: { href } }];
  return node;
}

function paragraph(...content) {
  return { type: 'paragraph', content };
}

function listItem(label, value, href) {
  return {
    type: 'listItem',
    content: [paragraph(text(`${label}: `), text(value, href))],
  };
}

export function buildComment({ result, context }) {
  const marker = `[travel-test-result:${context.runId}:${context.runAttempt}:${result.id}]`;
  const refLabel = context.pullRequest ? `Pull request #${context.pullRequest}` : context.ref;
  const refUrl = context.pullRequest
    ? `${context.repositoryUrl}/pull/${context.pullRequest}`
    : `${context.repositoryUrl}/tree/${encodeURIComponent(context.ref)}`;
  const artifactNames = context.artifactNames.join(', ');

  return {
    marker,
    body: {
      type: 'doc',
      version: 1,
      content: [
        paragraph(text(marker)),
        { type: 'heading', attrs: { level: 3 }, content: [text(`Automated execution: ${result.outcome}`)] },
        {
          type: 'bulletList',
          content: [
            listItem('Test', result.id),
            listItem('Commit', context.sha.slice(0, 12), `${context.repositoryUrl}/commit/${context.sha}`),
            listItem('Ref', refLabel, refUrl),
            listItem('Workflow', `${context.workflow} #${context.runNumber}`, context.runUrl),
            listItem('Environment', context.environment),
            listItem('Browser profile(s)', result.profiles.join(', ')),
            listItem('Started', context.startedAt),
            listItem('Finished', context.finishedAt),
            listItem('Retry', context.runAttempt),
            listItem('Artifacts', artifactNames, `${context.runUrl}#artifacts`),
          ],
        },
      ],
    },
  };
}

function requireEnvironment(env, names) {
  for (const name of names) assert(env[name], `${name} is required`);
}

async function jiraJson(fetchImpl, url, options, operation) {
  const response = await fetchImpl(url, options);
  if (!response.ok) {
    throw new Error(`${operation} failed with Jira HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function findComment({ fetchImpl, baseUrl, jiraKey, marker, headers }) {
  let startAt = 0;
  do {
    const page = await jiraJson(
      fetchImpl,
      `${baseUrl}/rest/api/3/issue/${jiraKey}/comment?startAt=${startAt}&maxResults=100`,
      { headers },
      `Read comments for ${jiraKey}`,
    );
    const existing = page.comments.find((comment) => JSON.stringify(comment.body).includes(marker));
    if (existing) return existing;
    startAt += page.comments.length;
    if (startAt >= page.total || page.comments.length === 0) return null;
  } while (true);
}

export async function publishResults({ mapping, junit, env, fetchImpl = fetch }) {
  const jobStatus = env.TEST_JOB_STATUS?.toLowerCase();
  if (['cancelled', 'skipped'].includes(jobStatus) || env.TEST_AUTHORITATIVE === 'false') {
    return { skipped: true, reason: 'run is cancelled, skipped, or superseded' };
  }
  assert(['success', 'failure'].includes(jobStatus), 'TEST_JOB_STATUS must be success or failure');
  assert(env.TEST_EVIDENCE_SOURCE !== 'manual', 'Manual evidence must not be published by the automated reporter');
  requireEnvironment(env, [
    'JIRA_BASE_URL',
    'JIRA_EMAIL',
    'JIRA_API_TOKEN',
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_NUMBER',
    'GITHUB_SHA',
    'GITHUB_WORKFLOW',
    'TEST_EXECUTION',
    'TEST_ENVIRONMENT',
    'TEST_STARTED_AT',
  ]);

  const results = collectExecutionResults({ mapping, junit, execution: env.TEST_EXECUTION });
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const repositoryUrl = `https://github.com/${env.GITHUB_REPOSITORY}`;
  const runUrl = `${repositoryUrl}/actions/runs/${env.GITHUB_RUN_ID}`;
  const authorization = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
  const headers = { Accept: 'application/json', Authorization: `Basic ${authorization}`, 'Content-Type': 'application/json' };
  const context = {
    repositoryUrl,
    runUrl,
    runId: env.GITHUB_RUN_ID,
    runNumber: env.GITHUB_RUN_NUMBER,
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? '1',
    sha: env.GITHUB_SHA,
    ref: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || 'unknown',
    pullRequest: env.GITHUB_PR_NUMBER || '',
    workflow: env.GITHUB_WORKFLOW,
    environment: env.TEST_ENVIRONMENT,
    startedAt: env.TEST_STARTED_AT,
    finishedAt: new Date().toISOString(),
    artifactNames: (env.TEST_ARTIFACT_NAMES ?? 'JUnit XML, Playwright HTML report').split(',').map((item) => item.trim()),
  };

  for (const result of results) {
    const comment = buildComment({ result, context });
    const existing = await findComment({ fetchImpl, baseUrl, jiraKey: result.jiraKey, marker: comment.marker, headers });
    const endpoint = existing
      ? `${baseUrl}/rest/api/3/issue/${result.jiraKey}/comment/${existing.id}`
      : `${baseUrl}/rest/api/3/issue/${result.jiraKey}/comment`;
    await jiraJson(
      fetchImpl,
      endpoint,
      { method: existing ? 'PUT' : 'POST', headers, body: JSON.stringify({ body: comment.body }) },
      `Publish ${result.id} to ${result.jiraKey}`,
    );
  }

  return { skipped: false, published: results.length };
}
