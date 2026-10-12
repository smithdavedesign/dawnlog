// Unit tests for Entire checkpoint reading and trailer linking.
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { isEntireBranch, loadCheckpoints, remoteSessions, sessionBranches } from '../src/entire.js';
import { branchCommits, readBlobs } from '../src/git.js';
import { HOUR, addEntireCheckpoints, cleanup, makeRepo, sessionJsonl } from './helpers.js';

after(cleanup);

describe('Entire', () => {
  test('isEntireBranch', () => {
    assert.ok(isEntireBranch('entire/checkpoints/v1'));
    assert.ok(isEntireBranch('entire/3f2a1b-wt1'));
    assert.ok(!isEntireBranch('entirely-new'));
    assert.ok(!isEntireBranch('feature/entire'));
  });

  test('no metadata branch: nothing read, nothing noted', () => {
    assert.deepEqual(loadCheckpoints(makeRepo()), { ref: null, sessions: [], refBackend: false, unreadable: 0 });
  });

  test('reads session metadata per checkpoint folder; bad JSON and missing session_id are counted', () => {
    const repo = makeRepo();
    addEntireCheckpoints(repo, [
      { id: 'a3b2c4d5e6f7', sessions: [{ session_id: 's1', branch: 'feat', created_at: '2026-10-11T01:00:00Z', files_touched: ['a.js'], transcript: '{}\n' }, { session_id: 's2' }] },
      { id: 'ffff00000000', sessions: [{ raw: 'nope' }, { raw: '{"branch":"x"}' }] },
    ]);
    const loaded = loadCheckpoints(repo);
    assert.equal(loaded.ref, 'refs/heads/entire/checkpoints/v1');
    assert.equal(loaded.unreadable, 2);
    assert.deepEqual(
      loaded.sessions.map((s) => [s.checkpoint, s.index, s.sessionId, s.branch, s.createdAt, s.filesTouched, s.transcript, s.agent]),
      [
        ['a3b2c4d5e6f7', 0, 's1', 'feat', Date.parse('2026-10-11T01:00:00Z'), ['a.js'], 'a3/b2c4d5e6f7/0/full.jsonl', 'Claude Code'],
        ['a3b2c4d5e6f7', 1, 's2', '', null, [], null, 'Claude Code'],
      ],
    );
  });

  test('trailers link checkpoints to branches, and so sessions to branches', () => {
    const now = Date.now();
    const repo = makeRepo({
      branches: [
        { name: 'one', commits: [{ at: now - HOUR, files: { 'a.txt': 'a\n' }, message: 'A\n\nEntire-Checkpoint: a3b2c4d5e6f7' }] },
        { name: 'two', commits: [{ at: now - HOUR, files: { 'b.txt': 'b\n' }, message: 'B\n\nEntire-Checkpoint: a3b2c4d5e6f7\nEntire-Checkpoint: 0123456789ab' }] },
      ],
    });
    assert.deepEqual(branchCommits(repo, 'main', 'two')[0].checkpoints, ['a3b2c4d5e6f7', '0123456789ab']);
    assert.deepEqual(branchCommits(repo, 'main', 'one')[0].subject, 'A');
    addEntireCheckpoints(repo, [
      { id: 'a3b2c4d5e6f7', sessions: [{ session_id: 'shared' }] },
      { id: '0123456789ab', sessions: [{ session_id: 'only-two' }] },
      { id: '999999999999', sessions: [{ session_id: 'unlinked' }] },
    ]);
    const links = sessionBranches(loadCheckpoints(repo), new Map(['one', 'two'].map((b) => [b, branchCommits(repo, 'main', b)])));
    assert.deepEqual(Object.fromEntries(links), {
      shared: { branches: ['one', 'two'], checkpoint: 'a3b2c4d5e6f7' },
      'only-two': { branches: ['two'], checkpoint: '0123456789ab' },
    });
  });

  test('remote sessions: only ones not on this machine, Claude Code agents, in the window', () => {
    const now = Date.now();
    const repo = makeRepo();
    const t = (id, start) => sessionJsonl({ id, cwd: '/elsewhere', start, prompt: `task ${id}` });
    const iso = (ms) => new Date(ms).toISOString();
    addEntireCheckpoints(repo, [
      { id: 'aaaaaaaaaaa1', sessions: [{ session_id: 'remote', created_at: iso(now - HOUR), transcript: t('remote', now - 2 * HOUR) }] },
      { id: 'aaaaaaaaaaa2', sessions: [{ session_id: 'local', created_at: iso(now - HOUR), transcript: t('local', now - 2 * HOUR) }] },
      { id: 'aaaaaaaaaaa3', sessions: [{ session_id: 'old', created_at: iso(now - 50 * HOUR), transcript: t('old', now - 51 * HOUR) }] },
      { id: 'aaaaaaaaaaa4', sessions: [{ session_id: 'codex', agent: 'Codex', created_at: iso(now - HOUR), transcript: '{}\n' }] },
    ]);
    const { sessions } = remoteSessions(repo, loadCheckpoints(repo), new Set(['local']), now - 24 * HOUR);
    assert.deepEqual(sessions.map((s) => [s.id, s.file, s.task, s.origin]), [['remote', 'entire:aaaaaaaaaaa1/0/full.jsonl', 'task remote', 'entire']]);
  });

  test('readBlobs reads many blobs in one call and skips missing ones', () => {
    const repo = makeRepo();
    addEntireCheckpoints(repo, [{ id: 'abcdefabcdef', sessions: [{ session_id: 's', transcript: 'line one\nline two\n' }] }]);
    const blobs = readBlobs(repo, 'refs/heads/entire/checkpoints/v1', ['ab/cdefabcdef/0/full.jsonl', 'nope/missing', 'ab/cdefabcdef/0/prompt.txt']);
    assert.deepEqual(Object.fromEntries(blobs), { 'ab/cdefabcdef/0/full.jsonl': 'line one\nline two\n', 'ab/cdefabcdef/0/prompt.txt': 'prompt\n' });
  });
});
