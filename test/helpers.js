// Fixture builders shared by the tests: throwaway git repos with dated commits,
// Claude Code-shaped session logs, and a runner for the real CLI binary.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const BIN = fileURLToPath(new URL('../bin/dawnlog.js', import.meta.url));

const created = [];

export function tmpDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dawnlog-${label}-`));
  created.push(dir);
  return dir;
}

export function cleanup() {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

// Hermetic git: ignore the developer's global/system config (signing, hooks, default branch).
export const GIT_ENV = {
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
};

export function git(cwd, args, at) {
  const env = { ...process.env, ...GIT_ENV };
  if (at !== undefined) {
    const date = `${Math.floor(at / 1000)} +0000`;
    env.GIT_AUTHOR_DATE = date;
    env.GIT_COMMITTER_DATE = date;
  }
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Creates a repo whose base branch has one old commit, then one branch per entry.
 * @param {{ base?: string, baseAt?: number,
 *   branches?: { name: string, commits?: { at: number, files: Record<string, string>, message?: string }[] }[] }} spec
 */
export function makeRepo({ base = 'main', baseAt = Date.now() - 72 * HOUR, branches = [] } = {}) {
  const dir = tmpDir('repo');
  git(dir, ['init', '-q', '-b', base]);
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'Initial commit'], baseAt);
  for (const branch of branches) {
    git(dir, ['checkout', '-q', '-b', branch.name, base]);
    for (const commit of branch.commits ?? []) {
      for (const [file, content] of Object.entries(commit.files)) {
        const full = path.join(dir, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
      }
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', commit.message ?? 'Agent commit'], commit.at);
    }
  }
  git(dir, ['checkout', '-q', base]);
  return dir;
}

export function addWorktree(repo, branch) {
  const dir = path.join(tmpDir('wt'), 'checkout');
  git(repo, ['worktree', 'add', '-q', dir, branch]);
  return dir;
}

/**
 * Claude Code-style session log text (records one minute apart): see writeSession for the spec.
 * `edits` adds Edit tool calls; a bash entry with `denied: true` gets the permission-refused result.
 */
export function sessionJsonl(spec) {
  return sessionRecords(spec).map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/**
 * Writes a Claude Code-style session log (records one minute apart) and returns its path.
 * Bash results carry both shapes seen in real logs: tool_result.is_error with an
 * "Exit code N" prefix, and toolUseResult.exitCode.
 * @param {string} projectsDir
 * @param {{ id: string, cwd: string, gitBranch?: string | string[], start: number, prompt: string,
 *   bash?: { command: string, exit: number, output?: string }[], final?: string, mtime?: number }} spec
 */
export function writeSession(projectsDir, spec) {
  const dir = path.join(projectsDir, spec.cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${spec.id}.jsonl`);
  fs.writeFileSync(file, sessionJsonl(spec));
  if (spec.mtime !== undefined) fs.utimesSync(file, spec.mtime / 1000, spec.mtime / 1000);
  return file;
}

function sessionRecords(spec) {
  const records = [];
  let t = spec.start;
  const branchAt = (i) => (Array.isArray(spec.gitBranch) ? spec.gitBranch[Math.min(i, spec.gitBranch.length - 1)] : spec.gitBranch);
  const common = () => {
    const record = {
      parentUuid: null,
      isSidechain: false,
      userType: 'external',
      cwd: spec.cwd,
      sessionId: spec.id,
      version: '2.0.0',
      timestamp: new Date(t).toISOString(),
    };
    const branch = branchAt(records.length);
    if (branch !== undefined) record.gitBranch = branch;
    t += MIN;
    return record;
  };
  records.push({ type: 'user', ...common(), message: { role: 'user', content: spec.prompt } });
  (spec.edits ?? []).forEach((filePath, i) => {
    records.push({
      type: 'assistant',
      ...common(),
      message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_edit_${i}`, name: 'Edit', input: { file_path: filePath, old_string: 'a', new_string: 'b' } }] },
    });
  });
  (spec.bash ?? []).forEach((run, i) => {
    const id = `toolu_${spec.id.slice(0, 4)}_${i}`;
    records.push({
      type: 'assistant',
      ...common(),
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running it.' },
          { type: 'tool_use', id, name: 'Bash', input: { command: run.command, description: 'run' } },
        ],
      },
    });
    if (run.denied) {
      records.push({
        type: 'user',
        ...common(),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: "The user doesn't want to proceed with this tool use." }] },
        toolUseResult: 'Error: The user doesn\'t want to proceed with this tool use.',
      });
      return;
    }
    const failed = run.exit !== 0;
    const output = run.output ?? (failed ? 'Tests: 1 failed, 4 passed' : 'Tests: 5 passed');
    records.push({
      type: 'user',
      ...common(),
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, is_error: failed, content: failed ? `Exit code ${run.exit}\n${output}` : output }],
      },
      toolUseResult: { stdout: output, stderr: '', exitCode: run.exit, interrupted: false },
    });
  });
  records.push({ type: 'assistant', ...common(), message: { role: 'assistant', content: [{ type: 'text', text: spec.final ?? 'Done.' }] } });
  return records;
}

/**
 * Adds Entire's metadata branch (entire/checkpoints/v1) to `repo`, one folder per checkpoint.
 * @param {{ id: string, sessions: { session_id: string, branch?: string, created_at?: string, agent?: string,
 *   transcript?: string, raw?: string }[] }[]} checkpoints  raw: metadata.json text, to test bad JSON
 */
export function addEntireCheckpoints(repo, checkpoints, at = Date.now()) {
  git(repo, ['checkout', '-q', '--orphan', 'entire/checkpoints/v1']);
  git(repo, ['rm', '-rfq', '--cached', '.']);
  for (const entry of fs.readdirSync(repo)) if (entry !== '.git') fs.rmSync(path.join(repo, entry), { recursive: true, force: true });
  for (const cp of checkpoints) {
    const dir = path.join(repo, cp.id.slice(0, 2), cp.id.slice(2));
    fs.mkdirSync(dir, { recursive: true });
    const refs = cp.sessions.map((_, i) => ({ metadata: `/${cp.id.slice(0, 2)}/${cp.id.slice(2)}/${i}/metadata.json`, transcript: `/${cp.id.slice(0, 2)}/${cp.id.slice(2)}/${i}/full.jsonl` }));
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ checkpoint_id: cp.id, strategy: 'manual-commit', sessions: refs }));
    cp.sessions.forEach((s, i) => {
      const sessionDir = path.join(dir, String(i));
      fs.mkdirSync(sessionDir, { recursive: true });
      const { transcript, raw, ...meta } = s;
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), raw ?? JSON.stringify({ cli_version: '0.10.1', checkpoint_id: cp.id, agent: 'Claude Code', ...meta }));
      if (transcript !== undefined) fs.writeFileSync(path.join(sessionDir, 'full.jsonl'), transcript);
      fs.writeFileSync(path.join(sessionDir, 'prompt.txt'), 'prompt\n');
    });
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'Checkpoints'], at);
  git(repo, ['checkout', '-q', '-f', 'main']);
  git(repo, ['clean', '-fdq']);
}

/** A fake home directory with an empty ~/.claude/projects. */
export function makeHome() {
  const home = tmpDir('home');
  const projects = path.join(home, '.claude', 'projects');
  fs.mkdirSync(projects, { recursive: true });
  return { home, projects };
}

/** Runs bin/dawnlog.js as a subprocess with a fake HOME. `node` adds Node flags (e.g. --import). */
export function runCli(args, { home, cwd, env = {}, node = [] } = {}) {
  const childEnv = { ...process.env, ...GIT_ENV, HOME: home };
  delete childEnv.CLAUDE_CONFIG_DIR;
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.DAWNLOG_CLAUDE;
  Object.assign(childEnv, env);
  const result = spawnSync(process.execPath, [...node, BIN, ...args], { cwd: cwd ?? home, env: childEnv, encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Splits terminal output into receipt blocks: "[n] branch — STATUS" plus its indented lines. */
export function receiptBlocks(stdout) {
  return stdout
    .split(/\n\s*\n/)
    .filter((block) => /^\[\d+\] /.test(block))
    .map((block) => {
      const head = /^\[(\d+)\] (.+) — (FAILED|UNVERIFIED|PASSED)$/m.exec(block);
      if (!head) throw new Error(`unrecognised receipt header:\n${block}`);
      const action = /^\s*suggest: (merge|fix|kill) — /m.exec(block)?.[1] ?? null;
      return { rank: Number(head[1]), branch: head[2], status: head[3], action, text: block };
    });
}

/** The "Unmatched sessions" section of terminal output, or '' when absent. */
export function unmatchedSection(stdout) {
  const start = stdout.indexOf('Unmatched sessions');
  return start < 0 ? '' : stdout.slice(start).split(/\n\s*\n/)[0];
}
