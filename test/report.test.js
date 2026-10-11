// buildReport: session→branch matching, receipts, ranking and risk.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { buildReport, riskOf } from '../src/report.js';
import { HOUR, MIN, addWorktree, cleanup, git, makeHome, makeRepo, tmpDir, writeSession } from './helpers.js';

after(cleanup);

const DAY = 24 * HOUR;

function report(repo, projects, extra = {}) {
  return buildReport({ repo, projects, since: Date.now() - DAY, ...extra });
}

const byBranch = (r) => Object.fromEntries(r.receipts.map((x) => [x.branch, x]));

describe('riskOf', () => {
  const cases = [
    [['package-lock.json'], ['dependency']],
    [['web/package.json', 'yarn.lock', 'pnpm-lock.yaml'], ['dependency']],
    [['go.sum', 'Cargo.lock', 'requirements-dev.txt', 'poetry.lock', 'Gemfile.lock'], ['dependency']],
    [['migrations/0001_init.py'], ['data']],
    [['db/migrate/20261010_add_users.rb'], ['data']],
    [['sql/seed.sql'], ['data']],
    [['prisma/schema.prisma'], ['data']],
    [['src/auth/session.ts', 'app/login.tsx'], ['auth']],
    [['lib/oauth2.py', 'api/permissions.go'], ['auth']],
    [['services/billing/invoice.ts'], ['payments']],
    [['src/stripe-webhook.js'], ['payments']],
    [['package-lock.json', 'migrations/1.sql', 'src/auth.js', 'payments/refund.js'], ['dependency', 'data', 'auth', 'payments']],
    [['README.md', 'docs/author.md', 'src/package-utils.js', 'src/datamigration-notes.md'], []],
    [[], []],
  ];
  for (const [paths, expected] of cases) {
    test(paths.join(', ') || '(no files)', () => {
      assert.deepEqual(riskOf(paths), expected);
    });
  }
});

describe('matching sessions to branches', () => {
  test('gitBranch wins; a session that started on base and switched matches the new branch', () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'feat', commits: [{ at: now - 2 * HOUR, files: { 'f.txt': 'f\n' } }] }] });
    const { projects } = makeHome();
    writeSession(projects, { id: 's1', cwd: repo, gitBranch: ['main', 'feat'], start: now - 3 * HOUR, prompt: 'p', bash: [{ command: 'git checkout -b feat', exit: 0 }] });
    const r = report(repo, projects);
    assert.equal(r.receipts.length, 1);
    assert.equal(r.receipts[0].branch, 'feat');
    assert.equal(r.receipts[0].sessions[0].session.id, 's1');
    assert.equal(r.receipts[0].sessions[0].via, 'gitBranch');
  });

  test('a session in a linked worktree matches the worktree branch, even with no new commits', () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'wt-branch', commits: [{ at: now - 30 * HOUR, files: { 'w.txt': 'w\n' } }] }] });
    const worktree = addWorktree(repo, 'wt-branch');
    const { projects } = makeHome();
    writeSession(projects, { id: 'wt', cwd: path.join(worktree), start: now - 2 * HOUR, prompt: 'p', bash: [{ command: 'npm test', exit: 1 }] });
    const r = report(repo, projects);
    assert.deepEqual(
      r.receipts.map((x) => [x.branch, x.status, x.sessions[0]?.via]),
      [['wt-branch', 'FAILED', 'worktree']],
    );
    assert.equal(r.receipts[0].commits.length, 1, 'commit is outside the window but still shown');
  });

  test('a session whose cwd is a symlink to the repo is still in the repo', () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'feat', commits: [{ at: now - HOUR + 2 * MIN, files: { 'f.txt': 'f\n' } }] }] });
    const link = path.join(tmpDir('link'), 'repo-link');
    fs.symlinkSync(repo, link);
    const { projects } = makeHome();
    writeSession(projects, { id: 'sym', cwd: path.join(link, 'src'), start: now - HOUR, prompt: 'p' });
    const r = report(repo, projects);
    assert.equal(r.receipts[0].sessions[0]?.session.id, 'sym');
    assert.equal(r.receipts[0].sessions[0]?.via, 'commit times');
    assert.equal(r.otherProjectSessions, 0);
  });

  test('commits on several branches during one session → unmatched, with the candidates named', () => {
    const now = Date.now();
    const repo = makeRepo({
      branches: [
        { name: 'one', commits: [{ at: now - HOUR + 2 * MIN, files: { '1.txt': '1\n' } }] },
        { name: 'two', commits: [{ at: now - HOUR + 3 * MIN, files: { '2.txt': '2\n' } }] },
      ],
    });
    const { projects } = makeHome();
    writeSession(projects, { id: 'amb', cwd: repo, start: now - HOUR, prompt: 'p' });
    const r = report(repo, projects);
    assert.equal(r.unmatched.length, 1);
    assert.match(r.unmatched[0].reason, /several branches: one, two/);
    assert.ok(r.receipts.every((x) => x.sessions.length === 0));
  });

  test('more commits on one branch wins the commit-time match', () => {
    const now = Date.now();
    const repo = makeRepo({
      branches: [
        {
          name: 'busy',
          commits: [
            { at: now - HOUR + 2 * MIN, files: { 'a.txt': 'a\n' } },
            { at: now - HOUR + 4 * MIN, files: { 'b.txt': 'b\n' } },
          ],
        },
        { name: 'quiet', commits: [{ at: now - HOUR + 3 * MIN, files: { 'q.txt': 'q\n' } }] },
      ],
    });
    const { projects } = makeHome();
    writeSession(projects, { id: 'm', cwd: repo, start: now - HOUR, prompt: 'p' });
    assert.equal(byBranch(report(repo, projects)).busy.sessions[0]?.session.id, 'm');
  });

  test('a session with no branch and no overlapping commits is unmatched with a reason', () => {
    const repo = makeRepo();
    const { projects } = makeHome();
    writeSession(projects, { id: 'lost', cwd: repo, start: Date.now() - HOUR, prompt: 'p' });
    const r = report(repo, projects);
    assert.deepEqual(
      r.unmatched.map((u) => [u.session.id, u.reason]),
      [['lost', 'no branch recorded and no commits during the session']],
    );
  });

  test('every in-repo session lands in exactly one place', () => {
    const now = Date.now();
    const repo = makeRepo({
      branches: [
        { name: 'a', commits: [{ at: now - 5 * HOUR, files: { 'a.txt': 'a\n' } }] },
        { name: 'b', commits: [{ at: now - 4 * HOUR, files: { 'b.txt': 'b\n' } }] },
      ],
    });
    const { projects } = makeHome();
    const ids = ['x1', 'x2', 'x3', 'x4', 'x5'];
    writeSession(projects, { id: 'x1', cwd: repo, gitBranch: 'a', start: now - 6 * HOUR, prompt: 'p' });
    writeSession(projects, { id: 'x2', cwd: repo, gitBranch: 'a', start: now - 3 * HOUR, prompt: 'p' });
    writeSession(projects, { id: 'x3', cwd: repo, gitBranch: 'b', start: now - 4 * HOUR - 2 * MIN, prompt: 'p' });
    writeSession(projects, { id: 'x4', cwd: repo, gitBranch: 'gone', start: now - 2 * HOUR, prompt: 'p' });
    writeSession(projects, { id: 'x5', cwd: repo, gitBranch: 'main', start: now - HOUR, prompt: 'p' });
    const r = report(repo, projects);
    const placed = [...r.receipts.flatMap((x) => x.sessions.map((s) => s.session.id)), ...r.unmatched.map((u) => u.session.id)];
    assert.deepEqual(placed.sort(), ids);
    assert.equal(r.sessionCount, 5);
  });
});

describe('receipts', () => {
  test('several sessions on one branch: status from the latest test run, retries summed, sessions in order', () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'feat', commits: [{ at: now - HOUR, files: { 'f.txt': 'f\n' } }] }] });
    const { projects } = makeHome();
    writeSession(projects, {
      id: 'later',
      cwd: repo,
      gitBranch: 'feat',
      start: now - 2 * HOUR,
      prompt: 'second',
      bash: [
        { command: 'npm test', exit: 1 },
        { command: 'npm test', exit: 0 },
      ],
    });
    writeSession(projects, {
      id: 'earlier',
      cwd: repo,
      gitBranch: 'feat',
      start: now - 8 * HOUR,
      prompt: 'first',
      bash: [
        { command: 'npm test', exit: 1 },
        { command: 'npm test', exit: 1 },
      ],
    });
    const [receipt] = report(repo, projects).receipts;
    assert.deepEqual(
      receipt.sessions.map((s) => s.session.id),
      ['earlier', 'later'],
    );
    assert.equal(receipt.status, 'PASSED');
    assert.equal(receipt.retries, 2);
  });

  test('a changed branch with no session still gets an UNVERIFIED receipt', () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'manual', commits: [{ at: now - HOUR, files: { 'm.txt': 'm\n' } }] }] });
    const { projects } = makeHome();
    const [receipt] = report(repo, projects).receipts;
    assert.equal(receipt.branch, 'manual');
    assert.equal(receipt.status, 'UNVERIFIED');
    assert.deepEqual(receipt.sessions, []);
    assert.equal(receipt.lastTest, null);
  });

  test('the base branch never gets a receipt, even with new commits', () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'feat', commits: [{ at: now - HOUR, files: { 'f.txt': 'f\n' } }] }] });
    fs.writeFileSync(path.join(repo, 'main.txt'), 'm\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'on main'], now - HOUR);
    const { projects } = makeHome();
    const r = report(repo, projects);
    assert.equal(r.base, 'main');
    assert.deepEqual(
      r.receipts.map((x) => x.branch),
      ['feat'],
    );
  });

  test('diff stat and files come from the merge base', () => {
    const now = Date.now();
    const repo = makeRepo({
      branches: [
        {
          name: 'feat',
          commits: [
            { at: now - 2 * HOUR, files: { 'a.txt': 'one\ntwo\n', 'migrations/1.sql': 'x\n' } },
            { at: now - HOUR, files: { 'a.txt': 'one\n' } },
          ],
        },
      ],
    });
    const { projects } = makeHome();
    const [receipt] = report(repo, projects).receipts;
    assert.deepEqual(receipt.files.map((f) => f.path).sort(), ['a.txt', 'migrations/1.sql']);
    assert.equal(receipt.added, 2);
    assert.equal(receipt.deleted, 0);
    assert.equal(receipt.commits.length, 2);
    assert.deepEqual(receipt.risk, ['data']);
  });

  test('an orphan branch (no merge base) reports the diff as unavailable instead of crashing', () => {
    const now = Date.now();
    const repo = makeRepo();
    git(repo, ['checkout', '-q', '--orphan', 'lonely']);
    fs.writeFileSync(path.join(repo, 'l.txt'), 'l\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'lonely'], now - HOUR);
    git(repo, ['checkout', '-q', '-f', 'main']);
    const { projects } = makeHome();
    const [receipt] = report(repo, projects).receipts;
    assert.equal(receipt.branch, 'lonely');
    assert.equal(receipt.files, null);
    assert.deepEqual(receipt.risk, []);
  });

  test('ranking: FAILED, then UNVERIFIED, then PASSED, then by branch name', () => {
    const now = Date.now();
    const names = ['a-pass', 'b-unverified', 'c-fail', 'd-fail'];
    const repo = makeRepo({ branches: names.map((name, i) => ({ name, commits: [{ at: now - (i + 1) * HOUR + 2 * MIN, files: { [`${name}.txt`]: 'x\n' } }] })) });
    const { projects } = makeHome();
    writeSession(projects, { id: 'p', cwd: repo, gitBranch: 'a-pass', start: now - HOUR, prompt: 'p', bash: [{ command: 'npm test', exit: 0 }] });
    writeSession(projects, { id: 'f1', cwd: repo, gitBranch: 'd-fail', start: now - 4 * HOUR, prompt: 'p', bash: [{ command: 'npm test', exit: 1 }] });
    writeSession(projects, { id: 'f2', cwd: repo, gitBranch: 'c-fail', start: now - 3 * HOUR, prompt: 'p', bash: [{ command: 'npm test', exit: 1 }] });
    assert.deepEqual(
      report(repo, projects).receipts.map((x) => x.branch),
      ['c-fail', 'd-fail', 'b-unverified', 'a-pass'],
    );
  });
});

describe('base branch detection', () => {
  test('falls back to master', () => {
    const repo = makeRepo({ base: 'master' });
    const { projects } = makeHome();
    assert.equal(report(repo, projects).base, 'master');
  });

  test('prefers origin/HEAD when it is set', () => {
    const repo = makeRepo({ branches: [{ name: 'develop', commits: [{ at: Date.now() - 50 * HOUR, files: { 'd.txt': 'd\n' } }] }] });
    git(repo, ['update-ref', 'refs/remotes/origin/develop', 'refs/heads/develop']);
    git(repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop']);
    const { projects } = makeHome();
    assert.equal(report(repo, projects).base, 'develop');
  });

  test('no recognisable base asks for --base', () => {
    const repo = makeRepo({ base: 'trunkish' });
    const { projects } = makeHome();
    assert.throws(() => report(repo, projects), /pass --base/);
    assert.equal(report(repo, projects, { base: 'trunkish' }).base, 'trunkish');
  });

  test('not a git repository', () => {
    const { projects } = makeHome();
    assert.throws(() => report(tmpDir('plain'), projects), /not a git repository/);
  });
});
