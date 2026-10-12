// End-to-end tests: ROADMAP M3 exit criteria (optional summaries and delivery), against the real CLI.
//   - with --summarize absent, zero subprocess or network calls other than git (asserted)
//   - digest file written to the given path on a fixture run
// plus Entire checkpoint ingestion.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FAKE } from './fake-secrets.js';
import { HOUR, MIN, addEntireCheckpoints, cleanup, git, makeHome, makeRepo, receiptBlocks, runCli, sessionJsonl, tmpDir, unmatchedSection, writeSession } from './helpers.js';
import { validate } from './schema-validator.js';

after(cleanup);

const TRAP = fileURLToPath(new URL('fixtures/trap.mjs', import.meta.url));
const SCHEMA = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../schema/receipts.schema.json', import.meta.url)), 'utf8'));

/** Two branches, one failing with a secret in its prompt, one passing. */
function fixture() {
  const now = Date.now();
  const repo = makeRepo({
    branches: [
      { name: 'fix-login', commits: [{ at: now - 4 * HOUR + 3 * MIN, files: { 'src/auth/login.js': 'x\n' }, message: 'Fix login' }] },
      { name: 'add-search', commits: [{ at: now - 2 * HOUR + 3 * MIN, files: { 'src/search.js': 'x\n' }, message: 'Add search' }] },
    ],
  });
  const { home, projects } = makeHome();
  writeSession(projects, {
    id: 'aaaa1111-0000-4000-8000-000000000001',
    cwd: repo,
    gitBranch: 'fix-login',
    start: now - 4 * HOUR,
    prompt: `Fix login. Staging key ${FAKE.anthropic}`,
    bash: [{ command: 'npm test', exit: 1 }],
    final: `Still failing. The key ${FAKE['github classic']} is in .env.`,
  });
  writeSession(projects, { id: 'bbbb2222-0000-4000-8000-000000000002', cwd: repo, gitBranch: 'add-search', start: now - 2 * HOUR, prompt: 'Add search', bash: [{ command: 'npm test', exit: 0 }] });
  return { repo, home, projects };
}

function trapped(args, { home, env = {} }) {
  const log = path.join(tmpDir('trap'), 'calls.jsonl');
  fs.writeFileSync(log, '');
  const out = runCli(args, { home, env: { OVERNIGHT_RECEIPTS_TRAP_LOG: log, ...env }, node: ['--import', TRAP] });
  const calls = fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return { out, calls };
}

/** A fake `claude` on PATH that records its argv and stdin and answers per branch. */
function fakeClaude({ exit = 0 } = {}) {
  const dir = tmpDir('bin');
  const record = path.join(dir, 'calls.jsonl');
  const script = path.join(dir, 'claude');
  fs.writeFileSync(
    script,
    `#!/usr/bin/env node
const fs = require('node:fs');
const input = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), input, cwd: process.cwd() }) + '\\n');
if (${exit}) { process.stderr.write('not logged in\\n'); process.exit(${exit}); }
const branch = /^Branch: (.*)$/m.exec(input)[1];
process.stdout.write('The agent worked on ' + branch + '. Check the tests first.\\n');
`,
  );
  fs.chmodSync(script, 0o755);
  const calls = () =>
    fs.existsSync(record)
      ? fs
          .readFileSync(record, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
  return { env: { PATH: `${dir}${path.delimiter}${process.env.PATH}` }, calls };
}

describe('exit 1: without --summarize, nothing but git runs and nothing touches the network', () => {
  let f;
  before(() => {
    f = fixture();
  });

  for (const [label, args] of [
    ['receipts', []],
    ['--json', ['--json']],
    ['--out', ['--out', 'OUT']],
    ['digest', ['digest', '--out', 'OUT']],
  ]) {
    test(label, () => {
      const out = path.join(tmpDir('o'), 'out.md');
      const argv = [...args.map((a) => (a === 'OUT' ? out : a)), '--since', '24h', '--repo', f.repo];
      const { out: result, calls } = trapped(argv, { home: f.home, env: fakeClaude().env });
      assert.equal(result.code, 0, result.stderr);
      assert.ok(calls.length > 0, 'the trap saw the git calls, so it is working');
      assert.deepEqual(
        calls.filter((c) => c.kind !== 'subprocess' || c.detail.command !== 'git'),
        [],
      );
    });
  }

  test('the trap does see a non-git subprocess (so the test above can fail)', () => {
    const fake = fakeClaude();
    const { calls } = trapped(['--since', '24h', '--repo', f.repo, '--summarize'], { home: f.home, env: fake.env });
    assert.ok(calls.some((c) => c.kind === 'subprocess' && c.detail.command === 'claude'));
  });
});

describe('--summarize', () => {
  let f;
  before(() => {
    f = fixture();
  });

  test('adds a summary per receipt from claude -p, with no tools and no session file', () => {
    const fake = fakeClaude();
    const out = runCli(['--since', '24h', '--repo', f.repo, '--summarize'], { home: f.home, env: fake.env });
    assert.equal(out.code, 0, out.stderr);
    const blocks = Object.fromEntries(receiptBlocks(out.stdout).map((r) => [r.branch, r.text]));
    assert.match(blocks['fix-login'], /summary: The agent worked on fix-login\. Check the tests first\./);
    assert.match(blocks['add-search'], /summary: The agent worked on add-search/);
    const calls = fake.calls();
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.deepEqual(call.argv, ['-p', '--output-format', 'text', '--no-session-persistence', '--tools', '']);
      assert.notEqual(fs.realpathSync(call.cwd), fs.realpathSync(f.repo), 'runs outside the repo so no CLAUDE.md loads');
    }
  });

  test('what is sent to claude is redacted', () => {
    const fake = fakeClaude();
    runCli(['--since', '24h', '--repo', f.repo, '--summarize'], { home: f.home, env: fake.env });
    const input = fake.calls().find((c) => c.input.includes('Branch: fix-login')).input;
    assert.ok(!input.includes(FAKE.anthropic), 'prompt secret');
    assert.ok(!input.includes(FAKE['github classic']), 'final-message secret');
    assert.match(input, /\[REDACTED\]/);
    assert.match(input, /Agent's final message:/);
    assert.match(input, /Last test: npm test → 1/);
  });

  test('a failing claude leaves the receipts intact and says why in a note', () => {
    const fake = fakeClaude({ exit: 3 });
    const out = runCli(['--since', '24h', '--repo', f.repo, '--summarize'], { home: f.home, env: fake.env });
    assert.equal(out.code, 0, out.stderr);
    assert.equal(receiptBlocks(out.stdout).length, 2);
    assert.doesNotMatch(out.stdout, /summary:/);
    assert.match(out.stdout, /note: --summarize: claude exited 3: not logged in \(2 receipts\)/);
  });

  test('no claude on PATH is a note, not a crash', () => {
    const out = runCli(['--since', '24h', '--repo', f.repo, '--summarize'], { home: f.home, env: { OVERNIGHT_RECEIPTS_CLAUDE: path.join(tmpDir('none'), 'claude') } });
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /note: --summarize: .*not found on PATH/);
  });

  test('--json carries the summary', () => {
    const fake = fakeClaude();
    const out = runCli(['--since', '24h', '--repo', f.repo, '--summarize', '--json'], { home: f.home, env: fake.env });
    const doc = JSON.parse(out.stdout);
    assert.deepEqual(validate(SCHEMA, doc), []);
    assert.ok(doc.receipts.every((r) => /^The agent worked on /.test(r.summary)));
  });
});

describe('exit 2: overnight-receipts digest writes a file for push delivery', () => {
  let f;
  before(() => {
    f = fixture();
  });

  test('writes the digest to the given path on a fixture run', () => {
    const dir = tmpDir('digest');
    const file = path.join(dir, 'nested', 'digest.txt');
    const out = runCli(['digest', '--since', '24h', '--repo', f.repo, '--out', file], { home: f.home });
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /^wrote .*digest\.txt \(2 branches across 1 repo\)$/m);
    const digest = fs.readFileSync(file, 'utf8');
    assert.match(digest, /^overnight-receipts digest · since .* UTC \(24h\)$/m);
    assert.match(digest, new RegExp(`^${path.basename(f.repo)}: 2 branches: 1 fix, 1 merge$`, 'm'));
    assert.match(digest, /^ {2}fix {3}fix-login \(FAILED\) — the last test run failed · risk auth · 1 for you$/m);
    assert.match(digest, /^ {2}merge add-search \(PASSED\) — tests pass$/m);
    assert.ok(digest.indexOf('fix-login') < digest.indexOf('add-search'), 'worst first');
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['digest.txt'], 'no temp file left behind');
  });

  test('several repos; a bad one is reported in the file and exits 1, the rest still written', () => {
    const file = path.join(tmpDir('digest'), 'd.txt');
    const empty = makeRepo();
    const notRepo = tmpDir('plain');
    const out = runCli(['digest', '--since', '24h', '--repo', f.repo, '--repo', empty, '--repo', notRepo, '--out', file], { home: f.home });
    assert.equal(out.code, 1);
    assert.match(out.stderr, /not a git repository/);
    const digest = fs.readFileSync(file, 'utf8');
    assert.match(digest, /2 branches: 1 fix, 1 merge/);
    assert.match(digest, new RegExp(`^${path.basename(empty)}: nothing to triage$`, 'm'));
    assert.match(digest, new RegExp(`^${path.basename(notRepo)}: error\\n {2}not a git repository`, 'm'));
  });

  test('--quiet prints nothing on success; --format md writes Markdown', () => {
    const file = path.join(tmpDir('digest'), 'd.md');
    const out = runCli(['digest', '--since', '24h', '--repo', f.repo, '--out', file, '--format', 'md', '--quiet'], { home: f.home });
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.stdout, '');
    const digest = fs.readFileSync(file, 'utf8');
    assert.match(digest, /^# overnight-receipts digest/);
    assert.match(digest, /^- \*\*fix\*\* `fix-login` \(FAILED\) — the last test run failed · risk auth · 1 for you$/m);
  });

  test('a rerun replaces the file', () => {
    const file = path.join(tmpDir('digest'), 'd.txt');
    fs.writeFileSync(file, 'old digest\n');
    runCli(['digest', '--since', '24h', '--repo', f.repo, '--out', file], { home: f.home });
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /old digest/);
  });

  test('the digest is redacted', () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'leak', commits: [{ at: now - HOUR, files: { 'a.txt': 'a\n' }, message: `Use ${FAKE.anthropic}` }] }] });
    const file = path.join(tmpDir('digest'), 'd.txt');
    const fake = fakeClaude();
    runCli(['digest', '--since', '24h', '--repo', repo, '--out', file], { home: f.home, env: fake.env });
    assert.ok(!fs.readFileSync(file, 'utf8').includes(FAKE.anthropic));
  });

  test('usage errors exit 2: missing --out, bad --format, bad --since', () => {
    assert.equal(runCli(['digest'], { home: f.home }).code, 2);
    assert.equal(runCli(['digest', '--out', 'x', '--format', 'pdf'], { home: f.home }).code, 2);
    assert.equal(runCli(['digest', '--out', 'x', '--since', 'soon'], { home: f.home }).code, 2);
  });

  test('without ~/.claude/projects it still lists branches, with a note', () => {
    const home = tmpDir('nohome');
    const file = path.join(tmpDir('digest'), 'd.txt');
    const out = runCli(['digest', '--since', '24h', '--repo', f.repo, '--out', file], { home });
    assert.equal(out.code, 0, out.stderr);
    const digest = fs.readFileSync(file, 'utf8');
    assert.match(digest, /note: no Claude Code sessions found/);
    assert.match(digest, /2 branches: 2 fix/);
  });
});

describe('exit 3: Entire checkpoint ingestion', () => {
  const LOCAL = 'cccc3333-0000-4000-8000-000000000003';
  const REMOTE = 'dddd4444-0000-4000-8000-000000000004';
  let repo;
  let home;
  let out;
  let json;

  before(() => {
    const now = Date.now();
    repo = makeRepo({
      branches: [
        { name: 'feature', commits: [{ at: now - 3 * HOUR, files: { 'f.js': 'x\n' }, message: 'Add feature\n\nEntire-Checkpoint: a3b2c4d5e6f7' }] },
        { name: 'remote-work', commits: [{ at: now - 2 * HOUR, files: { 'r.js': 'x\n' }, message: 'Remote work\n\nEntire-Checkpoint: b1c2d3e4f5a6' }] },
      ],
    });
    addEntireCheckpoints(repo, [
      { id: 'a3b2c4d5e6f7', sessions: [{ session_id: LOCAL, branch: 'feature', created_at: new Date(now - 3 * HOUR).toISOString() }] },
      {
        id: 'b1c2d3e4f5a6',
        sessions: [
          {
            session_id: REMOTE,
            branch: 'remote-work',
            created_at: new Date(now - 2 * HOUR).toISOString(),
            transcript: sessionJsonl({ id: REMOTE, cwd: '/home/runner/work/app', gitBranch: 'remote-work', start: now - 2.5 * HOUR, prompt: 'Do the remote work', bash: [{ command: 'npm test', exit: 1 }] }),
          },
        ],
      },
      { id: 'c0ffee000001', sessions: [{ raw: '{not json' }] },
    ]);
    const made = makeHome();
    home = made.home;
    // Local copy of the first session: no gitBranch and an hour before the commit, so only Entire's trailer can place it.
    writeSession(made.projects, { id: LOCAL, cwd: repo, start: now - 5 * HOUR, prompt: 'Build the feature', bash: [{ command: 'npm test', exit: 0 }] });
    out = runCli(['--since', '24h', '--repo', repo], { home });
    json = JSON.parse(runCli(['--since', '24h', '--repo', repo, '--json'], { home }).stdout);
  });

  test('the Entire-Checkpoint trailer matches a session nothing else could place', () => {
    assert.equal(out.code, 0, out.stderr);
    const blocks = Object.fromEntries(receiptBlocks(out.stdout).map((r) => [r.branch, r]));
    assert.match(blocks.feature.text, new RegExp(`session: ${LOCAL.slice(0, 8)} via entire — .*${LOCAL}\\.jsonl`));
    assert.equal(blocks.feature.status, 'PASSED');
    assert.equal(unmatchedSection(out.stdout), '');
  });

  test('a session stored only in Entire (another machine) is read from the checkpoint branch', () => {
    const r = json.receipts.find((x) => x.branch === 'remote-work');
    assert.equal(r.status, 'FAILED');
    assert.equal(r.task, 'Do the remote work');
    assert.deepEqual(r.sessions.map((s) => [s.id, s.via, s.file]), [[REMOTE, 'entire', 'entire:b1c2d3e4f5a6/0/full.jsonl']]);
    assert.equal(r.sources.task, 'entire:b1c2d3e4f5a6/0/full.jsonl:1');
    assert.equal(r.sessions[0].source, 'git:refs/heads/entire/checkpoints/v1:b1/c2d3e4f5a6');
  });

  test("Entire's own branches never get a receipt, and the run is noted", () => {
    assert.deepEqual(json.receipts.map((r) => r.branch).sort(), ['feature', 'remote-work']);
    assert.match(out.stdout, /note: Entire checkpoints read from refs\/heads\/entire\/checkpoints\/v1 \(2 checkpoint sessions, 1 session not on this machine read from it\)/);
    assert.match(out.stdout, /note: 1 Entire checkpoint metadata file unreadable/);
    assert.deepEqual(validate(SCHEMA, json), []);
  });

  test('with Entire present, no ~/.claude/projects is fine: checkpoints are the sessions', () => {
    const r = runCli(['--since', '24h', '--repo', repo], { home: tmpDir('nohome') });
    assert.equal(r.code, 0, r.stderr);
    const blocks = receiptBlocks(r.stdout);
    assert.equal(blocks.find((b) => b.branch === 'remote-work').status, 'FAILED');
    assert.equal(blocks.find((b) => b.branch === 'feature').status, 'UNVERIFIED', 'its transcript lives only on this machine');
  });

  test("Entire's ref backend is noted, not misread", () => {
    const plain = makeRepo({ branches: [{ name: 'x', commits: [{ at: Date.now() - HOUR, files: { 'x.txt': 'x\n' } }] }] });
    git(plain, ['update-ref', 'refs/entire/checkpoints/01/KVBJCWYA4YW6J5M9GP655HZN', 'HEAD']);
    const { home: h } = makeHome();
    const r = runCli(['--since', '24h', '--repo', plain], { home: h });
    assert.match(r.stdout, /note: Entire's ref-based checkpoints .* not read yet/);
  });
});

describe('scripts/morning-digest.sh', () => {
  const SCRIPT = fileURLToPath(new URL('../scripts/morning-digest.sh', import.meta.url));
  let f;
  before(() => {
    f = fixture();
  });

  /** Runs the script with a fake `openclaw` on PATH that records its argv and fails the first `failFirst` calls. */
  function morning(env, failFirst = 0) {
    const bin = tmpDir('bin');
    const record = path.join(bin, 'calls.jsonl');
    fs.writeFileSync(path.join(bin, 'openclaw'), `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nprocess.exit(fs.readFileSync(${JSON.stringify(record)}, 'utf8').trim().split('\\n').length <= ${failFirst} ? 1 : 0);\n`);
    fs.chmodSync(path.join(bin, 'openclaw'), 0o755);
    const out = path.join(tmpDir('m'), 'digest.txt');
    const childEnv = { ...process.env, HOME: f.home, PATH: `${bin}${path.delimiter}${process.env.PATH}`, OVERNIGHT_RECEIPTS_OUT: out, OVERNIGHT_RECEIPTS_SINCE: '24h', ...env };
    delete childEnv.OVERNIGHT_RECEIPTS_WHATSAPP_TO;
    Object.assign(childEnv, env);
    const r = spawnSync('/bin/sh', [SCRIPT], { env: childEnv, encoding: 'utf8' });
    const sends = fs.existsSync(record) ? fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { code: r.status, stderr: r.stderr, out, sends };
  }

  test('sends the digest to WhatsApp when branches need triage; non-repos in the list are skipped', () => {
    const r = morning({ OVERNIGHT_RECEIPTS_REPOS: `${f.repo} ${tmpDir('plain')}`, OVERNIGHT_RECEIPTS_WHATSAPP_TO: '+15550000000' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.sends.length, 1);
    const [args] = r.sends;
    assert.deepEqual(args.slice(0, 6), ['message', 'send', '--channel', 'whatsapp', '--target', '+15550000000']);
    assert.equal(args[6], '--message');
    assert.equal(`${args[7]}\n`, fs.readFileSync(r.out, 'utf8'));
  });

  test('a quiet morning writes the file and sends nothing; no number means no send', () => {
    const quiet = morning({ OVERNIGHT_RECEIPTS_REPOS: makeRepo(), OVERNIGHT_RECEIPTS_WHATSAPP_TO: '+15550000000' });
    assert.equal(quiet.code, 0, quiet.stderr);
    assert.deepEqual(quiet.sends, []);
    assert.match(fs.readFileSync(quiet.out, 'utf8'), /nothing to triage/);
    const unset = morning({ OVERNIGHT_RECEIPTS_REPOS: f.repo });
    assert.equal(unset.code, 0, unset.stderr);
    assert.deepEqual(unset.sends, []);
  });

  test('a failed send is retried, and gives up after the last try', () => {
    const env = { OVERNIGHT_RECEIPTS_REPOS: f.repo, OVERNIGHT_RECEIPTS_WHATSAPP_TO: '+15550000000', OVERNIGHT_RECEIPTS_SEND_WAIT: '0' };
    const retried = morning(env, 2);
    assert.equal(retried.code, 0, retried.stderr);
    assert.equal(retried.sends.length, 3);
    const failed = morning({ ...env, OVERNIGHT_RECEIPTS_SEND_TRIES: '2' }, 5);
    assert.equal(failed.code, 1);
    assert.equal(failed.sends.length, 2);
  });

  test('no repos matched exits 1', () => {
    assert.equal(morning({ OVERNIGHT_RECEIPTS_REPOS: tmpDir('plain') }).code, 1);
  });
});
