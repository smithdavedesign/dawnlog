// Terminal and Markdown receipts. Every transcript- or git-derived field goes through field():
// sanitize + redact first, then collapse to one line, then truncate, so a cut can't split a secret.
import { clean } from './redact.js';

const MAX_TASK = 160;
const MAX_COMMAND = 120;
const MAX_SUBJECT = 100;
const MAX_SUBJECTS = 5;

function field(text, max = Infinity) {
  const line = clean(String(text ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shortId = (id) => field(id).slice(0, 8);
const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
// Markdown: no raw HTML, images or inline links from transcripts, and code spans can't be closed early.
const md = (text, max) =>
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
  return lines;
}

const nothing = (report) => `Nothing to triage: no branches changed and no Claude Code sessions in this repo since ${utc(report.since)}.`;

/** @param {{ window: string }} options the --since value as typed, for the header */
export function renderText(report, { window }) {
  const out = [`dawnlog · ${field(report.repo)} · since ${utc(report.since)} (${field(window)}) · base ${field(report.base)}`, summary(report), ''];
  if (!report.receipts.length && !report.unmatched.length) out.push(nothing(report), '');

  report.receipts.forEach((r, i) => {
    out.push(`[${i + 1}] ${field(r.branch)} — ${r.status}`);
    if (r.sessions.length) out.push(`    task: ${field(r.task, MAX_TASK) || '(no prompt found)'}`);
    else out.push('    session: none found in the window');
    for (const { session, via } of r.sessions) out.push(`    session: ${shortId(session.id)} via ${via} — ${field(session.file)}`);
    out.push(`    tests: ${testsLine(r, field)}`);
    out.push(`    commits: ${commitsLine(r)}`);
    const { shown, more } = subjects(r);
    for (const subject of shown) out.push(`      - ${field(subject, MAX_SUBJECT)}`);
    if (more) out.push(`      - … ${more} more`);
    out.push(`    retries: ${r.retries}`);
    out.push(`    risk: ${r.risk.length ? r.risk.join(', ') : 'none'}`);
    out.push('');
  });

  if (report.unmatched.length) {
    out.push(`Unmatched sessions (${report.unmatched.length})`);
    for (const { session, reason } of report.unmatched) {
      out.push(`    - ${shortId(session.id)}: ${field(reason)} — ${field(session.file)}`);
      out.push(`      task: ${field(session.task, MAX_TASK) || '(no prompt found)'}`);
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
    `# dawnlog — ${md(name)}`,
    '',
    `${code(report.repo)} · since ${utc(report.since)} (${md(window)}) · base ${code(report.base)}  `,
    summary(report),
    '',
  ];
  if (!report.receipts.length && !report.unmatched.length) out.push(nothing(report), '');

  report.receipts.forEach((r, i) => {
    out.push(`## ${i + 1}. ${code(r.branch)} — ${r.status}`, '');
    if (r.sessions.length) out.push(`- task: ${md(r.task, MAX_TASK) || '(no prompt found)'}`);
    else out.push('- session: none found in the window');
    for (const { session, via } of r.sessions) out.push(`- session: ${code(shortId(session.id))} via ${via} — ${code(session.file)}`);
    out.push(`- tests: ${testsLine(r, code)}`);
    out.push(`- commits: ${commitsLine(r)}`);
    const { shown, more } = subjects(r);
    for (const subject of shown) out.push(`  - ${md(subject, MAX_SUBJECT)}`);
    if (more) out.push(`  - … ${more} more`);
    out.push(`- retries: ${r.retries}`);
    out.push(`- risk: ${r.risk.length ? r.risk.join(', ') : 'none'}`);
    out.push('');
  });

  if (report.unmatched.length) {
    out.push(`## Unmatched sessions (${report.unmatched.length})`, '');
    for (const { session, reason } of report.unmatched) {
      out.push(`- ${code(shortId(session.id))}: ${md(reason)} — ${code(session.file)}`);
      out.push(`  - task: ${md(session.task, MAX_TASK) || '(no prompt found)'}`);
    }
    out.push('');
  }

  for (const note of notes(report)) out.push(`> note: ${md(note)}`, '');
  return `${out.join('\n').trimEnd()}\n`;
}
