import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const assets = 'dist/assets';
const files = await readdir(assets);
const scripts = files.filter((name) => name.endsWith('.js'));
for (const name of scripts) {
  const bytes = (await stat(join(assets, name))).size;
  const budget = name.startsWith('DayOverviewMap-') ? 160 * 1024 : 110 * 1024;
  if (bytes > budget) throw new Error(name + ' exceeds the ' + (budget / 1024) + ' KiB per-chunk budget (' + bytes + ' bytes).');
}
const html = await readFile('dist/index.html', 'utf8');
for (const feature of ['MapFeature', 'GlobeFallback', 'DayOverviewMap']) {
  if (html.includes(feature)) throw new Error(`${feature} must not be requested by the initial document.`);
  if (!scripts.some((name) => name.startsWith(feature))) throw new Error(`${feature} must remain a separately lazy-loaded chunk.`);
}
console.log(`Bundle budgets passed for ${scripts.length} JavaScript chunks.`);
