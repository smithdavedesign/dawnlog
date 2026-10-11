// Secret redaction and terminal sanitising.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { REDACTED, clean, redact, sanitize } from '../src/redact.js';

// Seeded corpus: one sample per format (the PRD metric asks for 0 leaks across 10+ formats).
const SECRETS = {
  anthropic: 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcdEFGH',
  openai: 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  'github classic': 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  'github oauth': 'gho_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  'github fine-grained': 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP',
  'aws access key id': 'AKIAIOSFODNN7EXAMPLE',
  'aws session key id': 'ASIAIOSFODNN7EXAMPLE',
  slack: 'xoxb-1234567890-0987654321-AbCdEfGhIjKlMnOp',
  stripe: 'sk_live_51HAbCdEfGhIjKlMnOpQrStUv',
  google: 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q',
  npm: 'npm_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
};

describe('redact', () => {
  for (const [name, secret] of Object.entries(SECRETS)) {
    test(`${name} token`, () => {
      const out = redact(`before ${secret} after`);
      assert.ok(!out.includes(secret), out);
      assert.equal(out, `before ${REDACTED} after`);
    });
  }

  test('the three exit-criterion formats inside quotes, URLs and env assignments', () => {
    const input = `curl -H "x-api-key: ${SECRETS.anthropic}" https://${SECRETS['github classic']}@github.com/a/b.git AWS_ACCESS_KEY_ID='${SECRETS['aws access key id']}'`;
    const out = redact(input);
    for (const key of ['anthropic', 'github classic', 'aws access key id']) assert.ok(!out.includes(SECRETS[key]), out);
  });

  test('Bearer tokens', () => {
    assert.equal(redact('Authorization: Bearer abcdefghijklmnop1234567890'), `Authorization: Bearer ${REDACTED}`);
  });

  test('secret-looking assignments', () => {
    assert.equal(redact('DB_PASSWORD=hunter2hunter2 next'), `DB_PASSWORD=${REDACTED} next`);
    assert.equal(redact('"api_key": "abcd1234efgh5678"'), `"api_key": "${REDACTED}"`);
    assert.equal(redact('token: short'), 'token: short', 'short values are left alone');
  });

  test('private key blocks, including one cut off before its END line', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1b2c3\nd4e5f6\n-----END RSA PRIVATE KEY-----';
    assert.equal(redact(`key:\n${key}\nafter`), `key:\n${REDACTED}\nafter`);
    assert.equal(redact('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA'), REDACTED);
  });

  test('is idempotent and leaves ordinary text alone', () => {
    const once = redact(`x ${SECRETS.anthropic} GITHUB_TOKEN=${SECRETS['github classic']}`);
    assert.equal(redact(once), once);
    const plain = 'npm test → exit 1 · risk: dependency · feature/sk-branch · AKIA is short';
    assert.equal(redact(plain), plain);
  });
});

describe('sanitize', () => {
  test('strips ANSI escape sequences and control characters but keeps newlines and tabs', () => {
    assert.equal(sanitize('a\u001b[31mred\u001b[0m\tb\nc\r\u0007\u0000d\u009be'), 'ared\tb\ncde');
    assert.equal(sanitize('title\u001b]0;pwned\u0007 ok'), 'title ok');
  });

  test('keeps non-ASCII text', () => {
    assert.equal(sanitize('café — 日本 ✓'), 'café — 日本 ✓');
  });
});

describe('clean', () => {
  test('redacts and sanitizes', () => {
    assert.equal(clean(`\u001b[2J${SECRETS.npm}`), REDACTED);
  });
});
