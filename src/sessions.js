// Reads Claude Code session logs: ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl.
//
// The JSONL schema is undocumented, so only these fields are relied on; anything else is ignored
// and unparseable lines are counted (and reported) rather than failing the run:
//   every record  type, timestamp, sessionId, cwd, gitBranch, isMeta, isSidechain
//   assistant     message.content[] { type: 'tool_use', id, name: 'Bash', input.command }
//   user          message.content: string | blocks; { type: 'tool_result', tool_use_id, is_error, content }
//                 toolUseResult { exitCode?, interrupted?, stdout?, stderr? } (or a plain string)
// Subagent transcripts (<session-id>/subagents/*.jsonl) are not read in M1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * @typedef {{ command: string, at: number, test: boolean, masked: boolean,
 *   exitCode: number | null, ok: boolean | null, done: boolean }} Run
 *   ok: true passed, false failed, null unknown (no result yet, or exit code masked by a pipe)
 * @typedef {{ id: string, file: string, cwds: string[], branches: string[], start: number | null,
 *   end: number | null, task: string, runs: Run[], retries: number, records: number,
 *   unreadableLines: number }} Session
 */

export function projectsDir(env = process.env) {
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude');
  return path.join(configDir, 'projects');
}

// A heredoc body (`<<EOF … EOF`) is data, not commands; keep the rest of its opening line.
const HEREDOC = /<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g;
const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/;
const WRAPPER = /^(?:(?:npx|pnpx|bunx|time|nice|env|bundle\s+exec|pnpm\s+exec|yarn\s+exec|uv\s+run|poetry\s+run|python3?\s+-m|timeout\s+\S+)\s+)+/;
const TEST_HEAD =
  /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|check)(?::[\w:-]+)?|(?:go|cargo|deno|mix|dotnet|mvn|make|gradle|(?:\.\/)?gradlew)\s+(?:test|check|lint|vet|clippy)|node\s+--test|(?:\S*\/)?(?:vitest|jest|mocha|pytest|tox|rspec|phpunit|eslint|tsc|ruff|mypy|flake8|golangci-lint|playwright\s+test))(?=\s|$)/;

function commandHead(segment) {
  let head = segment.trim();
  for (let previous = ''; previous !== head; ) {
    previous = head;
    head = head.replace(ENV_PREFIX, '').replace(WRAPPER, '');
  }
  return head;
}

/**
 * Splits a shell command on `&&`, `||`, `|`, `;` and newlines outside quotes and heredocs,
 * so "npm test" inside a commit message is never mistaken for a test run.
 * @returns {{ text: string, before: string | null }[]} each segment with the separator before it
 */
function splitCommand(command) {
  const src = String(command).replace(HEREDOC, '$3');
  const segments = [];
  let text = '';
  let before = null;
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\' && quote !== "'") {
      text += ch + (src[i + 1] ?? '');
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      text += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      text += ch;
      continue;
    }
    const pair = src.slice(i, i + 2);
    const separator = pair === '&&' || pair === '||' ? pair : ch === '|' || ch === ';' || ch === '\n' ? ch : null;
    if (!separator) {
      text += ch;
      continue;
    }
    segments.push({ text, before });
    before = separator;
    text = '';
    i += separator.length - 1;
  }
  segments.push({ text, before });
  return segments;
}

/**
 * Is this Bash command a test/lint run, and is its exit status hidden by what follows it?
 * `npm test | tail` and `npm test; echo` report the last command's status, not the tests'.
 * @returns {{ test: boolean, masked: boolean }}
 */
export function classifyCommand(command) {
  const segments = splitCommand(command);
  let last = -1;
  segments.forEach((segment, i) => {
    if (TEST_HEAD.test(commandHead(segment.text))) last = i;
  });
  if (last < 0) return { test: false, masked: false };
  const pipefail = /\bpipefail\b/.test(command);
  const masked = segments
    .slice(last + 1)
    .some((segment) => segment.text.trim() !== '' && segment.before !== '&&' && !(segment.before === '|' && pipefail));
  return { test: true, masked };
}

// Claude Code prefixes failed Bash output with "Exit code N".
const EXIT_TEXT = /^(?:Error: )?Exit code (-?\d+)/;
// Failure summaries from common runners, for exit codes hidden behind a pipe. Runner markers
// are upper-case, so they're matched case-sensitively ("failed login is rejected ✓" is a pass).
const FAILURE_COUNT = /\b[1-9]\d* (?:failed|failing|failures?)\b|^# fail [1-9]/im;
const FAILURE_MARK = /^\s*(?:FAIL|FAILED)\b|--- FAIL|test result: FAILED/m;

function blockText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
  return '';
}

function settle(run, block, toolUseResult) {
  const structured = toolUseResult && typeof toolUseResult === 'object' ? toolUseResult : {};
  const text = [blockText(block.content), typeof toolUseResult === 'string' ? toolUseResult : '', structured.stdout ?? '', structured.stderr ?? ''].join('\n');
  let code = Number.isInteger(structured.exitCode) ? structured.exitCode : null;
  if (code === null) {
    const match = EXIT_TEXT.exec(blockText(block.content).trimStart());
    if (match) code = Number(match[1]);
  }
  run.exitCode = code;
  run.done = true;
  if (block.is_error === true || structured.interrupted === true || (code !== null && code !== 0)) run.ok = false;
  else if (run.masked) run.ok = FAILURE_COUNT.test(text) || FAILURE_MARK.test(text) ? false : null;
  else run.ok = true;
}

function promptOf(record) {
  if (record.isMeta || record.isSidechain) return null;
  const content = record.message?.content;
  let text = null;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content) && !content.some((b) => b?.type === 'tool_result')) {
    text = content
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  if (!text || !text.trim()) return null;
  const command = /<command-name>([^<]*)<\/command-name>/.exec(text);
  if (command) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(text);
    return `${command[1].trim()} ${args ? args[1].trim() : ''}`.trim();
  }
  if (/^\s*(?:<local-command-|<command-|\[Request interrupted|Caveat: )/.test(text)) return null;
  return text.trim();
}

const normalise = (command) => command.trim().replace(/\s+/g, ' ');

/** A retry is a re-run of a command whose previous run of the same command failed. */
export function countRetries(runs) {
  const lastFailed = new Map();
  let retries = 0;
  for (const run of runs) {
    const key = normalise(run.command);
    if (lastFailed.get(key)) retries++;
    lastFailed.set(key, run.ok === false);
  }
  return retries;
}

/**
 * Status from the last test/lint run (runs must be in time order).
 * @returns {{ status: 'FAILED' | 'UNVERIFIED' | 'PASSED', run: Run | null }}
 */
export function verdict(runs) {
  const run = runs.filter((r) => r.test).at(-1) ?? null;
  if (!run || run.ok === null) return { status: 'UNVERIFIED', run };
  return { status: run.ok ? 'PASSED' : 'FAILED', run };
}

/** @returns {Session} */
export function parseSession(text, file) {
  const session = {
    id: path.basename(file, '.jsonl'),
    file,
    cwds: [],
    branches: [],
    start: null,
    end: null,
    task: '',
    runs: [],
    retries: 0,
    records: 0,
    unreadableLines: 0,
  };
  const cwds = new Set();
  const branches = new Map(); // insertion order = last appearance
  const pending = new Map();
  let sessionId = null;
  let lastAt = null;

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      session.unreadableLines++;
      continue;
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      session.unreadableLines++;
      continue;
    }
    session.records++;
    const at = Date.parse(record.timestamp);
    if (!Number.isNaN(at)) {
      session.start = session.start === null ? at : Math.min(session.start, at);
      session.end = session.end === null ? at : Math.max(session.end, at);
      lastAt = at;
    }
    if (typeof record.sessionId === 'string' && !sessionId) sessionId = record.sessionId;
    if (typeof record.cwd === 'string' && record.cwd) cwds.add(record.cwd);
    if (typeof record.gitBranch === 'string' && record.gitBranch && record.gitBranch !== 'HEAD') {
      branches.delete(record.gitBranch);
      branches.set(record.gitBranch, true);
    }
    const content = record.message?.content;
    if (record.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== 'tool_use' || block.name !== 'Bash' || typeof block.input?.command !== 'string') continue;
        const { test, masked } = classifyCommand(block.input.command);
        const run = { command: block.input.command, at: lastAt ?? 0, test, masked, exitCode: null, ok: null, done: false };
        session.runs.push(run);
        pending.set(block.id, run);
      }
    } else if (record.type === 'user') {
      const results = Array.isArray(content) ? content.filter((b) => b?.type === 'tool_result') : [];
      for (const block of results) {
        const run = pending.get(block.tool_use_id);
        if (!run) continue;
        pending.delete(block.tool_use_id);
        settle(run, block, results.length === 1 ? record.toolUseResult : undefined);
      }
      if (!session.task) session.task = promptOf(record) ?? '';
    }
  }

  if (sessionId) session.id = sessionId;
  session.cwds = [...cwds];
  session.branches = [...branches.keys()];
  session.retries = countRetries(session.runs);
  return session;
}

// Claude Code prunes old sessions on startup, so a file can vanish between listing and reading.
function unlessGone(read) {
  try {
    return read();
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Top-level *.jsonl files in each project folder, modified at or after `since`. */
export function listSessionFiles(dir, since) {
  const files = [];
  for (const project of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(dir, project.name);
    for (const entry of unlessGone(() => fs.readdirSync(projectDir, { withFileTypes: true })) ?? []) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const file = path.join(projectDir, entry.name);
      if ((unlessGone(() => fs.statSync(file).mtimeMs) ?? -Infinity) >= since) files.push(file);
    }
  }
  return files.sort();
}

/**
 * Sessions active at or after `since`. A file's mtime is its last write, so older files
 * are skipped without being read.
 */
export function loadSessions(dir, since) {
  const sessions = [];
  let unreadableLines = 0;
  let emptyFiles = 0;
  for (const file of listSessionFiles(dir, since)) {
    const text = unlessGone(() => fs.readFileSync(file, 'utf8'));
    if (text === null) continue;
    const session = parseSession(text, file);
    unreadableLines += session.unreadableLines;
    if (session.records === 0) {
      emptyFiles++;
      continue;
    }
    if (session.end === null) session.start = session.end = unlessGone(() => fs.statSync(file).mtimeMs) ?? since;
    if (session.end >= since) sessions.push(session);
  }
  return { sessions, unreadableLines, emptyFiles };
}
