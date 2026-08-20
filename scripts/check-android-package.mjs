import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const activity = await readFile(new URL('../android/app/src/main/java/io/github/maxhenneberg/trailbook/MainActivity.java', import.meta.url), 'utf8');
const reader = await readFile(new URL('../android/app/src/main/java/io/github/maxhenneberg/trailbook/TrailbookIntentReader.java', import.meta.url), 'utf8');
const template = JSON.parse(await readFile(new URL('../android/dal/assetlinks.json.template', import.meta.url), 'utf8'));

assert.match(manifest, /application\/vnd\.trailbook\.itinerary\+json/);
assert.match(manifest, /application\/octet-stream/);
assert.match(manifest, /application\/json/);
assert.match(manifest, /android:scheme="content"/);
assert.match(manifest, /android:pathPattern="\.\*\\\.trailbook"/);
assert.equal(manifest.match(/android:host="\*"/g)?.length, 2);
assert.doesNotMatch(manifest, /android:mimeType="\*\/\*"/);
assert.doesNotMatch(manifest, /android\.intent\.category\.BROWSABLE/);
assert.doesNotMatch(manifest, /READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE/);
assert.match(activity, /setAllowFileAccess\(false\)/);
assert.match(activity, /setAllowContentAccess\(false\)/);
assert.match(activity, /TRUSTED_HOST = "maxhenneberg\.github\.io"/);
assert.match(reader, /openInputStream\(uri\)/);
assert.doesNotMatch(reader, /getPath\(\)|new File\(/);

assert.equal(template.length, 1);
assert.deepEqual(template[0].relation, ['delegate_permission/common.handle_all_urls']);
assert.equal(template[0].target.namespace, 'android_app');
assert.equal(template[0].target.package_name, 'io.github.maxhenneberg.trailbook');
assert.equal(template[0].target.sha256_cert_fingerprints[0], '__RELEASE_SHA256_CERT_FINGERPRINT__');

console.log('Android package contract is targeted, URI-only, storage-permission-free, and DAL-ready.');
