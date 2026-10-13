// `npm run screenshots`: proof that it works, as PNGs in docs/screenshots/. Not part of `npm test`.
//   home      the storefront's landing page, checkout on (a stand-in Payment Link), served on localhost
//   receipts  the real CLI on the demo fixture (`npm run demo`): terminal receipts and the end of the
//             --out Markdown file with its Pro footer
//   license   the thanks page Stripe redirects to, turning a (stand-in) Checkout Session id into the license line
// Each at desktop size (1280×800) and on a phone (iPhone 13), viewport only. It builds the site into a temp dir,
// starts site/serve.js, waits until it answers, drives Chromium from CHROMIUM_PATH (it never downloads a browser),
// then stops the server. Any console error or CSP violation on a page fails the run.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'docs', 'screenshots');
// Stand-ins built at runtime, so nothing credential-shaped sits in the source.
const CHECKOUT = ['https://buy.stripe.com', ['test', 'eVa5kD9xQ2'.repeat(2)].join('_')].join('/');
const SESSION = ['cs', 'test', 'b1C2d3E4'.repeat(7)].join('_');
const SIZES = [
  { suffix: 'desktop', context: { viewport: { width: 1280, height: 800 } } },
  { suffix: 'mobile', context: { ...devices['iPhone 13'] } },
];

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function run(args, env = {}) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`node ${args.join(' ')} exited ${r.status}\n${r.stderr}`);
  return r.stdout;
}

/** Starts site/serve.js on a free port; resolves with its base URL and the child, once it answers. */
async function startServer(dir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'site', 'serve.js'), dir, '--port', '0'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(() => reject(new Error('site/serve.js did not start in 10 s')), 10_000);
    child.stdout.on('data', (chunk) => {
      seen += chunk;
      const m = /http:\/\/127\.0\.0\.1:\d+/.exec(seen);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
    child.on('exit', (code) => reject(new Error(`site/serve.js exited ${code}`)));
  }).catch((err) => {
    child.kill();
    throw err;
  });
  for (let i = 0; i < 50; i += 1) {
    try {
      if ((await fetch(`${base}/`)).ok) return { base, child };
    } catch {
      // not answering yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`${base} never answered`);
}

/** A plain page showing the real `npm run demo` run: the terminal receipts and the end of the Markdown file. */
function receiptsPage(demo) {
  const [terminal, rest = ''] = demo.split('\n----- overnight-receipts.md -----\n');
  const markdown = rest.split('\n----- overnight-receipts digest')[0].trimEnd();
  const tail = markdown.split('\n').slice(-9).join('\n');
  if (!/^\[1\] fix-login — FAILED$/m.test(terminal) || !tail.includes('[Pro, $12 once](')) throw new Error(`unexpected demo output:\n${demo}`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>overnight-receipts: a real run</title><style>
body{margin:0;background:#e9e6df;font:15px/1.45 Helvetica,Arial,"Liberation Sans",sans-serif;color:#1d1f23}
.wrap{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:18px;padding:18px}
@media (max-width:900px){.wrap{grid-template-columns:minmax(0,1fr);padding:10px;gap:10px}}
.win{background:#15171b;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px #0003}
.bar{background:#2a2d33;color:#c9c6bf;font:12px/1 ui-monospace,Menlo,monospace;padding:9px 12px}
pre{margin:0;padding:12px 14px;color:#e6e3dc;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-all}
.md pre{color:#d8d4ca}.hl{color:#f0a37f;font-weight:700}
</style></head><body><div class="wrap">
<div class="win"><div class="bar">$ npm run demo · the real CLI on a fixture repo and fake ~/.claude</div><pre>${escapeHtml(terminal.trimEnd())}</pre></div>
<div class="win md"><div class="bar">overnight-receipts.md · last lines (written by --out)</div><pre>${escapeHtml(tail).replace(/(\[Pro, \$12 once\]\([^)]*\))/, '<span class="hl">$1</span>')}</pre></div>
</div></body></html>`;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-receipts-shots-'));
let server;
let browser;
try {
  const siteDir = path.join(tmp, 'site');
  process.stdout.write(run([path.join('site', 'build.js'), siteDir], { PRO_CHECKOUT_URL: CHECKOUT }));
  server = await startServer(siteDir);
  const demo = run([path.join('scripts', 'demo.js')]);

  if (!process.env.CHROMIUM_PATH) throw new Error('set CHROMIUM_PATH to a Chromium binary (this script never downloads one)');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  fs.mkdirSync(OUT, { recursive: true });

  const views = [
    {
      name: 'home',
      open: (page) => page.goto(`${server.base}/`),
      check: async (page) => (await page.getAttribute('#buy', 'href')) === CHECKOUT && (await page.isVisible('#buy')),
    },
    {
      name: 'receipts',
      open: (page) => page.setContent(receiptsPage(demo)),
      check: async (page) => (await page.textContent('body')).includes('fix-login — FAILED'),
    },
    {
      name: 'license',
      open: (page) => page.goto(`${server.base}/thanks.html?session_id=${SESSION}`),
      check: async (page) => (await page.isVisible('#license')) && (await page.textContent('#license-value')) === SESSION && !(await page.isVisible('#license-missing')),
    },
  ];

  for (const view of views) {
    for (const size of SIZES) {
      const context = await browser.newContext(size.context);
      const page = await context.newPage();
      const problems = [];
      page.on('console', (msg) => msg.type() === 'error' && problems.push(msg.text()));
      page.on('pageerror', (err) => problems.push(err.message));
      await view.open(page);
      await page.waitForLoadState('networkidle');
      if (!(await view.check(page))) throw new Error(`${view.name}-${size.suffix}: the page is not in the expected state`);
      if (problems.length) throw new Error(`${view.name}-${size.suffix}: console errors:\n${problems.join('\n')}`);
      const file = path.join(OUT, `${view.name}-${size.suffix}.png`);
      await page.screenshot({ path: file });
      process.stdout.write(`saved ${path.relative(ROOT, file)}\n`);
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server?.child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
