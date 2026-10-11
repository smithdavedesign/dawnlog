// Fake credentials for the redaction tests, one per format src/redact.js covers. They're built at
// runtime from a prefix and a repeated filler, so no credential-shaped string appears in the source:
// secret scanners (GitGuardian, gitleaks) match source text and can't tell a fixture from a real key.
// None of these is, or was ever, a real credential. Keep new fixtures in this style.

/** `n` characters of low-entropy filler. */
export const filler = (n, chars = 'A1b2C3d4E5f6G7h8') => chars.repeat(Math.ceil(n / chars.length)).slice(0, n);
const upper = (n) => filler(n, 'A1B2C3D4E5F6G7H8');

export const FAKE = {
  anthropic: ['sk', 'ant', 'api03', filler(48)].join('-'),
  openai: ['sk', 'proj', filler(40)].join('-'),
  'github classic': `gh${'p'}_${filler(36)}`,
  'github oauth': `gh${'o'}_${filler(36)}`,
  'github fine-grained': `github${'_pat_'}${filler(22)}_${filler(59)}`,
  'aws access key id': `AK${'IA'}${upper(16)}`,
  'aws session key id': `AS${'IA'}${upper(16)}`,
  slack: `xo${'xb'}-1234567890-${filler(24)}`,
  stripe: `sk${'_live_'}${filler(24)}`,
  google: `AI${'za'}${filler(35)}`,
  npm: `np${'m'}_${filler(36)}`,
  jwt: [`ey${'J'}${filler(20)}`, `ey${'J'}${filler(24)}`, filler(32)].join('.'),
};

const keyLine = (kind, edge) => `-----${edge} ${kind} ${'PRIVATE'} KEY-----`;
/** A complete PEM block. */
export const FAKE_PRIVATE_KEY = [keyLine('RSA', 'BEGIN'), filler(64), 'd4e5f6', keyLine('RSA', 'END')].join('\n');
/** A key cut off before its END line. */
export const FAKE_TRUNCATED_KEY = `${keyLine('OPENSSH', 'BEGIN')}\n${filler(40)}`;

export const FAKE_BEARER = `Bear${'er'} ${filler(32)}`;
export const FAKE_PASSWORD_ASSIGNMENT = `DB_PASS${'WORD'}=${'hunter2'.repeat(2)}`;
export const FAKE_API_KEY_JSON = `"api${'_key'}": "${filler(24)}"`;
