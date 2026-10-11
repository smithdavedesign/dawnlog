// Secret redaction and terminal safety for everything dawnlog prints or writes.
// Best-effort by design: the patterns cover common token formats, not every secret.

export const REDACTED = '[REDACTED]';

// [format, pattern, replacement]. Specific formats run before the generic ones.
// Distinctive prefixes have no leading \b, so a neighbouring character can't shield a token;
// plain `sk-` keeps it because "task-…" and "disk-…" are everywhere.
const RULES = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[\s\S]*)/g, REDACTED],
  ['anthropic', /sk-ant-[A-Za-z0-9_-]{8,}/g, REDACTED],
  ['openai', /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, REDACTED],
  ['github', /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  ['aws access key id', /(?:AKIA|ASIA)[A-Z0-9]{16}/g, REDACTED],
  ['slack', /xox[abposr]-[A-Za-z0-9-]{10,}/g, REDACTED],
  ['stripe', /[rs]k_(?:live|test)_[A-Za-z0-9]{10,}/g, REDACTED],
  ['google api key', /AIza[A-Za-z0-9_-]{35}/g, REDACTED],
  ['npm', /npm_[A-Za-z0-9]{36}/g, REDACTED],
  ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  ['bearer', /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi, `$1${REDACTED}`],
  [
    'assignment',
    /\b([A-Za-z0-9_]*(?:api_?key|secret|token|passw(?:or)?d)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)(?!\[REDACTED\])[^\s"']{8,}/gi,
    `$1${REDACTED}`,
  ],
];

// CSI/OSC/other escape sequences, then any remaining C0/C1 control character except \t and \n.
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Replaces known secret formats with [REDACTED]. Idempotent. */
export function redact(text) {
  let out = String(text);
  for (const [, pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

/** Strips escape sequences and control characters so transcript text can't drive the terminal. */
export function sanitize(text) {
  return String(text).replace(ANSI, '').replace(CONTROL, '');
}

/**
 * The last step before any byte leaves dawnlog. Sanitizes first: an escape sequence glued
 * to a token would otherwise hide it from the patterns and then vanish, leaving the token.
 */
export function clean(text) {
  return redact(sanitize(text));
}
