// Local preview of the built storefront: `node site/serve.js [dir] [--port N]` (default dist/, port 4173).
// It sends the headers vercel.json gives the site on Vercel, so a page the CSP would break also breaks here, and
// serves clean URLs like vercel.json's cleanUrls: /terms is terms.html, and /terms.html redirects there.
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
  '.xml': 'application/xml; charset=utf-8',
};

/** The headers for a path. Only the two source shapes vercel.json uses: "/(.*)" (every path) and an exact path. */
export function headersFor(pathname, rules) {
  const out = {};
  for (const rule of rules) {
    if (rule.source === '/(.*)' || rule.source === pathname) for (const { key, value } of rule.headers) out[key] = value;
  }
  return out;
}

/**
 * What a request path means, the way Vercel's cleanUrls serves it: `{ file, pathname }` (/ is index.html, /terms is
 * terms.html), `{ redirect }` for a path ending in .html (to the same path without it, query kept), or null when the
 * path decodes badly or would leave the root.
 */
function resolvePath(root, url) {
  let parsed;
  let pathname;
  try {
    parsed = new URL(url, 'http://localhost');
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  if (parsed.pathname.endsWith('.html')) {
    // One leading slash only: "//host" in a Location header would send the browser to another site.
    const clean = parsed.pathname.slice(0, -'.html'.length).replace(/(^|\/)index$/, '$1').replace(/^\/+/, '/');
    return { redirect: `${clean || '/'}${parsed.search}` };
  }
  let relative = pathname;
  if (relative.endsWith('/')) relative += 'index.html';
  else if (!path.extname(relative)) relative += '.html';
  const file = path.resolve(root, `.${relative}`);
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
    if (target.redirect) return send(308, '', { location: target.redirect });
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
