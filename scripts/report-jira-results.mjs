import { readFile } from 'node:fs/promises';
import { publishResults } from './lib/jira-results.mjs';

const mapping = JSON.parse(await readFile(new URL('../test-cases.json', import.meta.url), 'utf8'));
const junit = await readFile(new URL('../test-results/junit.xml', import.meta.url), 'utf8');
const summary = await publishResults({ mapping, junit, env: process.env });

if (summary.skipped) {
  console.log(`Jira reporting skipped: ${summary.reason}`);
} else {
  console.log(`Published ${summary.published} test result(s) to Jira.`);
}
