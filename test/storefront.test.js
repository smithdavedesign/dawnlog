// ROADMAP M3 revenue exit criteria: the storefront (REVENUE.md), a static site in site/ built to dist/.
//   S1 the build writes every page, links resolve, no placeholder is left
//   S2 the landing page: what it is, the free install line, the price, terms and privacy by the buy button
//   S3 PRO_CHECKOUT_URL switches checkout on; unset means "opens soon"; anything else fails the build
//   S4 terms and privacy state REVENUE.md's commitments
//   S5 the thanks page turns Stripe's session id into the license line, and that line hides the CLI footer
//   S6 the site keeps its own privacy promise (no other origins, no inline code, CSP, no-referrer)
// plus the local preview server the screenshots use.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HOUR, MIN, cleanup, makeHome, makeRepo, runCli, tmpDir, writeSession } from './helpers.js';

after(cleanup);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD = path.join(ROOT, 'site', 'build.js');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PAGES = ['index.html', 'terms.html', 'privacy.html', 'thanks.html'];
// Stand-ins built at runtime, like every fake value in these tests: a Stripe Payment Link and a Checkout Session id.
const CHECKOUT = ['https://buy.stripe.com', ['test', 'eVa5kD9xQ2'.repeat(2)].join('_')].join('/');
const SESSION = ['cs', 'test', 'b1C2d3E4'.repeat(7)].join('_');

let site;
let license;
let pro;
before(async () => {
  site = await import('../site/build.js');
  license = await import('../site/pages/license.js');
  pro = await import('../src/pro.js');
});

/** Builds into a fresh temp dir; returns the dir and every page's HTML. */
function build(env = {}) {
  const out = path.join(tmpDir('site'), 'dist');
  const result = site.buildSite({ out, env });
  const html = Object.fromEntries(PAGES.map((p) => [p, fs.readFileSync(path.join(out, p), 'utf8')]));
  return { out, html, result };
}

/** Values of `attr` on every `tag` element (our pages always double-quote attributes). */
const attrs = (html, tag, attr) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*?\\s${attr}="([^"]*)"`, 'g'))].map((m) => m[1]);
/** The element with this id: its opening tag through the matching close of the same tag name (no nesting of that tag). */
function byId(html, id) {
  const m = new RegExp(`<([a-z]+)\\b[^>]*\\sid="${id}"[^>]*>`).exec(html);
  if (!m) return null;
  const end = html.indexOf(`</${m[1]}>`, m.index);
  return { tag: m[1], open: m[0], html: html.slice(m.index, end < 0 ? undefined : end + m[1].length + 3) };
}
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

/** Runs `node site/build.js DIR` with PRO_CHECKOUT_URL removed from the environment unless given. */
function buildCli(out, env = {}) {
  const childEnv = { ...process.env };
  delete childEnv.PRO_CHECKOUT_URL;
  delete childEnv.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [BUILD, out], { env: { ...childEnv, ...env }, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('exit S1: npm run site:build writes the static site', () => {
  test('every page and asset is written, links resolve, and no placeholder is left', () => {
    const { out, html, result } = build();
    for (const file of [...PAGES, 'style.css', 'license.js']) assert.ok(fs.existsSync(path.join(out, file)), `${file} built`);
    assert.deepEqual([...result.files].sort(), fs.readdirSync(out).sort(), 'buildSite reports what it wrote');
    for (const [page, body] of Object.entries(html)) {
      assert.ok(!body.includes('{{'), `${page} has a leftover placeholder`);
      assert.match(body, /^<!doctype html>\n<html lang="en">/, `${page} doctype and lang`);
      assert.match(body, /<meta charset="utf-8">/, `${page} charset`);
      assert.match(body, /<meta name="viewport" content="width=device-width, initial-scale=1">/, `${page} viewport (phones)`);
      assert.match(body, /<title>[^<]+<\/title>/, `${page} title`);
      const refs = [...attrs(body, 'a', 'href'), ...attrs(body, 'link', 'href'), ...attrs(body, 'script', 'src')];
      for (const ref of refs.filter((r) => !/^(https:|mailto:|#)/.test(r))) {
        const file = ref.split(/[?#]/)[0] || 'index.html';
        assert.ok(fs.existsSync(path.join(out, file)), `${page} links ${ref}, which was not built`);
      }
    }
  });

  test('the CLI writes to the given directory, exits 0 and says whether checkout is on', () => {
    const out = path.join(tmpDir('site-cli'), 'dist');
    const off = buildCli(out);
    assert.equal(off.code, 0, off.stderr);
    assert.ok(fs.existsSync(path.join(out, 'index.html')));
    assert.match(off.stdout, /checkout: off/);
    const on = buildCli(out, { PRO_CHECKOUT_URL: CHECKOUT });
    assert.equal(on.code, 0, on.stderr);
    assert.match(on.stdout, /checkout: on/);
    assert.ok(!on.stdout.includes(CHECKOUT) && !on.stderr.includes(CHECKOUT), 'the build never prints the env value');
    assert.equal(PKG.scripts['site:build'], 'node site/build.js');
  });

  test('a rebuild replaces the old output: no stale page survives', () => {
    const { out } = build();
    fs.writeFileSync(path.join(out, 'old-page.html'), 'stale');
    site.buildSite({ out, env: {} });
    assert.ok(!fs.existsSync(path.join(out, 'old-page.html')));
  });

  test('refuses to replace a directory that is not a previous build, or the source pages', () => {
    const dir = tmpDir('site-guard');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me');
    assert.throws(() => site.buildSite({ out: dir, env: {} }), /refusing/);
    assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'keep me', 'nothing deleted');
    assert.throws(() => site.buildSite({ out: path.join(ROOT, 'site', 'pages'), env: {} }), /refusing/);
    assert.throws(() => site.buildSite({ out: path.join(ROOT, 'site'), env: {} }), /refusing/);
    assert.ok(fs.existsSync(path.join(ROOT, 'site', 'pages', 'index.html')), 'the pages survive');
    const empty = path.join(tmpDir('site-guard'), 'empty');
    fs.mkdirSync(empty);
    assert.ok(site.buildSite({ out: empty, env: {} }).files.includes('index.html'), 'an empty directory is fine');
  });

  test('render fills known placeholders, escapes text values, and throws on an unknown one', () => {
    assert.equal(site.render('<p>{{A}} {{B}}</p>', { A: 'x & <y>', B: '"q"' }), '<p>x &amp; &lt;y&gt; &quot;q&quot;</p>');
    assert.equal(site.render('{{RAW}}', {}, { RAW: '<b>ok</b>' }), '<b>ok</b>', 'html values are inserted as built');
    assert.throws(() => site.render('<p>{{NOPE}}</p>', { A: 'x' }), /\{\{NOPE\}\}/);
  });
});

describe('exit S2: the landing page', () => {
  test('says what it is, gives the free install line and the price, and links terms and privacy by the buy button', () => {
    const { html } = build({ PRO_CHECKOUT_URL: CHECKOUT });
    const page = html['index.html'];
    const words = text(page);
    assert.match(words, /overnight-receipts/);
    assert.match(words, /Claude Code/);
    assert.match(words, /receipt/i);
    assert.ok(words.includes('npx github:smithdavedesign/overnight-receipts --since 12h'), 'the free install line');
    assert.match(words, /free and MIT/i);
    assert.ok(words.includes(`${pro.PRO_PRICE} once`), 'the price from src/pro.js');
    const box = byId(page, 'pro');
    assert.ok(box, 'a Pro section');
    assert.ok(text(box.html).includes(pro.PRO_PRICE));
    const links = attrs(box.html, 'a', 'href');
    assert.ok(links.includes('terms.html'), 'terms next to the buy button');
    assert.ok(links.includes('privacy.html'), 'privacy next to the buy button');
    assert.match(text(box.html), /refund/i);
    assert.match(words, /\[REDACTED\]/, 'the sample receipt shows redaction');
    assert.match(words, /suggest: fix/, 'the sample receipt shows triage');
  });

  test('says plainly that Pro unlocks nothing: everything works free', () => {
    const words = text(build().html['index.html']);
    assert.match(words, /honour system/i);
    assert.ok(words.includes(pro.LICENSE_ENV));
  });
});

describe('exit S3: PRO_CHECKOUT_URL is the checkout switch', () => {
  test('checkoutUrl: a buy.stripe.com link is accepted (trimmed); unset or blank is off', () => {
    assert.equal(site.checkoutUrl(CHECKOUT), CHECKOUT);
    assert.equal(site.checkoutUrl(`  ${CHECKOUT}\n`), CHECKOUT);
    assert.equal(site.checkoutUrl(undefined), null);
    assert.equal(site.checkoutUrl(''), null);
    assert.equal(site.checkoutUrl(' \t'), null);
  });

  const BAD = [
    CHECKOUT.replace('https:', 'http:'),
    CHECKOUT.replace('buy.stripe.com', 'buy.stripe.com.example.net'),
    CHECKOUT.replace('buy.stripe.com', 'example.com'),
    'https://dashboard.stripe.com/payment-links',
    `${CHECKOUT}" onmouseover="alert(1)`,
    `${CHECKOUT}><script>alert(1)</script>`,
    'javascript:alert(1)',
    'https://buy.stripe.com/',
  ];

  test('checkoutUrl: any other value throws, naming the variable but never the value', () => {
    for (const bad of BAD) {
      assert.throws(
        () => site.checkoutUrl(bad),
        (err) => err.message.includes('PRO_CHECKOUT_URL') && !err.message.includes(bad.trim()),
        bad,
      );
    }
  });

  test('on: the Buy button links the Payment Link, and it is the only Stripe link in the site', () => {
    const { html, result } = build({ PRO_CHECKOUT_URL: CHECKOUT });
    assert.equal(result.checkout, true);
    const buy = byId(html['index.html'], 'buy');
    assert.equal(buy.tag, 'a');
    assert.match(buy.open, new RegExp(`href="${CHECKOUT.replace(/[.]/g, '\\.')}"`));
    assert.ok(text(buy.html).includes(`${pro.PRO_PRICE}`), 'the button states the price');
    const all = Object.values(html).join('\n');
    assert.equal(all.split(CHECKOUT).length - 1, 1, 'the link appears once');
    assert.ok(!/opens soon/i.test(html['index.html']));
  });

  test('off (unset or blank): no checkout link anywhere, and the page says checkout opens soon', () => {
    for (const env of [{}, { PRO_CHECKOUT_URL: '' }, { PRO_CHECKOUT_URL: '   ' }]) {
      const { html, result } = build(env);
      assert.equal(result.checkout, false);
      const buy = byId(html['index.html'], 'buy');
      assert.notEqual(buy.tag, 'a', 'not a link');
      assert.match(text(buy.html), /Checkout opens soon/);
      for (const [page, body] of Object.entries(html)) assert.ok(!body.includes('buy.stripe.com'), `${page} links checkout`);
    }
  });

  test('a set but invalid value fails the build (library and CLI) without printing it, and writes nothing', () => {
    for (const bad of BAD) {
      const out = path.join(tmpDir('site-bad'), 'dist');
      assert.throws(() => site.buildSite({ out, env: { PRO_CHECKOUT_URL: bad } }), /PRO_CHECKOUT_URL/);
      assert.ok(!fs.existsSync(out), 'nothing half-built');
    }
    const out = path.join(tmpDir('site-bad'), 'dist');
    const r = buildCli(out, { PRO_CHECKOUT_URL: BAD[0] });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /PRO_CHECKOUT_URL/);
    assert.ok(!r.stderr.includes(BAD[0]) && !r.stdout.includes(BAD[0]), 'the value is not printed');
  });
});

describe('exit S4: terms and privacy', () => {
  test("the terms state the price, refunds, as-is, best-effort redaction and the honour system", () => {
    const words = text(build().html['terms.html']);
    assert.ok(words.includes(`${pro.PRO_PRICE}`), 'price');
    assert.match(words, /one-time/i);
    assert.match(words, /refund/i);
    assert.match(words, /30 days/);
    assert.match(words, /as is/i);
    assert.match(words, /best-effort/i);
    assert.match(words, /honour system/i);
    assert.match(words, /MIT/);
    assert.match(words, /Stripe/);
    assert.match(words, /lost/i, 'how to get a lost license string');
  });

  test('the privacy page: local only, read-only, nothing uploaded; no cookies or analytics; who processes what', () => {
    const words = text(build().html['privacy.html']);
    assert.match(words, /runs on your machine/i);
    assert.match(words, /read-only/i);
    assert.match(words, /nothing is uploaded/i);
    assert.match(words, /no telemetry/i);
    assert.match(words, /--summarize/, 'the one option that sends anything, and where');
    assert.match(words, /best-effort/i);
    assert.match(words, /no cookies/i);
    assert.match(words, /no analytics/i);
    assert.match(words, /Stripe/);
    assert.match(words, /Vercel/);
    assert.match(words, /never sold/i);
  });

  test('every page links terms and privacy in its footer', () => {
    for (const [page, body] of Object.entries(build().html)) {
      const footer = /<footer\b[\s\S]*?<\/footer>/.exec(body)?.[0] ?? '';
      const links = attrs(footer, 'a', 'href');
      assert.ok(links.includes('terms.html'), `${page} footer links terms`);
      assert.ok(links.includes('privacy.html'), `${page} footer links privacy`);
    }
  });
});

describe('exit S5: the thanks page hands over the license string', () => {
  test('licenseFrom: a Checkout Session id from the query is the license', () => {
    assert.equal(license.licenseFrom(`?session_id=${SESSION}`), SESSION);
    assert.equal(license.licenseFrom(`?session_id=${SESSION.replace('test', 'live')}&utm_source=x`), SESSION.replace('test', 'live'));
  });

  test('licenseFrom: missing, forged or injected ids give no license', () => {
    for (const search of [
      '',
      '?',
      '?session_id=',
      '?session_id={CHECKOUT_SESSION_ID}',
      `?session_id=${SESSION.replace('cs_', 'pi_')}`,
      `?session_id=${encodeURIComponent(`${SESSION}"><img src=x onerror=alert(1)>`)}`,
      `?session_id=${encodeURIComponent(`<img src=x onerror=alert(1)>`)}`,
      `?session_id=${SESSION}%20`,
      `?session_id=cs_test_short`,
      `?session_id=${['cs', 'test', 'x'.repeat(300)].join('_')}`,
    ]) {
      assert.equal(license.licenseFrom(search), null, search);
    }
  });

  /** A stand-in for the three elements license.js touches. */
  const fakeDoc = () => {
    const els = { license: { hidden: true }, 'license-value': { textContent: '' }, 'license-missing': { hidden: false } };
    return { els, getElementById: (id) => els[id] ?? null };
  };

  test('showLicense: a valid id is written as text and the block shown; otherwise the fallback stays', () => {
    const doc = fakeDoc();
    assert.equal(license.showLicense(doc, `?session_id=${SESSION}`), true);
    assert.equal(doc.els['license-value'].textContent, SESSION);
    assert.equal(doc.els.license.hidden, false);
    assert.equal(doc.els['license-missing'].hidden, true);
    const none = fakeDoc();
    assert.equal(license.showLicense(none, '?session_id=nope'), false);
    assert.equal(none.els.license.hidden, true);
    assert.equal(none.els['license-missing'].hidden, false);
    assert.equal(none.els['license-value'].textContent, '');
    assert.equal(license.showLicense({ getElementById: () => null }, `?session_id=${SESSION}`), false, 'a page without the elements is not an error');
  });

  test('license.js never writes markup: textContent only', () => {
    const src = fs.readFileSync(path.join(ROOT, 'site', 'pages', 'license.js'), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(src), src);
  });

  test('thanks.html has the license block (hidden until filled), the fallback, the module script, and noindex', () => {
    const page = build().html['thanks.html'];
    const block = byId(page, 'license');
    assert.ok(block, 'a #license block');
    assert.match(block.open, /\shidden[\s>]/, 'hidden until the script fills it');
    assert.ok(text(block.html).includes(`export ${pro.LICENSE_ENV}="`), 'the shell line names the variable from src/pro.js');
    assert.ok(byId(page, 'license-value'), 'a #license-value slot');
    const missing = byId(page, 'license-missing');
    assert.ok(missing, 'a fallback');
    assert.match(text(missing.html), /receipt/i, 'the fallback says how to get the string');
    assert.match(page, /<script type="module" src="license\.js"><\/script>/);
    assert.match(page, /<meta name="robots" content="noindex">/);
  });

  test('end to end: the license string from the thanks page hides the CLI footer', () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'feat', commits: [{ at: now - HOUR + 3 * MIN, files: { 'src/feat.js': 'x\n' }, message: 'Feature' }] }] });
    const { home, projects } = makeHome();
    writeSession(projects, { id: 'shop0000-0000-4000-8000-000000000000', cwd: repo, gitBranch: 'feat', start: now - HOUR, prompt: 'Build the feature', bash: [{ command: 'npm test', exit: 0 }] });
    const run = (env) => {
      const out = path.join(tmpDir('shop'), 'r.md');
      const r = runCli(['--since', '24h', '--repo', repo, '--out', out], { home, env });
      assert.equal(r.code, 0, r.stderr);
      return { ...r, file: fs.readFileSync(out, 'utf8') };
    };
    assert.ok(run({}).file.includes(pro.PRO_URL), 'unlicensed: the footer is there');
    const paid = run({ [pro.LICENSE_ENV]: license.licenseFrom(`?session_id=${SESSION}`) });
    assert.ok(!paid.file.includes(pro.PRO_URL), 'licensed: no footer');
    for (const out of [paid.file, paid.stdout, paid.stderr]) assert.ok(!out.includes(SESSION), 'the license is never printed');
  });
});

describe('exit S6: the site keeps its own privacy promise', () => {
  const ALLOWED_LINK_HOSTS = new Set(['github.com', 'buy.stripe.com', 'stripe.com', 'vercel.com']);

  test('nothing loads from another origin; other-origin links go only to the allowed hosts', () => {
    const { html, out } = build({ PRO_CHECKOUT_URL: CHECKOUT });
    for (const [page, body] of Object.entries(html)) {
      for (const src of [...attrs(body, '[a-z]+', 'src'), ...attrs(body, 'link', 'href')]) {
        assert.ok(!/^(https?:)?\/\//.test(src), `${page} loads ${src} from another origin`);
      }
      for (const href of attrs(body, 'a', 'href').filter((h) => /^(https?:)?\/\//.test(h))) {
        const u = new URL(href, 'https://site.invalid/');
        assert.equal(u.protocol, 'https:', `${page}: ${href}`);
        assert.ok(ALLOWED_LINK_HOSTS.has(u.hostname), `${page} links ${u.hostname}`);
      }
    }
    const css = fs.readFileSync(path.join(out, 'style.css'), 'utf8');
    assert.ok(!/@import|url\(/.test(css), 'the stylesheet loads nothing (no fonts, no images)');
  });

  test('no inline script or style, no event handlers (so the CSP needs no unsafe-inline)', () => {
    for (const [page, body] of Object.entries(build().html)) {
      for (const m of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        assert.match(m[1], /\ssrc="/, `${page}: inline <script>`);
        assert.equal(m[2].trim(), '', `${page}: script with a body`);
      }
      assert.ok(!/<style\b/.test(body), `${page}: <style>`);
      assert.ok(!/\sstyle="/.test(body), `${page}: style attribute`);
      assert.ok(!/\son[a-z]+="/i.test(body), `${page}: event handler attribute`);
      assert.match(body, /<meta name="referrer" content="no-referrer">/, `${page}: no-referrer`);
    }
  });

  test('vercel.json builds the site and serves it with a strict CSP, no-referrer and nosniff; thanks is noindex', () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    assert.equal(config.buildCommand, 'npm run site:build');
    assert.equal(config.outputDirectory, 'dist');
    const all = config.headers.find((h) => h.source === '/(.*)');
    const get = (rule, key) => rule?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
    const csp = get(all, 'Content-Security-Policy');
    assert.match(csp, /(^|; )default-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'), csp);
    assert.equal(get(all, 'Referrer-Policy'), 'no-referrer');
    assert.equal(get(all, 'X-Content-Type-Options'), 'nosniff');
    assert.equal(get(config.headers.find((h) => h.source === '/thanks.html'), 'X-Robots-Tag'), 'noindex');
    // site/serve.js applies only these two source shapes locally; a new pattern must be taught to it first.
    for (const rule of config.headers) assert.match(rule.source, /^(\/\(\.\*\)|\/[\w.-]+)$/, `serve.js can't match ${rule.source}`);
  });

  test('dist/_headers carries the same headers for Cloudflare Pages (free, commercial use allowed; Vercel Hobby is not)', () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    const { out, result } = build();
    assert.ok(result.files.includes('_headers'));
    const blocks = Object.fromEntries(
      fs.readFileSync(path.join(out, '_headers'), 'utf8').trim().split(/\n\s*\n/).map((b) => {
        const [pattern, ...lines] = b.split('\n');
        return [pattern, lines];
      }),
    );
    const lines = (rule) => rule.headers.map(({ key, value }) => `  ${key}: ${value}`);
    assert.deepEqual(blocks['/*'], lines(config.headers.find((h) => h.source === '/(.*)')), 'every page: the same CSP and policies');
    const thanks = lines(config.headers.find((h) => h.source === '/thanks.html'));
    assert.deepEqual(blocks['/thanks.html'], thanks);
    assert.deepEqual(blocks['/thanks'], thanks, 'Cloudflare Pages serves /thanks.html at /thanks too');
    assert.throws(() => site.headersFile([{ source: '/(.*)\\.js', headers: [] }]), /source/);
  });

  test('the storefront is not shipped in the npm package', () => {
    for (const entry of PKG.files) assert.ok(!/^(site|dist|docs|scripts)\b/.test(entry), entry);
    assert.ok(PKG.devDependencies['playwright-core'], 'screenshots only: a devDependency');
    assert.ok(!PKG.dependencies, 'the CLI still has no runtime dependencies');
  });
});

describe('site/serve.js: the local preview the screenshots use', () => {
  let server;
  let base;
  let port;
  let parent;
  before(async () => {
    const { createSiteServer } = await import('../site/serve.js');
    const { out } = build();
    parent = path.dirname(out);
    fs.writeFileSync(path.join(parent, 'secret.txt'), 'outside the root');
    server = createSiteServer(out);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    base = `http://127.0.0.1:${port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  /** A raw request: the path is sent as written, without the client normalizing it. */
  const raw = (urlPath, method = 'GET') =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: urlPath, method }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });

  test('serves / as index.html with the right content types', async () => {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /^text\/html/);
    assert.match(await home.text(), /overnight-receipts/);
    assert.match((await fetch(`${base}/style.css`)).headers.get('content-type'), /^text\/css/);
    assert.match((await fetch(`${base}/license.js`)).headers.get('content-type'), /^text\/javascript/);
    assert.equal((await fetch(`${base}/thanks.html?session_id=${SESSION}`)).status, 200, 'query strings are ignored');
  });

  test("sends vercel.json's headers: the CSP everywhere, noindex only on the thanks page", async () => {
    const home = await fetch(`${base}/index.html`);
    assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(home.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(home.headers.get('x-robots-tag'), null);
    assert.equal((await fetch(`${base}/thanks.html`)).headers.get('x-robots-tag'), 'noindex');
  });

  test('404 for missing files and for any path outside the root; 405 for other methods', async () => {
    assert.equal((await fetch(`${base}/nope.html`)).status, 404);
    for (const p of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/%00', '/index.html%00.css', '/%E0%A4%A']) {
      const r = await raw(p);
      assert.ok([400, 404].includes(r.status), `${p} → ${r.status}`);
      assert.ok(!r.body.includes('outside the root'), `${p} leaked a file outside the root`);
    }
    assert.equal((await raw('/', 'POST')).status, 405);
    assert.equal((await raw('/', 'HEAD')).status, 200);
  });
});
