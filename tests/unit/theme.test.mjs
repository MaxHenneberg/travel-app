import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY, applyTheme, readStoredTheme, resolveThemeId, themes } from '../../src/lib/theme.js';

test('theme registry exposes stable extensible identifiers', () => {
  assert.deepEqual(themes.map(({ id }) => id), ['sakura', 'neon-japan']);
  assert.equal(new Set(themes.map(({ id }) => id)).size, themes.length);
});

test('unsupported and malformed stored values fall back safely', () => {
  for (const value of [null, '', 'unknown', '{broken']) assert.equal(resolveThemeId(value), DEFAULT_THEME_ID);
  assert.equal(readStoredTheme({ getItem: () => { throw new Error('denied'); } }), DEFAULT_THEME_ID);
});

test('applyTheme updates document state and persists only a valid identifier', () => {
  const writes = [];
  const meta = { content: '' };
  const root = { dataset: {}, style: {}, ownerDocument: { querySelector: () => meta } };
  const theme = applyTheme('neon-japan', { root, storage: { setItem: (...args) => writes.push(args) } });
  assert.equal(theme.id, 'neon-japan');
  assert.equal(root.dataset.theme, 'neon-japan');
  assert.equal(root.style.colorScheme, 'dark');
  assert.deepEqual(writes, [[THEME_STORAGE_KEY, 'neon-japan']]);
});
