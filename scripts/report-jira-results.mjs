import { readFile } from 'node:fs/promises';

const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_SHA'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const mapping = JSON.parse(await readFile(new URL('../test-cases.json', import.meta.url), 'utf8'));
const junit = await readFile(new URL('../test-results/junit.xml', import.meta.url), 'utf8');
const authorization = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
const runUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const headers = { Accept: 'application/json', Authorization: `Basic ${authorization}`, 'Content-Type': 'application/json' };

function resultFor(id) {
  const cases = [...junit.matchAll(/<testcase\b[\s\S]*?<\/testcase>|<testcase\b[^>]*\/>/g)].filter(([xml]) => xml.includes(id));
  if (!cases.length) return null;
  return cases.some(([xml]) => /<(failure|error)\b/.test(xml)) ? 'FAILED' : cases.every(([xml]) => /<skipped\b/.test(xml)) ? 'SKIPPED' : 'PASSED';
}

for (const testCase of mapping.cases) {
  const result = resultFor(testCase.id);
  if (!result) continue;
  const marker = `<!-- travel-test-result:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT ?? '1'}:${testCase.id} -->`;
  const body = `${marker}\n### Automated execution: ${result}\n\n- Test: ${testCase.id}\n- Commit: \`${process.env.GITHUB_SHA}\`\n- Ref: \`${process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'unknown'}\`\n- Environment: ${process.env.TEST_ENVIRONMENT ?? 'CI production preview'}\n- Browser profile(s): ${testCase.profiles.join(', ')}\n- Started: ${process.env.TEST_STARTED_AT ?? 'recorded by GitHub Actions'}\n- Finished: ${new Date().toISOString()}\n- Retry: ${process.env.GITHUB_RUN_ATTEMPT ?? '1'}\n- [Workflow run](${runUrl})\n- [JUnit and Playwright artifacts](${runUrl}#artifacts)`;
  const commentsResponse = await fetch(`${process.env.JIRA_BASE_URL}/rest/api/3/issue/${testCase.jiraKey}/comment?maxResults=100`, { headers });
  if (!commentsResponse.ok) throw new Error(`Could not read comments for ${testCase.jiraKey}: ${commentsResponse.status}`);
  const comments = await commentsResponse.json();
  const existing = comments.comments.find((comment) => JSON.stringify(comment.body).includes(marker));
  const endpoint = existing
    ? `${process.env.JIRA_BASE_URL}/rest/api/3/issue/${testCase.jiraKey}/comment/${existing.id}`
    : `${process.env.JIRA_BASE_URL}/rest/api/3/issue/${testCase.jiraKey}/comment`;
  const response = await fetch(endpoint, {
    method: existing ? 'PUT' : 'POST',
    headers,
    body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] } }),
  });
  if (!response.ok) throw new Error(`Could not report ${testCase.id} to ${testCase.jiraKey}: ${response.status}`);
}
