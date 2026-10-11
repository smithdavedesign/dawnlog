// Command-line entry: flags, the --since window, exit codes and the optional Markdown file.
// main() returns what to print instead of printing, and everything it returns or writes has
// already been through clean() (redaction + control-character stripping).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { clean } from './redact.js';
import { renderMarkdown, renderText } from './render.js';
import { buildReport } from './report.js';
import { projectsDir } from './sessions.js';

export const USAGE = `Usage: dawnlog [--since 12h] [--repo PATH] [--base BRANCH] [--out FILE.md]

Morning triage receipts for Claude Code runs: one receipt per git branch changed in the
window, built from the session logs in ~/.claude/projects. Read-only and offline.

  --since   window to look back: 30m, 12h, 2d, 1w or a date like 2026-10-10 (default 12h)
  --repo    git repository to triage (default: current directory)
  --base    branch the others are compared with (default: origin's HEAD, main or master)
  --out     also write the receipts as Markdown to this file
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

/**
 * @param {string[]} argv arguments after the program name
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
export function main(argv, env = process.env, now = Date.now()) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        since: { type: 'string', default: '12h' },
        repo: { type: 'string' },
        base: { type: 'string' },
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }).values;
  } catch (err) {
    return result(2, '', `dawnlog: ${err.message}\n\n${USAGE}\n`);
  }
  if (args.help) return result(0, `${USAGE}\n`);

  const since = parseSince(args.since, now);
  if (since === null) return result(2, '', `dawnlog: --since must look like 30m, 12h, 2d, 1w or 2026-10-10 (got "${args.since}")\n`);

  const projects = projectsDir(env);
  if (!fs.existsSync(projects)) {
    return result(
      0,
      `dawnlog: no Claude Code sessions found: ${projects} does not exist.\n` +
        'Nothing to triage. Run Claude Code in a repo first, or set CLAUDE_CONFIG_DIR if your Claude config lives elsewhere.\n',
    );
  }

  let report;
  try {
    report = buildReport({ repo: path.resolve(args.repo ?? process.cwd()), projects, since, base: args.base });
  } catch (err) {
    return result(1, '', `dawnlog: ${err.message}\n`);
  }

  let stdout = renderText(report, { window: args.since });
  if (args.out) {
    try {
      fs.writeFileSync(args.out, clean(renderMarkdown(report, { window: args.since })));
    } catch (err) {
      return result(1, stdout, `dawnlog: could not write ${args.out}: ${err.message}\n`);
    }
    stdout += `\nwrote ${args.out}\n`;
  }
  return result(0, stdout);
}
