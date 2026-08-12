import assert from 'node:assert/strict';
import test from 'node:test';

import { safeImageUrl, validStopImages } from '../../src/lib/stop-images.js';

test('filters malformed and insecure image metadata without leaking credentials', () => {
  assert.equal(safeImageUrl('http://example.test/a.jpg'), null);
  assert.equal(safeImageUrl('https://user:secret@example.test/a.jpg'), null);
  assert.deepEqual(validStopImages([
    null,
    { url: 'javascript:alert(1)', alt: 'Unsafe' },
    { url: 'https://example.test/a.jpg' },
    { url: 'https://example.test/a.jpg', alt: '', sourceUrl: 'http://example.test' },
  ]), [{ url: 'https://example.test/a.jpg', alt: '', caption: '', credit: '', sourceUrl: null }]);
});
