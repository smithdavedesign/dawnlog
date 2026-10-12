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
//   one receipt per branch with commits ahead of base changed in the window, or matched by a
//   session, ranked worst first (src/triage.js) with a merge / fix / kill suggestion
//
// When the repo has Entire's metadata branch, its Entire-Checkpoint commit trailers are rule 0
// (via entire), and sessions Entire stored from other machines are read too (src/entire.js).
//
// Every receipt carries `sources`: for each field, the transcript `file:line` it came from, or
// `git:<base>...<branch>` for fields read from git, or null when there's nothing to point at.
import path from 'node:path';
import { extractDeferred } from './deferred.js';
import * as entire from './entire.js';
import * as git from './git.js';
import { loadSessions, verdict } from './sessions.js';
import { STATUS_ORDER, compareReceipts, scopeOf, suggest } from './triage.js';

export { STATUS_ORDER };

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
  const linked = ctx.entireLinks.get(session.id);
  if (linked?.branches.length === 1) return { branch: linked.branches[0], via: 'entire', checkpoint: linked.checkpoint };

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
  if (linked) return { reason: `Entire checkpoint ${linked.checkpoint} is on several branches: ${linked.branches.join(', ')}` };

  if (named) return { reason: `branch "${named}" not found (deleted or renamed?)` };
  if (session.branches.includes(ctx.base)) return { reason: `ran on base branch ${ctx.base} with no branch commits during the session` };
  return { reason: 'no branch recorded and no commits during the session' };
}

export const at = (file, line) => (file && line ? `${file}:${line}` : null);

function matchSource(match, session, ctx, branch) {
  if (match.via === 'gitBranch') return at(session.file, session.branchLines[branch]);
  if (match.via === 'entire') return `git:${ctx.entireRef}:${match.checkpoint.slice(0, 2)}/${match.checkpoint.slice(2)}`;
  if (match.via === 'worktree') return `git:worktree ${branch}`;
  return `git:${ctx.base}...${branch}`;
}

/**
 * @param {{ repo: string, projects: string | null, since: number, base?: string }} options
 *   projects: the Claude Code projects folder, or null when it doesn't exist (Entire-only)
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
  const loaded = projects ? loadSessions(projects, since) : { sessions: [], unreadableLines: 0, emptyFiles: 0 };
  const inRepo = [];
  let otherProjectSessions = 0;
  for (const session of loaded.sessions) {
    if (sessionDirs(session).some((d) => repoDirs.some((r) => isInside(d, r)))) inRepo.push(session);
    else otherProjectSessions++;
  }

  const checkpoints = entire.loadCheckpoints(root);
  let remote = { sessions: [], unreadableLines: 0 };
  if (checkpoints.ref) {
    remote = entire.remoteSessions(root, checkpoints, new Set(loaded.sessions.map((s) => s.id)), since);
    inRepo.push(...remote.sessions);
  }
  inRepo.sort((a, b) => a.start - b.start);

  const commits = new Map();
  const commitsOf = (branch) => {
    if (!commits.has(branch)) commits.set(branch, git.branchCommits(root, base, branch));
    return commits.get(branch);
  };
  for (const name of [...branches.keys()]) if (entire.isEntireBranch(name)) branches.delete(name);
  const windowBranches = [...branches]
    .filter(([name, tip]) => name !== base && tip >= since)
    .map(([name]) => name)
    .sort(byName);
  const entireLinks = checkpoints.ref ? entire.sessionBranches(checkpoints, new Map(windowBranches.map((b) => [b, commitsOf(b)]))) : new Map();

  const ctx = { root, base, branches, worktrees, windowBranches, commitsOf, entireLinks, entireRef: checkpoints.ref };
  // A window branch with nothing ahead of base is already merged (or empty): no receipt unless a session ran on it.
  const merged = windowBranches.filter((name) => commitsOf(name).length === 0);
  const matched = new Map(windowBranches.filter((name) => !merged.includes(name)).map((name) => [name, []]));
  const unmatched = [];
  for (const session of inRepo) {
    const match = matchSession(session, ctx);
    if (match.branch) {
      if (!matched.has(match.branch)) matched.set(match.branch, []);
      matched.get(match.branch).push({ session, via: match.via, source: matchSource(match, session, ctx, match.branch) });
    } else {
      unmatched.push({ session, reason: match.reason });
    }
  }

  let squashMerged = 0;
  const receipts = [];
  for (const [branch, sessions] of matched) {
    const runs = sessions.flatMap((s) => s.session.runs).sort((a, b) => a.at - b.at);
    const { status, run } = verdict(runs);
    const files = git.branchFiles(root, base, branch);
    const inBase = files !== null && git.landedInBase(root, base, branch, files.map((f) => f.path));
    if (inBase && !sessions.length) {
      squashMerged++;
      continue;
    }
    const first = sessions[0]?.session;
    const last = sessions.at(-1)?.session;
    const deferred = last ? extractDeferred(last.finalText).map((item) => ({ ...item, source: at(last.file, last.finalLine) })) : [];
    const retrySession = sessions.find((s) => s.session.firstRetryLine)?.session;
    const { area, outside } = scopeOf(files, first?.task ?? '');
    const gitSource = `git:${base}...${branch}`;
    const receipt = {
      branch,
      status,
      lastTest: run,
      sessions,
      task: first?.task ?? '',
      commits: commitsOf(branch),
      files,
      added: (files ?? []).reduce((sum, f) => sum + f.added, 0),
      deleted: (files ?? []).reduce((sum, f) => sum + f.deleted, 0),
      retries: sessions.reduce((sum, s) => sum + s.session.retries, 0),
      risk: files ? riskOf(files.map((f) => f.path)) : [],
      area,
      outside,
      deferred,
      inBase,
    };
    receipt.sources = {
      branch: `git:refs/heads/${branch}`,
      status: run ? at(run.file, run.line) : null,
      tests: run ? at(run.file, run.line) : null,
      task: first ? at(first.file, first.taskLine) : null,
      sessions: sessions.length ? sessions.map((s) => s.source) : null,
      commits: gitSource,
      files: gitSource,
      retries: retrySession ? at(retrySession.file, retrySession.firstRetryLine) : null,
      risk: gitSource,
      outside: gitSource,
      deferred: deferred.length ? deferred[0].source : null,
    };
    receipt.suggestion = suggest(receipt);
    receipt.sources.suggestion = receipt.sources[receipt.suggestion.field] ?? null;
    if (Array.isArray(receipt.sources.suggestion)) receipt.sources.suggestion = receipt.sources.suggestion[0];
    receipts.push(receipt);
  }
  receipts.sort(compareReceipts);

  return {
    repo: root,
    base,
    since,
    receipts,
    unmatched,
    sessionCount: inRepo.length,
    otherProjectSessions,
    unreadableLines: loaded.unreadableLines + remote.unreadableLines,
    emptyFiles: loaded.emptyFiles,
    mergedBranches: merged.filter((name) => !matched.has(name)).length + squashMerged,
    entire: checkpoints.ref
      ? { ref: checkpoints.ref, sessions: checkpoints.sessions.length, remoteSessions: remote.sessions.length, unreadable: checkpoints.unreadable }
      : checkpoints.refBackend
        ? { ref: null, refBackend: true }
        : null,
  };
}
