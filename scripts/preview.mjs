import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 4173);
const configured = (process.env.BASE_PATH ?? '/travel-app/').replace(/^\/+|\/+$/g, '');
const basePath = configured ? `/${configured}/` : '/';
const root = resolve('dist');
const mime = { '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

export function createPreviewServer() {
  return createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (!url.pathname.startsWith(basePath)) {
      response.writeHead(404).end('Not found');
      return;
    }
    const relative = decodeURIComponent(url.pathname.slice(basePath.length)) || 'index.html';
    const path = resolve(root, relative);
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      response.writeHead(400).end('Invalid path');
      return;
    }
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
  });
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const server = createPreviewServer();
  server.listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}${basePath}`));
  const close = () => server.close(() => process.exit(0));
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
