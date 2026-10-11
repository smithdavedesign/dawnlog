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
