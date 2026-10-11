// Builds the morning report: sessions in the window, matched to the repo's branches.
//
//   sessions in window ──▶ keep those whose cwd is inside the repo or one of its worktrees
//          │
//          ▼  match each session, first rule that applies:
//     1. last gitBranch recorded (ignoring base) that exists      → via gitBranch
//     2. linked worktree containing the cwd, on a non-base branch → via worktree
//     3. only branch with the most commits during the session     → via commit times
//     4. otherwise Unmatched, with the reason (never dropped, never guessed)
//          │
//          ▼
//   one receipt per branch changed in the window or matched by a session,
//   ranked FAILED > UNVERIFIED > PASSED, then by branch name
import path from 'node:path';
import * as git from './git.js';
import { loadSessions, verdict } from './sessions.js';

export const STATUS_ORDER = ['FAILED', 'UNVERIFIED', 'PASSED'];

// Commits this close to a session's span count as made during it.
const COMMIT_SLACK_BEFORE_MS = 2 * 60_000;
const COMMIT_SLACK_AFTER_MS = 10 * 60_000;

export const RISKS = [
  [
    'dependency',
    /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Pipfile(?:\.lock)?|uv\.lock|Cargo\.(?:toml|lock)|go\.(?:mod|sum)|Gemfile(?:\.lock)?|composer\.(?:json|lock))$/,
  ],
  ['data', /(?:^|\/)(?:migrations?|migrate)\/|\.sql$|(?:^|\/)schema\.prisma$/i],
  ['auth', /(?:^|[/_.-])(?:auth|authn|authz|authentication|authori[sz]ation|authori[sz]e|oauth2?|login|logout|passwords?|jwt|sso|saml|permissions?|rbac)(?:[/_.-]|$)/i],
  ['payments', /(?:^|[/_.-])(?:payments?|billing|stripe|checkout|invoices?|subscriptions?)(?:[/_.-]|$)/i],
];

/** Risk labels for a set of changed paths, in RISKS order. */
export function riskOf(paths) {
  return RISKS.filter(([, pattern]) => paths.some((p) => pattern.test(p))).map(([name]) => name);
}

const isInside = (child, dir) => child === dir || child.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function sessionDirs(session) {
  return [...new Set(session.cwds.flatMap((cwd) => [path.resolve(cwd), git.realPath(cwd)]))];
}

function matchSession(session, ctx) {
  const named = session.branches.filter((b) => b !== ctx.base).at(-1);
  if (named && ctx.branches.has(named)) return { branch: named, via: 'gitBranch' };

  const dirs = sessionDirs(session);
  const worktree = ctx.worktrees
    .filter((w) => w.path !== ctx.root && dirs.some((d) => isInside(d, w.path)))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (worktree?.branch && worktree.branch !== ctx.base && ctx.branches.has(worktree.branch)) return { branch: worktree.branch, via: 'worktree' };

  const from = session.start - COMMIT_SLACK_BEFORE_MS;
  const to = session.end + COMMIT_SLACK_AFTER_MS;
  const hits = ctx.windowBranches
    .map((branch) => [branch, ctx.commitsOf(branch).filter((c) => c.at >= from && c.at <= to).length])
    .filter(([, count]) => count > 0);
  const most = Math.max(0, ...hits.map(([, count]) => count));
  const best = hits.filter(([, count]) => count === most).map(([branch]) => branch);
  if (best.length === 1) return { branch: best[0], via: 'commit times' };
  if (best.length > 1) return { reason: `commits during the session on several branches: ${best.sort(byName).join(', ')}` };

  if (named) return { reason: `branch "${named}" not found (deleted or renamed?)` };
  if (session.branches.includes(ctx.base)) return { reason: `ran on base branch ${ctx.base} with no branch commits during the session` };
  return { reason: 'no branch recorded and no commits during the session' };
}

/**
 * @param {{ repo: string, projects: string, since: number, base?: string }} options
 */
export function buildReport({ repo, projects, since, base: baseOption }) {
  const root = git.repoRoot(repo);
  if (!root) throw new Error(`not a git repository: ${repo} (use --repo PATH)`);
  const branches = git.listBranches(root);
  if (baseOption !== undefined && !branches.has(baseOption)) throw new Error(`base branch "${baseOption}" not found in ${root}`);
  const base = baseOption ?? git.detectBase(root, branches);
  if (!base) throw new Error(`could not find a base branch (main or master) in ${root}; pass --base BRANCH`);

  const worktrees = git.listWorktrees(root);
  const repoDirs = [root, ...worktrees.map((w) => w.path)];
  const loaded = loadSessions(projects, since);
  const inRepo = [];
  let otherProjectSessions = 0;
  for (const session of loaded.sessions) {
    if (sessionDirs(session).some((d) => repoDirs.some((r) => isInside(d, r)))) inRepo.push(session);
    else otherProjectSessions++;
  }
  inRepo.sort((a, b) => a.start - b.start);

  const commits = new Map();
  const commitsOf = (branch) => {
    if (!commits.has(branch)) commits.set(branch, git.branchCommits(root, base, branch));
    return commits.get(branch);
  };
  const windowBranches = [...branches]
    .filter(([name, tip]) => name !== base && tip >= since)
    .map(([name]) => name)
    .sort(byName);

  const ctx = { root, base, branches, worktrees, windowBranches, commitsOf };
  const matched = new Map(windowBranches.map((name) => [name, []]));
  const unmatched = [];
  for (const session of inRepo) {
    const match = matchSession(session, ctx);
    if (match.branch) {
      if (!matched.has(match.branch)) matched.set(match.branch, []);
      matched.get(match.branch).push({ session, via: match.via });
    } else {
      unmatched.push({ session, reason: match.reason });
    }
  }

  const receipts = [...matched].map(([branch, sessions]) => {
    const runs = sessions.flatMap((s) => s.session.runs).sort((a, b) => a.at - b.at);
    const { status, run } = verdict(runs);
    const files = git.branchFiles(root, base, branch);
    return {
      branch,
      status,
      lastTest: run,
      sessions,
      task: sessions[0]?.session.task ?? '',
      commits: commitsOf(branch),
      files,
      added: (files ?? []).reduce((sum, f) => sum + f.added, 0),
      deleted: (files ?? []).reduce((sum, f) => sum + f.deleted, 0),
      retries: sessions.reduce((sum, s) => sum + s.session.retries, 0),
      risk: files ? riskOf(files.map((f) => f.path)) : [],
    };
  });
  receipts.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byName(a.branch, b.branch));

  return {
    repo: root,
    base,
    since,
    receipts,
    unmatched,
    sessionCount: inRepo.length,
    otherProjectSessions,
    unreadableLines: loaded.unreadableLines,
    emptyFiles: loaded.emptyFiles,
  };
}
