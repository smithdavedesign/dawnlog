// Terminal, Markdown and JSON receipts. Every transcript- or git-derived field goes through field():
// sanitize + redact first, then collapse to one line, then truncate, so a cut can't split a secret.
// Transcript-derived lines end with the line they came from ("· L12", or "· aaaa1111 L12" when a
// branch has several sessions); --json carries the full file:line in each receipt's `sources`.
import { clean } from './redact.js';

const MAX_TASK = 160;
const MAX_COMMAND = 120;
const MAX_SUBJECT = 100;
const MAX_SUMMARY = 400;
const MAX_SUBJECTS = 5;
const MAX_OUTSIDE = 5;

function field(text, max = Infinity) {
  const line = clean(String(text ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const plural = (n, word) => `${n} ${n === 1 ? word : `${word.replace(/(?:(ch|sh|s|x)|([^aeiou])y)$/, (m, sib, c) => (sib ? `${m}e` : `${c}ie`))}s`}`;
const shortId = (id) => field(id).slice(0, 8);
const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
// Markdown: no raw HTML, images or inline links from transcripts, and code spans can't be closed early.
export const md = (text, max) =>
  field(text, max)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/!\[/g, '!\\[')
    .replace(/\]\(/g, ']\\(');
const code = (text, max) => `\`${field(text, max).replace(/`/g, "'")}\``;

function outcome(run) {
  if (!run.done) return 'no result recorded';
  const status = run.exitCode !== null ? `exit ${run.exitCode}` : run.ok === false ? 'error' : 'ok';
  if (!run.masked) return status;
  return `${status}, real exit status hidden by a pipe; ${run.ok === false ? 'output shows failures' : 'not verified'}`;
}

/** "path/to/file.jsonl:12" → { file, line } (paths may contain ':') */
export function splitSource(source) {
  const match = /^(.*):(\d+)$/.exec(source ?? '');
  return match ? { file: match[1], line: Number(match[2]) } : null;
}

/** " · L12" for a transcript source, naming the session when the receipt has several. */
function cite(source, sessions = []) {
  const ref = splitSource(source);
  if (!ref || String(source).startsWith('git:')) return '';
  const owner = sessions.find((s) => s.session.file === ref.file);
  return sessions.length > 1 && owner ? ` · ${shortId(owner.session.id)} L${ref.line}` : ` · L${ref.line}`;
}

function outsideLine(receipt, fmt) {
  const shown = receipt.outside.slice(0, MAX_OUTSIDE).map((p) => fmt(p)).join(', ');
  const more = receipt.outside.length > MAX_OUTSIDE ? `, … ${receipt.outside.length - MAX_OUTSIDE} more` : '';
  return `${plural(receipt.outside.length, 'file')} outside ${receipt.area.map((a) => fmt(a)).join(', ')}: ${shown}${more}`;
}

function testsLine(receipt, fmt) {
  if (!receipt.sessions.length) return 'unknown (no session)';
  if (!receipt.lastTest) return 'none run';
  return `${fmt(receipt.lastTest.command, MAX_COMMAND)} → ${outcome(receipt.lastTest)}`;
}

function commitsLine(receipt) {
  const commits = plural(receipt.commits.length, 'commit');
  if (!receipt.files) return `${commits}, diff unavailable (no merge base)`;
  return `${commits}, ${plural(receipt.files.length, 'file')} +${receipt.added} -${receipt.deleted}`;
}

function subjects(receipt) {
  const shown = receipt.commits.slice(0, MAX_SUBJECTS).map((c) => c.subject);
  const more = receipt.commits.length - shown.length;
  return { shown, more };
}

function summary(report) {
  return `${plural(report.receipts.length, 'receipt')} · ${plural(report.sessionCount, 'session')} · ${report.unmatched.length} unmatched`;
}

function notes(report) {
  const lines = [];
  if (report.otherProjectSessions) {
    lines.push(`${plural(report.otherProjectSessions, 'session')} from other projects in this window not listed (use --repo for another repo)`);
  }
  if (report.unreadableLines) {
    lines.push(`${plural(report.unreadableLines, 'unreadable JSONL line')} skipped: a session still being written, or a Claude Code log format change`);
  }
  if (report.emptyFiles) lines.push(`${plural(report.emptyFiles, 'session file')} had no readable records`);
  if (report.mergedBranches) lines.push(`${plural(report.mergedBranches, 'branch')} changed in the window already merged into base (nothing ahead, or squash-merged) not listed`);
  if (report.entire?.ref) {
    const remote = report.entire.remoteSessions ? `, ${plural(report.entire.remoteSessions, 'session')} not on this machine read from it` : '';
    lines.push(`Entire checkpoints read from ${report.entire.ref} (${plural(report.entire.sessions, 'checkpoint session')}${remote})`);
    if (report.entire.unreadable) lines.push(`${plural(report.entire.unreadable, 'Entire checkpoint metadata file')} unreadable`);
  } else if (report.entire?.refBackend) {
    lines.push("Entire's ref-based checkpoints (refs/entire/checkpoints/) found but not read yet; sessions are matched from local logs only");
  }
  for (const failure of report.summaryFailures ?? []) lines.push(`--summarize: ${failure}`);
  return lines;
}

const nothing = (report) => `Nothing to triage: no branches changed and no Claude Code sessions in this repo since ${utc(report.since)}.`;

/** @param {{ window: string }} options the --since value as typed, for the header */
export function renderText(report, { window }) {
  const out = [`overnight-receipts · ${field(report.repo)} · since ${utc(report.since)} (${field(window)}) · base ${field(report.base)}`, summary(report), ''];
  if (!report.receipts.length && !report.unmatched.length) out.push(nothing(report), '');

  report.receipts.forEach((r, i) => {
    out.push(`[${i + 1}] ${field(r.branch)} — ${r.status}`);
    out.push(`    suggest: ${r.suggestion.action} — ${field(r.suggestion.reason)}`);
    if (r.summary) out.push(`    summary: ${field(r.summary, MAX_SUMMARY)}`);
    if (r.sessions.length) out.push(`    task: ${field(r.task, MAX_TASK) || '(no prompt found)'}${cite(r.sources.task, r.sessions)}`);
    else out.push('    session: none found in the window');
    for (const { session, via } of r.sessions) out.push(`    session: ${shortId(session.id)} via ${via} — ${field(session.file)}`);
    out.push(`    tests: ${testsLine(r, field)}${cite(r.sources.tests, r.sessions)}`);
    out.push(`    commits: ${commitsLine(r)}`);
    const { shown, more } = subjects(r);
    for (const subject of shown) out.push(`      - ${field(subject, MAX_SUBJECT)}`);
    if (more) out.push(`      - … ${more} more`);
    out.push(`    retries: ${r.retries}${cite(r.sources.retries, r.sessions)}`);
    out.push(`    risk: ${r.risk.length ? r.risk.join(', ') : 'none'}`);
    if (r.outside.length) out.push(`    scope: ${outsideLine(r, field)}`);
    if (r.deferred.length) {
      out.push(`    needs you (${r.deferred.length}):`);
      for (const item of r.deferred) out.push(`      - ${item.kind === 'question' ? 'asked: ' : ''}${field(item.text, MAX_TASK)}${cite(item.source, r.sessions)}`);
    }
    out.push('');
  });

  if (report.unmatched.length) {
    out.push(`Unmatched sessions (${report.unmatched.length})`);
    for (const { session, reason } of report.unmatched) {
      out.push(`    - ${shortId(session.id)}: ${field(reason)} — ${field(session.file)}`);
      out.push(`      task: ${field(session.task, MAX_TASK) || '(no prompt found)'}${cite(`${session.file}:${session.taskLine}`)}`);
    }
    out.push('');
  }

  for (const note of notes(report)) out.push(`note: ${note}`);
  return `${out.join('\n').trimEnd()}\n`;
}

/** @param {{ window: string }} options */
export function renderMarkdown(report, { window }) {
  const name = report.repo.split(/[\\/]/).filter(Boolean).at(-1) ?? report.repo;
  const out = [
    `# overnight-receipts — ${md(name)}`,
    '',
    `${code(report.repo)} · since ${utc(report.since)} (${md(window)}) · base ${code(report.base)}  `,
    summary(report),
    '',
  ];
  if (!report.receipts.length && !report.unmatched.length) out.push(nothing(report), '');

  report.receipts.forEach((r, i) => {
    out.push(`## ${i + 1}. ${code(r.branch)} — ${r.status}`, '');
    out.push(`- **suggest: ${r.suggestion.action}** — ${md(r.suggestion.reason)}`);
    if (r.summary) out.push(`- summary: ${md(r.summary, MAX_SUMMARY)}`);
    if (r.sessions.length) out.push(`- task: ${md(r.task, MAX_TASK) || '(no prompt found)'}${cite(r.sources.task, r.sessions)}`);
    else out.push('- session: none found in the window');
    for (const { session, via } of r.sessions) out.push(`- session: ${code(shortId(session.id))} via ${via} — ${code(session.file)}`);
    out.push(`- tests: ${testsLine(r, code)}${cite(r.sources.tests, r.sessions)}`);
    out.push(`- commits: ${commitsLine(r)}`);
    const { shown, more } = subjects(r);
    for (const subject of shown) out.push(`  - ${md(subject, MAX_SUBJECT)}`);
    if (more) out.push(`  - … ${more} more`);
    out.push(`- retries: ${r.retries}${cite(r.sources.retries, r.sessions)}`);
    out.push(`- risk: ${r.risk.length ? r.risk.join(', ') : 'none'}`);
    if (r.outside.length) out.push(`- scope: ${outsideLine(r, code)}`);
    if (r.deferred.length) {
      out.push(`- needs you (${r.deferred.length}):`);
      for (const item of r.deferred) out.push(`  - ${item.kind === 'question' ? 'asked: ' : ''}${md(item.text, MAX_TASK)}${cite(item.source, r.sessions)}`);
    }
    out.push('');
  });

  if (report.unmatched.length) {
    out.push(`## Unmatched sessions (${report.unmatched.length})`, '');
    for (const { session, reason } of report.unmatched) {
      out.push(`- ${code(shortId(session.id))}: ${md(reason)} — ${code(session.file)}`);
      out.push(`  - task: ${md(session.task, MAX_TASK) || '(no prompt found)'}${cite(`${session.file}:${session.taskLine}`)}`);
    }
    out.push('');
  }

  for (const note of notes(report)) out.push(`> note: ${md(note)}`, '');
  return `${out.join('\n').trimEnd()}\n`;
}

const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

/** Recursively cleans every string, so JSON consumers never see a secret or an escape code. */
function deepClean(value) {
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map(deepClean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepClean(v)]));
  return value;
}

export const JSON_VERSION = 1;

/**
 * The report as plain data, matching schema/receipts.schema.json.
 * @param {{ window: string }} options
 */
export function toJson(report, { window }) {
  const run = (r) =>
    r && { command: r.command, exitCode: r.exitCode, ok: r.ok, masked: r.masked, done: r.done, source: `${r.file}:${r.line}` };
  return deepClean({
    "overnight-receipts": JSON_VERSION,
    repo: report.repo,
    base: report.base,
    since: iso(report.since),
    window,
    counts: {
      receipts: report.receipts.length,
      sessions: report.sessionCount,
      unmatched: report.unmatched.length,
      otherProjectSessions: report.otherProjectSessions,
      unreadableLines: report.unreadableLines,
      emptyFiles: report.emptyFiles,
      mergedBranches: report.mergedBranches ?? 0,
    },
    receipts: report.receipts.map((r, i) => ({
      rank: i + 1,
      branch: r.branch,
      status: r.status,
      suggestion: { action: r.suggestion.action, reason: r.suggestion.reason },
      summary: r.summary ?? null,
      task: r.task,
      sessions: r.sessions.map(({ session, via, source }) => ({ id: session.id, file: session.file, via, source })),
      tests: run(r.lastTest),
      commits: r.commits.map((c) => ({ sha: c.sha, at: iso(c.at), subject: c.subject, checkpoints: c.checkpoints ?? [] })),
      files: r.files,
      added: r.added,
      deleted: r.deleted,
      retries: r.retries,
      risk: r.risk,
      area: r.area,
      outside: r.outside,
      deferred: r.deferred,
      sources: r.sources,
    })),
    unmatched: report.unmatched.map(({ session, reason }) => ({
      id: session.id,
      file: session.file,
      reason,
      task: session.task,
      source: session.taskLine ? `${session.file}:${session.taskLine}` : null,
    })),
    entire: report.entire ?? null,
    notes: notes(report),
  });
}

/** @param {{ window: string }} options */
export function renderJson(report, options) {
  return `${JSON.stringify(toJson(report, options), null, 2)}\n`;
}
