// Triage: the merge / fix / kill suggestion, the ranking, and "files outside the task's area".
//
// Suggestion, first rule that applies (each comes with the reason it fired):
//   kill   no commits ahead of base: nothing to merge
//   kill   already landed in base by a squash or rebase merge (a session ran on it since)
//   kill   FAILED after 5+ retries: the agent thrashed, a fresh start is cheaper than a fix
//   fix    no merge base with base (orphan branch)
//   fix    FAILED: the last test/lint run failed
//   fix    UNVERIFIED: no passing test run on record, so it can't be merged blind
//   fix    PASSED, but the agent left items for you
//   merge  PASSED (with "review … first" when risky paths or out-of-area files changed)
//
// Ranking, worst first: status (FAILED > UNVERIFIED > PASSED), then risky before not, then
// more risk labels, then more retries, then more needs-you items, then branch name.

export const STATUS_ORDER = ['FAILED', 'UNVERIFIED', 'PASSED'];
export const ACTIONS = ['merge', 'fix', 'kill'];
export const THRASH_RETRIES = 5;

const plural = (n, word) => `${n} ${n === 1 ? word : `${word.replace(/(?:(ch|sh|s|x)|([^aeiou])y)$/, (m, sib, c) => (sib ? `${m}e` : `${c}ie`))}s`}`;

/** @returns {{ action: 'merge' | 'fix' | 'kill', reason: string, field: string }} field = what drove it */
export function suggest(r) {
  if (!r.commits.length) return { action: 'kill', reason: 'nothing to merge: no commits ahead of base', field: 'commits' };
  if (r.inBase) return { action: 'kill', reason: 'already in base (squash- or rebase-merged)', field: 'files' };
  if (r.status === 'FAILED' && r.retries >= THRASH_RETRIES) {
    return { action: 'kill', reason: `tests still fail after ${plural(r.retries, 'retry')}: restart with a clearer task`, field: 'retries' };
  }
  if (!r.files) return { action: 'fix', reason: 'no merge base with the base branch', field: 'commits' };
  if (r.status === 'FAILED') return { action: 'fix', reason: 'the last test run failed', field: 'status' };
  if (r.status === 'UNVERIFIED') {
    const why = r.lastTest?.masked ? 'test exit status was hidden by a pipe' : r.lastTest ? 'the last test run has no result' : 'no test run on record';
    return { action: 'fix', reason: `${why}: run the tests before merging`, field: 'status' };
  }
  if (r.deferred.length) return { action: 'fix', reason: `the agent left ${plural(r.deferred.length, 'item')} for you`, field: 'deferred' };
  const review = [...r.risk];
  if (r.outside.length) review.push(`${plural(r.outside.length, 'out-of-area file')}`);
  return { action: 'merge', reason: review.length ? `tests pass; review ${review.join(', ')} first` : 'tests pass', field: 'status' };
}

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function compareReceipts(a, b) {
  return (
    STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
    Number(b.risk.length > 0) - Number(a.risk.length > 0) ||
    b.risk.length - a.risk.length ||
    b.retries - a.retries ||
    b.deferred.length - a.deferred.length ||
    byName(a.branch, b.branch)
  );
}

/** `src/auth/login.js` → `src/auth`; `src/x.js` → `src`; `README.md` → `.` */
export function areaOf(file) {
  const parts = file.split('/');
  if (parts.length === 1) return '.';
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/');
}

/**
 * The task's area and the changed files outside it. The area is the directories the task
 * prompt names (when it names any that changed); otherwise the directory with the most changed
 * lines plus any with at least half as many. One-area branches have nothing outside.
 * @param {{ path: string, added: number, deleted: number }[]} files
 * @returns {{ area: string[], outside: string[] }}
 */
export function scopeOf(files, task = '') {
  if (!files?.length) return { area: [], outside: [] };
  const weight = new Map();
  for (const f of files) weight.set(areaOf(f.path), (weight.get(areaOf(f.path)) ?? 0) + Math.max(1, f.added + f.deleted));
  if (weight.size < 2) return { area: [...weight.keys()], outside: [] };
  const named = [...weight.keys()].filter((a) => a !== '.' && new RegExp(`(?:^|[\\s\`'"(/])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/|\\b)`).test(task));
  let area;
  if (named.length) area = named;
  else {
    const top = Math.max(...weight.values());
    area = [...weight].filter(([, w]) => w * 2 >= top).map(([a]) => a);
  }
  const inArea = new Set(area);
  const outside = files.map((f) => f.path).filter((p) => !inArea.has(areaOf(p)) && ![...inArea].some((a) => p.startsWith(`${a}/`)));
  return { area: area.sort(byName), outside };
}
