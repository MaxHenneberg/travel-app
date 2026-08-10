import { createPreviewServer } from '../scripts/preview.mjs';

export default async function globalSetup() {
  if (process.env.PLAYWRIGHT_BASE_URL) return undefined;
  const server = createPreviewServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4173, '127.0.0.1', resolve);
  });
  return () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
