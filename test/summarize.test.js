// Unit tests for --summarize: the prompt, and how failures are reported.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FAKE } from './fake-secrets.js';
import { MAX_SUMMARIES, promptFor, summarize } from '../src/summarize.js';

const receipt = (branch, over = {}) => ({
  branch,
  status: 'FAILED',
  suggestion: { action: 'fix', reason: 'the last test run failed' },
  task: `Fix it with ${FAKE.stripe}`,
  lastTest: { command: 'npm test', exitCode: 1, ok: false },
  retries: 2,
  risk: ['auth'],
  commits: [{ subject: 'Fix redirect' }],
  files: [{ path: 'src/auth.js', added: 3, deleted: 1 }],
  deferred: [{ text: 'Rotate the key' }],
  sessions: [{ session: { finalText: `I could not finish. ${FAKE.slack}` } }],
  ...over,
});

describe('promptFor', () => {
  test('carries the facts, redacted, and the final message', () => {
    const prompt = promptFor(receipt('fix-login'));
    for (const fact of ['Branch: fix-login', 'Status: FAILED (overnight-receipts suggests fix: the last test run failed)', 'Last test: npm test → 1', 'Retries: 2', 'Risk: auth', 'Commits: Fix redirect', 'Files: src/auth.js +3 -1', 'Agent left for the reviewer: Rotate the key', "Agent's final message:"]) {
      assert.ok(prompt.includes(fact), fact);
    }
    assert.ok(!prompt.includes(FAKE.stripe));
    assert.ok(!prompt.includes(FAKE.slack));
  });

  test('a receipt without a session still makes a prompt', () => {
    const prompt = promptFor(receipt('manual', { sessions: [], task: '', lastTest: null, deferred: [], files: null }));
    assert.match(prompt, /Task: \(no prompt found\)/);
    assert.match(prompt, /Last test: none/);
    assert.doesNotMatch(prompt, /final message/);
  });
});

describe('summarize', () => {
  test(`summarises at most ${MAX_SUMMARIES} receipts and notes the rest`, () => {
    const report = { receipts: Array.from({ length: MAX_SUMMARIES + 2 }, (_, i) => receipt(`b${i}`)) };
    let calls = 0;
    summarize(report, { run: () => (calls++, { text: 'ok' }) });
    assert.equal(calls, MAX_SUMMARIES);
    assert.equal(report.receipts.filter((r) => r.summary === 'ok').length, MAX_SUMMARIES);
    assert.equal(report.receipts.at(-1).summary, null);
    assert.deepEqual(report.summaryFailures, [`only the first ${MAX_SUMMARIES} receipts were summarised (2 more)`]);
  });

  test('identical failures are grouped', () => {
    const report = { receipts: [receipt('a'), receipt('b'), receipt('c')] };
    let n = 0;
    summarize(report, { run: () => (n++ === 1 ? { text: 'fine' } : { error: 'claude timed out after 120s' }) });
    assert.deepEqual(report.summaryFailures, ['claude timed out after 120s (2 receipts)']);
    assert.deepEqual(report.receipts.map((r) => r.summary), [null, 'fine', null]);
  });
});
