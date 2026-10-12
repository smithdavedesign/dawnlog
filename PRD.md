# PRD — dawnlog

## Problem
After an unattended agent run, a developer faces several branches and failed runs and must reconstruct what the agent decided before they can merge, fix or kill each one. Git log shows what changed but not retries, skipped work, failing checks or out-of-scope edits. Evidence: https://tianpan.co/blog/2026-07-02-the-morning-review-queue

## Target user
A solo developer or small-team lead who runs Claude Code (later Codex) in the background overnight or during meetings, on 1–5 repos, and reviews the results over coffee. They already have session logs in `~/.claude/projects` and do not want to install hooks or a hosted service.

## Competitors & gap
Entire and Semantica capture session-to-commit provenance via hooks installed up front and focus on tracing one commit; session viewers only browse transcripts; git-summary skills ignore agent behavior. Gap: retroactive, zero-install, cross-branch triage output. See RESEARCH.md.

## MVP scope
- `dawnlog [--since 12h] [--repo PATH]` scans Claude Code session files and git branches modified in the window.
- Match each session to a branch (cwd + timestamps + commit times); list unmatched sessions separately.
- Per-branch receipt: task (first user prompt), commits and diff stat, final test/lint status from tool results, retry/thrash count, files outside the task's main directories, dependency-file changes.
- "Deferred / needs you" list from phrases in the agent's final messages and unanswered questions.
- Triage ranking: failed-or-unverified and high-risk paths (auth, payments, migrations, lockfiles) first, with a suggested merge / fix / kill label.
- Output to terminal and a single Markdown file; secrets redacted; every claim links to a transcript file and line.
- Read-only and offline by default; optional `--summarize` via the user's own `claude -p`.

## Non-goals
- Capturing sessions via hooks, hosting, or team dashboards.
- Reviewing code quality or auto-merging.
- Token cost accounting (a separate, passed idea: pr-receipt).
- Codex/Gemini support in v1.

## Success metrics
- Correctly attributes ≥ 90% of sessions to the right branch on 20 real overnight runs of the author.
- Receipt generation under 5 s for 100 session files.
- Author's triage time per branch drops from a self-measured baseline by ≥ 50% over two weeks.
- 0 unredacted secrets in outputs across a seeded test corpus of 10 token formats.
- 25 GitHub stars or 5 external issues within 60 days of a Show HN, as a demand signal.

## Open questions
- Is the JSONL schema stable enough across Claude Code versions to avoid a parser per release?
- Do users want a push (email/WhatsApp) morning digest more than a CLI?
- Should it ingest Entire checkpoints instead of raw JSONL when present?

## Status (2026-10-11)

Every MVP-scope item is built and tested; [BUILD.md](BUILD.md) has the details.

| MVP scope | Status |
|---|---|
| `dawnlog [--since 12h] [--repo PATH]` over session files and branches changed in the window | ✅ M1. Also ignores branches already merged, including squash merges. |
| Match each session to a branch (cwd + timestamps + commit times); unmatched listed separately | ✅ M1, plus Entire trailers first (M3) |
| Receipt: task, commits + diff stat, final test/lint status, retry count | ✅ M1 |
| Receipt: files outside the task's main directories | ✅ `scope:` line, the directories named in the task or holding most changed lines |
| Receipt: dependency-file changes | ✅ `risk: dependency` (with data, auth, payments) |
| "Deferred / needs you" list from final messages and unanswered questions | ✅ M2 |
| Triage ranking with merge / fix / kill label | ✅ M2: golden-file tested |
| Terminal + single Markdown file; secrets redacted | ✅ M1. Redaction also covers `--json` and the digest. |
| Every claim links to a transcript file and line | ✅ M2: `· L12` in text, `file:line` in `--json` `sources` |
| Read-only and offline by default; optional `--summarize` via `claude -p` | ✅ M3. Offline is asserted by a subprocess and network trap. |

| Success metric | Status |
|---|---|
| ≥ 90% sessions attributed correctly on 20 real overnight runs | **Not measured yet.** Needs real overnight runs. A 3-day spot check on RepoHQ and ai-stack (2026-10-11) found 7 sessions. 4 were placed on a branch (3 via gitBranch, 1 via commit times). The other 3 ran on the base branch and are listed as unmatched with that reason. Not yet confirmed by hand. |
| Receipts under 5 s for 100 session files | ✅ `test/perf.test.js`: 100 files × 40 runs, well under 5 s. Real repos take about 0.4–0.7 s. |
| Triage time per branch down ≥ 50% over two weeks | **Not measured yet.** Needs two weeks of use. |
| 0 unredacted secrets across 10 token formats | ✅ 12 formats, in every output (`test/redact.test.js`, `cli.test.js` exit 5, `m3.test.js`) |
| 25 stars or 5 external issues within 60 days of a Show HN | **Not started.** The repo is private and unpublished. |

| Open question | Answer so far |
|---|---|
| Is the JSONL schema stable across Claude Code versions? | The fields dawnlog reads were checked against a real 2.1.x session file on 2026-10-11. Failures carry `is_error` plus an "Exit code N" prefix, with no `toolUseResult.exitCode`, and the parser handles both shapes. Denied tool calls are a third shape and are now handled. Keep checking after each release. |
| Push digest or CLI? | Both: `dawnlog digest` writes a file for cron to send (README shows WhatsApp through OpenClaw). |
| Ingest Entire checkpoints when present? | Yes. They're read alongside the raw JSONL, not instead of it, and Entire's trailer is the strongest match. |
