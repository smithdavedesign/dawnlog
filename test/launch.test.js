// Go-live (LAUNCH-READY.md): what a public launch adds to the storefront in site/.
//   L1 every public page has its own title and description, a canonical URL, Open Graph and Twitter tags with the
//      1200×630 share image, and SoftwareApplication JSON-LD with Pro as a $12 Offer; thanks stays out of search
//   L2 robots.txt allows indexing and points at sitemap.xml, which lists the public pages
//   L3 the share image is a valid 1200×630 PNG drawn by the build
//   L4 the visit beacon: visit / activate / checkout, once where it should be, never to bots, previews or the owner
//   L5 privacy and terms say what the launch changed; .provision asks for the Vercel project and the Payment Link
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanup, tmpDir } from './helpers.js';

after(cleanup);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = ['index.html', 'terms.html', 'privacy.html'];
const SITE = 'https://dawnlog.vercel.app';

let site;
let beacon;
let og;
let pro;
before(async () => {
  site = await import('../site/build.js');
  beacon = await import('../site/pages/beacon.js');
  og = await import('../site/og-image.js');
  pro = await import('../src/pro.js');
});

/** Builds into a fresh temp dir with exactly `env`; returns the dir and every built page's HTML. */
function build(env = {}) {
  const out = path.join(tmpDir('launch'), 'dist');
  const result = site.buildSite({ out, env });
  const html = Object.fromEntries(fs.readdirSync(out).filter((f) => f.endsWith('.html')).map((f) => [f, fs.readFileSync(path.join(out, f), 'utf8')]));
  return { out, html, result, read: (f) => fs.readFileSync(path.join(out, f)) };
}

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** The content of <meta {attr}="{key}">, or undefined. */
const meta = (html, attr, key) => {
  const m = new RegExp(`<meta ${attr}="${key.replace(/[.:]/g, '\\$&')}" content="([^"]*)">`).exec(html);
  return m ? unescape(m[1]) : undefined;
};
const canonical = (html) => /<link rel="canonical" href="([^"]*)">/.exec(html)?.[1];
const titleOf = (html) => [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => unescape(m[1]));
const jsonLdOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

describe('L1: search and sharing tags on every public page', () => {
  test('each public page: one unique title and description, canonical URL, og:* and twitter:* with the share image', () => {
    const { html } = build();
    const titles = new Set();
    const descriptions = new Set();
    for (const file of PUBLIC) {
      const page = html[file];
      const { path: urlPath, title, description } = site.PUBLIC_PAGES[file];
      assert.deepEqual(titleOf(page), [title], `${file}: one <title>`);
      assert.equal(meta(page, 'name', 'description'), description, `${file}: description`);
      assert.ok(description.length >= 50 && description.length <= 170, `${file}: a description search engines show whole (${description.length})`);
      titles.add(title);
      descriptions.add(description);
      const url = `${SITE}${urlPath}`;
      assert.equal(canonical(page), url, `${file}: canonical`);
      assert.equal(meta(page, 'property', 'og:url'), url);
      assert.equal(meta(page, 'property', 'og:type'), 'website');
      assert.equal(meta(page, 'property', 'og:title'), title);
      assert.equal(meta(page, 'property', 'og:description'), description);
      assert.equal(meta(page, 'property', 'og:image'), `${SITE}/og.png`);
      assert.equal(meta(page, 'property', 'og:image:width'), '1200');
      assert.equal(meta(page, 'property', 'og:image:height'), '630');
      assert.ok(meta(page, 'property', 'og:image:alt'), `${file}: image alt text`);
      assert.equal(meta(page, 'name', 'twitter:card'), 'summary_large_image');
      assert.equal(meta(page, 'name', 'twitter:title'), title);
      assert.equal(meta(page, 'name', 'twitter:description'), description);
      assert.equal(meta(page, 'name', 'twitter:image'), `${SITE}/og.png`);
    }
    assert.equal(titles.size, PUBLIC.length, 'titles are unique');
    assert.equal(descriptions.size, PUBLIC.length, 'descriptions are unique');
    assert.deepEqual(Object.keys(site.PUBLIC_PAGES).sort(), [...PUBLIC].sort());
  });

  test('JSON-LD: a SoftwareApplication with Pro as a one-time $12 Offer (the price from src/pro.js), on every public page', () => {
    const { html } = build();
    for (const file of PUBLIC) {
      const [ld, ...more] = jsonLdOf(html[file]);
      assert.equal(more.length, 0, `${file}: one JSON-LD block`);
      assert.equal(ld['@context'], 'https://schema.org');
      assert.equal(ld['@type'], 'SoftwareApplication');
      assert.equal(ld.name, 'overnight-receipts');
      assert.equal(ld.url, `${SITE}/`);
      assert.equal(ld.applicationCategory, 'DeveloperApplication');
      assert.equal(ld.offers['@type'], 'Offer');
      assert.equal(`$${ld.offers.price}`, pro.PRO_PRICE);
      assert.equal(ld.offers.price, '12');
      assert.equal(ld.offers.priceCurrency, 'USD');
      assert.match(ld.offers.description, /once, no subscription/);
      assert.ok(!JSON.stringify(ld).includes('stripe.com'), 'the Payment Link stays out of the JSON-LD');
    }
  });

  test('JSON-LD cannot be closed early by a value: < is escaped', () => {
    const head = site.pageHead('index.html', 'https://x.example', 'production');
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head)[1];
    assert.ok(!block.includes('<'), block);
  });

  test('the thanks page stays out of search: noindex, no canonical, no share tags, no JSON-LD', () => {
    const page = build().html['thanks.html'];
    assert.match(page, /<meta name="robots" content="noindex">/);
    assert.equal(canonical(page), undefined);
    assert.equal(meta(page, 'property', 'og:title'), undefined);
    assert.deepEqual(jsonLdOf(page), []);
  });

  test("siteUrl: SITE_URL, else Vercel's production domain, else the default; a bad value fails without being echoed", () => {
    assert.equal(site.siteUrl({}), SITE);
    assert.equal(site.siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'dawnlog-x1.vercel.app' }), 'https://dawnlog-x1.vercel.app');
    assert.equal(site.siteUrl({ SITE_URL: 'https://receipts.example/', VERCEL_PROJECT_PRODUCTION_URL: 'dawnlog.vercel.app' }), 'https://receipts.example');
    assert.equal(site.siteUrl({ SITE_URL: '  ' }), SITE, 'blank is unset');
    const withLogin = ['https://', 'someone', ':', 'x'.repeat(8), '@receipts.example'].join('');
    for (const [env, name] of [
      [{ SITE_URL: 'http://receipts.example' }, 'SITE_URL'],
      [{ SITE_URL: 'https://receipts.example/shop' }, 'SITE_URL'],
      [{ SITE_URL: 'https://receipts.example/?a=1' }, 'SITE_URL'],
      [{ SITE_URL: 'receipts.example' }, 'SITE_URL'],
      [{ SITE_URL: withLogin }, 'SITE_URL'],
      [{ VERCEL_PROJECT_PRODUCTION_URL: 'dawnlog.vercel.app/x' }, 'VERCEL_PROJECT_PRODUCTION_URL'],
    ]) {
      const value = Object.values(env)[0];
      assert.throws(() => site.siteUrl(env), (err) => err.message.includes(name) && !err.message.includes(value), value);
    }
    const out = path.join(tmpDir('launch-bad'), 'dist');
    assert.throws(() => site.buildSite({ out, env: { SITE_URL: 'http://receipts.example' } }), /SITE_URL/);
    assert.ok(!fs.existsSync(out), 'nothing half-built');
  });

  test('SITE_URL flows into every canonical URL, og:image, robots.txt and the sitemap', () => {
    const custom = 'https://receipts.example';
    const { html, read } = build({ SITE_URL: custom, VERCEL_PROJECT_PRODUCTION_URL: 'dawnlog.vercel.app' });
    for (const file of PUBLIC) {
      assert.ok(canonical(html[file]).startsWith(`${custom}/`), file);
      assert.equal(meta(html[file], 'property', 'og:image'), `${custom}/og.png`);
      assert.ok(!html[file].includes('dawnlog.vercel.app'), `${file} names only the custom origin`);
    }
    assert.match(String(read('robots.txt')), /^Sitemap: https:\/\/receipts\.example\/sitemap\.xml$/m);
    assert.ok(String(read('sitemap.xml')).includes(`<loc>${custom}/</loc>`));
  });
});

describe('L2: robots.txt and sitemap.xml', () => {
  test('robots.txt allows everything and names the sitemap', () => {
    const robots = String(build().read('robots.txt'));
    assert.match(robots, /^User-agent: \*$/m);
    assert.match(robots, /^Allow: \/$/m);
    assert.doesNotMatch(robots, /^Disallow: \/\s*$/m, 'nothing is blocked');
    assert.match(robots, new RegExp(`^Sitemap: ${SITE.replace(/[.]/g, '\\.')}/sitemap\\.xml$`, 'm'));
  });

  test('sitemap.xml lists exactly the public pages at their canonical URLs, each a built page', () => {
    const { html, read } = build();
    const xml = String(read('sitemap.xml'));
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.match(xml, /<\/urlset>\n$/);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(locs.sort(), PUBLIC.map((f) => canonical(html[f])).sort());
    assert.ok(!xml.includes('thanks'), 'the thanks page is not listed');
  });

  test('robots.txt, sitemap.xml and og.png are in the build, so the host serves them at the root', () => {
    const { result } = build();
    for (const file of ['robots.txt', 'sitemap.xml', 'og.png']) assert.ok(result.files.includes(file), file);
  });
});

/** The chunks of a PNG, each checked against its CRC (node's own zlib.crc32, independent of og-image.js). */
function pngChunks(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  const chunks = [];
  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    assert.equal(buf.readUInt32BE(at + 8 + length), zlib.crc32(buf.subarray(at + 4, at + 8 + length)), `${type} CRC`);
    chunks.push({ type, data });
    at += 12 + length;
  }
  return chunks;
}

describe('L3: the share image', () => {
  test('og.png is a valid 1200×630 RGB PNG that decodes to a drawn picture, not a blank', () => {
    const png = build().read('og.png');
    const chunks = pngChunks(png);
    assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
    const ihdr = chunks[0].data;
    assert.equal(ihdr.readUInt32BE(0), 1200);
    assert.equal(ihdr.readUInt32BE(4), 630);
    assert.deepEqual([...ihdr.subarray(8)], [8, 2, 0, 0, 0], '8-bit RGB, no interlace');
    const raw = zlib.inflateSync(chunks[1].data);
    assert.equal(raw.length, (1200 * 3 + 1) * 630);
    const colours = new Set();
    for (let y = 0; y < 630; y += 1) {
      assert.equal(raw[y * 3601], 0, 'filter type 0');
      for (let x = 0; x < 1200; x += 7) colours.add(raw.readUIntBE(y * 3601 + 1 + x * 3, 3));
    }
    assert.ok(colours.size >= 8, `${colours.size} colours: background, panel, text, accent, three statuses`);
    assert.ok(png.length < 100_000, `small enough for link previews (${png.length} bytes)`);
  });

  test('the image is the same on every build, and its text needs no glyph the font lacks', () => {
    const words = { name: site.NAME, tagline: site.TAGLINE, price: pro.PRO_PRICE };
    assert.ok(og.ogImage(words).equals(og.ogImage(words)));
    assert.throws(() => og.ogImage({ ...words, tagline: 'Was ist das? ~' }), /no glyph for "~"/);
  });

  test('crc32 matches the standard check value', () => {
    assert.equal(og.crc32(Buffer.from('123456789')), 0xcbf43926);
  });
});

/** A stand-in browser window for beacon.js: storage maps, the elements it listens on, and a recording fetch. `env: null` is a page without the deploy meta. */
function fakeWindow({ env = 'production', webdriver = false, referrer = '', local = new Map(), session = new Map(), storageThrows = false, buy = true, fetchImpl } = {}) {
  const storage = (map) => ({ getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)) });
  const listeners = [];
  const element = (name) => ({ addEventListener: (type, fn) => listeners.push({ name, type, fn }) });
  const sent = [];
  const win = {
    navigator: { webdriver },
    location: { origin: SITE },
    document: {
      referrer,
      querySelector: (sel) => {
        if (sel === 'meta[name="vercel-env"]') return env === null ? null : { getAttribute: (a) => (a === 'content' ? env : null) };
        if (sel === 'a#buy') return buy ? element('buy') : null;
        return null;
      },
      querySelectorAll: (sel) => (sel === '[data-activate]' ? [element('install')] : []),
    },
    fetch:
      fetchImpl ??
      ((url, init) => {
        sent.push({ url, init, body: JSON.parse(init.body) });
        return Promise.resolve({ ok: true });
      }),
  };
  for (const [key, map] of [['localStorage', local], ['sessionStorage', session]]) {
    Object.defineProperty(win, key, {
      get() {
        if (storageThrows) throw new Error('SecurityError: storage is disabled');
        return storage(map);
      },
    });
  }
  const fire = (name, type) => listeners.filter((l) => l.name === name && l.type === type).forEach((l) => l.fn());
  return { win, sent, local, session, fire, listeners };
}

describe('L4: the visit beacon', () => {
  test('visit once per browser session, activate once per browser, checkout on every Buy click', () => {
    const local = new Map();
    const first = fakeWindow({ local });
    assert.equal(typeof beacon.startBeacon(first.win), 'function');
    assert.deepEqual(first.sent.map((s) => s.body.kind), ['visit']);

    const sameSession = fakeWindow({ local, session: first.session });
    beacon.startBeacon(sameSession.win);
    assert.deepEqual(sameSession.sent, [], 'another page in the same session: no second visit');

    first.fire('install', 'copy');
    first.fire('install', 'copy');
    sameSession.fire('install', 'copy');
    first.fire('buy', 'click');
    first.fire('buy', 'click');
    assert.deepEqual(first.sent.map((s) => s.body.kind), ['visit', 'activate', 'checkout', 'checkout']);
    assert.deepEqual(sameSession.sent, [], 'activate is once per browser');

    const nextSession = fakeWindow({ local });
    beacon.startBeacon(nextSession.win);
    nextSession.fire('install', 'copy');
    assert.deepEqual(nextSession.sent.map((s) => s.body.kind), ['visit'], 'a new session visits again, but never re-activates');
  });

  test('the request: a JSON POST to RepoHQ with the slug, kind and referrer; keepalive, no cookies, no Referer header', () => {
    const { win, sent } = fakeWindow();
    beacon.startBeacon(win);
    const [{ url, init, body }] = sent;
    assert.equal(url, 'https://repohq.vercel.app/api/ideas/signal');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['content-type'], 'application/json');
    assert.equal(init.keepalive, true);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.deepEqual(body, { slug: 'dawnlog', kind: 'visit', referrer: null });
    assert.deepEqual(Object.keys(body), ['slug', 'kind', 'referrer'], 'nothing else is sent');
  });

  test('referrer: the linking page when it is on another site; null for this site, none, or a non-web URL', () => {
    const hn = 'https://news.ycombinator.com/item?id=1';
    const { win, sent } = fakeWindow({ referrer: hn });
    beacon.startBeacon(win);
    assert.equal(sent[0].body.referrer, hn);
    const own = fakeWindow({ referrer: `${SITE}/terms` });
    beacon.startBeacon(own.win);
    assert.equal(own.sent[0].body.referrer, null, "this site's own URL never leaves");
    assert.equal(beacon.externalReferrer('', SITE), null);
    assert.equal(beacon.externalReferrer('not a url', SITE), null);
    assert.equal(beacon.externalReferrer('android-app://com.example/', SITE), null);
    assert.equal(beacon.externalReferrer(`${SITE}/?q=1`, SITE), null);
    assert.equal(beacon.externalReferrer('https://dawnlog.vercel.app.example/', SITE), 'https://dawnlog.vercel.app.example/', 'a look-alike host is another site');
  });

  test('sends nothing, and listens for nothing, to bots, previews, local builds, the opted-out owner, or without storage', () => {
    const cases = {
      'navigator.webdriver': { webdriver: true },
      'a preview deploy': { env: 'preview' },
      'a local build': { env: 'local' },
      'no deploy meta': { env: null },
      'repohq:notrack set': { local: new Map([['repohq:notrack', '1']]) },
      'repohq:notrack set to an empty string': { local: new Map([['repohq:notrack', '']]) },
      'storage that throws': { storageThrows: true },
    };
    for (const [name, options] of Object.entries(cases)) {
      const { win, sent, listeners, fire } = fakeWindow(options);
      assert.equal(beacon.startBeacon(win), null, name);
      fire('install', 'copy');
      fire('buy', 'click');
      assert.deepEqual(sent, [], name);
      assert.deepEqual(listeners, [], `${name}: no listeners`);
    }
  });

  test('fire-and-forget: a failing or refused fetch never breaks the page; no Buy link means no checkout listener', async () => {
    const rejecting = fakeWindow({ fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) });
    assert.doesNotThrow(() => beacon.startBeacon(rejecting.win));
    const throwing = fakeWindow({ fetchImpl: () => { throw new TypeError('keepalive quota exceeded'); } });
    assert.doesNotThrow(() => beacon.startBeacon(throwing.win));
    assert.doesNotThrow(() => throwing.fire('buy', 'click'));
    await new Promise((resolve) => setImmediate(resolve)); // an unhandled rejection would fail the run here
    const noBuy = fakeWindow({ buy: false });
    beacon.startBeacon(noBuy.win);
    assert.ok(!noBuy.listeners.some((l) => l.name === 'buy'));
  });

  test('a storage that refuses writes counts as seen, so an event is never sent twice', () => {
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    assert.equal(beacon.firstTime(full, 'k'), false);
  });

  test('the pages are wired: deploy env from VERCEL_ENV, the beacon on public pages only, the install line marked', () => {
    const { html } = build({ VERCEL_ENV: 'production' });
    for (const file of PUBLIC) {
      assert.equal(meta(html[file], 'name', 'vercel-env'), 'production', file);
      assert.match(html[file], /<script type="module" src="beacon\.js"><\/script>/, file);
    }
    assert.ok(!html['thanks.html'].includes('beacon.js'), 'the page after paying sends nothing');
    assert.equal(meta(html['thanks.html'], 'name', 'vercel-env'), undefined);
    const install = /<pre\b[^>]*\sdata-activate="install"[^>]*>([\s\S]*?)<\/pre>/.exec(html['index.html']);
    assert.ok(install, 'the install line carries data-activate');
    assert.equal(install[1].replace(/<[^>]+>/g, ''), site.INSTALL);
    assert.match(html['index.html'], /<p id="buy"/, 'checkout off: #buy is not a link, so no checkout event can fire');
    for (const [VERCEL_ENV, expected] of [['preview', 'preview'], ['development', 'development'], [undefined, 'local'], ['staging', 'local']]) {
      assert.equal(meta(build({ VERCEL_ENV }).html['index.html'], 'name', 'vercel-env'), expected, String(VERCEL_ENV));
    }
  });

  test('beacon.js touches no cookie and writes no markup', () => {
    const src = fs.readFileSync(path.join(ROOT, 'site', 'pages', 'beacon.js'), 'utf8');
    assert.ok(!/document\.cookie|innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|sendBeacon/.test(src));
  });
});

describe('L5: privacy, terms and provisioning', () => {
  const words = (html) => unescape(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

  test('the privacy page names the beacon, its three events, what it sends and how to turn it off', () => {
    const page = words(build().html['privacy.html']);
    for (const event of ['visit', 'activate', 'checkout']) assert.match(page, new RegExp(`\\b${event}\\b`), event);
    assert.match(page, /repohq\.vercel\.app/);
    assert.match(page, /no cookie/i);
    assert.match(page, /no identifier/i);
    assert.match(page, /IP address/);
    assert.match(page, /sessionStorage/);
    assert.match(page, /localStorage/);
    assert.match(page, /repohq:notrack/);
    assert.match(page, /automated browsers/i);
    assert.match(page, /another website/i, 'the referrer is sent only from other sites');
  });

  test('privacy and terms: contact through the GitHub repo issues; terms keep the price, refund and no warranty', () => {
    const { html } = build();
    for (const file of ['privacy.html', 'terms.html']) assert.ok(html[file].includes(`href="${site.ISSUES_URL}"`), `${file} links the issues`);
    assert.equal(site.ISSUES_URL, 'https://github.com/smithdavedesign/overnight-receipts/issues');
    const terms = words(html['terms.html']);
    assert.ok(terms.includes(`${pro.PRO_PRICE} (US dollars) as a one-time payment`), 'REVENUE.md: $12 once');
    assert.match(terms, /Within 30 days of buying, for any reason/);
    assert.match(terms, /without warranty of any kind/i);
    for (const file of Object.keys(html)) assert.ok(html[file].includes(`<footer class="foot">`) && html[file].includes('href="/privacy"') && html[file].includes('href="/terms"'), file);
  });

  test('.provision asks for the Vercel project and the Stripe Payment Link, and nothing else', () => {
    const lines = fs.readFileSync(path.join(ROOT, '.provision'), 'utf8').trim().split('\n');
    assert.deepEqual(lines, ['vercel project dawnlog', 'request "Stripe payment link for dawnlog: $12 once, per REVENUE.md"']);
  });

  test('the screenshot run stays out of npm test and never downloads a browser', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.screenshots, 'node scripts/screenshots.mjs');
    assert.ok(!pkg.scripts.test.includes('screenshots'));
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'screenshots.mjs'), 'utf8');
    assert.match(src, /executablePath: process\.env\.CHROMIUM_PATH/);
    assert.match(src, /STRIPE_PAYMENT_LINK: CHECKOUT/);
  });
});
