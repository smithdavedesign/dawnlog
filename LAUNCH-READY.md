# Launch ready: dawnlog (overnight-receipts)

The go-live pass of 2026-10-13. The product does what it did before. The CLI is untouched: it's still offline, still read-only and still free. This pass made its storefront (`site/`, built to `dist/` and served by Vercel) ready for a public launch.

**Status:** `npm test` gives 290 tests and 0 failures. 265 were there before; 25 are new in `test/launch.test.js`. `npm run screenshots` passes, and I opened and checked every PNG.

## What I did

**1. Search and sharing.** The site is plain HTML built by `site/build.js`, with no framework. So "the framework's conventions" means the build writes what a framework would generate.
- **Every public page** (`/`, `/terms`, `/privacy`) gets:
  - its own `<title>` and meta description
  - a canonical URL
  - Open Graph tags and a `summary_large_image` Twitter card, both using the share image
  - JSON-LD: a `SoftwareApplication`, free and MIT, with Pro as an `Offer` of `12` `USD`. The price comes from `PRO_PRICE` in `src/pro.js`, so the site, the JSON-LD and the CLI can't disagree.
- **`/thanks`** (after payment) stays out of search: `noindex`, no canonical URL, no share tags.
- **`robots.txt`** allows everything and points at `sitemap.xml`. The sitemap lists the three public pages at their canonical URLs.
- **The share image** `og.png` (1200×630) is drawn by code at build time, in `site/og-image.js`. That's a 5×7 pixel font, a circle and some rectangles, encoded as a PNG with `node:zlib`. Nothing is copied in and nothing is installed. It shows the name, "What did your agent do overnight?", a ranked sample run and "Pro $12 once".
- **The site's address** for all of the above is resolved in this order:
  1. `SITE_URL`
  2. Vercel's own `VERCEL_PROJECT_PRODUCTION_URL` (set on every Vercel build, so a custom domain is picked up automatically)
  3. `https://dawnlog.vercel.app`

**2. `/privacy` and `/terms`.** Both pages existed; now they're served at those clean paths (`cleanUrls` in `vercel.json`).
- **Privacy:**
  - The tool collects nothing.
  - The site sets no cookies and uses no third-party analytics.
  - It describes the visit beacon: its three events, exactly what each message holds, the IP address its host sees, the two storage notes, when nothing is sent, and how to opt out.
- **Terms** keep "$12 (US dollars) as a one-time payment", the 30-day refund, and "provided as is, without warranty of any kind".
- **Contact:** both pages, and every footer, link the GitHub repo's issues. Every footer also links Terms and Privacy.

**3. Payment.** The Buy button ("Buy Pro · $12 once") links to `STRIPE_PAYMENT_LINK`, read at build time. The variable was renamed from `PRO_CHECKOUT_URL`.
- Unset or blank: there's no Buy button and no Stripe link anywhere, and the Pro box says "Checkout opens soon".
- Set to anything but a `https://buy.stripe.com/…` link: the build fails without printing the value, and Vercel keeps the last good deploy.
- Nothing is hard-coded. The static site never needs the value in the browser, so there's no `NEXT_PUBLIC_` copy.

**4. Visit beacon** (`site/pages/beacon.js`). It POSTs `{"slug":"dawnlog","kind":…,"referrer":…}` to `https://repohq.vercel.app/api/ideas/signal`.
- **How it's sent:** fire-and-forget `fetch`, with `keepalive`, `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`. The CSP's `connect-src` allows that one origin and nothing else.
- **`visit`:** on each public page, once per browser session (`sessionStorage`).
- **`activate`:** the first time someone **copies the install command** (`npx github:smithdavedesign/overnight-receipts --since 12h`) from the landing page. Once per browser (`localStorage`). **This is the core action.** The product's real core action, running the CLI, happens on the user's machine. The CLI promises "no telemetry" and its tests assert it opens no socket, so it must not phone home. Copying the install line is the last step the website can see before someone runs it.
- **`checkout`:** every click on the Buy button. It only exists when checkout is on.
- **`referrer`:** `document.referrer` only when its origin differs from the page's, else `null`.
- **Nothing is sent** in any of these cases:
  - `navigator.webdriver` is true
  - the build wasn't a production deploy (the build writes Vercel's `VERCEL_ENV` into `<meta name="vercel-env">`, and the beacon requires `production`)
  - `localStorage` has `repohq:notrack`
  - storage can't be read
  - the thanks page (it doesn't load the beacon)

**5. `.provision`** has exactly the two lines from the brief: the Vercel project `dawnlog` and the request for a $12 one-time Stripe Payment Link.

**6. Tests** (`test/launch.test.js`, plus updates in `test/storefront.test.js`):
- every public page's tags, JSON-LD and price
- unique titles and descriptions
- the thanks page staying out of search
- `SITE_URL` and Vercel domain handling, including bad values that fail without being echoed
- `robots.txt` and the sitemap
- the PNG, checked with node's own CRC: size, chunks, decoding, not blank, deterministic
- the beacon, on a fake window: once-per-session and once-per-browser rules, the request shape, the referrer rule, every no-send case, and fetch failures never breaking the page
- the privacy and terms wording
- `.provision`
- the Buy button hidden without the variable
- clean URLs and redirects in the preview server
- the CSP's `connect-src`

**7. Screenshots** (`npm run screenshots`, with `playwright-core` as a devDependency and Chromium from `CHROMIUM_PATH`; it never downloads a browser):
- **How it runs:** it builds the production site with a stand-in Payment Link and `VERCEL_ENV=production`, serves it on localhost with `vercel.json`'s headers, and waits until it answers. It checks that `robots.txt`, `sitemap.xml` and `og.png` are served, then captures three views at 1280×800 and on an iPhone 13.
  - `home-*`: the landing page, with the Buy button
  - `receipts-*`: the core job, the real CLI run on the demo fixture
  - `license-*`: the thanks page, with the footer's Terms, Privacy, Source and Contact links
- **The stand-in link** is a `buy.stripe.com/test_…` value built at runtime, not `https://example.com/pay`, because the build rejects anything that isn't a Stripe Payment Link.
- **It fails on** any console error, any CSP violation, or any request to RepoHQ: Playwright sets `navigator.webdriver`, so the site must send nothing.
- The README's `## Screenshots` section has the six PNGs, with captions.

## Decisions (nobody to ask)

| Question | Decision | Why |
|---|---|---|
| The core action for `activate` | Copying the install command | The CLI must stay offline (its privacy promise and its tests). The install line is the site's last step before use. |
| `/privacy` vs `privacy.html` | `cleanUrls: true` in `vercel.json`, with links and canonical URLs on `/terms`, `/privacy`, `/thanks` | The brief names `/privacy` and `/terms`. Cloudflare Pages serves the same paths, so both hosts agree. `site/serve.js` mirrors it locally, and `.html` paths redirect with the query kept. |
| Keep `PRO_CHECKOUT_URL` as an alias? | No: a clean rename to `STRIPE_PAYMENT_LINK` | It was never set anywhere (no Vercel project existed yet), and two names for one switch is a trap. |
| Keep "Checkout opens soon" when unset? | Yes. The Buy button is hidden, and the note stays. | That's existing behaviour ("without changing what it does"), and it's honest: nothing can be bought. |
| `fetch` vs `navigator.sendBeacon` | `fetch` with `keepalive` | `sendBeacon` can't send `application/json` cross-origin, and it can't set `credentials: 'omit'`. |
| JSON-LD under a strict CSP | Inline `<script type="application/ld+json">` | Browsers don't run data blocks, so the CSP doesn't apply. The screenshot run confirms there's no console error. `<` is escaped so no value can close the tag. |
| `operatingSystem` in JSON-LD | `macOS, Linux` | BUILD.md says Windows is untested. |
| Beacon on the thanks page | None | It isn't a public page, and its URL carries the buyer's session id. |

## How to check it

```sh
npm test                                            # 290 tests, 0 failures
npm run site:build && ls dist                       # og.png, robots.txt, sitemap.xml, the pages, _headers
STRIPE_PAYMENT_LINK=https://buy.stripe.com/<link id> npm run site:build   # "checkout: on"; without it, "off"
npm run site:preview                                # http://127.0.0.1:4173/, /terms, /privacy, /robots.txt, /sitemap.xml, /og.png
CHROMIUM_PATH=/path/to/chromium npm run screenshots # regenerates docs/screenshots/, fails on console errors or a beacon request
```

After the first production deploy:
1. View the source of `/`, `/terms` and `/privacy`. Check that each title and canonical URL is its own, and that `og:image` is `https://<domain>/og.png`.
2. Open `https://<domain>/robots.txt`, `https://<domain>/sitemap.xml` and `https://<domain>/og.png`.
3. Paste the home URL into a link-preview checker (for example, a draft post on X or LinkedIn) and into Google's Rich Results Test.
4. Check the beacon in a normal (not automated) browser, with DevTools › Network open on `/`.
   - You should see one `signal` request answered with 2xx. Copying the install line should send one more (`activate`).
   - **If the request fails with a CORS error,** RepoHQ's endpoint needs to answer the preflight for this origin. The beacon sends `Content-Type: application/json`, which needs one. That's a RepoHQ change; nothing here needs to change.

## What's left for David

1. **Paste the Stripe Payment Link into the Vercel env as `STRIPE_PAYMENT_LINK`, then redeploy.** The `.provision` request asks the broker for the link.
   - Scope it to **Production** only, so preview deploys keep the Buy button hidden.
   - In Stripe, set the link's after-payment redirect to `https://<domain>/thanks?session_id={CHECKOUT_SESSION_ID}`.
   - Try one test-mode purchase.
   - REVENUE.md's gate still applies: switch checkout on only once attribution is at least 90% on 10+ real runs.
2. **Decide where checkout runs.** Vercel's free Hobby plan is for non-commercial use, and a $12 sale is commercial. BUILD.md found this in the M3 pass. The brief puts the link in the Vercel env, so that's what's set up. Either way, nothing changes in the code:
   - **Vercel Pro:** $20/month, which breaks the $0 rule.
   - **Cloudflare Pages:** free, and commercial use is allowed. Connect the same repo with build command `npm run site:build`, output `dist`, `NODE_VERSION=22`, `STRIPE_PAYMENT_LINK` and `SITE_URL=https://<pages domain>`. The build already writes `dist/_headers` for Pages. Then add that origin to RepoHQ's CORS if it lists origins.
3. **A custom domain, if you want one.** Add it in Vercel. `VERCEL_PROJECT_PRODUCTION_URL` picks it up on the next build, so the canonical URLs, sitemap and share image follow. Elsewhere, set `SITE_URL`. Without one, the site lives at `https://dawnlog.vercel.app`, or at whatever `*.vercel.app` name Vercel assigns if that one is taken.
4. **Make the GitHub repo public (or `npm publish`).** Until then the install line, the Source link and the Contact link (GitHub issues) on every page lead to a 404.
5. **In your own browser,** on the live site, run `localStorage.setItem('repohq:notrack', '1')` in the console so your visits aren't counted.
6. **From BUILD.md, unchanged:**
   - put the live storefront URL in README `## Pro`
   - add the seller's legal name, and governing law if wanted, to the terms
   - decide on Stripe Tax
   - bump the version when publishing

## Self-review

I reviewed this diff (`git status`, `git diff`) against gstack's pre-landing checklist ("Review Categories", "Fix-First Heuristic").

**Pass 1, critical: no CRITICAL findings.** By category:
- **SQL, data safety, concurrency:** none here. There's no database or server code.
- **XSS:**
  - Every head value is HTML-escaped.
  - In the JSON-LD, `<` is escaped.
  - The Buy URL is allowlisted (`buy.stripe.com`) and escaped.
  - `beacon.js` writes no markup and touches no cookie (tested).
  - The preview server's new `.html` → clean redirect collapses leading slashes, so it can't emit a `//host` Location (tested).
- **LLM trust boundary, shell injection:** not touched.
- **Enum and value completeness:**
  - The header rule moved from `/thanks.html` to `/thanks`. I read all three consumers: `serve.js` `headersFor` matches the clean path, and `headersFile` and the tests follow it.
  - The checkout variable rename: grep finds no `PRO_CHECKOUT_URL` left outside BUILD.md's history and ROADMAP's rename note.
  - The beacon's `kind` values are the three the brief lists.

**Pass 2, informational:**
- [P2] (confidence: 6/10) `beacon.js` — **Possible CORS preflight failure.** A cross-origin JSON POST needs one, and whether RepoHQ answers it can't be checked from here. If it doesn't, events are lost silently and the page is unaffected. Check 4 above covers it. *Not fixed:* switching to a `text/plain` body would dodge the preflight but break "POST JSON", which is a design call for RepoHQ's side.
- [P3] (confidence: 7/10) `beacon.js` — **`sessionStorage` is per tab,** so a visitor who opens the site in two tabs counts as two visits. That's how the brief defines a session, so it's accepted.
- [P3] (confidence: 5/10) `site/build.js` — **`VERCEL_ENV` is baked in at build time.** A preview build later promoted to production without a rebuild keeps the beacon off. Vercel normally rebuilds for production, so it's accepted.
- [P3] (confidence: 8/10) `beacon.js` — **The `referrer` is attacker-chosen text.** Anyone can link from any URL. RepoHQ should escape it when it displays it.
- **Auto-fixed during the review:** the privacy page said nothing is sent from "automated browsers"; it now says "automated browsers that say they are one", which is what `navigator.webdriver` can detect.
