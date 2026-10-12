// PRD success metric: receipts in under 5 s for 100 session files.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { buildReport } from '../src/report.js';
import { HOUR, MIN, cleanup, makeHome, makeRepo, writeSession } from './helpers.js';

after(cleanup);

test('100 session files (40 Bash runs each) across 10 branches build in under 5 s', () => {
  const now = Date.now();
  const names = Array.from({ length: 10 }, (_, i) => `branch-${i}`);
  const repo = makeRepo({ branches: names.map((name, i) => ({ name, commits: [{ at: now - (i + 1) * HOUR, files: { [`src/${name}.js`]: 'x\n' } }] })) });
  const { projects } = makeHome();
  const bash = Array.from({ length: 40 }, (_, i) => ({ command: i % 5 ? `ls src/${i}` : 'npm test', exit: i % 7 === 0 ? 1 : 0, output: 'x'.repeat(2000) }));
  for (let i = 0; i < 100; i++) {
    writeSession(projects, { id: `perf${String(i).padStart(4, '0')}-0000-4000-8000-000000000000`, cwd: repo, gitBranch: names[i % 10], start: now - 20 * HOUR + i * 5 * MIN, prompt: `task ${i}`, bash });
  }
  const started = performance.now();
  const report = buildReport({ repo, projects, since: now - 24 * HOUR });
  const ms = performance.now() - started;
  assert.equal(report.sessionCount, 100);
  assert.equal(report.receipts.length, 10);
  assert.ok(ms < 5000, `took ${Math.round(ms)} ms`);
});
