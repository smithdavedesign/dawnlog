# Research — dawnlog

## Summary
Developers who let Claude Code/Codex agents run overnight wake up to several branches, failed runs and unrequested changes, and have no quick way to learn what the agent decided. Commit-level provenance tools (Entire, Semantica) exist but must be installed beforehand and focus on tracing, not triage. A zero-install CLI that reads the agent session logs already on disk and the git branches, then prints a per-branch morning triage receipt (intent, decisions, verification evidence, retries, deferred work), is an open gap.

## Evidence of the problem
- A 2026 post on "the morning review queue" describes waking up to six branches, two failed runs, a dependency bump nobody asked for, and a refactor that is "either brilliant or subtly wrong". It argues the job is triage: reconstructing the agent's decisions, not reviewing a colleague's work. It cites a telemetry study of 10,000+ developers: high-AI-adoption teams merged 98% more PRs, review time rose 91%, average PR size grew 154%. https://tianpan.co/blog/2026-07-02-the-morning-review-queue
- It recommends a per-branch "provenance receipt" (intent, decision log, verification evidence, deferred list, anomalies like retries/thrashing) and a single batched queue of open questions. It names no product that delivers this. Same source.
- Vendor guidance converges on the same morning output: "what changed, what passed, what failed, and what needs a human decision". https://www.verdent.ai/guides/overnight-ai-coding-agent-safety-checks
- A solo operator running an agent overnight ends up doing the compliance department's job, and enterprise audit tools assume a security team they lack. https://constellationnetwork.io/blog/openclaw-audit-trail/
- Session history is hard to browse: Claude Code `/resume` is scoped to one project; users file requests for a global history view and build their own JSONL parsers. Sessions live at `~/.claude/projects/<project>/*.jsonl` (one reporter has 72 sessions across 14 projects). https://claudeissues.com/issue/49095-global-session-history-view-across-all-projects

## Competitors & alternatives
| Name | Price | Gap |
|---|---|---|
| Entire CLI (checkpoints) | Open source CLI + hosted web | Hooks must be installed before the run; session log stored on a separate git branch with a commit trailer; oriented to tracing a commit back to a session, not an overnight triage queue. Thoughtworks Radar: "Assess", ecosystem still forming. https://www.thoughtworks.com/radar/tools/entire-cli |
| Semantica (semanticash/cli) | Open source | Git hooks capture checkpoints; `semantica explain HEAD` explains one commit. Needs prior install; no cross-branch morning queue. https://pkg.go.dev/github.com/semanticash/cli@v0.4.0 |
| Claude Code history viewers / conversation-search MCPs | Free | Search/browse transcripts; do not tie sessions to branches or judge outcomes. https://claudeissues.com/issue/49095-global-session-history-view-across-all-projects |
| "Git catchup" style custom commands / commit-summarizer skills | Free | Summarize git log only; blind to what the agent decided, retried or skipped. https://claudecowork.im/resources/git-catchup |
| Verdent (agent platform) | Not stated | Bundled into its own agent product, not usable across Claude Code/Codex. https://www.verdent.ai/guides/overnight-ai-coding-agent-safety-checks |

## Technical notes
- Input 1: `~/.claude/projects/<encoded-cwd>/*.jsonl` session files (per-project folder, one JSONL per session). The record schema is not documented in the sources checked: it must be reverse-engineered from local files and treated as unstable.
- Input 2: `git for-each-ref`, `git log --since`, `git diff --stat` per branch; link a session to a branch by cwd + timestamps + commit times.
- Heuristics for the receipt (no LLM needed for v1): retries (same tool call repeated or repeated failing test command), final test/lint exit status from Bash tool results, files touched outside the stated task, dependency-file changes, "skipped"/"couldn't" phrases in last assistant messages as the deferred list.
- Optional: summarize intent/decisions via `claude -p` on the user's own subscription; off by default.
- Local-only, read-only: no network, no upload. Transcripts can contain secrets, so output must redact common token patterns (Entire's docs note its own redaction is best-effort; same risk applies).

## Risks & open questions
- JSONL format is undocumented and may change between Claude Code versions; Codex/Gemini parsers multiply the surface. Start with Claude Code only.
- Entire/Semantica could add a "morning" view; their checkpoints would be a richer input. dawnlog should be able to read their data later.
- Unverified: how many people run agents unattended often enough to care. Evidence is blog posts and vendor guides, mostly not user threads.
- Heuristic receipts may be wrong; false confidence is worse than none. Receipts must cite the transcript line they derive from.

## Sources
- https://tianpan.co/blog/2026-07-02-the-morning-review-queue
- https://www.verdent.ai/guides/overnight-ai-coding-agent-safety-checks
- https://constellationnetwork.io/blog/openclaw-audit-trail/
- https://claudeissues.com/issue/49095-global-session-history-view-across-all-projects
- https://www.thoughtworks.com/radar/tools/entire-cli
- https://pkg.go.dev/github.com/semanticash/cli@v0.4.0
- https://claudecowork.im/resources/git-catchup
