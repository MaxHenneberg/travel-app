import assert from 'node:assert/strict';
import test from 'node:test';

import { commonsApiUrl, parseCommonsResponse, safeImageUrl, validStopImages } from '../../src/lib/stop-images.js';

test('filters malformed and insecure image metadata without leaking credentials', () => {
  assert.equal(safeImageUrl('http://example.test/a.jpg'), null);
  assert.equal(safeImageUrl('https://user:secret@example.test/a.jpg'), null);
  assert.deepEqual(validStopImages([
    null,
    { url: 'javascript:alert(1)', alt: 'Unsafe' },
    { provider: 'unknown', commonsQuery: 'place', alt: 'Unsafe' },
    { url: 'https://example.test/a.jpg', alt: '', sourceUrl: 'http://example.test' },
  ]), [{ url: 'https://example.test/a.jpg', apiUrl: null, alt: '', caption: '', credit: '', sourceUrl: null }]);
});

test('builds keyless Wikimedia Commons file and search API URLs', () => {
  const file = new URL(commonsApiUrl({ provider: 'wikimediaCommons', commonsFile: 'Example.jpg' }));
  assert.equal(file.origin, 'https://commons.wikimedia.org');
  assert.equal(file.searchParams.get('origin'), '*');
  assert.equal(file.searchParams.get('titles'), 'File:Example.jpg');
  const search = new URL(commonsApiUrl({ provider: 'wikimediaCommons', commonsQuery: 'MAAT Lisbon riverfront' }));
  assert.equal(search.searchParams.get('generator'), 'search');
  assert.equal(search.searchParams.get('gsrnamespace'), '6');
  assert.equal(search.searchParams.get('gsrsearch'), 'MAAT Lisbon riverfront');
});

test('extracts safe thumbnail, attribution, description and source metadata', () => {
  assert.deepEqual(parseCommonsResponse({ query: { pages: [{ imageinfo: [{
    thumburl: 'https://upload.wikimedia.org/example.jpg',
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
    extmetadata: { ImageDescription: { value: '&lt;a href=&quot;https://example.test&quot;&gt;Riverfront museum&lt;/a&gt;' }, Artist: { value: 'Jane &amp; John' } },
  }] }] } }, 'Museum exterior'), {
    url: 'https://upload.wikimedia.org/example.jpg', alt: 'Museum exterior', caption: 'Riverfront museum',
    credit: 'Jane & John', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
  });
});
