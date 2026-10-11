# Roadmap — dawnlog

## M1 — Weekend: branch receipts from Claude Code logs
Deliverables: Node CLI `dawnlog`; JSONL session parser; git branch scanner; session→branch matcher; Markdown + terminal receipt; secret redaction.
Exit criteria (testable):
- Given fixtures of 3 session JSONL files and a git repo with 3 branches, `dawnlog --since 24h` lists exactly 3 receipts with the right session on each branch.
- A session whose last Bash result shows a non-zero test exit gets status `FAILED` and ranks above a passing one.
- A session that repeats the same failing command 3 times reports `retries: 2`.
- A diff touching `package-lock.json` sets `risk: dependency`; touching `migrations/` sets `risk: data`.
- Input containing `sk-ant-…`, `ghp_…` and `AKIA…` tokens appears as `[REDACTED]` in all output.
- Sessions with no matching branch appear under "Unmatched", never dropped.
- Running with no `~/.claude/projects` exits 0 with a clear message.

## M2 — Triage queue
Deliverables: ranking and merge/fix/kill suggestion; deferred-work extraction; transcript line links; `--json` output.
Exit criteria: ranking order matches a golden file for the fixture set; each receipt field carries a `source: file:line`; `--json` validates against a schema.

## M3 — Optional summaries and delivery
Deliverables: `--summarize` through `claude -p`; cron-friendly `dawnlog digest` writing a file for push delivery; Entire checkpoint ingestion if present.
Exit criteria: with `--summarize` absent, zero subprocess or network calls other than git (asserted in test); digest file written to the given path on a fixture run.

## Suggested stack
- Node.js + TypeScript: matches David's other tooling and ships via `npx`.
- No dependencies for parsing: JSONL and the `git` subprocess are enough, keeping install instant.
- Vitest: fixture-driven tests for the exit criteria above.
