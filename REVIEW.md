# Verdict: PASS — score 5/10

A weekend-buildable, $0 CLI that solves a real but thinly evidenced pain, and has no visible path to anyone paying for it.

## Forcing questions

### Q1 Demand Reality — 3/10
Evidence is one 2026 blog post (tianpan.co "morning review queue"), a vendor guide (Verdent), and a feature-request issue for a global session history view (claudeissues.com #49095). All are articles or a request for a viewer, not behavior or money. RESEARCH.md itself says: "Unverified: how many people run agents unattended often enough to care." No one has asked for this tool, paid, or built a workaround that David has seen. The only real user is David, who runs Claude Code. That is a user of one, not demand.
Would change my mind: 5+ people in a thread who say they already hand-parse `~/.claude/projects` for this, or an unprompted DM asking when it ships.

### Q2 Status Quo — 5/10
The workaround is `git log`, `/resume`, and reading the transcript. It is annoying but cheap, and the research found users writing their own JSONL parsers, which is a good sign. Entire and Semantica are the real competitors, but they need hooks installed beforehand, so retroactive zero-install is a true difference. Against that, Anthropic can ship a better history view or a "what happened overnight" summary at any time.

### Q3 Desperate Specificity — 4/10
The persona is "a solo developer or small-team lead running Claude Code overnight on 1–5 repos". That is a profile, not a named person with a consequence. The cost is some lost coffee-time, not a missed deadline or a lost job. Nobody gets fired for a slow morning review. The pain is a nuisance.

### Q4 Narrowest Wedge — 6/10
The wedge is good: one `npx dawnlog --since 12h` that prints per-branch FAILED / retries / risky-file flags. It needs no login, setup, or hosting. The weakness is that it is a free OSS CLI, so there is nothing to sell this week. The PRD's own success metric is "25 stars or 5 issues", which is attention, not revenue.

### Q5 Observation (pre-product)
Watch M1 users run it on their own real overnight sessions. Note whether the session-to-branch match is right, whether they trust the FAILED label or re-open the transcript anyway, which receipt field they read first, and whether they ask for a push digest rather than a CLI.

### Q6 Future-Fit — 4/10
More unattended agent runs make triage more valuable, and that is a real trend. But the receipt depends on an undocumented JSONL schema owned by a vendor who is the obvious party to build this. Entire and Semantica may add a morning view. A tool that rides on another company's log format, with no distribution or data moat of its own, gets less essential as the platform matures.

## Premises
1. Developers run agents unattended often enough to need triage. Weakly supported: blogs and vendors, no user threads.
2. Heuristics (exit codes, repeated commands, risky paths) give receipts people trust. Plausible, but a wrong receipt is worse than none, and the research flags this.
3. The Claude Code JSONL format is stable enough to parse. Unsupported: undocumented, and the research says to treat it as unstable.
4. A retroactive, zero-install tool beats hook-based tracing. Partly supported: it is a real gap, but hooks give richer data.
5. Someone will pay for or meaningfully adopt a local CLI. Not supported anywhere in the research.

## Alternatives
- **Minimal: a single shell script or Claude Code skill.** Run `git log` plus a grep over the session files and print a summary. Effort S, no landing page needed. It scratches David's own itch with no demand test.
- **Extend an existing repo of David's.** Add a "last night's agent runs" panel to RepoHQ, his GitHub portfolio health dashboard. It reuses his stack and a surface he already visits, and it shares the session-log reading with the passed pr-receipt idea. Effort M.
- **Ideal: ingest Entire/Semantica checkpoints as the primary input**, with raw JSONL as fallback. This is more robust, but it ties dawnlog to tools that are still forming, and it is bigger than a weekend.
- **Recommendation:** build the minimal script for personal use only if David feels the pain, and do not spend a demand-test slot on it.

## Narrowest wedge
`npx dawnlog --since 12h` on one repo, Claude Code only. It prints one line per branch: matched session, FAILED/OK from the last test result, retry count, and a flag for lockfile, migration, or auth-path changes. No ranking, no summaries, no markdown file.

## M1 feasibility
- **Weekend:** yes. Node CLI with a hand-rolled JSONL parser, `git` subprocess calls, and a regex redactor, all fixture-tested with Vitest.
- **$0:** yes. Local-only, no hosting, no paid API, npm publish is free.
- **Single test that proves M1:** on 10 of David's real overnight sessions, at least 9 attribute to the correct branch. The PRD's 90% bar is the right one.
- **Hidden cost:** schema drift. Plan for a parser fix every Claude Code release.

## Risks
- JSONL schema drift breaks the parser silently.
- Anthropic ships a native overnight summary or a better history view.
- Entire or Semantica add a morning view.
- Heuristic false confidence ("PASSED" when it was not).
- Transcript secrets leaking despite best-effort redaction.
- No monetization: a free CLI violates the "products people pay for" goal, and a waitlist for a CLI is a weak filter.
- Overlaps the passed pr-receipt idea in the same session-log reading, with the same weakness.

## Kill criteria
Drop it if a 2-week test gets fewer than 50 visitors and fewer than 5 signups, if no reader of the launch post describes already parsing session logs themselves, if Anthropic or Entire ship a morning view, or if parser attribution is under 90% on David's own runs.

## What M1 users should be watched doing
Running it cold the morning after a real overnight run. Do they trust the label or open the transcript? Which branch do they look at first? Do they ask for Codex support or a push digest?

## Assignment
Before building anything, post once in a Claude Code community asking "how do you review what your agent did overnight?" and count how many describe a manual workaround.
