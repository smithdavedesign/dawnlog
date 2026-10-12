// Entire (entire.io) checkpoint ingestion, used only when the repo has Entire's metadata branch.
//
// Entire's branch backend keeps one folder per checkpoint on the orphan branch
// `entire/checkpoints/v1`, sharded by the first two hex characters of the 12-hex-char id:
//
//   a3/b2c4d5e6f7/metadata.json        checkpoint: checkpoint_id, branch, files_touched, sessions[]
//   a3/b2c4d5e6f7/0/metadata.json      session: session_id, agent, branch, created_at, files_touched
//   a3/b2c4d5e6f7/0/full.jsonl         the session transcript (Claude Code's own JSONL, pre-redacted)
//
// and adds an `Entire-Checkpoint: a3b2c4d5e6f7` trailer to every commit the agent made. That
// trailer is the strongest session→branch evidence there is, so it's matched before gitBranch.
// Field names follow entireio/cli (e2e/testutil/metadata.go); only those listed are relied on.
// Entire's newer ref backend (refs/entire/checkpoints/<shard>/<id>) isn't read yet: it's noted.
import * as git from './git.js';
import { parseSession } from './sessions.js';

export const METADATA_BRANCH = 'entire/checkpoints/v1';
const CANDIDATE_REFS = [`refs/heads/${METADATA_BRANCH}`, `refs/remotes/origin/${METADATA_BRANCH}`];
const SESSION_META = /^([0-9a-f]{2})\/([0-9a-f]{10})\/(\d+)\/metadata\.json$/;

/** Is `name` a branch Entire manages (metadata, trails or shadow branches), never a receipt? */
export const isEntireBranch = (name) => name === 'entire' || name.startsWith('entire/');

/**
 * @typedef {{ checkpoint: string, index: number, sessionId: string, agent: string, branch: string,
 *   createdAt: number | null, filesTouched: string[], transcript: string | null }} CheckpointSession
 * @returns {{ ref: string | null, sessions: CheckpointSession[], refBackend: boolean, unreadable: number }}
 */
export function loadCheckpoints(repo) {
  const ref = git.resolveRef(repo, CANDIDATE_REFS);
  if (!ref) {
    const refBackend = git.git(repo, ['for-each-ref', '--count=1', '--format=%(refname)', 'refs/entire/checkpoints/']).trim() !== '';
    return { ref: null, sessions: [], refBackend, unreadable: 0 };
  }
  const tree = git.listTree(repo, ref);
  const present = new Set(tree);
  const metaPaths = tree.filter((p) => SESSION_META.test(p));
  const blobs = git.readBlobs(repo, ref, metaPaths);
  const sessions = [];
  let unreadable = 0;
  for (const metaPath of metaPaths) {
    const [, shard, rest, index] = SESSION_META.exec(metaPath);
    let meta;
    try {
      meta = JSON.parse(blobs.get(metaPath) ?? '');
    } catch {
      unreadable++;
      continue;
    }
    if (!meta || typeof meta.session_id !== 'string' || !meta.session_id) {
      unreadable++;
      continue;
    }
    const dir = `${shard}/${rest}/${index}`;
    const createdAt = Date.parse(meta.created_at);
    sessions.push({
      checkpoint: typeof meta.checkpoint_id === 'string' && meta.checkpoint_id ? meta.checkpoint_id : `${shard}${rest}`,
      index: Number(index),
      sessionId: meta.session_id,
      agent: typeof meta.agent === 'string' ? meta.agent : '',
      branch: typeof meta.branch === 'string' ? meta.branch : '',
      createdAt: Number.isNaN(createdAt) ? null : createdAt,
      filesTouched: Array.isArray(meta.files_touched) ? meta.files_touched.filter((f) => typeof f === 'string') : [],
      transcript: present.has(`${dir}/full.jsonl`) ? `${dir}/full.jsonl` : null,
    });
  }
  return { ref, sessions, refBackend: false, unreadable };
}

/** Entire records which agent ran; only Claude Code transcripts can be parsed. Unknown is tried. */
const isClaudeCode = (agent) => !agent || /claude/i.test(agent);

/**
 * Sessions that Entire stored but that aren't on this machine (another laptop, a cloud runner),
 * parsed from their full.jsonl. Their `file` is `entire:<checkpoint>/<n>/full.jsonl`.
 * @param {Set<string>} localIds session ids already read from ~/.claude/projects
 */
export function remoteSessions(repo, loaded, localIds, since) {
  const wanted = new Map();
  for (const s of loaded.sessions) {
    if (!s.transcript || localIds.has(s.sessionId) || !isClaudeCode(s.agent)) continue;
    if (s.createdAt !== null && s.createdAt < since) continue;
    // A session can span checkpoints; the last one stored holds the longest transcript.
    const seen = wanted.get(s.sessionId);
    if (!seen || (s.createdAt ?? 0) >= (seen.createdAt ?? 0)) wanted.set(s.sessionId, s);
  }
  const blobs = git.readBlobs(repo, loaded.ref, [...wanted.values()].map((s) => s.transcript));
  const sessions = [];
  let unreadableLines = 0;
  for (const s of wanted.values()) {
    const text = blobs.get(s.transcript);
    if (text === undefined) continue;
    const session = parseSession(text, `entire:${s.checkpoint}/${s.index}/full.jsonl`);
    unreadableLines += session.unreadableLines;
    if (!session.records) continue;
    session.id = s.sessionId;
    session.origin = 'entire';
    if (session.end === null) session.start = session.end = s.createdAt ?? since;
    if (session.end >= since) sessions.push(session);
  }
  return { sessions, unreadableLines };
}

/**
 * Which branch each Entire session's checkpoints were committed on, from the trailers.
 * @param {Map<string, { checkpoints: string[] }[]>} commitsByBranch
 * @returns {Map<string, { branches: string[], checkpoint: string }>} session id → branches
 */
export function sessionBranches(loaded, commitsByBranch) {
  const branchesOfCheckpoint = new Map();
  for (const [branch, commits] of commitsByBranch) {
    for (const commit of commits) {
      for (const id of commit.checkpoints) {
        if (!branchesOfCheckpoint.has(id)) branchesOfCheckpoint.set(id, new Set());
        branchesOfCheckpoint.get(id).add(branch);
      }
    }
  }
  const out = new Map();
  for (const s of loaded.sessions) {
    const branches = branchesOfCheckpoint.get(s.checkpoint);
    if (!branches) continue;
    const entry = out.get(s.sessionId) ?? { branches: new Set(), checkpoint: s.checkpoint };
    for (const b of branches) entry.branches.add(b);
    out.set(s.sessionId, entry);
  }
  return new Map([...out].map(([id, e]) => [id, { branches: [...e.branches].sort(), checkpoint: e.checkpoint }]));
}
