// End-to-end tests: ROADMAP M2 exit criteria (triage queue), run against the real CLI binary.
//   - ranking order matches a golden file for the fixture set
//   - each receipt field carries a `source: file:line`
//   - --json validates against a schema
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HOUR, MIN, cleanup, git, makeHome, makeRepo, receiptBlocks, runCli, tmpDir, writeSession } from './helpers.js';
import { validate } from './schema-validator.js';

after(cleanup);

const GOLDEN = fileURLToPath(new URL('golden/ranking.txt', import.meta.url));
const SCHEMA = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../schema/receipts.schema.json', import.meta.url)), 'utf8'));

/** Nine branches, one per triage rule. Times are relative to now; the ranking doesn't depend on them. */
function triageFixture() {
  const now = Date.now();
  const commit = (hoursAgo, files, message) => [{ at: now - hoursAgo * HOUR + 3 * MIN, files, message }];
  const repo = makeRepo({
    branches: [
      { name: 'auth-fail', commits: commit(9, { 'src/auth/session.js': 'x\n' }, 'Refresh sessions') },
      { name: 'thrash', commits: commit(8, { 'src/upload.js': 'x\n' }, 'Upload retries') },
      { name: 'plain-fail', commits: commit(7, { 'src/math.js': 'x\n' }, 'Rounding') },
      { name: 'deps-unverified', commits: commit(6, { 'package-lock.json': '{}\n', 'src/dep.js': 'x\n' }, 'Bump deps') },
      { name: 'piped', commits: commit(5, { 'src/piped.js': 'x\n' }, 'Piped tests') },
      { name: 'billing-pass', commits: commit(4, { 'src/billing/invoice.js': 'x\n' }, 'Invoice totals') },
      { name: 'left-todo', commits: commit(3, { 'src/todo.js': 'x\n' }, 'Half done') },
      { name: 'clean-pass', commits: commit(2, { 'src/clean.js': 'x\n' }, 'Clean change') },
      { name: 'no-commits' },
    ],
  });
  const { home, projects } = makeHome();
  const files = {};
  const session = (n, branch, hoursAgo, prompt, bash = [], final) => {
    files[branch] = writeSession(projects, { id: `${String(n).repeat(8)}-0000-4000-8000-00000000000${n}`, cwd: repo, gitBranch: branch, start: now - hoursAgo * HOUR, prompt, bash, final });
  };
  const fail = { command: 'npm test', exit: 1 };
  const pass = { command: 'npm test', exit: 0 };
  session(1, 'auth-fail', 9, 'Refresh auth sessions', [fail, fail]);
  session(2, 'thrash', 8, 'Make uploads retry', [fail, fail, fail, fail, fail, fail]);
  session(3, 'plain-fail', 7, 'Fix rounding', [fail]);
  session(4, 'deps-unverified', 6, 'Bump the deps');
  session(5, 'piped', 5, 'Pipe the tests', [{ command: 'npm test 2>&1 | tail -5', exit: 0, output: 'ok' }]);
  session(6, 'billing-pass', 4, 'Fix invoice totals', [pass]);
  session(7, 'left-todo', 3, 'Start the export', [pass], 'Export skeleton is in.\n\n## Next steps\n- Wire the CSV writer\n- Should the export include archived rows?');
  session(8, 'clean-pass', 2, 'Small clean change', [pass]);
  session(9, 'no-commits', 1, 'Look into caching', [pass]);
  return { repo, home, files };
}

describe('M2 fixture: triage queue', () => {
  let fixture;
  let text;
  let json;

  before(() => {
    fixture = triageFixture();
    text = runCli(['--since', '24h', '--repo', fixture.repo], { home: fixture.home });
    json = runCli(['--since', '24h', '--repo', fixture.repo, '--json'], { home: fixture.home });
  });

  test('exits 0 in both modes', () => {
    assert.equal(text.code, 0, text.stderr);
    assert.equal(json.code, 0, json.stderr);
    assert.equal(json.stderr, '');
  });

  test('exit 1: ranking order matches the golden file (terminal and --json agree)', () => {
    const fromText = receiptBlocks(text.stdout)
      .map((r) => `${r.rank} ${r.branch} ${r.status} ${r.action}`)
      .join('\n');
    const fromJson = JSON.parse(json.stdout)
      .receipts.map((r) => `${r.rank} ${r.branch} ${r.status} ${r.suggestion.action}`)
      .join('\n');
    if (process.env.UPDATE_GOLDEN) fs.writeFileSync(GOLDEN, `${fromText}\n`);
    const golden = fs.readFileSync(GOLDEN, 'utf8').trim();
    assert.equal(fromText, golden);
    assert.equal(fromJson, golden);
  });

  test('exit 2: every receipt field carries a source, and file:line sources point at the right line', () => {
    const lineOf = (source) => {
      const [, file, n] = /^(.*):(\d+)$/.exec(source);
      return fs.readFileSync(file, 'utf8').split('\n')[Number(n) - 1];
    };
    const keys = SCHEMA.$defs.receipt.properties.sources.required;
    for (const r of JSON.parse(json.stdout).receipts) {
      assert.deepEqual(Object.keys(r.sources).sort(), [...keys].sort(), r.branch);
      for (const key of ['branch', 'commits', 'files', 'risk', 'outside']) assert.match(r.sources[key], /^git:/, `${r.branch}.${key}`);
      const file = fixture.files[r.branch];
      // The task cites the prompt's line, the tests cite the last test command's line.
      assert.equal(r.sources.task, `${file}:1`, `${r.branch}.task`);
      assert.ok(JSON.parse(lineOf(r.sources.task)).message.content.includes(r.task));
      assert.equal(r.sources.sessions.length, 1);
      assert.equal(r.sessions[0].source, r.sources.sessions[0]);
      assert.match(lineOf(r.sessions[0].source), new RegExp(`"gitBranch":"${r.branch}"`));
      if (r.tests) {
        assert.equal(r.sources.tests, r.tests.source);
        assert.equal(r.sources.status, r.tests.source);
        assert.ok(lineOf(r.tests.source).includes(JSON.stringify(r.tests.command)), `${r.branch}.tests`);
      } else {
        assert.equal(r.sources.tests, null);
        assert.equal(r.sources.status, null);
      }
      if (r.retries) assert.ok(lineOf(r.sources.retries).includes('"tool_use"'), `${r.branch}.retries`);
      else assert.equal(r.sources.retries, null);
      for (const item of r.deferred) assert.ok(lineOf(item.source).includes(item.text.replace(/\?$/, '')), item.text);
      assert.notEqual(r.sources.suggestion, undefined);
    }
  });

  test('retries cite the first re-run: the second of two failing runs', () => {
    const r = JSON.parse(json.stdout).receipts.find((x) => x.branch === 'auth-fail');
    assert.equal(r.retries, 1);
    // prompt (1), run (2), result (3), retry run (4)
    assert.equal(r.sources.retries, `${fixture.files['auth-fail']}:4`);
  });

  test('exit 3: --json validates against schema/receipts.schema.json', () => {
    const errors = validate(SCHEMA, JSON.parse(json.stdout));
    assert.deepEqual(errors, []);
  });

  test('the validator catches a broken document (so the schema test can fail)', () => {
    const doc = JSON.parse(json.stdout);
    doc.receipts[0].status = 'MAYBE';
    doc.receipts[0].sources.task = 'nowhere';
    delete doc.counts;
    assert.equal(validate(SCHEMA, doc).length, 3);
  });

  test('terminal receipts show the suggestion, line references and the needs-you list', () => {
    const blocks = Object.fromEntries(receiptBlocks(text.stdout).map((r) => [r.branch, r.text]));
    assert.match(blocks['thrash'], /suggest: kill — tests still fail after 5 retries/);
    assert.match(blocks['no-commits'], /suggest: kill — nothing to merge/);
    assert.match(blocks['billing-pass'], /suggest: merge — tests pass; review payments first/);
    assert.match(blocks['auth-fail'], /task: Refresh auth sessions · L1$/m);
    assert.match(blocks['auth-fail'], /tests: npm test → exit 1 · L4$/m);
    assert.match(blocks['left-todo'], /needs you \(2\):\n\s+- Wire the CSV writer · L\d+\n\s+- asked: Should the export include archived rows\? · L\d+/);
  });

  test('the Markdown file carries the same suggestions and needs-you list', () => {
    const out = path.join(tmpDir('md'), 'r.md');
    runCli(['--since', '24h', '--repo', fixture.repo, '--out', out], { home: fixture.home });
    const markdown = fs.readFileSync(out, 'utf8');
    assert.match(markdown, /- \*\*suggest: kill\*\* — tests still fail after 5 retries/);
    assert.match(markdown, /- needs you \(2\):\n {2}- Wire the CSV writer · L\d+/);
  });

  test('--json with --out keeps stdout pure JSON', () => {
    const out = path.join(tmpDir('md'), 'r.md');
    const r = runCli(['--since', '24h', '--repo', fixture.repo, '--json', '--out', out], { home: fixture.home });
    assert.doesNotThrow(() => JSON.parse(r.stdout));
    assert.match(r.stderr, /wrote /);
    assert.ok(fs.existsSync(out));
  });
});

describe('triage details', () => {
  test('branches already merged into base are skipped and counted, unless a session ran on them', () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'merged', commits: [{ at: now - 2 * HOUR, files: { 'm.txt': 'm\n' } }] }, { name: 'live', commits: [{ at: now - HOUR, files: { 'l.txt': 'l\n' } }] }] });
    git(repo, ['merge', '-q', '--ff-only', 'merged']);
    const { home } = makeHome();
    const out = runCli(['--since', '24h', '--repo', repo], { home });
    assert.deepEqual(
      receiptBlocks(out.stdout).map((r) => r.branch),
      ['live'],
    );
    assert.match(out.stdout, /note: 1 branch changed in the window already merged into base \(nothing ahead, or squash-merged\) not listed/);
  });

  test('squash-merged branches are skipped: same content in base, or the same patch on base', () => {
    const now = Date.now();
    const repo = makeRepo({
      branches: [
        { name: 'same-content', commits: [{ at: now - 3 * HOUR, files: { 'a.txt': 'a\n' } }, { at: now - 3 * HOUR + MIN, files: { 'a.txt': 'a2\n' } }] },
        { name: 'same-patch', commits: [{ at: now - 2 * HOUR, files: { 'b.txt': 'one\n' } }] },
        { name: 'squashed-with-session', commits: [{ at: now - 2 * HOUR, files: { 'c.txt': 'c\n' } }] },
        { name: 'open', commits: [{ at: now - HOUR, files: { 'd.txt': 'd\n' } }] },
      ],
    });
    for (const branch of ['same-content', 'same-patch', 'squashed-with-session']) {
      git(repo, ['merge', '-q', '--squash', branch]);
      git(repo, ['commit', '-q', '-m', `Squash ${branch}`], now - 90 * MIN);
    }
    // base moves on and edits b.txt again, so only the patch-id still shows same-patch landed
    fs.writeFileSync(path.join(repo, 'b.txt'), 'one\ntwo\n');
    git(repo, ['commit', '-q', '-am', 'Later edit'], now - 80 * MIN);
    const { home, projects } = makeHome();
    writeSession(projects, { id: 'sqsh0000-0000-4000-8000-000000000000', cwd: repo, gitBranch: 'squashed-with-session', start: now - 2 * HOUR - 5 * MIN, prompt: 'c' });
    const out = runCli(['--since', '24h', '--repo', repo], { home });
    const blocks = receiptBlocks(out.stdout);
    assert.deepEqual(blocks.map((r) => r.branch).sort(), ['open', 'squashed-with-session']);
    assert.match(blocks.find((r) => r.branch === 'squashed-with-session').text, /suggest: kill — already in base \(squash- or rebase-merged\)/);
    assert.match(out.stdout, /note: 2 branches changed in the window already merged into base/);
  });

  test("a denied test run doesn't count as a failure or a retry", () => {
    const now = Date.now();
    const repo = makeRepo({ branches: [{ name: 'feat', commits: [{ at: now - HOUR + 3 * MIN, files: { 'f.txt': 'f\n' } }] }] });
    const { home, projects } = makeHome();
    writeSession(projects, {
      id: 'deny0000-0000-4000-8000-000000000000',
      cwd: repo,
      gitBranch: 'feat',
      start: now - HOUR,
      prompt: 'Feature',
      bash: [{ command: 'npm test', exit: 0 }, { command: 'npm test', denied: true }],
    });
    const [receipt] = JSON.parse(runCli(['--since', '24h', '--repo', repo, '--json'], { home }).stdout).receipts;
    assert.equal(receipt.status, 'PASSED');
    assert.equal(receipt.retries, 0);
  });

  test('scope: files outside the task area are listed', () => {
    const now = Date.now();
    const repo = makeRepo({
      branches: [{ name: 'search', commits: [{ at: now - HOUR + 3 * MIN, files: { 'src/search/index.js': 'a\nb\nc\nd\n', 'src/search/q.js': 'a\nb\n', 'deploy/prod.sh': 'x\n' } }] }],
    });
    const { home, projects } = makeHome();
    writeSession(projects, { id: 'scop0000-0000-4000-8000-000000000000', cwd: repo, gitBranch: 'search', start: now - HOUR, prompt: 'Add search', bash: [{ command: 'npm test', exit: 0 }] });
    const out = runCli(['--since', '24h', '--repo', repo], { home });
    assert.match(out.stdout, /scope: 1 file outside src\/search: deploy\/prod\.sh/);
    assert.match(out.stdout, /suggest: merge — tests pass; review 1 out-of-area file first/);
  });
});
