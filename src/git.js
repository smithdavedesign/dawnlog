// Read-only git queries. Always argument arrays (never a shell), full refs/heads/ names and a
// `--` before paths, so a branch name can't be read as an option or a file.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HEADS = 'refs/heads/';

export function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('git was not found on PATH');
    throw err;
  }
}

/** Realpath of `p`, or of its deepest existing ancestor plus the rest (the dir may be gone). */
export function realPath(p) {
  const resolved = path.resolve(p);
  const rest = [];
  for (let dir = resolved; ; dir = path.dirname(dir)) {
    try {
      return path.join(fs.realpathSync(dir), ...rest);
    } catch {
      if (path.dirname(dir) === dir) return resolved;
      rest.unshift(path.basename(dir));
    }
  }
}

/** Top-level directory of the repository containing `dir`, or null. */
export function repoRoot(dir) {
  try {
    return realPath(git(dir, ['rev-parse', '--show-toplevel']).trim());
  } catch (err) {
    if (typeof err.status === 'number') return null; // git ran and said no
    throw err;
  }
}

/** @returns {Map<string, number>} local branch name → tip commit time (ms) */
export function listBranches(repo) {
  const out = git(repo, ['for-each-ref', '--format=%(refname)%00%(committerdate:unix)', HEADS]);
  const branches = new Map();
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [ref, time] = line.split('\0');
    branches.set(ref.slice(HEADS.length), Number(time) * 1000);
  }
  return branches;
}

/** origin's default branch, else main / master / trunk / develop, else null. */
export function detectBase(repo, branches) {
  try {
    const ref = git(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']).trim();
    const name = ref.replace(/^refs\/remotes\/origin\//, '');
    if (branches.has(name)) return name;
  } catch {
    // no origin/HEAD: fall through to the usual names
  }
  return ['main', 'master', 'trunk', 'develop'].find((name) => branches.has(name)) ?? null;
}

/** @returns {{ path: string, branch: string | null }[]} the main worktree first */
export function listWorktrees(repo) {
  const worktrees = [];
  for (const line of git(repo, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) worktrees.push({ path: realPath(line.slice('worktree '.length)), branch: null });
    else if (line.startsWith(`branch ${HEADS}`) && worktrees.length) worktrees.at(-1).branch = line.slice(`branch ${HEADS}`.length);
  }
  return worktrees;
}

/** Commits on `branch` that are not on `base`, newest first. */
export function branchCommits(repo, base, branch) {
  const out = git(repo, ['log', '--format=%H%x1f%ct%x1f%s', `${HEADS}${base}..${HEADS}${branch}`, '--']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, time, ...subject] = line.split('\x1f');
      return { sha, at: Number(time) * 1000, subject: subject.join('\x1f') };
    });
}

/**
 * Files changed on `branch` since it left `base` (merge-base diff), or null when there is no
 * merge base (orphan branch).
 * @returns {{ path: string, added: number, deleted: number }[] | null}
 */
export function branchFiles(repo, base, branch) {
  let out;
  try {
    out = git(repo, ['diff', '--numstat', '-z', '--no-renames', `${HEADS}${base}...${HEADS}${branch}`, '--']);
  } catch (err) {
    if (/no merge base/i.test(String(err.stderr ?? ''))) return null;
    throw err;
  }
  return out
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [added, deleted, ...file] = entry.split('\t');
      // Binary files report "-" for both counts.
      return { path: file.join('\t'), added: Number(added) || 0, deleted: Number(deleted) || 0 };
    });
}
