// `npm run demo`: builds a throwaway repo + fake ~/.claude in a temp dir, runs dawnlog on it,
// prints the terminal and Markdown receipts, then deletes everything. Touches nothing of yours.
import fs from 'node:fs';
import path from 'node:path';
import { HOUR, MIN, cleanup, makeHome, makeRepo, runCli, tmpDir, writeSession } from '../test/helpers.js';

const now = Date.now();
try {
  const repo = makeRepo({
    branches: [
      { name: 'add-search', commits: [{ at: now - 5 * HOUR + 3 * MIN, files: { 'src/search.js': 'export const search = 1;\n' }, message: 'Add search endpoint' }] },
      { name: 'db-users', commits: [{ at: now - 3 * HOUR + 3 * MIN, files: { 'db/migrations/001_users.sql': 'create table users (id int);\n' }, message: 'Add users table' }] },
      {
        name: 'fix-login',
        commits: [{ at: now - 9 * HOUR + 3 * MIN, files: { 'src/auth/redirect.js': 'export const go = 1;\n', 'package-lock.json': '{}\n' }, message: 'Fix redirect loop' }],
      },
    ],
  });
  const { home, projects } = makeHome();
  writeSession(projects, {
    id: 'aaaa1111-0000-4000-8000-000000000001',
    cwd: repo,
    gitBranch: 'fix-login',
    start: now - 9 * HOUR,
    prompt: 'Fix the login redirect loop. Token for the staging API: sk-ant-api03-DEMOdemoDEMOdemo1234',
    bash: [
      { command: 'npm test', exit: 1 },
      { command: 'npm test', exit: 1 },
      { command: 'npm test', exit: 1 },
    ],
  });
  writeSession(projects, { id: 'bbbb2222-0000-4000-8000-000000000002', cwd: repo, gitBranch: 'add-search', start: now - 5 * HOUR, prompt: 'Add a search endpoint', bash: [{ command: 'npm test 2>&1 | tail -20', exit: 0 }] });
  writeSession(projects, { id: 'cccc3333-0000-4000-8000-000000000003', cwd: repo, start: now - 3 * HOUR, prompt: 'Create the users table migration' });
  writeSession(projects, { id: 'dddd4444-0000-4000-8000-000000000004', cwd: repo, gitBranch: 'spike-cache', start: now - 2 * HOUR, prompt: 'Try a caching spike' });
  const outFile = path.join(tmpDir('demo-out'), 'dawnlog.md');
  const { code, stdout, stderr } = runCli(['--since', '24h', '--repo', repo, '--out', outFile], { home });
  process.stdout.write(`$ dawnlog --since 24h --out dawnlog.md   (exit ${code})\n\n${stdout}${stderr}`);
  process.stdout.write(`\n----- dawnlog.md -----\n\n${fs.readFileSync(outFile, 'utf8')}`);
} finally {
  cleanup();
}
