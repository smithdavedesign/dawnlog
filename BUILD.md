# BUILD — dawnlog (overnight-receipts)

_Renamed from **dawnlog** to **overnight-receipts** on 2026-10-11 (the npm name was taken). Older notes below were written under the old name; the command is now `overnight-receipts`, the env vars `OVERNIGHT_RECEIPTS_*`._

History:
- M1 was built non-interactively by idea-build on 2026-10-11.
- M2 and M3 were built the same day in a Claude Code session.
- On 2026-10-13 an MVP run took M2 and then M3 again, this time with REVENUE.md as an input. The goal is a product that can take money at the end.

The [Plan](#plan) below is for this run's M3 pass, the storefront. The M2 pass plan, the M1 plan and the first M2/M3 notes are kept as written further down.

**Go-live pass (2026-10-13), after the M3 pass.** It is described in [LAUNCH-READY.md](LAUNCH-READY.md), with its decisions and what's left for David. It changed four things the notes below describe:
- **The checkout variable is now `STRIPE_PAYMENT_LINK`** (it was `PRO_CHECKOUT_URL`). It's renamed throughout this file, and the behaviour is unchanged.
- **The site no longer says "no analytics".** It sends RepoHQ's visit beacon, and the privacy page describes it: three events, no cookie and no identifier.
- **Clean URLs:** `vercel.json` has `cleanUrls`, so the pages are `/terms`, `/privacy` and `/thanks`, and the `noindex` header rule is on `/thanks`.
- **Where checkout goes live:** the go-live brief puts the Payment Link in the Vercel env and `.provision` asks only for the Vercel project and the link. That reverses the Cloudflare-only decision below. The Hobby plan's non-commercial clause is still true, so LAUNCH-READY.md flags it for David.

## Plan

**M3 pass of the MVP run (2026-10-13): the storefront.** This was planned non-interactively with gstack's Step 0, Architecture review and Test review. Nobody was available to answer questions, so each decision is written down here with its reason.

### Step 0: Scope Challenge

1. **What already solves each sub-problem?**
   - ROADMAP's three M3 exit criteria are already built and green in `test/m3.test.js`: only `git` runs without `--summarize`, the digest is written, and Entire checkpoints are read. Nothing there needs rebuilding.
   - What's left from REVENUE.md is what the M2 pass assigned to M3: a landing page, the Stripe checkout, terms and privacy, and what the buyer gets after paying (the license string).
   - Existing code carries most of it:
     - `src/pro.js` already owns the price (`PRO_PRICE`) and the license variable (`LICENSE_ENV`). The site reads both from there instead of restating them.
     - The CLI already accepts any non-blank license, so the page after payment only has to hand over a string.
     - `runCli` in `test/helpers.js` can prove the whole loop: the string from that page hides the CLI's footer.
   - **[Layer 1]** Stripe does the checkout. A Payment Link is a hosted checkout page with no code. Its after-payment redirect can carry `{CHECKOUT_SESSION_ID}` (docs.stripe.com/payment-links/post-payment), so a static page can show a per-purchase license string without a server.
   - **[Layer 1]** Vercel serves a static directory from `vercel.json` (`buildCommand`, `outputDirectory`, `headers`) on the free tier.
2. **Minimum change set:**
   - `site/pages/`: four static pages (landing, terms, privacy, thanks), one stylesheet, and a browser module of about 20 lines for the license line.
   - `site/build.js`: fills in the price, the license variable and the Buy button (from `STRIPE_PAYMENT_LINK`), then writes `dist/`.
   - `vercel.json`: the build command, the output directory and security headers.
   - `.provision`: the Vercel project, plus requests to David for the Payment Link and (added during the build, see the search check) a Cloudflare Pages project.
   - This run also requires screenshots: `scripts/screenshots.mjs`, `site/serve.js` (a local preview server the screenshots use), and `playwright-core` as a devDependency.
3. **Complexity check:**
   - New code: `site/build.js` (about 100 lines), `site/serve.js` (about 70), `site/pages/license.js` (about 20) and `scripts/screenshots.mjs`. That's 0 classes and one new service (a static site).
   - The diff touches more than 8 files. Most of them are content (HTML, CSS, docs), not code.
   - Two reductions were considered and rejected:
     - **Drop `serve.js` and screenshot `file://` URLs.** ES modules don't load over `file://`, and the screenshots must come from an app answering on localhost. The server also sends `vercel.json`'s CSP, so the screenshots prove the CSP doesn't break the pages.
     - **Drop the license script and put one fixed string in Stripe's confirmation message.** About 20 lines buys a string that maps to one payment. That's what manual refunds and "I lost my license" need while fulfilment is manual (REVENUE: manual for the first 10 sales).
4. **Search check:**
   - **[Layer 1]** Stripe Payment Links: `{CHECKOUT_SESSION_ID}` in the after-payment redirect. **Footgun, from the same docs:** a buyer may never reach the redirect page (closed tab, dropped connection). So the thanks page can't be the only way to get the string. The thanks page and the terms both say to reply to the Stripe receipt, and the maintainer looks the payment up in the dashboard. Webhooks would automate this, but they need a server and a signing secret, and REVENUE says to automate nothing before the tenth sale.
   - **[Layer 1]** Vercel static deploys through `vercel.json`. **Footguns:**
     - CSP keywords need single quotes inside the JSON string.
     - Guides often add `'unsafe-inline'`. It isn't needed here, because the pages have no inline script or style (tested).
   - **Found while writing the deploy notes: Vercel's free Hobby plan is "non-commercial personal use only".** Its fair-use guidelines count any deployment "used for the purpose of financial gain of anyone involved" as commercial, though asking for donations isn't. A $12 Stripe link qualifies, and Vercel Pro ($20/month) would break the $0 rule. **[Layer 1]** Cloudflare Pages' free plan allows commercial use (Cloudflare's self-serve agreement has no such restriction) and reads a `_headers` file from the output directory. **Decision:**
     - The build also writes `dist/_headers`, generated from `vercel.json`'s rules, so there's one source for the headers.
     - Vercel (`vercel project dawnlog`) hosts the pre-launch page and previews while checkout is off, so no money changes hands there.
     - The live storefront with checkout goes on Cloudflare Pages: a `request` for David, and `STRIPE_PAYMENT_LINK` is set only there.
     - Footgun: Pages serves `/thanks.html` at `/thanks`, so `_headers` gets both paths.
   - **[Layer 1]** No static site generator. Four pages and a `replace` that fails on an unknown placeholder are less code than configuring one. The build keeps 0 dependencies: Vercel's install only fetches playwright-core, which downloads no browser.
   - **[EUREKA]** The checkout URL is the "start charging" switch. REVENUE says not to charge until attribution is at least 90% on David's own runs. The Buy button exists only when `STRIPE_PAYMENT_LINK` is set in Vercel's env. So the gate is a config step David takes after that check, not a code change. Until then the page says "Checkout opens soon", never a dead link.
5. **TODOS.md:** none exists. Follow-ups go to "What's left".
6. **Completeness check:** the tests cover:
   - both checkout states, plus a set-but-invalid value (the build fails without echoing it)
   - every page's links and assets
   - the legal commitments REVENUE lists
   - the license string's validation, including injection attempts
   - path traversal in the preview server
   - the end-to-end loop: page → license → no CLI footer
7. **Distribution check:** the new artifact is the static site. The host builds it from the repo on every push (Git integration), on a free tier: Vercel with `vercel.json` before launch, then Cloudflare Pages with `dist/_headers` once checkout is on. It isn't shipped in the npm package: `files` doesn't list `site/` (tested). There's no CI workflow, since Vercel does the build; that's in What's left, as before.

### Scope

**In (M3 pass):**
- **Landing (`index.html`):**
  - what it is
  - the free install line
  - a sample receipt
  - what's free and what Pro is
  - the Buy button, or "Checkout opens soon"
  - terms and privacy links right under it
- **Terms and privacy pages:**
  - local only, read-only, nothing uploaded
  - redaction is best-effort, and the software is provided as is
  - 30-day refunds
  - Stripe takes the payment, and Vercel hosts with standard logs
  - no cookies or analytics
  - it's an honour system, and how to get a lost license
- **Thanks (`thanks.html?session_id=…`):** the license line `export OVERNIGHT_RECEIPTS_LICENSE="cs_…"`, or a fallback that says how to get it. The page is `noindex`.
- **`STRIPE_PAYMENT_LINK`** (host env, on Cloudflare Pages only): only `https://buy.stripe.com/…` links are accepted.
- **`vercel.json`** with security headers, the same headers as **`dist/_headers`** for Cloudflare Pages, and **`.provision`**.
- **README `## Pro`:** describes the storefront. The live link is added at launch.

**Deliberately not in this pass:**
- **A server, webhooks, license checks or a license database.** REVENUE says to automate nothing before the tenth sale, and Pro is an honour system.
- **Analytics or counting clicks.** The privacy page promises none. Stripe's dashboard counts payments. REVENUE's step 6 counting stays manual: GitHub stars and issues, npm downloads, Stripe payments.
- **A custom domain.** It costs money, and `*.vercel.app` is free.
- **Changing the CLI.** The footer still links to the README's `#pro`, which always exists. The storefront's URL isn't known until Vercel assigns it (`dawnlog.vercel.app` if that name is free). Hardcoding a guess would risk a dead link in every Markdown file. The launch checklist puts the live URL into the README.
- **Stripe Tax, governing law, and the seller's legal name in the terms.** These are David's decisions and are on the launch checklist.
- **Gating Pro features.** This was decided in the M2 pass.

### Architecture

```
 CLI --out FILE.md ── footer link ──▶ README #pro ── (link added at launch) ──▶ storefront
                                                                                │
 site/pages/*.html ─┐                                                           ▼
 src/pro.js ────────┼─▶ site/build.js ─▶ dist/  ── Vercel (vercel.json): pre-launch, checkout off
   PRO_PRICE        │     {{PRICE}} {{LICENSE_ENV}} {{BUY}}  └ Cloudflare Pages (dist/_headers): live ─▶ index.html
   LICENSE_ENV      │     fails on an unknown placeholder       same headers: CSP default-src 'self',
 STRIPE_PAYMENT_LINK ──┘     and on a set-but-invalid URL;          no-referrer, nosniff       │ Buy (only if
   (Pages env)            _headers generated from vercel.json                               │ STRIPE_PAYMENT_LINK)
                                                                            ▼
                                             buy.stripe.com Payment Link (David's Stripe account)
                                                                            │ after payment: redirect to
                                                                            ▼ thanks.html?session_id={CHECKOUT_SESSION_ID}
                     license.js: session id ─(regex)─▶ textContent ─▶ export OVERNIGHT_RECEIPTS_LICENSE="cs_…"
                                                                            │ buyer pastes it in a shell profile
                                                                            ▼
                                                 CLI: proFooter(env) is null, so no footer
 local: site/serve.js dist/ (127.0.0.1, same headers as vercel.json) ◀── scripts/screenshots.mjs (Playwright)
```

- **Boundaries:**
  - `site/` is the storefront and isn't in the npm package.
  - `site/build.js` only reads `src/pro.js` constants, so it doesn't change the CLI.
  - The pages are static, and the only script is `license.js`. It reads the query string and writes `textContent`.
- **Security:**
  - The checkout URL comes from env, and only `https://buy.stripe.com/<id>` is accepted. That allowlist means a typo or a hostile value can't put another link behind the Buy button. Attribute escaping still applies.
  - The session id is matched against `cs_(test|live)_[A-Za-z0-9]+` and written with `textContent`, so it can't inject markup.
  - `Referrer-Policy: no-referrer`, as both a header and a meta tag, keeps the session id in the thanks URL from leaking through links.
  - The preview server binds to 127.0.0.1 and refuses paths outside its root.
- **Data flow:** no data is stored anywhere we run. Stripe holds the payment. The license string lives in the buyer's URL and shell profile.
- **Failure scenarios:**

| Codepath | Realistic failure | Handled by |
|---|---|---|
| `STRIPE_PAYMENT_LINK` unset (preview deploys, or before David's go-ahead) | A Buy button to nowhere | No link. The page says "Checkout opens soon" (test). |
| `STRIPE_PAYMENT_LINK` mistyped (`http:`, a dashboard URL, a stray quote) | A broken or hostile Buy link goes live | The build fails, so Vercel keeps the last good deploy. The message names the variable, never its value (test). |
| Buyer closes the tab before the redirect (Stripe's own warning) | Paid, no license string | The terms and thanks page say to reply to the Stripe receipt. Any non-blank value works meanwhile (honour system). |
| Thanks page opened without, or with a forged, `session_id` | Script injection, or a junk license | The regex rejects it, the fallback text shows, and nothing is injected (test with `<img onerror>` and quote payloads). |
| A page edit adds an inline script or a CDN font | The CSP blocks it on Vercel, or the privacy promise breaks | A test fails on inline scripts and styles, `on*=` handlers and any other-origin `src` or `href` except the allowed links. |
| A template edit leaves `{{SOMETHING}}` | Raw braces on the live page | The build throws on unknown placeholders, and a test checks that none survive. |
| Preview server path traversal (`/..%2fpackage.json`) | Leaks repo files on localhost | Paths are resolved and checked to stay under the root, and NUL bytes are rejected (test). |
| The host runs `npm install` | A browser download or install script runs | `playwright-core` downloads no browser and has no install script. |
| Checkout switched on for the Vercel Hobby deploy | Breaks Vercel's non-commercial clause, and the project can be suspended | `STRIPE_PAYMENT_LINK` goes only to Cloudflare Pages (the `.provision` request says so). `_headers` gives that host the same CSP (test). |
| A header added to `vercel.json` in a shape `serve.js` or `_headers` can't translate | It's missing locally or on Cloudflare Pages | The build throws on an untranslatable source, and a test pins `vercel.json` to the two supported shapes. |

### Test plan

New file `test/storefront.test.js`. Each test fails before the change: `site/build.js`, `site/serve.js`, `site/pages/license.js` and `vercel.json` don't exist yet.

| Exit criterion (ROADMAP M3, revenue) | Tests |
|---|---|
| S1. `npm run site:build` writes the static site; every internal link and asset resolves; no placeholder is left | `buildSite` into a temp dir: the files exist, every relative `href` and `src` resolves to a built file, no `{{`, and each page has `lang`, `charset`, viewport and `title`. The CLI (`node site/build.js DIR`) exits 0 and says whether checkout is on. `package.json` has `site:build`. An unknown placeholder throws. |
| S2. Landing: what it is, the free install line, the price from `PRO_PRICE`, terms and privacy next to the buy button | Text checks on `index.html`. The `#buy` section holds `terms.html` and `privacy.html` links, and the sample receipt shows `[REDACTED]`. |
| S3. Checkout switch | `checkoutUrl` unit cases. With a runtime-built `buy.stripe.com` link, `#buy` is an `<a>` to it, and it's the only Stripe URL in the site. Unset or blank: no `stripe.com` link anywhere and "Checkout opens soon". Invalid values (`http:`, another host, a quote payload, `javascript:`) make `buildSite` and the CLI fail, and neither error contains the value. |
| S4. Terms and privacy commitments; every page links both | Regex checks for each commitment, plus a footer check on all four pages. |
| S5. The thanks page shows the license string, and it hides the footer | `licenseFrom` and `showLicense` on a fake document: a valid id sets `textContent` and shows the block; missing, forged or injection ids leave the fallback. `thanks.html` has the elements and the module script. End to end: the id given to `runCli` as `OVERNIGHT_RECEIPTS_LICENSE` means the `--out` file has no footer. |
| S6. The site keeps its privacy promise | No other-origin `src`/`href` except the allowlist (GitHub repo, Stripe link, Stripe and Vercel privacy pages). No inline `<script>`, `<style>`, `style=` or `on*=`. A `no-referrer` meta on every page, `noindex` on thanks. `vercel.json`: build command, `dist`, a CSP with `default-src 'self'`, `Referrer-Policy`, `nosniff`, and `X-Robots-Tag` on `/thanks.html`. `dist/_headers` matches `vercel.json` rule for rule (plus `/thanks`). `site/` isn't in `files`. |
| Preview server (screenshots depend on it) | It serves `/` → `index.html` with the right content types and sends `vercel.json`'s headers (`noindex` only on thanks). It gives 404 for a missing file, `/..%2fpackage.json` and a NUL byte, and 405 for POST. |

M1–M3 and the M2 revenue tests (236) must stay green. Screenshots run outside `npm test` (`npm run screenshots`).

## What it does now

The product has two parts. The CLI didn't change in this pass; the storefront is new.

**The CLI, `overnight-receipts`** (free, MIT) is local and read-only. It reads the Claude Code session logs in `~/.claude/projects` (plus Entire checkpoints, when a repo has them) and the repo's git branches. It prints one receipt per branch changed in the window, ranked worst first, each with a `merge` / `fix` / `kill` suggestion. A receipt shows:
- the task
- the session and how it was matched
- the last test run
- commits and diff stat
- retries
- risky paths and files outside the task area
- a "needs you" list

Every transcript-derived line cites its transcript line.

| Command | Does |
|---|---|
| `overnight-receipts [--since 12h] [--repo PATH] [--base BRANCH]` | Terminal receipts, with no footer. |
| `… --out FILE.md` | Also writes Markdown. The file ends with the one-line Pro footer unless `OVERNIGHT_RECEIPTS_LICENSE` is set. |
| `… --json` | Machine-readable receipts (`schema/receipts.schema.json`). |
| `… --summarize` | A two-sentence summary per receipt from your own `claude -p`. The only option that runs anything but git. |
| `overnight-receipts digest --out FILE [--repo PATH]…` | One short file across repos for cron and push delivery. |

**The storefront** (new, `site/` → `dist/`) is four static pages:

| Page | Shows |
|---|---|
| `index.html` | What it is, the free install line, a sample receipt, and the Pro box. The box holds the price from `PRO_PRICE` and the **Buy Pro · $12 once** button. That button links the Stripe Payment Link when `STRIPE_PAYMENT_LINK` is set; otherwise the box says "Checkout opens soon". Terms, privacy and the 30-day refund sit under the button. |
| `terms.html` | What you buy, the honour system, payment by Stripe, 30-day refunds, a lost license, no warranty ("as is"), best-effort redaction, liability capped at the price. |
| `privacy.html` | The tool: on your machine, read-only, nothing uploaded, no telemetry, and what `--summarize` sends. The site: no cookies, no analytics, Vercel or Cloudflare request logs. Stripe: what the maintainer sees, and that it's never sold. |
| `thanks.html` | Where Stripe redirects after payment, with `?session_id={CHECKOUT_SESSION_ID}`. `license.js` checks the id and shows `export OVERNIGHT_RECEIPTS_LICENSE="cs_…"`. Without a valid id it shows how to get one (reply to the Stripe receipt). It's `noindex`, sends no referrer, and isn't cached. |

**The money path:**
1. The CLI's `--out` footer links to README `#pro`.
2. README `#pro` links to the storefront (the link is added at launch).
3. **Buy** opens the Stripe Payment Link.
4. Stripe redirects to the thanks page, which shows the license line.
5. With `OVERNIGHT_RECEIPTS_LICENSE` set, the footer is gone.

A test runs steps 4 and 5 end to end, and the screenshots show steps 1, 3 and 4.

**Can it take money yet?** The code is ready. Once the storefront is deployed with `STRIPE_PAYMENT_LINK`, buyers can pay and get their license string. Three things are missing, and none of them is code:
- David's Stripe Payment Link (requested in `.provision`)
- the Cloudflare Pages deploy (requested)
- REVENUE.md's gate: at least 90% attribution on 10+ real runs before switching checkout on

The full list is in [What's left](#whats-left).

## Run it locally

Requires Node ≥ 22 and git. The CLI and the site build have no dependencies. `playwright-core` (a devDependency) is only for screenshots.

```sh
npm test                                   # 290 tests (node:test), ~4 s
npm run demo                               # the CLI on a fixture repo in a temp dir: terminal, Markdown (with footer), digest
node bin/overnight-receipts.js --since 12h # in any repo you've run Claude Code in
npm run site:build                         # dist/ with checkout off ("Checkout opens soon")
STRIPE_PAYMENT_LINK=https://buy.stripe.com/<your link id> npm run site:build   # checkout on
npm run site:preview                       # build, then serve dist/ at http://127.0.0.1:4173/ with vercel.json's headers
npm install && CHROMIUM_PATH=/path/to/chromium npm run screenshots          # regenerate docs/screenshots/ (never downloads a browser)
```

Open `http://127.0.0.1:4173/thanks?session_id=cs_test_` followed by 16 or more letters and digits to see the license line. Any other value shows the fallback.

## Deploy (free tier)

**The CLI** has nothing to host, as before:
- `npx github:smithdavedesign/overnight-receipts --since 12h` once the repo is public
- or `npm publish` (free for public packages)

**The storefront** is a static `dist/` and needs no server, database or secrets.

_Go-live pass: the current deploy steps are in [LAUNCH-READY.md](LAUNCH-READY.md). The `.provision` now asks for the Vercel project and the Payment Link only, and the link goes in the Vercel env as `STRIPE_PAYMENT_LINK`. The Cloudflare Pages route below still works (`dist/_headers`, plus `SITE_URL` for the canonical URLs) if David decides the Hobby clause rules Vercel out once checkout is on._

1. **Pre-launch, on Vercel Hobby (free):** `.provision` creates the `dawnlog` project. Connect it to the repo. `vercel.json` sets the build command (`npm run site:build`), the output directory (`dist`), `framework: null` and the security headers. Every push deploys. Leave `STRIPE_PAYMENT_LINK` unset there, so the page says "Checkout opens soon".
2. **Live, with checkout, on Cloudflare Pages (free plan, commercial use allowed).** This is requested in `.provision`.
   - Connect the same repo: build command `npm run site:build`, output directory `dist`, env `NODE_VERSION=22` and `STRIPE_PAYMENT_LINK`.
   - The build writes `dist/_headers`, so Pages serves the same CSP, no-referrer, nosniff and `noindex` as Vercel.
   - The Stripe redirect goes to `https://<project>.pages.dev/thanks?session_id={CHECKOUT_SESSION_ID}`. Pages serves `thanks.html` at `/thanks`, so no redirect can drop the query string.
   - **Why not Vercel for this step:** Vercel's Hobby plan is non-commercial only, and Vercel Pro ($20/month) would break the $0 rule.
3. **Switching checkout on or off** is one env var. Set `STRIPE_PAYMENT_LINK` and redeploy to open checkout; unset it to close. A malformed value fails the build, so the last good deploy stays up.

## Infrastructure

Requested in `.provision`, one per line (rewritten in the go-live pass). Nothing in the tests needs any of it.

| Line | For | Value the code reads |
|---|---|---|
| `vercel project dawnlog` | The storefront, its previews, and Vercel's build-time variables | `VERCEL_ENV` (the beacon sends only on production) and `VERCEL_PROJECT_PRODUCTION_URL` (canonical URLs), both set by Vercel itself |
| `request "Stripe payment link for dawnlog: $12 once, per REVENUE.md"` | The $12 one-time checkout, with the after-payment redirect to `/thanks?session_id={CHECKOUT_SESSION_ID}` | `STRIPE_PAYMENT_LINK` (a `https://buy.stripe.com/…` link, not a secret, but kept in env so switching checkout on is a config step) |

The M3 pass also asked for a Cloudflare Pages project. The go-live `.provision` drops that request; see LAUNCH-READY.md › What's left.

There's no database, no API key and no other secret. Stripe has no monthly fee, only a fee per sale (about $0.65 on $12, per REVENUE.md). There's no webhook, so no signing secret is needed.

## Exit criteria

All pass: `npm test` gives 290 tests and 0 failures (265 after the M3 pass, plus 25 in `test/launch.test.js` from the go-live pass).

| Milestone | Criterion | Status | Test |
|---|---|---|---|
| M1 | The 7 criteria (receipts per branch, FAILED ranking, retries, risk, redaction, unmatched, no `~/.claude`) | ✅ | `cli.test.js` exits 1–7 |
| M2.1–M2.3 | Golden ranking; `source: file:line` on every field; `--json` schema | ✅ | `m2.test.js` › exits 1–3 |
| M2 R1–R4 | The Pro footer in the `--out` Markdown only; the license hides it; the README `## Pro` target | ✅ | `m2.test.js` › M2 revenue |
| M3.1–M3.3 | Only git without `--summarize`; digest written; Entire ingestion | ✅ | `m3.test.js` |
| **M3 S1** | `npm run site:build` writes every page, links resolve, no placeholder left | ✅ | `storefront.test.js` › exit S1 (5 tests, including the output-dir guard and `render`) |
| **M3 S2** | Landing: what it is, install line, price from `PRO_PRICE`, terms and privacy by the buy button | ✅ | › exit S2 (2 tests) |
| **M3 S3** | `STRIPE_PAYMENT_LINK` on → Buy links the Payment Link; unset or blank → "opens soon", no Stripe link; invalid → the build fails without printing the value | ✅ | › exit S3 (5 tests: 8 invalid values, library and CLI) |
| **M3 S4** | Terms and privacy commitments; every page links both | ✅ | › exit S4 (3 tests) |
| **M3 S5** | The thanks page turns a Checkout Session id into the license line; forged ids give none; that string hides the CLI footer | ✅ | › exit S5 (6 tests, including the end-to-end CLI run) |
| **M3 S6** | Nothing from other origins, no inline code, no-referrer, a strict CSP in `vercel.json` and `_headers`, thanks is noindex, the site isn't in the npm package | ✅ | › exit S6 (5 tests) |
| (support) | Preview server: content types, `vercel.json` headers, path traversal, NUL bytes, 405 | ✅ | › site/serve.js (3 tests) |
| PRD | Receipts under 5 s for 100 session files | ✅ | `perf.test.js` |

Screenshot proof, from `npm run screenshots` (each PNG was opened and checked):
- `home-*`: the landing page with the Buy button
- `receipts-*`: the real CLI run and the Markdown footer
- `license-*`: the thanks page with the license line

## What's left

**Launch checklist (David; none of it is code):**
1. **Make the repo public, or `npm publish`.** The PRD says the repo is still private. Until it's public, the landing page's install line and GitHub links, and the CLI footer's link to README `#pro`, lead to a 404.
2. **Measure attribution:** at least 90% on 10+ real overnight runs (REVENUE.md). If it misses, don't switch checkout on.
3. **Create the Stripe Payment Link** (requested):
   - It must charge exactly `PRO_PRICE` ($12). The pages read the price from `src/pro.js`, but Stripe's price is set in Stripe.
   - Redirect to `/thanks?session_id={CHECKOUT_SESSION_ID}`.
   - Try it once in test mode.
4. **Where checkout runs.** The go-live pass superseded this item: the Payment Link goes in the Vercel env, and the Hobby-plan question is item 2 of LAUNCH-READY.md › What's left.
5. **Put the live URL in README `## Pro`** in place of "Checkout opens once the storefront is live".
6. **Review the terms:** add the seller's legal name, a contact address, and governing law if wanted, and decide on Stripe Tax. These were left out rather than invented.
7. **Bump the version** (still 0.3.0) when publishing.

**Deliberately not built (see Scope):** a server, webhooks, license checks, analytics and click counting, and a custom domain. REVENUE's counting (stars, issues, installs, payments) is manual from GitHub, npm and the Stripe dashboard.

**Needs real use (PRD metrics):** two weeks of measured triage time, and `--summarize` tried on a real night.

**Not built (unchanged):**
- Entire's ref-based checkpoints, subagent transcripts, uncommitted worktree changes, and Codex (a v1 non-goal).
- Wrapped test commands (`bash -c "npm test"`) show as UNVERIFIED.
- Windows is untested.
- There's no CI workflow.

## Review

This is a self-review of this pass's diff (`git status`, `git diff`) against gstack's pre-landing checklist ("Review Categories", "Fix-First Heuristic").

**Diff:**
- New:
  - `site/build.js`, `site/serve.js`
  - `site/pages/` (4 pages, `style.css`, `license.js`, `favicon.svg`)
  - `vercel.json`, `.provision`, `.gitignore`
  - `scripts/screenshots.mjs`, `docs/screenshots/` (6 PNGs)
  - `test/storefront.test.js` (29 tests)
  - `package-lock.json` (playwright-core)
- Changed:
  - `package.json` (scripts, devDependency)
  - README, ROADMAP, BUILD
- No CLI source changed.

**No CRITICAL findings remain.**

**Fixed (tests rerun: 265/265 pass):**
- [P1] (confidence: 9/10) `site/build.js`: **destructive delete.** The build deletes its output directory first, so `node site/build.js ~` would have wiped a home directory.
  - Fix: it refuses unless the directory is missing, empty or a previous build (`index.html` + `license.js`), and never touches the source pages. Tested, including that nothing is deleted on refusal.
- [P1] (confidence: 8/10) **Hosting terms.** Taking money from a Vercel Hobby deploy breaks Vercel's non-commercial clause, and the project could be suspended mid-sale.
  - Fix: the build emits `dist/_headers` from `vercel.json`, so Cloudflare Pages' free plan (commercial use allowed) gets the same headers.
  - `.provision` puts `STRIPE_PAYMENT_LINK` there only.
  - Tested: `_headers` matches `vercel.json` rule for rule.
- [P2] (confidence: 7/10) **Stripe redirect.** Cloudflare Pages serves `thanks.html` at `/thanks`. A redirect URL ending in `.html` would depend on Pages keeping the query string through its own redirect.
  - Fix: the request names `/thanks?session_id=…`, and `_headers` covers both paths.
- [P3] (confidence: 8/10) `site/build.js`: the invalid-URL error's hint (`https://buy.stripe.com/…`) contained one of the test's invalid values verbatim.
  - Fix: reworded. The test was unchanged and now passes.
- [P3] (confidence: 8/10) `scripts/screenshots.mjs`: if the preview server failed to start, its process was left running.
  - Fix: it's killed on failure.
- [P3] (confidence: 7/10) `site/serve.js` and `_headers` translate only two header `source` shapes. A new pattern in `vercel.json` would silently not apply locally or on Pages.
  - Fix: the build throws on others, and a test pins `vercel.json` to the two shapes.
- [P3] **Seen in the screenshots:**
  - `system-ui` resolved to a monospace face under Linux fontconfig, so it's dropped from the font stack.
  - The install line overflowed on a phone, so it now wraps.
  - The desktop Buy button was below the fold, so the landing page now has a two-column hero.

**Checked, nothing to fix:**
- **SQL, races, N+1:** none. There's no database. The build writes a fresh directory, and nothing else writes to it.
- **Unsafe HTML:**
  - `render` escapes every text value.
  - The one HTML value (the Buy control) is built from an allowlisted URL, and that URL is escaped again.
  - `license.js` writes only `textContent` (a test fails on `innerHTML`, `document.write` and similar). Injection ids are rejected by the regex (tested).
  - The screenshot page escapes the CLI output.
- **Secrets:**
  - Nothing credential-shaped is in any file. The stand-in Payment Link and session id are built at runtime.
  - The build never prints `STRIPE_PAYMENT_LINK`, even when it's invalid (tested).
  - The session id in the thanks URL is covered by `no-referrer` (header and meta), `noindex` and `no-store`, and it's never sent anywhere.
- **Shell injection:** every spawn uses argument arrays, and the `.provision` lines contain no `$` or backticks.
- **LLM trust boundary:** not touched.
- **Enum and value completeness:**
  - `STRIPE_PAYMENT_LINK` is read only in `site/build.js`.
  - `LICENSE_ENV` and `PRO_PRICE` reach the pages only through `{{…}}`. The tests compare them with `src/pro.js`.
  - Header rules flow from `vercel.json` to `serve.js` and `_headers`, which is pinned by a test.
- **Offline CLI:** unchanged. The M3 network trap is still green.
- **Distribution:** the site isn't in the npm package (tested). The hosts build it from the repo.

**Left (none CRITICAL):**
- [P2] (confidence: 8/10) **User-visible:** the CLI footer → README `#pro` → storefront chain has a gap until launch. The README section says checkout isn't live yet, and the storefront URL can't be known before Cloudflare assigns it. Launch checklist items 1 and 5.
- [P2] (confidence: 7/10) **Price drift:** Stripe's price is set in Stripe, not from `PRO_PRICE`, so the two can disagree. Launch checklist item 3.
- [P2] (confidence: 6/10) **The legal text was written by an engineer, not a lawyer.** It has no legal name, address, governing law or tax handling. Medium confidence that this matters at $12 and 10 sales; David should read it before switching checkout on (item 6).
- [P3] **Honour system.** Anyone can open `thanks.html` with an invented id and get a "license". This is by design, and the CLI accepts any non-blank value anyway.
- [P3] **A buyer who never reaches the thanks page** (Stripe's own warning) gets the string by replying to the receipt. That's manual, as REVENUE says, for the first 10 sales.
- [P3] (confidence: 5/10) **The pre-launch Vercel page names a price** while checkout is off. Nothing can be bought there, so it should be on the safe side of Vercel's clause. For zero ambiguity, host both phases on Cloudflare Pages.
- [P3] **The landing page's sample receipt is hand-trimmed** from a real run, to fit a column. The `receipts-*` screenshots show an untrimmed real run.

## M2 pass (2026-10-13), as written

These are the M2 pass's notes as written that day. Its plan, its snapshot of the product, and its review are kept here, and the sections above are current.

**M2 pass of the MVP run (2026-10-13).** This was planned non-interactively with gstack's Step 0, Architecture review and Test review. Nobody was available to answer questions, so each decision is written down here with its reason.

### Step 0: Scope Challenge

1. **What already solves each sub-problem?**
   - ROADMAP's three M2 exit criteria are already built, and their tests pass (`test/m2.test.js`, 229/229 green at the start of this pass):
     - ranking against `test/golden/ranking.txt`
     - `sources` with `file:line` on every field
     - `--json` against `schema/receipts.schema.json`

     Nothing there needs rebuilding.
   - What's new is REVENUE.md. It says M2 "is the real MVP for charging", and that "the Pro link goes in the README and in the `--markdown` output footer". It also asks for a landing page with privacy and terms, a $12 Stripe Payment Link, and manual fulfilment.
   - Existing code already does most of the work:
     - The Markdown writer exists (`renderMarkdown`, through `--out`).
     - `main(argv, env)` already takes the environment as a parameter.
     - Every written byte already goes through `clean()`.
   - The footer is one more line from that path, not a new output.
2. **Which REVENUE.md parts fit M2, and which fit M3:**
   - **M2 (this pass): the Pro surface inside the product.** M2 is the Markdown, `--json` and ranking milestone, and REVENUE names it as the one that makes the product worth paying for.
     - the footer link in the Markdown file
     - an honour-system supporter license that hides the footer
     - npm's `funding` field
     - a README "Pro" section that the footer links to
   - **M3 (next pass): the storefront.** M3 is the delivery milestone, and these parts need a deploy and a Stripe account (a `request` for David):
     - a landing page
     - the checkout (a Stripe Payment Link)
     - terms and privacy
     - the confirmation message that shows the license string
   - Charging can't start before M3, because there's no checkout before it. So M2 never links to a checkout without terms next to it.
3. **Minimum change set:**
   - **The footer.** One line at the end of the `--out` Markdown file, with the price and a link to the Pro section. `OVERNIGHT_RECEIPTS_LICENSE` (any non-blank value) turns it off.
   - **No footer elsewhere.** Terminal output, `--json` and the digest stay unchanged.
   - **`funding` field** in `package.json`. This is the single source for the URL.
   - **README `## Pro` section**, which is the footer's link target.
4. **Complexity check:**
   - Files:
     - `src/pro.js` (new, about 20 lines)
     - `src/render.js` and `src/cli.js` (a few lines each)
     - `package.json`
     - `test/helpers.js` (hermetic env)
     - `test/m2.test.js`
     - docs: README, ROADMAP, BUILD
   - 0 classes, 0 services, 0 dependencies. That's under the 8-file / 2-service smell threshold for code, so no reduction is needed.
5. **Search check:**
   - **[Layer 1]** npm's built-in `funding` field: `npm fund` lists it, and `npm install` mentions it, at no cost. The footer reads its URL from the same field, so there's one source. (Search confirmed the field shapes: a string, `{type, url}` or an array.)
   - **[Layer 1]** Stripe Payment Links can show a **custom confirmation message** after payment. They can also redirect to a page with `{CHECKOUT_SESSION_ID}`. So M3 needs no success-page server to show the license string. (Stripe docs, post-payment.) This is noted now because it shapes the license design. The string is shown, never checked against a server.
   - **Footgun avoided:** JSON import attributes (`import … with { type: 'json' }`) have printed an ExperimentalWarning on some Node 22 releases. That would add a line to stderr, and a test asserts `--json` stderr is empty. `package.json` is read with `fs.readFileSync` instead.
6. **TODOS.md:** none exists. Follow-ups go to "What's left".
7. **Completeness check:**
   - The tests cover the footer's presence and its absence (license set; blank license still counted as unset), plus every other output (terminal, stderr, `--json`, digest text and md).
   - They also check that the link target exists: the README anchor, and the same price in the README as in the code.
8. **Distribution check:** no new artifact. Through `npx github:smithdavedesign/overnight-receipts` the `funding` field does nothing until a package is installed, and `npm publish` is still optional (see Deploy).

### Scope

**In (M2 pass):**
- **Footer:** at the end of the Markdown file written by `--out`, after a `---` rule. It's one line with the price, a `[Pro, $12 once](<funding.url>)` link and how to hide it. The exact text is in [What it does now](#what-it-does-now).
- **`OVERNIGHT_RECEIPTS_LICENSE`:** any non-blank value hides the footer. The value is never printed, logged or checked.
- **`package.json`:** `funding: { type: "individual", url: "https://github.com/smithdavedesign/overnight-receipts#pro" }`.
- **README `## Pro` section:**
  - the price and what paying gets you
  - that it's an honour system
  - that checkout opens with the M3 storefront
- **ROADMAP M2:** the four revenue exit criteria below.

**Deliberately not in this pass:**
- The landing page, the Stripe Payment Link, terms and privacy pages, and the license string shown after payment. All of these are M3.
- **Gating the Pro features (no private `dawnlog-pro` repo).** REVENUE.md imagines Pro features in a private repo. But Markdown, `--json`, triage and `digest` already ship publicly under MIT, and the repo is public. Moving them would:
  - remove functionality people already have
  - break the M2 and M3 exit-criteria tests
  - be undone by any fork

  REVENUE.md's own risk list says "paying is a courtesy, not a gate". So Pro is a supporter license.
- **License verification.** It would need a signing key (a credential to keep somewhere) or a server. REVENUE says to automate nothing before the tenth sale. With manual fulfilment, the honour system is the whole mechanism.
- **A footer in the digest.** It's pushed to a phone every morning, and a sales line there daily is spam. It's also not in the terminal (the free tier stays clean) or in `--json` (machine-readable, schema unchanged).
- Counting Pro-link clicks (REVENUE step 6). There's no server in M2. M3's storefront is where clicks can be counted.

### Architecture

```
bin/overnight-receipts.js ─▶ src/cli.js main(argv, env)
                                │ --out FILE
                                │   footer = proFooter(env)          ◀── src/pro.js
                                │     null if OVERNIGHT_RECEIPTS_        PRO_URL  = package.json funding.url
                                │     LICENSE is set (non-blank)         PRO_PRICE = '$12'
                                ▼
                   src/render.js renderMarkdown(report, { window, footer })
                                │   …receipts… then "---" + footer (static text, not transcript data)
                                ▼
                   clean() ─▶ FILE           (stdout, --json, digest: unchanged, no footer)
```

- **Boundaries.** `render.js` stays pure: it gets the footer string and never reads the environment. `cli.js` already owns `env`. `pro.js` owns the URL, price and wording, so M3 has one place to extend.
- **Security.**
  - The footer is static text, not transcript data, so it adds no new trust boundary. It still goes through `clean()` like every byte, and a GitHub URL matches no redaction pattern (asserted: the link is intact in the file).
  - The license value is only tested for presence. It's never echoed, logged or written.
- **Failure scenarios:**

| Codepath | Realistic failure | Handled by |
|---|---|---|
| `pro.js` reading `package.json` | A fork deletes `funding`, sets an `http:`/`javascript:` link or an array, or `package.json` is unreadable | `fundingUrl` returns null (or the first https entry), so there's no footer, no "undefined" link and no crash (unit test). |
| License env | A user sets it to `""` or spaces in a shell profile | Blank counts as unset, so the footer shows (test). |
| Footer link | The README heading is renamed and the anchor breaks | A test checks that the README has `## Pro` and the same price as `PRO_PRICE`. |
| Tests | A developer has `OVERNIGHT_RECEIPTS_LICENSE` set in their shell | `runCli` deletes it, so tests stay hermetic. |
| Markdown safety | The footer adds a link, and the transcript-neutralising test checks for links | Only the footer link exists. The `[docs](` and `![x](` checks from transcripts still pass. |

### Test plan

New tests go in `test/m2.test.js` › "M2 revenue". Each one fails before the change.

| Exit criterion (ROADMAP M2, revenue) | Test |
|---|---|
| R1. The `--out` Markdown file ends with a Pro footer: a `---` rule, the price, and a link to `package.json` `funding.url` | Run the CLI with `--out`. The file's last lines are the rule plus a footer with `[Pro, $12 once](<funding.url>)`. |
| R2. `OVERNIGHT_RECEIPTS_LICENSE` hides it; a blank value doesn't | Run the same fixture with and without a runtime-built license value. The licensed file equals the unlicensed one minus the footer, byte for byte. A blank value (`'  '`) still shows the footer, and the value never appears in any output. |
| R3. The footer is only in the Markdown file | Terminal stdout, stderr, `--json` stdout and the digest (`text` and `md`) don't contain the Pro URL. The `--json` output still validates. |
| R4. The link target exists | `package.json` `funding` is `{ type, url }` with an https URL ending `#pro`. The README has a `## Pro` heading and states `PRO_PRICE` once, plus the license variable. |
| Unit | `proFooter` returns null without a URL, null with a license, and a string otherwise. |
| Unit (added in review) | `fundingUrl` reads every npm `funding` shape (string, `{type, url}`, array). It returns null for a missing file, bad JSON, no field, `http:`, `javascript:`, or a URL with a space, bracket or parenthesis. |

M1–M3's 229 existing tests must stay green. The Markdown-safety, redaction and network-trap tests already run `--out`, so they cover the footer too.

### What it did after the M2 pass

`overnight-receipts` is a local, read-only CLI. It reads the Claude Code session logs in `~/.claude/projects` (plus Entire checkpoints, when a repo has them) and the repo's git branches. It prints one receipt per branch changed in the window, ranked worst first, each with a `merge` / `fix` / `kill` suggestion. A receipt shows:
- the task
- the session and how it was matched
- the last test run
- commits and diff stat
- retries
- risky paths
- files outside the task area
- a "needs you" list

Transcript-derived lines cite their transcript line.

| Command | Does |
|---|---|
| `overnight-receipts [--since 12h] [--repo PATH] [--base BRANCH]` | Terminal receipts. Free, with no footer. |
| `… --out FILE.md` | Also writes the receipts as Markdown. **New in this pass:** the file ends with the Pro footer (below). |
| `… --json` | Machine-readable receipts, schema `schema/receipts.schema.json`. No footer. |
| `… --summarize` | A two-sentence summary per receipt from your own `claude -p`. The only option that runs anything but git. |
| `overnight-receipts digest --out FILE [--repo PATH]…` | One short file across repos, for cron and push delivery (`scripts/morning-digest.sh` sends it to WhatsApp). No footer. |

The footer at the end of every `--out` Markdown file:

```
---

Made with overnight-receipts, free and MIT. If it saved you a morning: [Pro, $12 once](https://github.com/smithdavedesign/overnight-receipts#pro). Already a supporter? Set `OVERNIGHT_RECEIPTS_LICENSE` to hide this line.
```

- **The link** goes to the README's `## Pro` section. That section gives the price, what paying changes and that it's an honour system. It also says plainly that checkout isn't open yet.
- **One source for the URL:** `package.json` `funding`, npm's standard field. The footer reads the URL from there.
- **Turning it off:** any non-blank `OVERNIGHT_RECEIPTS_LICENSE` removes the footer and changes nothing else in the file. The value is never printed.

**Can it take money yet? No.** There is no checkout, terms or privacy page until M3. REVENUE.md also says not to charge until attribution is at least 90% on David's own runs (see What's left).

### Run it locally (M2 pass)

Requires Node ≥ 22 and git. No dependencies, nothing to install or build.

```sh
npm test                                          # 236 tests (node:test), ~4 s
npm run demo                                      # fixture repo in a temp dir: terminal, Markdown (with the footer) and a digest
node bin/overnight-receipts.js --since 12h        # in any repo you've run Claude Code in
node bin/overnight-receipts.js --since 12h --out /tmp/receipts.md                                 # ends with the Pro footer
OVERNIGHT_RECEIPTS_LICENSE=supporter node bin/overnight-receipts.js --since 12h --out /tmp/receipts.md   # no footer
```

### Deploy (M2 pass)

There's nothing to host. The CLI runs on the user's machine, and both ways to ship it cost $0:
- **GitHub, no publish step:** `npx github:smithdavedesign/overnight-receipts --since 12h`. The repo is public, and there's no build and no dependencies.
- **npm:** check the name is still free (`npm view overnight-receipts`), then run `npm publish`. Public packages are free. Once published, `funding` shows the Pro link through `npm fund` in projects that depend on it.

The Pro link points at the GitHub README, so it works without any hosting. M3's storefront will be a static site on Vercel's free tier.

### Infrastructure (M2 pass)

**This M2 pass asks for nothing.** There's no database, no API key and no `.provision` file. The CLI is offline and needs no secrets, and the tests use none.

Planned for M3, not requested yet (this pass doesn't use them):
- `vercel project dawnlog`, for the storefront page.
- `request "Stripe Payment Link for dawnlog: $12 one-time 'overnight-receipts Pro', with a custom confirmation message that shows the supporter license string"`. Stripe has no monthly fee, only a fee per sale.

### Exit criteria (M2 pass)

All pass: `npm test` gives 236 tests and 0 failures.

| Milestone | Criterion | Status | Test |
|---|---|---|---|
| M1 | The 7 criteria (receipts per branch, FAILED ranking, retries, risk, redaction, unmatched, no `~/.claude`) | ✅ | `cli.test.js` exits 1–7 (see [M1 exit criteria](#m1-exit-criteria-2026-10-11)) |
| M2.1 | Ranking order matches a golden file | ✅ | `m2.test.js` › exit 1 |
| M2.2 | Each receipt field carries a `source: file:line` | ✅ | `m2.test.js` › exit 2 |
| M2.3 | `--json` validates against a schema | ✅ | `m2.test.js` › exit 3 |
| **M2 R1** | The `--out` Markdown file ends with a Pro footer: rule, price, link to `funding.url` | ✅ | `m2.test.js` › M2 revenue › exit R1 |
| **M2 R2** | `OVERNIGHT_RECEIPTS_LICENSE` hides it and changes nothing else; blank counts as unset; the value is never printed | ✅ | › exit R2 (two tests: byte-for-byte diff, blank values) |
| **M2 R3** | The footer is only in the Markdown file: not in the terminal, stderr, `--json` or the digest | ✅ | › exit R3 |
| **M2 R4** | The link target exists: `funding` shape, `#pro` anchor, README `## Pro` with the same price | ✅ | › exit R4, plus `proFooter` and `fundingUrl` unit tests |
| M3.1–M3.3 | No subprocess or network calls but git without `--summarize`; digest written; Entire ingestion | ✅ | `m3.test.js` (the network trap also covers the `--out` run that writes the footer) |
| PRD | Receipts under 5 s for 100 session files | ✅ | `perf.test.js` |

### What was left after the M2 pass

**M3, next in this run: the storefront.**
- A static landing page: what it is, the free install line, and the $12 Pro button.
- Terms and privacy pages. They need to say: local only, read-only, nothing uploaded, redaction is best-effort, refunds.
- The Stripe Payment Link (a `request` for David), with the license string in its custom confirmation message.
- Then the README's "Checkout isn't open yet" line becomes the checkout link.

**Before charging (REVENUE.md, needs David and real use):**
- At least 90% attribution on 10+ real overnight runs. This hasn't been measured, and REVENUE says don't charge until it is.
- Fulfilment is manual for the first 10 sales, so there's nothing to automate before then.
- Counting Pro clicks needs the M3 page. The CLI won't phone home.

**Needs real use (PRD metrics):** two weeks of measured triage time, and `--summarize` tried on a real night.

**Not built (unchanged from the first M3):**
- Entire's ref-based checkpoints, subagent transcripts, uncommitted worktree changes, and Codex (a v1 non-goal).
- Wrapped test commands (`bash -c "npm test"`) show as UNVERIFIED.
- Windows is untested.
- There's no CI workflow.

### Review (M2 pass)

This is a self-review of the M2 pass's diff (`git status`, `git diff`) against gstack's pre-landing checklist ("Review Categories", "Fix-First Heuristic").

**Diff:**
- `src/pro.js` (new)
- `src/cli.js` (+1 import, 1 line)
- `src/render.js` (footer option)
- `package.json` (`funding`)
- `test/helpers.js` (hermetic env)
- `test/m2.test.js` (+8 tests)
- README, ROADMAP, BUILD

**No CRITICAL findings.**

**Fixed (tests rerun: 236/236 pass):**
- [P3] (confidence: 8/10) `src/pro.js`: reading `package.json` at module load could throw, and then the whole CLI fails, terminal mode included, because of a footer.
  - Fix: `fundingUrl()` catches the error and returns null, so there's no footer. Unit-tested with a missing file and bad JSON.
- [P3] (confidence: 8/10) `src/pro.js`: npm also allows `funding` as an array, which was read as no URL.
  - Fix: the first entry wins. Unit-tested for the string, object and array shapes.
- [P3] (confidence: 7/10) `src/pro.js`: **unsafe Markdown.** Any https string was accepted. A `)` in `funding` could close the footer link and inject an image or a tracking link into the written file. Only the package author controls `package.json`, so this isn't a transcript boundary.
  - Fix: the URL must be `https://` with no whitespace, brackets or parentheses. Unit-tested, including a `)![x](…)` payload.
- [P3] `test/m2.test.js`: temp file names used `Math.random()`. They now use a counter, so they're deterministic.

**Checked, nothing to fix:**
- **SQL, races, N+1:** none. The pass adds no database and no new write path. The footer rides on the existing `--out` write.
- **Unsafe HTML or Markdown:** the footer is static text, not transcript data. Transcript text still goes through `md()`, and the existing tests that neutralise images, links and HTML from transcripts still pass with the footer in the file. The footer still passes through `clean()`, and R1 asserts the link survives it intact.
- **Secrets:**
  - The license value is only tested for presence. A test asserts it never reaches the file, stdout or stderr.
  - The test license is built at runtime.
  - No credential-shaped string was added to any file.
- **Enum and value completeness:** the one new value is the env var name `OVERNIGHT_RECEIPTS_LICENSE`. It's read only in `src/pro.js` (through `LICENSE_ENV`), and `runCli` clears it so a developer's shell can't change test results. The README and the footer name it identically, and R1/R4 assert it.
- **Shell injection, LLM trust boundary:** not touched.
- **Time windows:** the byte-for-byte R2 test uses a fixed `--since` date, not `48h`. Two runs a minute apart therefore render the same header.
- **Offline:** the M3 network trap still runs `--out`, which now writes the footer, and sees only `git`.

**Left (none CRITICAL):**
- [P2] (confidence: 7/10) **User-visible change.** Every `--out` file now ends with a sales line. Fix-First says to ask about this, and nobody was available, so it was decided from REVENUE.md ("the Pro link goes in … the `--markdown` output footer"). It's limited to the Markdown file, it's one line, and a supporter license turns it off. Revisit if users object.
- [P3] (confidence: 6/10) **The link leads to a page with nothing to buy yet.** The README's Pro section says so plainly, and M3 adds the checkout. Medium confidence that this matters: it holds only until M3 lands in this same run.
- [P3] **Honour system.** Anyone can hide the footer without paying. This is deliberate, matching REVENUE.md's own "paying is a courtesy, not a gate".
- [P3] **Version.** `package.json` is still 0.3.0. The sandbox wouldn't show the version history, so the convention couldn't be checked. Bump it when publishing, since the Markdown output changed.
- [P3] **Demo not run.** `npm run demo` was blocked in this sandbox. Its `--out` path is the same CLI path that R1 and R2 check byte for byte.
- [P3] **Non-atomic `--out` write.** The `--out` file is written in place, not atomically. This predates the pass and is unchanged; the digest's write is atomic.

## M1 plan (2026-10-11)

Built non-interactively from PRD.md, ROADMAP.md (M1) and REVIEW.md. Nobody was available to answer questions, so each decision is written down here with its reason.

### Step 0: Scope Challenge

1. **What already solves each sub-problem?**
   - Claude Code already writes `cwd`, `gitBranch`, `sessionId` and `timestamp` on every session record. **[EUREKA]** This makes the session→branch match mostly a lookup. Commit times are only a fallback, for records without `gitBranch` and for sessions that never left the base branch.
   - Git answers every branch question: `for-each-ref`, `log base..branch`, `diff --numstat -z base...branch` and `worktree list --porcelain`.
   - Node built-ins cover the rest **[Layer 1]**: `util.parseArgs` for flags, `child_process.execFileSync` for git, `node:test` + `node:assert` for tests, and `JSON.parse` per line for JSONL. No dependencies.
2. **Minimum change set:** a CLI that prints one receipt per changed branch with these fields: status, retries, risk, matched session, commits/diffstat, plus an "Unmatched" list, redaction, and an optional Markdown file. Everything else is deferred (see "Not in scope").
3. **Complexity check:** 7 source files (`bin/dawnlog.js` plus six in `src/`), 0 classes, 0 runtime or dev dependencies. Under the 8-file / 2-service smell threshold, so no reduction needed. Two files were added during the build and aren't shipped (`files` in package.json): `scripts/demo.js`, a dev-only demo that reuses the test fixtures, and the test helper.
4. **Search check:**
   - Node's built-in TypeScript type stripping (stable since 25.2) refuses to strip `.ts` files under `node_modules`. A `.ts` package run through `npx` would break.
     → **Decision:** plain ESM JavaScript with JSDoc, no build step. This deliberately departs from ROADMAP's "TypeScript" suggestion, because `npx dawnlog` is the whole wedge.
   - Session-file fields were confirmed against third-party write-ups (no official spec exists): `cwd`, `gitBranch`, `tool_result.is_error`, `toolUseResult.exitCode`. Subagent transcripts live in `<session-id>/subagents/`.
     → The parser reads only these fields, falls back to an "Exit code N" text prefix, and counts unreadable lines instead of failing silently.
   - Known footguns, both avoided:
     - npm links `bin` through a symlink, so an `import.meta.url === argv[1]` "am I main?" check never fires. `bin/dawnlog.js` is therefore a 5-line shim.
     - `process.exit()` can truncate piped stdout, so the CLI sets `process.exitCode` instead.
   - The roadmap suggests Vitest. Vitest pulls in a bundler with native binaries, which is a risk with install scripts disabled. **[Layer 1]** `node:test` meets "vitest or node:test" with zero installs.
5. **TODOS.md:** none exists. Follow-ups are listed under "What's left".
6. **Completeness check:** the redaction set covers 12 formats, not just the three the exit criterion names, which matches the PRD's 10-format metric. Risk covers all four PRD categories (dependency, data, auth, payments), not just the two in the exit criteria. Each costs a regex and a test.
7. **Distribution check:** the artifact is an npm CLI. With no build step and no dependencies, `npm publish` is the whole pipeline. Publishing is **deferred**, not dropped: it needs David's npm account and a license choice. No CI workflow is included. Targets are any OS with Node ≥ 22 and git on `PATH`; only macOS was tested.

### Scope

**In (M1 deliverables):**
- Node CLI `dawnlog [--since 12h] [--repo PATH] [--base BRANCH] [--out FILE.md]`.
- JSONL session parser:
  - task (first real user prompt)
  - Bash runs with exit status
  - test/lint detection
  - retries
  - FAILED / UNVERIFIED / PASSED
- Git branch scanner and session→branch matcher. The match order is:
  1. `gitBranch`
  2. linked worktree
  3. commit times inside the session
  4. otherwise "Unmatched", with a reason
- Terminal receipt, plus a Markdown file with `--out`.
- Secret redaction, and stripping of terminal control characters, on every byte written.
- Status-first ordering (FAILED > UNVERIFIED > PASSED). This is required by exit criterion 2.

**Deliberately not in M1:**
- Merge/fix/kill labels, a golden ranking, the deferred-work list, `file:line` links on every field, `--json` (all M2).
- `--summarize`, digest, Entire ingestion (all M3).
- "Files outside the task's main directories" (in the PRD, but not in any milestone's exit criteria).
- Subagent transcript files.
- Uncommitted work in worktrees.
- Multi-repo scans.
- Colours.
- npm publish / CI.

### Decisions (no one to ask)

| Question | Decision | Why |
|---|---|---|
| Statuses | `FAILED`, `UNVERIFIED`, `PASSED`, taken from the **last test/lint Bash run** across the branch's sessions | Exit criterion 2. "Unverified" is the honest default: no test, no result, or an exit code hidden by a pipe. |
| `npm test \| tail` (exit code masked by a pipe, `;` or `\|\|`) | A non-zero exit is FAILED. Exit 0 with a failure count in the output is FAILED. Anything else is UNVERIFIED, **never PASSED**. | The review's main risk is a false "PASSED", and agents pipe tests into `tail` all the time. |
| Retries | A retry is re-running a command whose previous run of the same command failed. Three failing runs give `retries: 2`. | Exit criterion 3. Re-running a passing command isn't a retry. |
| Base branch | `origin/HEAD`, then `main`, `master`, `trunk`, `develop`, or `--base`. The base itself gets no receipt. | A receipt is "what's on this branch vs base". Sessions that only touched base go to Unmatched with that reason. |
| Which branches get receipts | Branches whose tip commit is inside the window, plus any branch a session in the window was on (even with no new commits) | A failed overnight run that never committed must not vanish. |
| Window | `--since` takes `30m`, `12h`, `2d`, `1w` or an ISO date. The default is `12h`, as in the PRD and the review wedge. Times print in UTC. | Deterministic output. |
| Markdown file | Only with `--out FILE` | Writing a file by default into a repo that's being triaged would dirty `git status`. |
| Sessions from other repos | Not listed, but counted in a note | `--repo` scopes the report. Nothing is dropped silently. |
| Ambiguous commit-time match | Unmatched, with the candidate branches named | A wrong attribution is worse than none (REVIEW premise 2). |
| Redaction point | At render, before truncation, and again over the whole output, including stderr and the Markdown file | Truncating first could cut a private key in half and leak the rest. |

### Architecture

```
bin/dawnlog.js ──▶ src/cli.js  parseArgs · --since · exit codes · --out
                       │  (no ~/.claude/projects → exit 0 + message)
                       ▼
                 src/report.js  buildReport()
           ┌───────────┴────────────┐
   src/sessions.js               src/git.js
   ~/.claude/projects/*/*.jsonl   git -C repo …  (execFile, arg arrays,
   mtime prefilter → parse        full refs/heads/ names, `--`)
   Session{cwds, branches,        branches · base · worktrees ·
   task, runs, retries}           commits · numstat
           └───────────┬────────────┘
             filter sessions to repo + worktrees (realpath both sides)
             match: gitBranch → linked worktree → commit times → Unmatched(reason)
             receipt per branch: verdict(runs) · retries · risk(paths) · diffstat
             sort: FAILED > UNVERIFIED > PASSED, then branch name
                       ▼
                 src/render.js  renderText / renderMarkdown
                 (redact each field → collapse → truncate; HTML-escape in .md)
                       ▼
                 src/redact.js  clean() = redact + strip ANSI/control chars
                       ▼
                 stdout / stderr / --out file
```

**Security:**
- Read-only and offline. The only subprocess is `git`.
- Transcript strings never reach a shell. Git gets argument arrays with `refs/heads/<name>` refs, so a branch name can't be read as a flag.
- Transcript text is untrusted:
  - ANSI and control characters are stripped, which prevents terminal injection.
  - `<`, `>` and `&` are escaped in Markdown.
  - Secrets are redacted.

**Production failure scenarios, and how each is handled:**

| Codepath | Realistic failure | Handled by |
|---|---|---|
| Session parser | Claude Code renames a field | Runs/branches come up empty, so receipts fall to UNVERIFIED (the safe side). Unparseable lines are counted in a visible note, never silently. |
| Session parser | Agent still running; last line half-written | The line is counted as unreadable and skipped; no crash. |
| Session discovery | Years of history in `~/.claude/projects` | Files with an mtime older than the window are skipped before reading. |
| Repo filter | Session `cwd` is `/var/…` but git reports `/private/var/…` (macOS), or a symlinked checkout | Both sides are realpath'd (tested). |
| Repo filter | Agent worked in a `git worktree` outside the repo folder | Worktree paths come from `git worktree list` (tested). |
| Matcher | Old Claude Code without `gitBranch`, or `HEAD` (detached) | Falls back to commit times. Ambiguous matches go to Unmatched with a reason. |
| Matcher | Branch deleted after the run | Unmatched, with "branch … not found". |
| Git scanner | Not a repo, no `main`/`master`, git missing | A clear error and exit 1 (or "pass --base"). |
| Git scanner | Orphan branch with no merge base | The receipt says "diff unavailable" instead of crashing. |
| Status | Tests piped into `tail` | Covered by the "masked" rule above. |
| Redaction | A token format not in the list | Leaks. Documented as best-effort; new formats are a one-line addition plus a test. |

### Test plan

Run with `node:test` via `npm test`. Fixtures are generated per test run in temp directories:
- **Git repos:** commits are given exact dates through `GIT_COMMITTER_DATE`. The developer's global git config (signing, hooks) is ignored.
- **Session files:** Claude-Code-shaped JSONL with timestamps relative to now.
- **The CLI:** run as a real subprocess with a fake `HOME`.

| Exit criterion | Test(s) |
|---|---|
| 3 sessions + 3 branches → exactly 3 receipts, right session on each | `cli.test.js` "exit 1": receipts are parsed from stdout. Each branch block holds only its own session id, and one of the three is matched by commit times. |
| Non-zero test exit → `FAILED`, ranks above passing | `cli.test.js` "exit 2" (the passing branch sorts first alphabetically, so only status can put FAILED on top). `sessions.test.js` verdict cases. |
| Same failing command ×3 → `retries: 2` | `cli.test.js` "exit 3". `sessions.test.js` retry cases (fail-fail-pass, pass-pass, different commands). |
| `package-lock.json` → `risk: dependency`; `migrations/` → `risk: data` | `cli.test.js` "exit 4". `report.test.js` risk table (incl. auth, payments, negatives such as `author.md`). |
| `sk-ant-…`, `ghp_…`, `AKIA…` → `[REDACTED]` everywhere | `cli.test.js` "exit 5" (stdout, stderr and the `--out` Markdown, with tokens in the prompt, the Bash command and a commit subject). `redact.test.js`: 12 formats, idempotence, a private key cut before its END marker, ANSI stripping. |
| Unmatched sessions are listed, never dropped | `cli.test.js` "exit 6" (deleted branch, base-only session). `report.test.js`: ambiguous commit times, and every in-repo session appears exactly once. |
| No `~/.claude/projects` → exit 0 + clear message | `cli.test.js` "exit 7" (also outside a git repo, and with `CLAUDE_CONFIG_DIR`). |

Other codepaths are covered too:
- the session parser: task extraction, result shapes, masked pipes, case-sensitive runner FAIL markers, unreadable lines, mtime and timestamp window
- `classifyCommand` table, including quotes, heredocs and line continuations, so `npm test` inside a commit message is not a test run
- matcher via worktree and via symlinked cwd
- multiple sessions on one branch
- branch without a session
- a session's branch with no new commits
- the CLI's `--help`, a bad `--since`, not a git repo, an unknown `--base`, Markdown escaping (HTML, images, links), and other-project/old sessions

## M1: what it did (2026-10-11)

`dawnlog [--since 12h] [--repo PATH] [--base BRANCH] [--out FILE.md]`:
1. Reads the Claude Code session logs in `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`) that were active in the window.
2. Keeps the sessions whose working directory is inside the repo or one of its git worktrees.
3. Matches each session to a branch. It prints one receipt per branch that changed in the window (or that a session worked on), worst first.

```
dawnlog · /Users/you/code/app · since 2026-10-10 21:08 UTC (24h) · base main
3 receipts · 4 sessions · 1 unmatched

[1] fix-login — FAILED
    task: Fix the login redirect loop. Token for the staging API: [REDACTED]
    session: aaaa1111 via gitBranch — ~/.claude/projects/-Users-you-code-app/aaaa1111-….jsonl
    tests: npm test → exit 1
    commits: 1 commit, 2 files +2 -0
      - Fix redirect loop
    retries: 2
    risk: dependency, auth

[2] add-search — UNVERIFIED
    task: Add a search endpoint
    session: bbbb2222 via gitBranch — …
    tests: npm test 2>&1 | tail -20 → exit 0, real exit status hidden by a pipe; not verified
    …

Unmatched sessions (1)
    - dddd4444: branch "spike-cache" not found (deleted or renamed?) — …
      task: Try a caching spike
```

(Output is from `npm run demo`, shortened: real runs print full transcript paths.)

**Receipt fields:**

| Field | Meaning |
|---|---|
| status | `FAILED`, `UNVERIFIED` or `PASSED`, from the last test/lint command. A test piped into `tail` and exiting 0 is never PASSED: it's FAILED if the output shows failures, otherwise UNVERIFIED. |
| task | The first real user prompt. |
| session | The session id, how it was matched (`gitBranch`, `worktree` or `commit times`), and the transcript path. |
| tests | The last test command and its exit code. |
| commits | Commits on the branch since it left base, the diff stat, and up to 5 subjects. |
| retries | Re-runs of a command that had just failed. |
| risk | `dependency` (lockfiles and manifests), `data` (`migrations/`, `*.sql`, Prisma schema), `auth`, `payments`. |

**Behaviour:**
- Sessions that can't be matched are listed under "Unmatched" with the reason.
- Sessions from other repos and unreadable JSONL lines are counted in a `note:` line.
- With no `~/.claude/projects` it exits 0 with a clear message.
- Everything printed or written is secret-redacted (12 formats) and stripped of terminal escape codes.
- Read-only and offline: the only subprocess is `git`, and there are no network calls.

## M1: run it locally (old command name)

Requires Node ≥ 22 and git. There are no dependencies and nothing to install or build.

```sh
npm test                                   # 152 tests, ~4 s
npm run demo                               # builds a fixture in a temp dir, prints terminal + Markdown receipts, cleans up
node bin/dawnlog.js --since 12h            # in any git repo you've run Claude Code in
node bin/dawnlog.js --repo ~/Documents/Repos/RepoHQ --since 24h --out /tmp/dawnlog.md
npm link && dawnlog --since 12h            # put `dawnlog` on PATH (npm link sets the exec bit)
```

## M1: deploy notes (2026-10-11)

There's nothing to host: it's a local CLI. Both distribution routes are $0:
- **From GitHub, no publish step:** once the repo is pushed and public, run `npx github:<owner>/dawnlog --since 12h`. This works because there's no build and no dependencies.
- **npm:** pick a license, add a `LICENSE` file and a `license` field, check the name with `npm view dawnlog`, then run `npm publish`. After that, `npx dawnlog --since 12h` works anywhere. Public packages are free.

No API keys, accounts or paid services are used at runtime.

## M1 exit criteria (2026-10-11)

All 7 M1 exit criteria pass (`npm test`: 152 tests, 0 failures):

| # | Criterion | Status | Test |
|---|---|---|---|
| 1 | 3 sessions + 3 branches → exactly 3 receipts, right session on each | ✅ | `cli.test.js` › M1 fixture › exit 1 |
| 2 | Non-zero test exit → `FAILED`, ranks above passing | ✅ | `cli.test.js` › exit 2; `sessions.test.js` › verdict |
| 3 | Same failing command ×3 → `retries: 2` | ✅ | `cli.test.js` › exit 3; `sessions.test.js` › countRetries |
| 4 | `package-lock.json` → `risk: dependency`; `migrations/` → `risk: data` | ✅ | `cli.test.js` › exit 4; `report.test.js` › riskOf |
| 5 | `sk-ant-…`, `ghp_…`, `AKIA…` → `[REDACTED]` in all output | ✅ | `cli.test.js` › exit 5 (stdout, stderr, `--out` file); `redact.test.js` |
| 6 | Unmatched sessions listed, never dropped | ✅ | `cli.test.js` › exit 6; `report.test.js` › every session lands in exactly one place |
| 7 | No `~/.claude/projects` → exit 0 + clear message | ✅ | `cli.test.js` › exit 7 |

## M2 and M3 (first build, 2026-10-11)

### Decisions

| Question | Decision | Why |
|---|---|---|
| Ranking (M2) | Status first: FAILED > UNVERIFIED > PASSED, as before. Then risky before not, then more risk labels, then more retries, then more needs-you items, then name. | PRD: "failed-or-unverified and high-risk paths first". Status stays on top, so M1's exit criterion 2 still holds. |
| merge / fix / kill | The rule table in `src/triage.js` (copied in the README). `merge` only when PASSED. `kill` for no commits, already squash-merged, or FAILED after ≥ 5 retries. | A wrong `merge` is the costly mistake. A wrong `kill` costs a look. |
| "Deferred / needs you" | Read from the session's **final** assistant message only. It counts phrases ("I couldn't…", "you'll need to…", "skipped", "TODO"), bullets under headings such as "Next steps" or "Not done", and lines ending in `?`. Code blocks are skipped, and there are at most 10 items. | That's where agents put their summary. Earlier messages are full of plans that later got done. |
| `source: file:line` (M2) | `sources` on every receipt, with one key per field. Transcript fields cite `file:line` (1-based, blank lines counted). git fields cite `git:<base>...<branch>`. null means there's nothing to point at, such as no test run. Text output shows `· L12`. | The exit criterion says file:line, but commits and risk come from git, not a transcript. Inventing a line for them would be worse than citing git. |
| `--json` | Version 1 is documented in `schema/receipts.schema.json` (2020-12). It's validated in tests by a ~60-line validator in `test/` that throws on unknown keywords, so nothing is installed. Every string goes through `clean()` before serialising. | Zero dependencies, and the schema can't quietly outgrow the check. |
| Already-merged branches | Skipped, with a count in a note. A branch counts as merged if it has nothing ahead of base, or if it landed by squash: every changed file is identical in base, or its diff's patch-id equals a base commit's. If a session ran on it, it gets a receipt with `kill`. | Real run: RepoHQ went from 16 receipts to 3. GitHub squash merges leave branches looking unmerged. |
| Denied tool calls | `toolDenialKind`, or a result starting "The user doesn't want to proceed", means the run never happened. It isn't a failure, a retry or the verdict. | Found in a real session file. Before this, a denied `npm test` gave a false FAILED. |
| Files outside the task area (PRD) | The area is the directories the prompt names, if any changed. Otherwise it's the directory (two levels deep) with the most changed lines, plus any with at least half as many. | Explainable in one line. A one-area branch never gets a scope line. |
| `--summarize` (M3) | `claude -p --output-format text --no-session-persistence --tools ""`, run in `os.tmpdir()`. The prompt is the receipt's facts plus the last 3,000 characters of the final message, all through `clean()`. At most 20 receipts, 120 s each. Failures become notes. | No tools and no session file, so dawnlog never reads its own summaries back as sessions. The temp directory keeps CLAUDE.md out. Using the user's own `claude` means a subscription login costs nothing extra; an `ANTHROPIC_API_KEY` is billed per call. |
| `dawnlog digest` (M3) | `--out` is required. It takes several `--repo`, writes text or Markdown, and replaces the file atomically (temp file plus rename). If one repo fails, the error goes in the file and the exit code is 1; the rest are still written. Without `~/.claude/projects` it still lists branches. | Cron-friendly: one file per run, no partial reads, and failures are visible both in the file and to cron. |
| Entire (M3) | Reads the branch backend `entire/checkpoints/v1` (local, then `origin/`). Field names come from entireio/cli's `e2e/testutil/metadata.go`. The `Entire-Checkpoint` trailer is match rule 0. Sessions only in Entire are parsed from `full.jsonl` when the agent is Claude Code. The ref backend is noted, not read. Entire's branches are never receipts. | The trailer is evidence written at commit time, the strongest there is. The ref backend's tree layout isn't documented, so guessing at it would risk misreading. |

### New files

- `src/triage.js`: suggestion rules, ranking and task area.
- `src/deferred.js`: the needs-you extractor.
- `src/entire.js`: checkpoint reading and trailer links.
- `src/summarize.js`: `--summarize`.
- `src/digest.js`: `dawnlog digest`.
- `schema/receipts.schema.json`: the `--json` schema.
- Changed: `sessions.js` (line numbers, final message, edits, denied runs), `git.js` (trailers, squash detection, batched blob reads), `report.js`, `render.js` (JSON) and `cli.js`.

### Exit criteria

All 228 tests pass (`npm test`, about 6 s).

| # | Criterion | Status | Test |
|---|---|---|---|
| M2.1 | Ranking order matches a golden file for the fixture set | ✅ | `m2.test.js` › exit 1: nine branches, one per rule, against `test/golden/ranking.txt`; text and `--json` agree |
| M2.2 | Each receipt field carries a `source: file:line` | ✅ | `m2.test.js` › exit 2: every `sources` key present, and each `file:line` opened to check it holds the task, the command or the item |
| M2.3 | `--json` validates against a schema | ✅ | `m2.test.js` › exit 3, plus a test that a broken document fails; `m3.test.js` validates the Entire and `--summarize` variants |
| M3.1 | Without `--summarize`, no subprocess or network call other than git | ✅ | `m3.test.js` › exit 1: `test/fixtures/trap.mjs` preloaded with `--import` patches every `child_process` and `net`/`tls`/`http(s)`/`dns`/`fetch` entry. Checked for receipts, `--json`, `--out` and `digest`, plus a test that the trap does see `claude` with `--summarize`. |
| M3.2 | Digest file written to the given path on a fixture run | ✅ | `m3.test.js` › exit 2 (also: several repos, a bad repo, md, quiet, atomic replace, redaction), plus `scripts/morning-digest.sh` with a fake `openclaw` |
| M3.3 | Entire checkpoint ingestion if present | ✅ | `m3.test.js` › exit 3, `entire.test.js` |
| PRD | Receipts under 5 s for 100 session files | ✅ | `perf.test.js` |

### Checked on real data (2026-10-11, read-only, on this machine)

- **Session file schema.** A 2,993-record session from Claude Code 2.1.x has the fields the parser reads. Bash failures carry `is_error` and an "Exit code N" prefix, with no `toolUseResult.exitCode`, and the parser handles both shapes. Denied calls (`toolDenialKind`) were the one new shape, and they're handled now.
- **RepoHQ and ai-stack, `--since 3d`.** 0.4–0.7 s each, and `--json` passes the schema. The 7 sessions found were placed or explained as listed in the PRD status table. Squash detection took RepoHQ from 16 receipts to 3.
- **`claude -p` flags.** The exact `--summarize` flags ran against the real `claude` 2.1.296 with a trivial prompt and no API key in the environment.

## What was left after the first M3 (2026-10-11)

Superseded by [What's left](#whats-left) above. Kept for the record.

**Needs real use (PRD metrics):**
- The proof test: at least 9 of 10 real overnight sessions on the right branch.
- Two weeks of measured triage time.
- `--summarize` on a real night, to judge whether the summaries are worth the wait.

**Not built:**
- Entire's ref-based checkpoint storage (`refs/entire/checkpoints/<shard>/<id>`).
- Subagent transcripts (`<session>/subagents/*.jsonl`) and Entire's `tasks/` folder.
- Uncommitted work in worktrees.
- Codex sessions (a PRD non-goal for v1).
- Wrapped test commands (`bash -c "npm test"`, `make -C dir test`) still show as UNVERIFIED, which is the safe side.
- Windows is untested.

**Packaging (owner decisions):**
- License: MIT (added 2026-10-11). The bin's exec bit is set in git.
- The npm name `dawnlog` was taken by an unrelated standup-report CLI (yyalim/dawnlog), so the project is now **overnight-receipts** (free on npm on 2026-10-11). The repo is public, so `npx github:smithdavedesign/overnight-receipts` works now; `npm publish` is optional.
- An optional GitHub Actions test workflow.

## M1 review (2026-10-11)

This was a self-review against the gstack pre-landing checklist ("Review Categories", "Fix-First Heuristic"). Every file is new, so `git diff` was empty and the review was a full read of `bin/`, `src/`, `test/` and `scripts/`.

**Fixed (tests rerun: 152/152 pass):**
- [P1] (confidence: 9/10) `src/sessions.js` `classifyCommand`: **LLM output trust boundary, giving a false PASSED.**
  - The splitter ignored quotes and heredocs, so `npm test` on its own line inside a heredoc commit message counted as a test run, and the commit's exit 0 became PASSED.
  - Fix: a quote- and heredoc-aware splitter, plus 7 table tests.
- [P1] (confidence: 9/10) `src/redact.js` `clean`: **secret leak.**
  - Redacting before sanitizing let an escape sequence glued to a token hide its word boundary. The escape was then stripped and the token printed.
  - Caught by `redact.test.js` before the first green run.
  - Fix: sanitize first, and no leading `\b` on distinctive token prefixes.
- [P2] (confidence: 8/10) `src/render.js` `md`: **unsafe rendering.**
  - Transcript `![x](url)` became an auto-loading image (a tracking request) when the `--out` file is previewed.
  - Fix: images and inline links are neutralised, plus a test. Raw HTML was already escaped.
- [P2] (confidence: 7/10) `src/sessions.js`: **false FAILED on masked runs.**
  - Case-insensitive `FAIL` matched passing tests named "failed …".
  - Fix: runner markers are now case-sensitive, plus a test.
- [P3] `src/sessions.js`: a session file deleted mid-scan crashed the run (Claude Code prunes old sessions on startup).
  - `ENOENT` is now skipped. Not covered by a test: it's a race.
- [P3] `src/git.js`: two catch-alls narrowed. `repoRoot` only maps a git exit status to "not a repo", and `branchFiles` only treats "no merge base" as "diff unavailable".
- [P3] Dead data removed: `run.id` and the unused `now` in `buildReport`.

**Checked, nothing to fix:**
- **SQL, races, N+1:** none; it's read-only with no DB.
- **Shell injection:** only `execFileSync('git', [...])`. Branch names go in as `refs/heads/…` with `--`, and transcript strings never reach git or a shell.
- **Enum completeness:** traced every consumer of the `FAILED`/`UNVERIFIED`/`PASSED`, `via` and risk values (`STATUS_ORDER`, render, test parser).
- **Time windows:** the session mtime prefilter and the record-timestamp filter use the same `since`, and branch tips are compared against it too.

**Left (none CRITICAL):**
- [P2] (confidence: 6/10) **Schema drift is still the top risk** (REVIEW risk 1). A renamed field degrades receipts to UNVERIFIED, the safe side, and unreadable lines are reported. But a silently *changed* meaning, for example `is_error` no longer set on non-zero exits, would make every run PASSED. Medium confidence: verify against a real current session file.
- [P3] Some wrapped test commands aren't recognised: `bash -c "npm test"`, `(npm test)` and `make -C dir test`. They show as UNVERIFIED (safe side).
- [P3] Redaction is best-effort. A token format not on the list will leak, so every new format needs a pattern and a test.
- [P3] **Distribution:** the CLI artifact has no publish or CI workflow. This is deliberate and flagged in "Not in scope". Windows is untested.

