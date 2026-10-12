// End-to-end tests: ROADMAP M1 exit criteria, run against the real CLI binary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { HOUR, MIN, cleanup, makeHome, makeRepo, receiptBlocks, runCli, tmpDir, unmatchedSection, writeSession } from './helpers.js';
import { FAKE } from './fake-secrets.js';

after(cleanup);

const SESSION_A = 'aaaa1111-0000-4000-8000-000000000001';
const SESSION_B = 'bbbb2222-0000-4000-8000-000000000002';
const SESSION_C = 'cccc3333-0000-4000-8000-000000000003';

describe('M1 fixture: 3 sessions, 3 branches', () => {
  let out;
  let files;

  before(() => {
    const now = Date.now();
    const repo = makeRepo({
      branches: [
        // Alphabetically first, but passing: only status ranking can put fix-login above it.
        { name: 'add-search', commits: [{ at: now - 5 * HOUR + 3 * MIN, files: { 'src/search.js': 'export const search = 1;\n' }, message: 'Add search endpoint' }] },
        {
          name: 'db-users',
          commits: [{ at: now - 3 * HOUR + 3 * MIN, files: { 'db/migrations/001_users.sql': 'create table users (id int);\n' }, message: 'Add users table' }],
        },
        {
          name: 'fix-login',
          commits: [{ at: now - 9 * HOUR + 3 * MIN, files: { 'src/redirect.js': 'export const go = 1;\n', 'package-lock.json': '{}\n' }, message: 'Fix redirect loop' }],
        },
      ],
    });
    const { home, projects } = makeHome();
    files = {
      a: writeSession(projects, {
        id: SESSION_A,
        cwd: repo,
        gitBranch: 'fix-login',
        start: now - 9 * HOUR,
        prompt: 'Fix the login redirect loop',
        bash: [
          { command: 'npm test', exit: 1 },
          { command: 'npm test', exit: 1 },
          { command: 'npm test', exit: 1 },
        ],
        final: 'I could not get the tests green.',
      }),
      b: writeSession(projects, {
        id: SESSION_B,
        cwd: repo,
        gitBranch: 'add-search',
        start: now - 5 * HOUR,
        prompt: 'Add a search endpoint',
        bash: [{ command: 'npm test', exit: 0 }],
      }),
      // No gitBranch field (older Claude Code): must be matched by commit times.
      c: writeSession(projects, {
        id: SESSION_C,
        cwd: repo,
        start: now - 3 * HOUR,
        prompt: 'Create the users table migration',
        bash: [{ command: 'ls db', exit: 0, output: 'migrations' }],
      }),
    };
    out = runCli(['--since', '24h', '--repo', repo], { home });
  });

  test('exits 0', () => {
    assert.equal(out.code, 0, out.stderr);
  });

  test('exit 1: lists exactly 3 receipts with the right session on each branch', () => {
    const receipts = receiptBlocks(out.stdout);
    assert.equal(receipts.length, 3, out.stdout);
    assert.deepEqual(receipts.map((r) => r.branch).sort(), ['add-search', 'db-users', 'fix-login']);
    const expected = { 'fix-login': SESSION_A, 'add-search': SESSION_B, 'db-users': SESSION_C };
    for (const receipt of receipts) {
      for (const [branch, id] of Object.entries(expected)) {
        const short = id.slice(0, 8);
        if (branch === receipt.branch) assert.match(receipt.text, new RegExp(`session: ${short}\\b`), receipt.text);
        else assert.doesNotMatch(receipt.text, new RegExp(short), `${receipt.branch} must not show ${branch}'s session`);
      }
    }
    const byBranch = Object.fromEntries(receipts.map((r) => [r.branch, r]));
    assert.match(byBranch['db-users'].text, /via commit times/);
    assert.match(byBranch['fix-login'].text, /via gitBranch/);
    assert.ok(byBranch['fix-login'].text.includes(files.a), 'receipt links the transcript file');
    assert.match(byBranch['fix-login'].text, /task: Fix the login redirect loop/);
    assert.equal(unmatchedSection(out.stdout), '', 'nothing unmatched in this fixture');
  });

  test('exit 2: a non-zero test exit gets FAILED and ranks above a passing one', () => {
    const receipts = receiptBlocks(out.stdout);
    const failed = receipts.find((r) => r.branch === 'fix-login');
    const passed = receipts.find((r) => r.branch === 'add-search');
    assert.equal(failed.status, 'FAILED');
    assert.equal(passed.status, 'PASSED');
    assert.ok(failed.rank < passed.rank, `FAILED rank ${failed.rank} should be above PASSED rank ${passed.rank}`);
    assert.equal(receipts[0].branch, 'fix-login');
    assert.match(failed.text, /tests: npm test → exit 1/);
  });

  test('exit 3: repeating the same failing command 3 times reports retries: 2', () => {
    const failed = receiptBlocks(out.stdout).find((r) => r.branch === 'fix-login');
    assert.match(failed.text, /^\s*retries: 2(?: · L\d+)?$/m);
  });

  test('exit 4: package-lock.json sets risk: dependency, migrations/ sets risk: data', () => {
    const receipts = Object.fromEntries(receiptBlocks(out.stdout).map((r) => [r.branch, r]));
    assert.match(receipts['fix-login'].text, /^\s*risk: .*\bdependency\b/m);
    assert.match(receipts['db-users'].text, /^\s*risk: .*\bdata\b/m);
    assert.match(receipts['add-search'].text, /^\s*risk: none$/m);
  });

  test('a session without tests is UNVERIFIED, between FAILED and PASSED', () => {
    const receipts = receiptBlocks(out.stdout);
    assert.deepEqual(
      receipts.map((r) => [r.rank, r.branch, r.status]),
      [
        [1, 'fix-login', 'FAILED'],
        [2, 'db-users', 'UNVERIFIED'],
        [3, 'add-search', 'PASSED'],
      ],
    );
  });

  test('shows commits and diff stat', () => {
    const failed = receiptBlocks(out.stdout).find((r) => r.branch === 'fix-login');
    assert.match(failed.text, /commits: 1 commit, 2 files \+2 -0/);
    assert.match(failed.text, /- Fix redirect loop/);
  });
});

describe('exit 5: secret redaction', () => {
  const ANTHROPIC = FAKE.anthropic;
  const GITHUB = FAKE['github classic'];
  const AWS = FAKE['aws access key id'];
  let out;
  let markdown;

  before(() => {
    const now = Date.now();
    const repo = makeRepo({
      branches: [
        { name: 'rotate-keys', commits: [{ at: now - 2 * HOUR + 3 * MIN, files: { 'config.js': 'x\n' }, message: `Rotate ${AWS} out of config` }] },
      ],
    });
    const { home, projects } = makeHome();
    writeSession(projects, {
      id: 'dddd4444-0000-4000-8000-000000000004',
      cwd: repo,
      gitBranch: 'rotate-keys',
      start: now - 2 * HOUR,
      prompt: `Use ANTHROPIC_API_KEY ${ANTHROPIC} and rotate the AWS key ${AWS}`,
      bash: [{ command: `GITHUB_TOKEN=${GITHUB} npm test`, exit: 1 }],
    });
    const outFile = path.join(tmpDir('out'), 'receipts.md');
    out = runCli(['--since', '24h', '--repo', repo, '--out', outFile], { home });
    markdown = fs.readFileSync(outFile, 'utf8');
  });

  test('exits 0 and writes the Markdown file', () => {
    assert.equal(out.code, 0, out.stderr);
    assert.match(markdown, /^# overnight-receipts/);
    assert.match(markdown, /rotate-keys/);
  });

  for (const [name, token] of [
    ['sk-ant-…', ANTHROPIC],
    ['ghp_…', GITHUB],
    ['AKIA…', AWS],
  ]) {
    test(`${name} never appears in terminal output, stderr or the Markdown file`, () => {
      assert.ok(!out.stdout.includes(token), `stdout leaks ${name}`);
      assert.ok(!out.stderr.includes(token), `stderr leaks ${name}`);
      assert.ok(!markdown.includes(token), `markdown leaks ${name}`);
    });
  }

  test('tokens are replaced with [REDACTED] in both outputs', () => {
    const block = receiptBlocks(out.stdout)[0].text;
    assert.match(block, /task: .*\[REDACTED\].*\[REDACTED\]/, 'prompt tokens');
    assert.match(block, /tests: GITHUB_TOKEN=\[REDACTED\] npm test → exit 1/, 'command token');
    assert.match(block, /- Rotate \[REDACTED\] out of config/, 'commit subject token');
    assert.equal((markdown.match(/\[REDACTED\]/g) ?? []).length >= 4, true, markdown);
  });
});

describe('exit 6: sessions with no matching branch appear under "Unmatched"', () => {
  const MATCHED = 'eeee5555-0000-4000-8000-000000000005';
  const DELETED = 'ffff6666-0000-4000-8000-000000000006';
  const ON_BASE = 'abab7777-0000-4000-8000-000000000007';
  let out;

  before(() => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'feature', commits: [{ at: now - 6 * HOUR + 2 * MIN, files: { 'a.txt': 'a\n' } }] }] });
    const { home, projects } = makeHome();
    writeSession(projects, { id: MATCHED, cwd: repo, gitBranch: 'feature', start: now - 6 * HOUR, prompt: 'Build the feature' });
    writeSession(projects, { id: DELETED, cwd: repo, gitBranch: 'experiment', start: now - 4 * HOUR, prompt: 'Try an experiment' });
    writeSession(projects, { id: ON_BASE, cwd: repo, gitBranch: 'main', start: now - 1 * HOUR, prompt: 'Explain the codebase' });
    out = runCli(['--since', '24h', '--repo', repo], { home });
  });

  test('matched session gets a receipt; the other two are listed as unmatched with reasons', () => {
    assert.equal(out.code, 0, out.stderr);
    const receipts = receiptBlocks(out.stdout);
    assert.deepEqual(
      receipts.map((r) => r.branch),
      ['feature'],
    );
    const unmatched = unmatchedSection(out.stdout);
    assert.match(unmatched, /^Unmatched sessions \(2\)/);
    assert.match(unmatched, new RegExp(`${DELETED.slice(0, 8)}: branch "experiment" not found`));
    assert.match(unmatched, new RegExp(`${ON_BASE.slice(0, 8)}: ran on base branch main`));
    assert.match(unmatched, /task: Try an experiment/);
    assert.match(unmatched, /task: Explain the codebase/);
  });

  test('every session in the window appears exactly once (never dropped, never doubled)', () => {
    for (const id of [MATCHED, DELETED, ON_BASE]) {
      const count = out.stdout.split('\n').filter((line) => line.includes(id.slice(0, 8))).length;
      assert.equal(count, 1, `${id} is on ${count} lines`);
    }
    assert.match(out.stdout, /1 receipt · 3 sessions · 2 unmatched/);
  });
});

describe('exit 7: no ~/.claude/projects', () => {
  test('exits 0 with a clear message, even outside a git repo', () => {
    const home = tmpDir('emptyhome');
    const out = runCli(['--since', '24h'], { home, cwd: home });
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /no Claude Code sessions found/i);
    assert.ok(out.stdout.includes(path.join(home, '.claude', 'projects')), out.stdout);
    assert.equal(out.stderr, '');
  });

  test('honours CLAUDE_CONFIG_DIR', () => {
    const home = tmpDir('emptyhome');
    const config = path.join(home, 'elsewhere');
    const out = runCli([], { home, env: { CLAUDE_CONFIG_DIR: config } });
    assert.equal(out.code, 0);
    assert.ok(out.stdout.includes(path.join(config, 'projects')), out.stdout);
  });
});

describe('CLI edges', () => {
  test('--help prints usage and exits 0', () => {
    const out = runCli(['--help'], { home: tmpDir('home') });
    assert.equal(out.code, 0);
    assert.match(out.stdout, /Usage: overnight-receipts/);
  });

  test('unknown flag exits 2 with usage', () => {
    const out = runCli(['--nope'], { home: tmpDir('home') });
    assert.equal(out.code, 2);
    assert.match(out.stderr, /Usage: overnight-receipts/);
  });

  test('bad --since exits 2 with a clear message', () => {
    const { home } = makeHome();
    const out = runCli(['--since', 'yesterday-ish'], { home });
    assert.equal(out.code, 2);
    assert.match(out.stderr, /--since/);
  });

  test('not a git repository exits 1 with a clear message', () => {
    const { home } = makeHome();
    const notRepo = tmpDir('plain');
    const out = runCli(['--repo', notRepo], { home });
    assert.equal(out.code, 1);
    assert.match(out.stderr, /not a git repository/);
  });

  test('unknown --base exits 1', () => {
    const { home } = makeHome();
    const repo = makeRepo();
    const out = runCli(['--repo', repo, '--base', 'nope'], { home });
    assert.equal(out.code, 1);
    assert.match(out.stderr, /base branch "nope" not found/);
  });

  test('defaults to the current directory and a 12h window', () => {
    const now = Date.now();
    const repo = makeRepo({
      branches: [
        { name: 'recent', commits: [{ at: now - 2 * HOUR, files: { 'r.txt': 'r\n' } }] },
        { name: 'stale', commits: [{ at: now - 20 * HOUR, files: { 's.txt': 's\n' } }] },
      ],
    });
    const { home } = makeHome();
    const out = runCli([], { home, cwd: repo });
    assert.equal(out.code, 0, out.stderr);
    assert.deepEqual(
      receiptBlocks(out.stdout).map((r) => r.branch),
      ['recent'],
    );
    assert.match(out.stdout, /\(12h\)/);
  });

  test('sessions from other projects and older sessions are not listed but other projects are counted', () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'work', commits: [{ at: now - 1 * HOUR, files: { 'w.txt': 'w\n' } }] }] });
    const elsewhere = makeRepo();
    const { home, projects } = makeHome();
    writeSession(projects, { id: '11110000-0000-4000-8000-000000000000', cwd: repo, gitBranch: 'work', start: now - 1 * HOUR - 2 * MIN, prompt: 'Work' });
    writeSession(projects, { id: '22220000-0000-4000-8000-000000000000', cwd: elsewhere, gitBranch: 'main', start: now - 1 * HOUR, prompt: 'Other repo' });
    writeSession(projects, { id: '33330000-0000-4000-8000-000000000000', cwd: repo, gitBranch: 'work', start: now - 50 * HOUR, prompt: 'Old', mtime: now - 50 * HOUR });
    const out = runCli(['--since', '24h', '--repo', repo], { home });
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /11110000/);
    assert.doesNotMatch(out.stdout, /22220000|33330000/);
    assert.match(out.stdout, /1 session from other projects/);
  });

  test('Markdown output escapes HTML from transcripts and terminal output strips escape codes', () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'xss', commits: [{ at: now - HOUR + 2 * MIN, files: { 'x.txt': 'x\n' } }] }] });
    const { home, projects } = makeHome();
    writeSession(projects, { id: '44440000-0000-4000-8000-000000000000', cwd: repo, gitBranch: 'xss', start: now - HOUR, prompt: 'Render <script>alert(1)</script> \u001b[2Jsafely' });
    const outFile = path.join(tmpDir('out'), 'r.md');
    const out = runCli(['--since', '24h', '--repo', repo, '--out', outFile], { home });
    const markdown = fs.readFileSync(outFile, 'utf8');
    assert.ok(!markdown.includes('<script>'), markdown);
    assert.match(markdown, /&lt;script&gt;/);
    assert.ok(!out.stdout.includes('\u001b'), 'no escape codes reach the terminal');
    assert.match(out.stdout, /task: Render <script>alert\(1\)<\/script> safely/);
    assert.match(out.stdout, new RegExp(`wrote ${outFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  test('Markdown output neutralises images and links from transcripts', () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'img', commits: [{ at: now - HOUR + 2 * MIN, files: { 'i.txt': 'i\n' } }] }] });
    const { home, projects } = makeHome();
    writeSession(projects, { id: '55550000-0000-4000-8000-000000000000', cwd: repo, gitBranch: 'img', start: now - HOUR, prompt: 'See ![x](http://example.com/p.png) and [docs](http://example.com)' });
    const outFile = path.join(tmpDir('out'), 'r.md');
    runCli(['--since', '24h', '--repo', repo, '--out', outFile], { home });
    const markdown = fs.readFileSync(outFile, 'utf8');
    assert.ok(!markdown.includes('![x]('), markdown);
    assert.ok(!markdown.includes('[docs]('), markdown);
  });

  test('empty window says there is nothing to triage', () => {
    const repo = makeRepo();
    const { home } = makeHome();
    const out = runCli(['--since', '24h', '--repo', repo], { home });
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /Nothing to triage/);
  });
});
