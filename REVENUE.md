# Revenue plan: dawnlog

**Plain verdict: the evidence says nobody has been shown to pay for this yet.** Evidence strength: weak. Everything below is a best case at a low price, built to test willingness to pay cheaply. It is not a forecast.

## What the evidence is
- Demand evidence is blog posts, a vendor guide and one feature-request issue (claudeissues.com #49095). No one has paid, pre-ordered or asked when it ships. The review scored demand 3/10.
- Competitors I found are free or open source: Entire, Semantica, ccusage (a local CLI reading the same JSONL files, which sets the price norm for this niche at $0) and session viewers. LangWatch has a hosted Claude Code tracking product with a free individual tier; its paid price wasn't in my search results. I could not find a paid, local, agent-triage CLI to anchor on.
- The only price anchor that is solid is the buyer's own spend: Claude Code runs inside a $20/mo Pro, $100/mo Max 5x or $200/mo Max 20x plan (a 2026-07 pricing summary). People who run agents overnight are paying $100-$200/mo, so a one-time $12-$19 is a rounding error for them. The problem is that the free baseline tool is already good enough, not that they can't afford it.
- Search for paid CLI comparables returned nothing useful. I won't invent any.

## Who pays
Not "users". A specific person: a solo developer or freelancer on **Claude Code Max ($100-$200/mo)** who runs agents overnight across 2-5 repos and bills clients or ships a product on their own time. They have a personal card and no approval step. A staff engineer at a company is the wrong buyer: employer procurement for a $12 CLI is slower than the value.
Find them where they complain about review overhead: r/ClaudeAI, r/ClaudeCode, Show HN comment threads on agent tools, and the people commenting on issue #49095 who built their own JSONL parsers. Those parser-builders are the single best lead list: they already pay in time.

## What they pay today
Nothing for a tool. They pay in minutes: `git log`, `/resume`, reading transcripts. The tianpan post says review time rose 91% for high-AI-adoption teams. I can't turn that into dollars for one solo developer; treat the "saves 20 minutes a morning" line as a hypothesis, not a fact.

## Narrowest version worth paying for
The free CLI must stay free and useful, or no one will install it, and installs are the only demand signal. A paid tier has to be something the free version honestly lacks:
- **Free (MIT):** `dawnlog --since 12h` terminal receipts per branch.
- **Pro, $12 one-time:** Markdown file with transcript line links, `--json`, ranked merge/fix/kill triage, and `dawnlog digest` for cron. These are the M2/M3 items, so M2 is the real MVP for charging.
Do not charge until M2 exists and attribution is at least 90% on David's own 10+ runs. Charging for M1 is charging for `git log` plus a regex.

**Price: $12 once.** Why not a subscription: the data never leaves the machine, there is no server cost to cover, and no one subscribes to a local CLI that Anthropic could out-ship. Why $12 and not $19-$29: no evidence of willingness to pay exists, and the price should be an impulse buy that still filters out "free only" people. Raise it only after 10 buyers.

## How payment works with $0 and no backend
Stripe Payment Link for a $12 product. The success page shows a license string and a link to a private GitHub repo or npm tarball for `dawnlog-pro`. Fulfilment is manual at first (David adds the buyer to the repo from the Stripe email). Manual is fine for 10 customers. Automate nothing before the tenth sale. Stripe's fee is about 2.9% + $0.30 (my memory, not checked), so about $0.65 on $12.

## Shortest path
1. Merge M2 (ranking, source links, `--json`). M3 `digest` can follow.
2. Run it on 10+ real overnight runs; confirm >= 90% attribution. If it fails, stop here.
3. Post the free CLI to npm and GitHub with a landing page that has privacy policy and terms (they state: local only, read-only, nothing is uploaded; secret redaction is best-effort).
4. Ask in r/ClaudeAI and r/ClaudeCode: "how do you review what your agent did overnight?" (the review's assignment) and reply to the issue #49095 commenters.
5. Show HN once the free tool works. The Pro link goes in the README and in the `--markdown` output footer.
6. Count: stars, issues, installs, Pro clicks, payments, over 60 days.

## Risks
- Wrong receipt ("PASSED" when it was not) kills trust, and trust is the product.
- Claude Code's JSONL format is undocumented; a release can break parsing and then refunds follow.
- Anthropic, Entire or Semantica ship a morning view and the niche disappears.
- Open source plus MIT means anyone can copy the Pro features; paying is a courtesy, not a gate. Expect some buyers to pay out of goodwill only.
- Transcripts contain secrets; a redaction miss in a paid product is a reputational and possibly legal problem. Terms must disclaim it.
- Market size may simply be tiny. Realistic outcome: 0-5 sales, $0-$60 total. That is a valid result of the test.

## Kill criteria
Stop if any of these hold:
- Attribution is under 90% on David's own runs.
- 60 days after the launch post: fewer than 25 stars and fewer than 5 external issues and zero Pro purchases.
- After 150 installs or 30 Pro-link clicks there are still no sales: people want it free.
- Anthropic or Entire ship an overnight triage view.
In every case keep it as a free open-source portfolio piece, and do not spend more build time on it.

## Sources
- https://claudeissues.com/issue/49095-global-session-history-view-across-all-projects
- https://tianpan.co/blog/2026-07-02-the-morning-review-queue
- https://www.thoughtworks.com/radar/tools/entire-cli
- https://www.sourcepulse.org/projects/4424865 (ccusage)
- https://fast.io/resources/claude-code-usage-guide/ and https://www.lowcode.agency/blog/claude-code-pricing (Claude plan prices)
- https://www.producthunt.com/posts/claude-code-usage-tracking-by-langwatch
