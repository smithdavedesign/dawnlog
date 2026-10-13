// `npm run site:build`: the storefront (REVENUE.md) as static files in dist/, which Vercel serves (vercel.json),
// plus a `_headers` file with the same security headers for Cloudflare Pages.
// The pages in site/pages/ are plain HTML with {{PLACEHOLDERS}}; the price and the license variable come from
// src/pro.js, so the site and the CLI can't disagree, and the Buy button comes from STRIPE_PAYMENT_LINK.
// The build also writes what search engines and link previews read: each public page's head (title, description,
// canonical URL, Open Graph and Twitter tags, JSON-LD), robots.txt, sitemap.xml and the share image og.png.
//
// STRIPE_PAYMENT_LINK is the "start charging" switch. Unset or blank, there's no Buy button and the page says
// "Checkout opens soon" (preview deploys, and until David turns checkout on). Set, it must be a Stripe Payment Link
// (https://buy.stripe.com/…): anything else fails the build, so Vercel keeps the last good deploy instead of
// shipping a wrong Buy link. The value is never printed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LICENSE_ENV, PRO_PRICE } from '../src/pro.js';
import { OG_HEIGHT, OG_WIDTH, ogImage } from './og-image.js';

export const CHECKOUT_ENV = 'STRIPE_PAYMENT_LINK';
export const REPO_URL = 'https://github.com/smithdavedesign/overnight-receipts';
export const ISSUES_URL = `${REPO_URL}/issues`;
export const INSTALL = 'npx github:smithdavedesign/overnight-receipts --since 12h';
export const NAME = 'overnight-receipts';
export const TAGLINE = 'What did your agent do overnight?';
/** Where the site lives when neither SITE_URL nor Vercel's VERCEL_PROJECT_PRODUCTION_URL says otherwise. */
export const DEFAULT_SITE_URL = 'https://dawnlog.vercel.app';
export const OG_IMAGE = 'og.png';

/**
 * The pages search engines may index, by template file: the clean URL each is served at (vercel.json's
 * cleanUrls; Cloudflare Pages does the same) and its own title and description. thanks.html isn't here: it's
 * noindex, has no canonical URL, and sends no beacon.
 */
export const PUBLIC_PAGES = {
  'index.html': {
    path: '/',
    title: `${NAME}: what did your agent do overnight?`,
    description: 'Morning triage receipts for overnight Claude Code runs: one receipt per git branch, from the session logs already on your disk. Free, MIT, local and read-only.',
  },
  'terms.html': {
    path: '/terms',
    title: `Terms · ${NAME}`,
    description: `The terms for ${NAME} Pro: a ${PRO_PRICE} one-time supporter license, refunds within 30 days, and software provided as is, with no warranty.`,
  },
  'privacy.html': {
    path: '/privacy',
    title: `Privacy · ${NAME}`,
    description: `What ${NAME} collects: the tool uploads nothing, and this site sets no cookies and counts three events (visit, activate, checkout) with one small beacon.`,
  },
};

const PAGES_DIR = fileURLToPath(new URL('pages/', import.meta.url));
const DEFAULT_OUT = fileURLToPath(new URL('../dist/', import.meta.url));
const STRIPE_LINK = /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+$/;
const DEPLOY_ENVS = new Set(['production', 'preview', 'development']);

/** The Payment Link from the env value: null when unset or blank; throws (without echoing it) when it isn't one. */
export function checkoutUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return null;
  // The message names the variable and the expected shape, never the value (it may be a paste of something else).
  if (!STRIPE_LINK.test(url)) throw new Error(`${CHECKOUT_ENV} is set but is not an https Stripe Payment Link on buy.stripe.com; fix or unset it`);
  return url;
}

/**
 * The site's origin, for canonical URLs, og:image, robots.txt and the sitemap: SITE_URL if set (a custom domain, or
 * another host), else Vercel's production domain (VERCEL_PROJECT_PRODUCTION_URL, set on every Vercel build, previews
 * included), else DEFAULT_SITE_URL. It must be a bare https origin; the error names the variable, not the value.
 */
export function siteUrl(env = {}) {
  const explicit = env.SITE_URL?.trim();
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const name = explicit ? 'SITE_URL' : 'VERCEL_PROJECT_PRODUCTION_URL';
  const raw = explicit || (vercel ? `https://${vercel}` : DEFAULT_SITE_URL);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} is not a URL; set SITE_URL to the site's https origin, like ${DEFAULT_SITE_URL}`);
  }
  const bare = url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  if (!bare || !/^https:\/\/[^/]+\/?$/.test(raw)) throw new Error(`${name} must be a bare https origin, like ${DEFAULT_SITE_URL}`);
  return url.origin;
}

/** Vercel's VERCEL_ENV as the pages see it (the beacon sends only on "production"); anything else is "local". */
export function deployEnv(env = {}) {
  return DEPLOY_ENVS.has(env.VERCEL_ENV) ? env.VERCEL_ENV : 'local';
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** PRO_PRICE ("$12") as schema.org wants it: the number alone, in USD. */
function offerPrice() {
  const m = /^\$(\d+(?:\.\d{2})?)$/.exec(PRO_PRICE);
  if (!m) throw new Error(`PRO_PRICE ${PRO_PRICE} is not a dollar amount`);
  return m[1];
}

/** The JSON-LD every public page carries: the tool, free and MIT, with Pro as a one-time Offer at PRO_PRICE. */
export function jsonLd(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: NAME,
    alternateName: 'dawnlog',
    description: PUBLIC_PAGES['index.html'].description,
    url: `${site}/`,
    image: `${site}/${OG_IMAGE}`,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'macOS, Linux',
    softwareRequirements: 'Node.js 22 or later, git',
    license: 'https://opensource.org/licenses/MIT',
    sameAs: REPO_URL,
    offers: {
      '@type': 'Offer',
      name: `${NAME} Pro`,
      description: `A supporter license: ${PRO_PRICE} once, no subscription. Everything works without it.`,
      price: offerPrice(),
      priceCurrency: 'USD',
      url: `${site}/#pro`,
    },
  };
}

/**
 * A public page's head: title, description, canonical URL, Open Graph and Twitter tags, JSON-LD, the deploy
 * environment the beacon checks, and the beacon itself (a module, so it runs after the page is parsed).
 * JSON-LD is a data block, not a script, so the CSP doesn't apply to it; `<` is escaped so no value can end it.
 */
export function pageHead(file, site, deploy) {
  const page = PUBLIC_PAGES[file];
  if (!page) throw new Error(`${file} is not a public page`);
  const url = `${site}${page.path}`;
  const image = `${site}/${OG_IMAGE}`;
  const imageAlt = `${NAME}: ${TAGLINE} A sample run ranked worst first: fix-login FAILED, db-users UNVERIFIED, add-search PASSED.`;
  const meta = (attr, key, value) => `<meta ${attr}="${key}" content="${escapeHtml(value)}">`;
  return [
    `<title>${escapeHtml(page.title)}</title>`,
    meta('name', 'description', page.description),
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', NAME),
    meta('property', 'og:title', page.title),
    meta('property', 'og:description', page.description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:type', 'image/png'),
    meta('property', 'og:image:width', String(OG_WIDTH)),
    meta('property', 'og:image:height', String(OG_HEIGHT)),
    meta('property', 'og:image:alt', imageAlt),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', page.title),
    meta('name', 'twitter:description', page.description),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', imageAlt),
    `<script type="application/ld+json">${JSON.stringify(jsonLd(site)).replace(/</g, '\\u003c')}</script>`,
    meta('name', 'vercel-env', deploy),
    '<script type="module" src="beacon.js"></script>',
  ].join('\n');
}

/** robots.txt: everything may be crawled (thanks is kept out by its noindex), and where the sitemap is. */
export function robotsTxt(site) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`;
}

/** sitemap.xml: the public pages at their canonical URLs. */
export function sitemapXml(site) {
  const urls = Object.values(PUBLIC_PAGES).map((p) => `  <url><loc>${escapeHtml(`${site}${p.path}`)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/**
 * Fills {{KEY}} from `text` (HTML-escaped) or `html` (inserted as built). An unknown key throws, so a typo in a
 * page fails the build instead of shipping raw braces.
 */
export function render(template, text = {}, html = {}) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (Object.hasOwn(html, key)) return html[key];
    if (Object.hasOwn(text, key)) return escapeHtml(text[key]);
    throw new Error(`unknown placeholder ${match}`);
  });
}

/** vercel.json's header rules: the one place the site's security headers live. */
export function readHeaderRules(file = new URL('../vercel.json', import.meta.url)) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).headers ?? [];
}

/**
 * The same rules as a `_headers` file, which Cloudflare Pages (and Netlify) read. Vercel's free Hobby plan is
 * non-commercial only, so once checkout is on, the same dist/ deploys to Cloudflare Pages' free plan with the
 * same CSP. Only the two source shapes vercel.json uses are translated; anything else throws rather than drop a header.
 */
export function headersFile(rules) {
  const blocks = [];
  for (const rule of rules) {
    let patterns;
    if (rule.source === '/(.*)') patterns = ['/*'];
    else if (/^\/[\w.-]+$/.test(rule.source)) patterns = rule.source.endsWith('.html') ? [rule.source, rule.source.slice(0, -5)] : [rule.source]; // Pages serves /x.html at /x
    else throw new Error(`can't translate header source ${rule.source} to _headers`);
    for (const p of patterns) blocks.push([p, ...rule.headers.map(({ key, value }) => `  ${key}: ${value}`)].join('\n'));
  }
  return `${blocks.join('\n\n')}\n`;
}

/** The landing page's Buy control: a link to the Payment Link, or a plain line while checkout is off. */
function buyControl(url) {
  return url
    ? `<a id="buy" class="buy" href="${escapeHtml(url)}">Buy Pro · ${escapeHtml(PRO_PRICE)} once</a>`
    : '<p id="buy" class="buy soon">Checkout opens soon.</p>';
}

/**
 * `out` is deleted before each build, so it must be missing, empty or a previous build (which always has
 * index.html and license.js), and never the pages themselves: `node site/build.js ~` must not wipe a home dir.
 */
function assertReplaceable(out) {
  const pages = path.resolve(PAGES_DIR);
  if (pages === out || pages.startsWith(out + path.sep)) throw new Error(`refusing to build into ${out}: it holds the site's source pages`);
  if (!fs.existsSync(out)) return;
  const entries = fs.readdirSync(out);
  if (entries.length > 0 && !(entries.includes('index.html') && entries.includes('license.js'))) {
    throw new Error(`refusing to replace ${out}: it isn't empty and isn't a previous site build`);
  }
}

/**
 * Writes the site to `out` (replaced as a whole, so no stale page survives) and returns what it wrote.
 * The checkout value and `out` are checked before anything is touched: a bad value leaves the old output alone.
 * @param {{ out?: string, env?: Record<string, string | undefined> }} options
 */
export function buildSite({ out = DEFAULT_OUT, env = process.env } = {}) {
  out = path.resolve(out);
  const url = checkoutUrl(env[CHECKOUT_ENV]);
  const site = siteUrl(env);
  const deploy = deployEnv(env);
  assertReplaceable(out);
  const text = { PRICE: PRO_PRICE, LICENSE_ENV, REPO_URL, ISSUES_URL, INSTALL };
  const html = { BUY: buyControl(url) };
  const rendered = fs
    .readdirSync(PAGES_DIR)
    .filter((f) => !f.startsWith('.'))
    .map((file) => {
      const source = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
      if (!file.endsWith('.html')) return [file, source];
      const head = PUBLIC_PAGES[file] ? { HEAD: pageHead(file, site, deploy) } : {};
      return [file, render(source, text, { ...html, ...head })];
    });
  for (const file of Object.keys(PUBLIC_PAGES)) {
    if (!rendered.some(([f, body]) => f === file && body.includes('<link rel="canonical"'))) throw new Error(`${file} is a public page without {{HEAD}}`);
  }
  rendered.push(
    ['_headers', headersFile(readHeaderRules())],
    ['robots.txt', robotsTxt(site)],
    ['sitemap.xml', sitemapXml(site)],
    [OG_IMAGE, ogImage({ name: NAME, tagline: TAGLINE, price: PRO_PRICE })],
  );
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const [file, body] of rendered) fs.writeFileSync(path.join(out, file), body);
  return { out, files: rendered.map(([file]) => file), checkout: url !== null, site, deploy };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const out = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT;
    const { files, checkout, site, deploy } = buildSite({ out });
    const where = path.relative(process.cwd(), out) || '.';
    process.stdout.write(`site: wrote ${files.length} files to ${where} · ${site} (${deploy}) · checkout: ${checkout ? 'on' : `off (${CHECKOUT_ENV} unset)`}\n`);
  } catch (err) {
    process.stderr.write(`site:build: ${err.message}\n`);
    process.exitCode = 1;
  }
}
