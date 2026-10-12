// `dawnlog digest`: one short file across one or more repos, for cron and push delivery
// (WhatsApp, Slack, email: whatever sends the file). One line per branch, worst first.
import fs from 'node:fs';
import path from 'node:path';
import { clean } from './redact.js';
import { md } from './render.js';

const MAX_REASON = 120;
const MAX_BRANCHES = 15;
const plural = (n, word) => `${n} ${n === 1 ? word : `${word.replace(/(?:(ch|sh|s|x)|([^aeiou])y)$/, (m, sib, c) => (sib ? `${m}e` : `${c}ie`))}s`}`;
const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const one = (text, max = Infinity) => {
  const line = clean(String(text ?? '')).replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

function tally(receipts) {
  const counts = new Map();
  for (const r of receipts) counts.set(r.suggestion.action, (counts.get(r.suggestion.action) ?? 0) + 1);
  return ['kill', 'fix', 'merge']
    .filter((a) => counts.has(a))
    .map((a) => `${counts.get(a)} ${a}`)
    .join(', ');
}

function details(r) {
  const bits = [];
  if (r.retries) bits.push(`retries ${r.retries}`);
  if (r.risk.length) bits.push(`risk ${r.risk.join('+')}`);
  if (r.deferred.length) bits.push(`${r.deferred.length} for you`);
  return bits.length ? ` · ${bits.join(' · ')}` : '';
}

/**
 * @param {{ repo: string, report?: object, error?: string }[]} results one per --repo, in order
 * @param {{ since: number, window: string, format: 'text' | 'md', note?: string | null }} options
 */
export function renderDigest(results, { since, window, format, note = null }) {
  const mdx = format === 'md';
  const out = [mdx ? `# dawnlog digest · since ${utc(since)} (${one(window)})` : `dawnlog digest · since ${utc(since)} (${one(window)})`, ''];
  if (note) out.push(mdx ? `> note: ${md(note)}` : `note: ${one(note)}`, '');
  let branches = 0;
  for (const { repo, report, error } of results) {
    const name = one(path.basename(repo) || repo);
    if (error) {
      out.push(mdx ? `## ${md(name)}` : `${name}: error`, ...(mdx ? ['', `error: ${md(error)}`] : [`  ${one(error)}`]), '');
      continue;
    }
    const receipts = report.receipts;
    branches += receipts.length;
    const unmatched = report.unmatched.length ? ` · ${plural(report.unmatched.length, 'unmatched session')}` : '';
    const head = receipts.length ? `${plural(receipts.length, 'branch')}: ${tally(receipts)}${unmatched}` : `nothing to triage${unmatched}`;
    out.push(mdx ? `## ${md(name)}` : `${name}: ${head}`);
    if (mdx) out.push('', head);
    for (const r of receipts.slice(0, MAX_BRANCHES)) {
      const line = `${r.suggestion.action.padEnd(5)} ${one(r.branch)} (${r.status}) — ${one(r.summary || r.suggestion.reason, MAX_REASON)}${details(r)}`;
      out.push(mdx ? `- **${r.suggestion.action}** \`${one(r.branch).replace(/`/g, "'")}\` (${r.status}) — ${md(r.summary || r.suggestion.reason, MAX_REASON)}${details(r)}` : `  ${line}`);
    }
    if (receipts.length > MAX_BRANCHES) out.push(mdx ? `- … ${receipts.length - MAX_BRANCHES} more` : `  … ${receipts.length - MAX_BRANCHES} more`);
    out.push('');
  }
  if (!results.length) out.push('No repos given.', '');
  return { text: clean(`${out.join('\n').trimEnd()}\n`), branches };
}

/** Writes via a temp file + rename, so a reader (or the next cron run) never sees half a digest. */
export function writeAtomic(file, text) {
  const dir = path.dirname(path.resolve(file));
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
