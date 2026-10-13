// Local preview of the built storefront: `node site/serve.js [dir] [--port N]` (default dist/, port 4173).
// It sends the headers vercel.json gives the site on Vercel, so a page the CSP would break also breaks here.
// Dev only (the screenshots use it): it listens on 127.0.0.1 and serves nothing outside its root.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readHeaderRules } from './build.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** The headers for a path. Only the two source shapes vercel.json uses: "/(.*)" (every path) and an exact path. */
export function headersFor(pathname, rules) {
  const out = {};
  for (const rule of rules) {
    if (rule.source === '/(.*)' || rule.source === pathname) for (const { key, value } of rule.headers) out[key] = value;
  }
  return out;
}

/** The file under `root` for a request path, or null when it decodes badly or would leave the root. */
function resolvePath(root, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.resolve(root, `.${pathname}`);
  return file.startsWith(root + path.sep) ? { file, pathname } : null;
}

export function createSiteServer(dir, rules = readHeaderRules()) {
  const root = path.resolve(dir);
  return http.createServer((req, res) => {
    const send = (status, body = '', headers = {}) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed\n', { allow: 'GET, HEAD' });
    const target = resolvePath(root, req.url);
    if (!target) return send(404, 'not found\n');
    fs.readFile(target.file, (err, body) => {
      if (err) return send(404, 'not found\n');
      const type = TYPES[path.extname(target.file)] ?? 'application/octet-stream';
      send(200, body, { ...headersFor(target.pathname, rules), 'content-type': type });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { port: { type: 'string', default: '4173' } } });
  const dir = path.resolve(positionals[0] ?? fileURLToPath(new URL('../dist/', import.meta.url)));
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    process.stderr.write(`site:serve: no index.html in ${dir}; run npm run site:build first\n`);
    process.exit(1);
  }
  const server = createSiteServer(dir);
  server.listen(Number(values.port), '127.0.0.1', () => {
    process.stdout.write(`serving ${path.relative(process.cwd(), dir) || '.'} at http://127.0.0.1:${server.address().port}/\n`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
