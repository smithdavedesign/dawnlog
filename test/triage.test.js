// Merge / fix / kill suggestion, ranking, and "files outside the task's area".
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { areaOf, compareReceipts, scopeOf, suggest, THRASH_RETRIES } from '../src/triage.js';

const receipt = (over = {}) => ({
  branch: 'b',
  status: 'PASSED',
  lastTest: { masked: false },
  commits: [{ subject: 'x' }],
  files: [{ path: 'src/a.js', added: 1, deleted: 0 }],
  retries: 0,
  risk: [],
  outside: [],
  deferred: [],
  ...over,
});

describe('suggest', () => {
  test('no commits → kill, whatever the status', () => {
    for (const status of ['FAILED', 'UNVERIFIED', 'PASSED']) assert.equal(suggest(receipt({ status, commits: [] })).action, 'kill');
  });

  test(`FAILED with ${THRASH_RETRIES}+ retries → kill; fewer → fix`, () => {
    assert.equal(suggest(receipt({ status: 'FAILED', retries: THRASH_RETRIES })).action, 'kill');
    assert.match(suggest(receipt({ status: 'FAILED', retries: THRASH_RETRIES })).reason, /5 retries/);
    assert.equal(suggest(receipt({ status: 'FAILED', retries: THRASH_RETRIES - 1 })).action, 'fix');
  });

  test('orphan branch → fix', () => {
    assert.deepEqual(suggest(receipt({ files: null })), { action: 'fix', reason: 'no merge base with the base branch', field: 'commits' });
  });

  test('UNVERIFIED → fix, saying why', () => {
    assert.match(suggest(receipt({ status: 'UNVERIFIED', lastTest: { masked: true } })).reason, /hidden by a pipe/);
    assert.match(suggest(receipt({ status: 'UNVERIFIED', lastTest: null })).reason, /no test run on record/);
    assert.match(suggest(receipt({ status: 'UNVERIFIED', lastTest: { masked: false } })).reason, /no result/);
  });

  test('PASSED with items left for you → fix; otherwise merge, flagging risk and scope', () => {
    assert.deepEqual(suggest(receipt({ deferred: [{}, {}] })), { action: 'fix', reason: 'the agent left 2 items for you', field: 'deferred' });
    assert.equal(suggest(receipt()).reason, 'tests pass');
    assert.equal(suggest(receipt({ risk: ['auth', 'payments'], outside: ['x'] })).reason, 'tests pass; review auth, payments, 1 out-of-area file first');
  });

  test('never suggests merge unless PASSED', () => {
    for (const status of ['FAILED', 'UNVERIFIED']) assert.notEqual(suggest(receipt({ status })).action, 'merge');
  });
});

describe('compareReceipts', () => {
  const rank = (list) => [...list].sort(compareReceipts).map((r) => r.branch);

  test('status first, then risky before not, then more risks, more retries, more items, name', () => {
    assert.deepEqual(
      rank([
        receipt({ branch: 'pass', status: 'PASSED' }),
        receipt({ branch: 'unv', status: 'UNVERIFIED' }),
        receipt({ branch: 'fail-z', status: 'FAILED' }),
        receipt({ branch: 'fail-a', status: 'FAILED' }),
        receipt({ branch: 'fail-retries', status: 'FAILED', retries: 3 }),
        receipt({ branch: 'fail-risk', status: 'FAILED', risk: ['data'] }),
        receipt({ branch: 'fail-2risk', status: 'FAILED', risk: ['data', 'auth'] }),
        receipt({ branch: 'pass-items', status: 'PASSED', deferred: [{}] }),
      ]),
      ['fail-2risk', 'fail-risk', 'fail-retries', 'fail-a', 'fail-z', 'unv', 'pass-items', 'pass'],
    );
  });
});

describe('scope: files outside the task area', () => {
  test('areaOf', () => {
    assert.equal(areaOf('src/auth/login.js'), 'src/auth');
    assert.equal(areaOf('src/x.js'), 'src');
    assert.equal(areaOf('README.md'), '.');
    assert.equal(areaOf('a/b/c/d.js'), 'a/b');
  });

  test('one area → nothing outside', () => {
    assert.deepEqual(scopeOf([{ path: 'src/a.js', added: 5, deleted: 0 }, { path: 'src/b.js', added: 1, deleted: 0 }]).outside, []);
  });

  test('the heaviest area wins when the task names none', () => {
    const files = [
      { path: 'src/search/index.js', added: 80, deleted: 4 },
      { path: 'src/search/query.js', added: 20, deleted: 0 },
      { path: 'scripts/deploy.sh', added: 3, deleted: 1 },
      { path: 'README.md', added: 2, deleted: 0 },
    ];
    assert.deepEqual(scopeOf(files, 'Add a search endpoint'), { area: ['src/search'], outside: ['scripts/deploy.sh', 'README.md'] });
  });

  test('areas within half of the heaviest count as the task area too', () => {
    const files = [
      { path: 'api/a.js', added: 10, deleted: 0 },
      { path: 'web/b.js', added: 6, deleted: 0 },
      { path: 'infra/c.tf', added: 1, deleted: 0 },
    ];
    assert.deepEqual(scopeOf(files), { area: ['api', 'web'], outside: ['infra/c.tf'] });
  });

  test('directories named in the task prompt define the area', () => {
    const files = [
      { path: 'src/auth/login.js', added: 2, deleted: 0 },
      { path: 'src/ui/big.js', added: 300, deleted: 0 },
    ];
    assert.deepEqual(scopeOf(files, 'Fix the redirect bug in src/auth'), { area: ['src/auth'], outside: ['src/ui/big.js'] });
  });

  test('no files', () => {
    assert.deepEqual(scopeOf(null), { area: [], outside: [] });
    assert.deepEqual(scopeOf([]), { area: [], outside: [] });
  });
});
