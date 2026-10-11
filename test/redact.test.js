// Secret redaction and terminal sanitising.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { REDACTED, clean, redact, sanitize } from '../src/redact.js';
import { FAKE, FAKE_API_KEY_JSON, FAKE_BEARER, FAKE_PASSWORD_ASSIGNMENT, FAKE_PRIVATE_KEY, FAKE_TRUNCATED_KEY } from './fake-secrets.js';

// Seeded corpus: one sample per format (the PRD metric asks for 0 leaks across 10+ formats).
// Seeded corpus from test/fake-secrets.js: built at runtime, never real.
const SECRETS = FAKE;

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
    assert.equal(redact(`Authorization: ${FAKE_BEARER}`), `Authorization: Bearer ${REDACTED}`);
  });

  test('secret-looking assignments', () => {
    assert.equal(redact(`${FAKE_PASSWORD_ASSIGNMENT} next`), `DB_PASSWORD=${REDACTED} next`);
    assert.equal(redact(FAKE_API_KEY_JSON), `"api_key": "${REDACTED}"`);
    assert.equal(redact('token: short'), 'token: short', 'short values are left alone');
  });

  test('private key blocks, including one cut off before its END line', () => {
    const key = FAKE_PRIVATE_KEY;
    assert.equal(redact(`key:\n${key}\nafter`), `key:\n${REDACTED}\nafter`);
    assert.equal(redact(FAKE_TRUNCATED_KEY), REDACTED);
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
