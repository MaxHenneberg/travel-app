import assert from 'node:assert/strict';
import test from 'node:test';
import { attachmentKind, sanitizeAttachmentName } from '../../src/lib/attachment-store.js';

test('TA-TRAVEL-89-01 scopes priority attachment formats conservatively', () => {
  assert.equal(attachmentKind('ticket.pdf', 'application/pdf'), 'pdf');
  assert.equal(attachmentKind('boarding.pkpass', 'application/vnd.apple.pkpass'), 'pass');
  assert.equal(attachmentKind('notes.txt', 'text/plain'), 'generic');
});

test('TA-TRAVEL-89-03 rejects active formats and normalizes unsafe names', () => {
  assert.equal(attachmentKind('payload.svg', 'image/svg+xml'), 'unsupported');
  assert.equal(attachmentKind('picture.png', 'text/html'), 'unsupported');
  assert.equal(sanitizeAttachmentName('../private/boarding-pass.pdf\u0000'), 'boarding-pass.pdf');
});

test('TA-TRAVEL-89-04 refuses spoofed PDF and script MIME combinations', () => {
  assert.equal(attachmentKind('fake.pdf', 'text/html'), 'unsupported');
  assert.equal(attachmentKind('run.js', 'application/octet-stream'), 'unsupported');
});
