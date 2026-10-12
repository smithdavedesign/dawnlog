// --summarize: a two-sentence summary per receipt from the user's own `claude -p`.
//
// The only network-reaching code in dawnlog, and it only runs with --summarize. What goes to the
// model is the receipt's facts and the agent's final message, both through clean() first, so
// redacted secrets stay redacted. claude runs with no tools, no session file written (so dawnlog
// never reads its own summaries back as sessions) and in a temp directory, so no CLAUDE.md loads.
// It uses whatever auth `claude` has: a Claude subscription login costs nothing extra; an
// ANTHROPIC_API_KEY in the environment is billed per call.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { clean } from './redact.js';

export const CLAUDE_ARGS = ['-p', '--output-format', 'text', '--no-session-persistence', '--tools', ''];
export const MAX_SUMMARIES = 20;
const TIMEOUT_MS = 120_000;
const MAX_FINAL = 3000;
const MAX_FILES = 30;

const INSTRUCTIONS = `You are helping a developer triage a branch an AI coding agent worked on unattended.
In at most two sentences, say what the agent actually did and the one thing the reviewer should check first.
Use only the facts below; if they are too thin to tell, say so. Plain text, no Markdown, no preamble.`;

/** The prompt for one receipt. Everything in it has been through clean(). */
export function promptFor(receipt) {
  const last = receipt.sessions.at(-1)?.session;
  const test = receipt.lastTest ? `${receipt.lastTest.command} → ${receipt.lastTest.exitCode ?? (receipt.lastTest.ok === false ? 'error' : 'no exit code')}` : 'none';
  const lines = [
    INSTRUCTIONS,
    '',
    `Branch: ${receipt.branch}`,
    `Status: ${receipt.status} (dawnlog suggests ${receipt.suggestion.action}: ${receipt.suggestion.reason})`,
    `Task: ${receipt.task || '(no prompt found)'}`,
    `Last test: ${test}`,
    `Retries: ${receipt.retries}`,
    `Risk: ${receipt.risk.join(', ') || 'none'}`,
    `Commits: ${receipt.commits.map((c) => c.subject).join(' | ') || 'none'}`,
    `Files: ${(receipt.files ?? [])
      .slice(0, MAX_FILES)
      .map((f) => `${f.path} +${f.added} -${f.deleted}`)
      .join(', ') || 'none'}`,
  ];
  if (receipt.deferred.length) lines.push(`Agent left for the reviewer: ${receipt.deferred.map((d) => d.text).join(' | ')}`);
  if (last?.finalText) lines.push('', "Agent's final message:", '"""', last.finalText.slice(-MAX_FINAL), '"""');
  return clean(lines.join('\n'));
}

/** Runs `claude -p` with the prompt on stdin. @returns {{ text: string } | { error: string }} */
export function runClaude(prompt, env = process.env) {
  const bin = env.DAWNLOG_CLAUDE || 'claude';
  const result = spawnSync(bin, CLAUDE_ARGS, { input: prompt, encoding: 'utf8', timeout: TIMEOUT_MS, cwd: os.tmpdir(), env, maxBuffer: 16 * 1024 * 1024 });
  if (result.error?.code === 'ENOENT') return { error: `${bin} not found on PATH (install Claude Code or set DAWNLOG_CLAUDE)` };
  if (result.error?.code === 'ETIMEDOUT') return { error: `${bin} timed out after ${TIMEOUT_MS / 1000}s` };
  if (result.error) return { error: `${bin} failed: ${result.error.message}` };
  if (result.status !== 0) return { error: `${bin} exited ${result.status}: ${String(result.stderr || result.stdout).trim().split('\n')[0]}` };
  const text = String(result.stdout).trim();
  return text ? { text } : { error: `${bin} returned nothing` };
}

/**
 * Adds `summary` to the first MAX_SUMMARIES receipts. Failures become report.summaryFailures
 * (shown as notes) and never fail the run: the receipts are still the receipts.
 */
export function summarize(report, { env = process.env, run = runClaude } = {}) {
  const failures = new Map();
  report.receipts.forEach((receipt, i) => {
    receipt.summary = null;
    if (i >= MAX_SUMMARIES) return;
    const out = run(promptFor(receipt), env);
    if ('text' in out) receipt.summary = out.text;
    else failures.set(out.error, (failures.get(out.error) ?? 0) + 1);
  });
  const skipped = report.receipts.length - MAX_SUMMARIES;
  report.summaryFailures = [...failures].map(([error, n]) => (n > 1 ? `${error} (${n} receipts)` : error));
  if (skipped > 0) report.summaryFailures.push(`only the first ${MAX_SUMMARIES} receipts were summarised (${skipped} more)`);
  return report;
}
