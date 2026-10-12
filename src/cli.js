// Command-line entry: flags, the --since window, exit codes, the optional Markdown file, --json,
// --summarize and the `digest` subcommand. main() returns what to print instead of printing, and
// everything it returns or writes has already been through clean() (redaction + control-character
// stripping). Without --summarize the only subprocess is git and nothing touches the network.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { renderDigest, writeAtomic } from './digest.js';
import * as entire from './entire.js';
import * as git from './git.js';
import { clean } from './redact.js';
import { renderJson, renderMarkdown, renderText } from './render.js';
import { buildReport } from './report.js';
import { projectsDir } from './sessions.js';
import { summarize } from './summarize.js';

export const USAGE = `Usage: dawnlog [--since 12h] [--repo PATH] [--base BRANCH] [--out FILE.md] [--json] [--summarize]
       dawnlog digest --out FILE [--since 12h] [--repo PATH]... [--format text|md] [--summarize] [--quiet]

Morning triage receipts for Claude Code runs: one receipt per git branch changed in the
window, built from the session logs in ~/.claude/projects (and Entire checkpoints, when the
repo has them), ranked worst first with a merge / fix / kill suggestion. Read-only and offline.

  --since      window to look back: 30m, 12h, 2d, 1w or a date like 2026-10-10 (default 12h)
  --repo       git repository to triage (default: current directory); digest takes several
  --base       branch the others are compared with (default: origin's HEAD, main or master)
  --out        also write the receipts as Markdown to this file (digest: the digest file)
  --json       print the receipts as JSON (schema/receipts.schema.json) instead of text
  --summarize  add a two-sentence summary per receipt from your own \`claude -p\`
               (the only option that runs anything but git or reaches the network)
  --format     digest only: text (default) or md
  --quiet      digest only: print nothing on success (for cron)
  -h, --help`;

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** Start of the window in ms, or null if `value` isn't a duration or a date. */
export function parseSince(value, now) {
  const duration = /^(\d+)\s*([mhdw])$/.exec(value.trim());
  if (duration) return now - Number(duration[1]) * UNIT_MS[duration[2]];
  if (!/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return null;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : date;
}

const result = (code, stdout = '', stderr = '') => ({ code, stdout: clean(stdout), stderr: clean(stderr) });

const noSessions = (projects) =>
  `dawnlog: no Claude Code sessions found: ${projects} does not exist.\n` +
  'Nothing to triage. Run Claude Code in a repo first, or set CLAUDE_CONFIG_DIR if your Claude config lives elsewhere.\n';

/** Entire checkpoints are a session source of their own, so a repo with them needs no ~/.claude. */
function hasEntire(repo) {
  const root = git.repoRoot(repo);
  return Boolean(root && git.resolveRef(root, [`refs/heads/${entire.METADATA_BRANCH}`, `refs/remotes/origin/${entire.METADATA_BRANCH}`]));
}

/**
 * @param {string[]} argv arguments after the program name
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
export function main(argv, env = process.env, now = Date.now()) {
  if (argv[0] === 'digest') return digest(argv.slice(1), env, now);
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        since: { type: 'string', default: '12h' },
        repo: { type: 'string' },
        base: { type: 'string' },
        out: { type: 'string' },
        json: { type: 'boolean' },
        summarize: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }).values;
  } catch (err) {
    return result(2, '', `dawnlog: ${err.message}\n\n${USAGE}\n`);
  }
  if (args.help) return result(0, `${USAGE}\n`);

  const since = parseSince(args.since, now);
  if (since === null) return result(2, '', `dawnlog: --since must look like 30m, 12h, 2d, 1w or 2026-10-10 (got "${args.since}")\n`);

  const repo = path.resolve(args.repo ?? process.cwd());
  let projects = projectsDir(env);
  if (!fs.existsSync(projects)) {
    if (!hasEntire(repo)) return result(0, noSessions(projects));
    projects = null;
  }

  let report;
  try {
    report = buildReport({ repo, projects, since, base: args.base });
  } catch (err) {
    return result(1, '', `dawnlog: ${err.message}\n`);
  }
  if (args.summarize) summarize(report, { env });

  const window = { window: args.since };
  let stdout = args.json ? renderJson(report, window) : renderText(report, window);
  let stderr = '';
  if (args.out) {
    try {
      fs.writeFileSync(args.out, clean(renderMarkdown(report, window)));
    } catch (err) {
      return result(1, stdout, `dawnlog: could not write ${args.out}: ${err.message}\n`);
    }
    // Keep --json output pure JSON: the "wrote" line goes to stderr there.
    if (args.json) stderr += `wrote ${args.out}\n`;
    else stdout += `\nwrote ${args.out}\n`;
  }
  return result(0, stdout, stderr);
}

/** `dawnlog digest`: cron-friendly, writes one file across repos, exit 1 if any repo failed. */
function digest(argv, env, now) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        since: { type: 'string', default: '12h' },
        repo: { type: 'string', multiple: true },
        base: { type: 'string' },
        out: { type: 'string' },
        format: { type: 'string', default: 'text' },
        summarize: { type: 'boolean' },
        quiet: { type: 'boolean', short: 'q' },
        help: { type: 'boolean', short: 'h' },
      },
    }).values;
  } catch (err) {
    return result(2, '', `dawnlog digest: ${err.message}\n\n${USAGE}\n`);
  }
  if (args.help) return result(0, `${USAGE}\n`);
  if (!args.out) return result(2, '', 'dawnlog digest: --out FILE is required (the digest is written there for delivery)\n');
  if (!['text', 'md'].includes(args.format)) return result(2, '', `dawnlog digest: --format must be text or md (got "${args.format}")\n`);
  const since = parseSince(args.since, now);
  if (since === null) return result(2, '', `dawnlog digest: --since must look like 30m, 12h, 2d, 1w or 2026-10-10 (got "${args.since}")\n`);

  const repos = (args.repo?.length ? args.repo : [process.cwd()]).map((r) => path.resolve(r));
  const projects = projectsDir(env);
  const haveProjects = fs.existsSync(projects);
  const results = repos.map((repo) => {
    try {
      const report = buildReport({ repo, projects: haveProjects ? projects : null, since, base: args.base });
      if (args.summarize) summarize(report, { env });
      return { repo, report };
    } catch (err) {
      return { repo, error: err.message };
    }
  });

  const note = haveProjects ? null : `no Claude Code sessions found (${projects} does not exist): branches only`;
  const { text, branches } = renderDigest(results, { since, window: args.since, format: args.format, note });
  try {
    writeAtomic(args.out, text);
  } catch (err) {
    return result(1, '', `dawnlog digest: could not write ${args.out}: ${err.message}\n`);
  }
  const failed = results.filter((r) => r.error);
  const stderr = failed.map((r) => `dawnlog digest: ${r.repo}: ${r.error}\n`).join('');
  const stdout = args.quiet ? '' : `wrote ${args.out} (${branches} branch${branches === 1 ? '' : 'es'} across ${repos.length} repo${repos.length === 1 ? '' : 's'})\n`;
  return result(failed.length ? 1 : 0, stdout, stderr);
}
