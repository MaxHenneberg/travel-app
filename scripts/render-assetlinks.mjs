import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const fingerprint = process.env.TRAILBOOK_ANDROID_SHA256_CERT_FINGERPRINT?.trim().toUpperCase();
if (!fingerprint || !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint)) {
  throw new Error('TRAILBOOK_ANDROID_SHA256_CERT_FINGERPRINT must contain the 32-byte release certificate SHA-256 fingerprint.');
}

const source = new URL('../android/dal/assetlinks.json.template', import.meta.url);
const output = resolve(process.argv[2] ?? 'dist/.well-known/assetlinks.json');
const rendered = (await readFile(source, 'utf8')).replace('__RELEASE_SHA256_CERT_FINGERPRINT__', fingerprint);
JSON.parse(rendered);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, rendered, 'utf8');
console.log(`Rendered ${output}`);
