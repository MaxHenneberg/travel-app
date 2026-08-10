import { readFile, readdir } from 'node:fs/promises';

const mapping = JSON.parse(await readFile(new URL('../test-cases.json', import.meta.url), 'utf8'));
const specDirectory = new URL('../tests/integration/', import.meta.url);
const specFiles = (await readdir(specDirectory, { recursive: true })).filter((name) => name.endsWith('.spec.js'));
const spec = (await Promise.all(specFiles.map((name) => readFile(new URL(name.replaceAll('\\', '/'), specDirectory), 'utf8')))).join('\n');
const expectedId = /^TA-(TRAVEL-\d+)-(\d{2})$/;
const seenIds = new Set();
const seenJiraKeys = new Set();
const stories = new Set(mapping.stories ?? (mapping.story ? [mapping.story] : []));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const testCase of mapping.cases) {
  const match = testCase.id.match(expectedId);
  assert(match, `Invalid stable test ID: ${testCase.id}`);
  assert(!seenIds.has(testCase.id), `Duplicate stable test ID: ${testCase.id}`);
  assert(!seenJiraKeys.has(testCase.jiraKey), `Jira task mapped more than once: ${testCase.jiraKey}`);
  assert(stories.has(testCase.story), `${testCase.id} references undeclared Story ${testCase.story}`);
  assert(match[1] === testCase.story, `${testCase.id} encodes a different Story from ${testCase.story}`);
  assert((spec.match(new RegExp(testCase.id, 'g')) ?? []).length === 1, `${testCase.id} must appear exactly once in the Playwright spec`);
  seenIds.add(testCase.id);
  seenJiraKeys.add(testCase.jiraKey);
}

const specIds = [...spec.matchAll(/TA-TRAVEL-\d+-\d{2}/g)].map(([id]) => id);
for (const id of new Set(specIds)) {
  assert(seenIds.has(id), `Playwright contains an unmapped test ID: ${id}`);
}

if (process.argv.includes('--jira')) {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
  for (const name of required) assert(process.env[name], `${name} is required for Jira validation`);
  const authorization = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');

  for (const testCase of mapping.cases) {
    const response = await fetch(`${process.env.JIRA_BASE_URL}/rest/api/3/issue/${testCase.jiraKey}?fields=summary,labels,issuelinks`, {
      headers: { Accept: 'application/json', Authorization: `Basic ${authorization}` },
    });
    assert(response.ok, `${testCase.id} references unknown Jira task ${testCase.jiraKey} (${response.status})`);
    const issue = await response.json();
    assert(issue.fields.summary.includes(testCase.id), `${testCase.jiraKey} summary does not contain ${testCase.id}`);
    assert(issue.fields.labels.includes('test-case'), `${testCase.jiraKey} is missing the test-case label`);
    const links = issue.fields.issuelinks.flatMap((link) => [link.inwardIssue?.key, link.outwardIssue?.key]);
    assert(links.includes(testCase.story), `${testCase.jiraKey} is not linked to ${testCase.story}`);
  }
}

console.log(`Traceability validated for ${mapping.cases.length} test cases${process.argv.includes('--jira') ? ' against Jira' : ''}.`);
