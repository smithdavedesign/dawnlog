# BUILD — dawnlog M1

## Plan

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

## What it does now

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

## Run it locally

Requires Node ≥ 22 and git. There are no dependencies and nothing to install or build.

```sh
npm test                                   # 152 tests, ~4 s
npm run demo                               # builds a fixture in a temp dir, prints terminal + Markdown receipts, cleans up
node bin/dawnlog.js --since 12h            # in any git repo you've run Claude Code in
node bin/dawnlog.js --repo ~/Documents/Repos/RepoHQ --since 24h --out /tmp/dawnlog.md
npm link && dawnlog --since 12h            # put `dawnlog` on PATH (npm link sets the exec bit)
```

## Deploy (free tier)

There's nothing to host: it's a local CLI. Both distribution routes are $0:
- **From GitHub, no publish step:** once the repo is pushed and public, run `npx github:<owner>/dawnlog --since 12h`. This works because there's no build and no dependencies.
- **npm:** pick a license, add a `LICENSE` file and a `license` field, check the name with `npm view dawnlog`, then run `npm publish`. After that, `npx dawnlog --since 12h` works anywhere. Public packages are free.

No API keys, accounts or paid services are used at runtime.

## Exit criteria

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

## What's left

**Before trusting it on real nights:**
- Run it on David's real sessions; this is the REVIEW's proof test (≥ 9/10 attributed to the right branch).
- Fixtures follow the schema from third-party write-ups, not a real file. Nothing was read from `~/.claude/projects`, because this build stayed inside the repo. Check in particular that Bash failures carry `is_error`/`exitCode` the way the parser expects.

**M2:**
- Merge/fix/kill labels and a golden ranking.
- Deferred-work list.
- `source: file:line` on every field (the parser already walks lines in order, so this is cheap).
- `--json` with a schema.

**M3:**
- `--summarize` via `claude -p`.
- `dawnlog digest`.
- Entire checkpoint ingestion.

**Not planned in any milestone yet:**
- "Files outside the task's main directories" (PRD).
- Subagent transcripts (`<session>/subagents/*.jsonl`).
- Uncommitted work in worktrees.
- Codex support.
- Performance: the PRD target is 100 files in < 5 s, which isn't tested. Files are read whole (`readFileSync`), so very large transcripts may need streaming.

**Packaging:**
- Choose a license.
- Set the exec bit on `bin/dawnlog.js` in git (`git update-index --chmod=+x bin/dawnlog.js`; the sandbox blocked `chmod`). npm sets it on install anyway.
- Optional: a GitHub Actions test workflow (free for public repos).

## Review

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

