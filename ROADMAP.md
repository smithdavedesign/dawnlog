# Roadmap — dawnlog

_Renamed from **dawnlog** to **overnight-receipts** on 2026-10-11 (the npm name was taken). Notes below were written under the old name; the command is now `overnight-receipts`, the env vars `OVERNIGHT_RECEIPTS_*`._

**Status (2026-10-11): M1, M2 and M3 are built, and every exit criterion has a passing test.** How each criterion is tested is in [BUILD.md](BUILD.md).

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

## M3 — Optional summaries and delivery ✅
Deliverables: `--summarize` through `claude -p`; cron-friendly `dawnlog digest` writing a file for push delivery; Entire checkpoint ingestion if present.
Exit criteria: with `--summarize` absent, zero subprocess or network calls other than git (asserted in test); digest file written to the given path on a fixture run.
- ✅ A preload trap records every subprocess and socket. Receipts, `--json`, `--out` and `digest` run only `git` (`test/m3.test.js` › exit 1).
- ✅ `dawnlog digest --out FILE` writes the file, atomically, across repos (exit 2).
- ✅ Entire ingestion: trailer matching, sessions from other machines, and no receipts for Entire's own branches (exit 3).

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
