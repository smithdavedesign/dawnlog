// `npm run site:build`: the storefront (REVENUE.md) as static files in dist/, which Vercel serves (vercel.json),
// plus a `_headers` file with the same security headers for Cloudflare Pages.
// The pages in site/pages/ are plain HTML with {{PLACEHOLDERS}}; the price and the license variable come from
// src/pro.js, so the site and the CLI can't disagree, and the Buy button comes from PRO_CHECKOUT_URL.
//
// PRO_CHECKOUT_URL is the "start charging" switch. Unset or blank, the page says "Checkout opens soon" (preview
// deploys, and until David turns checkout on). Set, it must be a Stripe Payment Link (https://buy.stripe.com/…):
// anything else fails the build, so Vercel keeps the last good deploy instead of shipping a wrong Buy link.
// The value is never printed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LICENSE_ENV, PRO_PRICE } from '../src/pro.js';

export const CHECKOUT_ENV = 'PRO_CHECKOUT_URL';
export const REPO_URL = 'https://github.com/smithdavedesign/overnight-receipts';
export const INSTALL = 'npx github:smithdavedesign/overnight-receipts --since 12h';

const PAGES_DIR = fileURLToPath(new URL('pages/', import.meta.url));
const DEFAULT_OUT = fileURLToPath(new URL('../dist/', import.meta.url));
const STRIPE_LINK = /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+$/;

/** The Payment Link from the env value: null when unset or blank; throws (without echoing it) when it isn't one. */
export function checkoutUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return null;
  // The message names the variable and the expected shape, never the value (it may be a paste of something else).
  if (!STRIPE_LINK.test(url)) throw new Error(`${CHECKOUT_ENV} is set but is not an https Stripe Payment Link on buy.stripe.com; fix or unset it`);
  return url;
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
  assertReplaceable(out);
  const text = { PRICE: PRO_PRICE, LICENSE_ENV, REPO_URL, INSTALL };
  const html = { BUY: buyControl(url) };
  const rendered = fs
    .readdirSync(PAGES_DIR)
    .filter((f) => !f.startsWith('.'))
    .map((file) => {
      const source = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
      return [file, file.endsWith('.html') ? render(source, text, html) : source];
    });
  rendered.push(['_headers', headersFile(readHeaderRules())]);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const [file, body] of rendered) fs.writeFileSync(path.join(out, file), body);
  return { out, files: rendered.map(([file]) => file), checkout: url !== null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const out = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT;
    const { files, checkout } = buildSite({ out });
    const where = path.relative(process.cwd(), out) || '.';
    process.stdout.write(`site: wrote ${files.length} files to ${where} · checkout: ${checkout ? 'on' : `off (${CHECKOUT_ENV} unset)`}\n`);
  } catch (err) {
    process.stderr.write(`site:build: ${err.message}\n`);
    process.exitCode = 1;
  }
}
