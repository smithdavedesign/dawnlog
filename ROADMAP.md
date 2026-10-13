# Roadmap — dawnlog

_Renamed from **dawnlog** to **overnight-receipts** on 2026-10-11 (the npm name was taken). Notes below were written under the old name; the command is now `overnight-receipts`, the env vars `OVERNIGHT_RECEIPTS_*`._

**Status (2026-10-11): M1, M2 and M3 are built, and every exit criterion has a passing test.** How each criterion is tested is in [BUILD.md](BUILD.md). **2026-10-13:** an MVP run added REVENUE.md's parts. M2's revenue criteria (the Pro link) and M3's storefront criteria (S1–S6) pass. Taking money now needs only non-code steps: the launch checklist in BUILD.md › What's left. **Go-live pass (2026-10-13):** search and sharing tags, robots.txt, sitemap, share image, clean URLs, RepoHQ's visit beacon and `.provision`. What's left for David is in [LAUNCH-READY.md](LAUNCH-READY.md).

## M1 — Weekend: branch receipts from Claude Code logs ✅
Deliverables: Node CLI `dawnlog`; JSONL session parser; git branch scanner; session→branch matcher; Markdown + terminal receipt; secret redaction.
Exit criteria (testable):
- Given fixtures of 3 session JSONL files and a git repo with 3 branches, `dawnlog --since 24h` lists exactly 3 receipts with the right session on each branch.
- A session whose last Bash result shows a non-zero test exit gets status `FAILED` and ranks above a passing one.
- A session that repeats the same failing command 3 times reports `retries: 2`.
- A diff touching `package-lock.json` sets `risk: dependency`; touching `migrations/` sets `risk: data`.
- Input containing `sk-ant-…`, `ghp_…` and `AKIA…` tokens appears as `[REDACTED]` in all output.
- Sessions with no matching branch appear under "Unmatched", never dropped.
- Running with no `~/.claude/projects` exits 0 with a clear message.

## M2 — Triage queue ✅
Deliverables: ranking and merge/fix/kill suggestion; deferred-work extraction; transcript line links; `--json` output.
Exit criteria: ranking order matches a golden file for the fixture set; each receipt field carries a `source: file:line`; `--json` validates against a schema.
- ✅ Ranking matches `test/golden/ranking.txt`, in both text and `--json` (`test/m2.test.js` › exit 1).
- ✅ Every receipt field has a `sources` entry. Transcript fields cite `file:line`, and the test opens that line to check it. git fields cite `git:<base>...<branch>` (exit 2).
- ✅ `--json` validates against `schema/receipts.schema.json` (exit 3).

**Revenue (added 2026-10-13 from REVENUE.md: "M2 is the real MVP for charging"; the Pro link goes in the README and the Markdown footer).** The storefront (landing page, Stripe checkout, terms and privacy) is M3. Exit criteria, all tested in `test/m2.test.js` › "M2 revenue":
- ✅ R1. The `--out` Markdown file ends with a Pro footer: a rule, the price, and a link to `package.json`'s `funding.url`.
- ✅ R2. `OVERNIGHT_RECEIPTS_LICENSE` (honour system, any non-blank value) hides the footer and changes nothing else.
- ✅ R3. The footer is only in the Markdown file. Terminal output, `--json` and the digest have none.
- ✅ R4. The link target exists: the README has a `## Pro` section with the same price.

## M3 — Optional summaries and delivery ✅
Deliverables: `--summarize` through `claude -p`; cron-friendly `dawnlog digest` writing a file for push delivery; Entire checkpoint ingestion if present.
Exit criteria: with `--summarize` absent, zero subprocess or network calls other than git (asserted in test); digest file written to the given path on a fixture run.
- ✅ A preload trap records every subprocess and socket. Receipts, `--json`, `--out` and `digest` run only `git` (`test/m3.test.js` › exit 1).
- ✅ `dawnlog digest --out FILE` writes the file, atomically, across repos (exit 2).
- ✅ Entire ingestion: trailer matching, sessions from other machines, and no receipts for Entire's own branches (exit 3).

**Revenue: the storefront (added 2026-10-13 from REVENUE.md: a landing page with terms and privacy, a $12 Stripe Payment Link, and a success page that shows a license string).** It's a static site in `site/`, built to `dist/`. Vercel's free tier hosts it before launch. Once checkout is on, it moves to Cloudflare Pages' free plan, because Vercel Hobby is non-commercial only; the build writes `_headers` for it (see BUILD.md › Deploy). Exit criteria, all tested in `test/storefront.test.js`:
- ✅ S1. `npm run site:build` writes the static site to `dist/`: landing, terms, privacy, thanks, CSS and JS. Every internal link and asset resolves, and no template placeholder is left.
- ✅ S2. The landing page says what the tool is and gives the free install line. It shows the price from `PRO_PRICE`, with terms and privacy links next to the buy button.
- ✅ S3. `STRIPE_PAYMENT_LINK` (named `PRO_CHECKOUT_URL` until the go-live pass) is the checkout switch:
  - set to a `https://buy.stripe.com/…` link, the Buy button links there
  - unset or blank, there's no checkout link anywhere and the page says "Checkout opens soon"
  - any other value fails the build without printing the value
- ✅ S4. Terms and privacy say it's local only, read-only and uploads nothing, that redaction is best-effort, and that it's provided as is. They also cover 30-day refunds, Stripe taking the payment, and no cookies or third-party analytics on the site (the go-live pass added RepoHQ's visit beacon, which the privacy page describes). Every page links both.
- ✅ S5. The thanks page turns `?session_id=<Checkout Session id>` into `export OVERNIGHT_RECEIPTS_LICENSE="<id>"`. Anything else shows no line, plus a fallback that says how to get one. That string hides the CLI's Markdown footer.
- ✅ S6. The site keeps its own privacy promise:
  - nothing loads from another origin
  - no inline script or style
  - `no-referrer` on every page
  - `vercel.json`, and the generated `_headers`, serve a `default-src 'self'` CSP
  - the thanks page is `noindex`

## Suggested stack
- Node.js + TypeScript: matches David's other tooling and ships via `npx`. **Built as plain ESM JavaScript with JSDoc instead.** Node won't strip types under `node_modules`, so a `.ts` package breaks under `npx` (see BUILD.md).
- No dependencies for parsing: JSONL and the `git` subprocess are enough, keeping install instant.
- Vitest: fixture-driven tests for the exit criteria above. **Built on `node:test` instead**, so there's nothing to install.

## Next (not in any milestone)
These come from the PRD's success metrics and open questions, and need real use:
- The proof test: at least 9 of 10 real overnight sessions attributed to the right branch (REVIEW's M1 test).
- Two weeks of self-measured triage time.
- Entire's ref-based checkpoint storage.
- Codex sessions (a PRD non-goal for v1).
- Subagent transcripts.
- Uncommitted work in worktrees.
- Publishing: a license, then `npm publish` or a public repo for `npx github:…`.
