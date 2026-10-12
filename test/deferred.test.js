// "Deferred / needs you" extraction from the agent's final message.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { extractDeferred } from '../src/deferred.js';

const texts = (message) => extractDeferred(message).map((i) => i.text);

describe('extractDeferred', () => {
  test('bullets under a "Next steps" heading are deferred work', () => {
    const items = extractDeferred('All green.\n\n## Next steps\n- Rotate the staging key\n- Run the migration on prod\n\n## Summary\n- Added search');
    assert.deepEqual(items, [
      { text: 'Rotate the staging key', kind: 'deferred' },
      { text: 'Run the migration on prod', kind: 'deferred' },
    ]);
  });

  test('headings in other styles: bold, trailing colon, numbered bullets', () => {
    assert.deepEqual(texts('**Not done**\n1. Wire up email\n2) Add rate limits'), ['Wire up email', 'Add rate limits']);
    assert.deepEqual(texts('Remaining work:\n* Docs page'), ['Docs page']);
    assert.deepEqual(texts("What's left:\n- the CSV export"), ['the CSV export']);
  });

  test('a plain paragraph ends the heading section', () => {
    assert.deepEqual(texts('Next steps:\n- Ship it\nThat is everything.\n- Unrelated bullet'), ['Ship it']);
  });

  test('phrases anywhere in the message', () => {
    const message = [
      "I couldn't get the e2e suite to start.",
      "You'll need to add STRIPE_KEY to the env.",
      'Skipped the flaky upload test.',
      'This needs your review before merge.',
      'Blocked on the API credentials.',
      'TODO: remove the debug flag',
      'Tests are still failing on CI.',
      'Not yet implemented: refunds.',
      'You should rotate the staging token.',
      'Someone has to approve the DNS change.',
    ].join('\n');
    assert.equal(extractDeferred(message).length, 10);
    assert.ok(extractDeferred(message).every((i) => i.kind === 'deferred'));
  });

  test('questions the agent ended on', () => {
    assert.deepEqual(extractDeferred('Done with the API.\nShould I also update the docs?'), [{ text: 'Should I also update the docs?', kind: 'question' }]);
    assert.equal(extractDeferred('Want me to open a PR?)')[0].kind, 'question');
  });

  test('ordinary summaries yield nothing', () => {
    assert.deepEqual(texts('Added the search endpoint and tests. All 12 tests pass.\n\n## Summary\n- New route /search\n- Fixed the broken link in the README'), []);
  });

  test('code blocks are output, not asks', () => {
    assert.deepEqual(texts('Output:\n```\nTODO: in a log line\nwhat?\n```\nAll good.'), []);
  });

  test('duplicates collapse, long items are cut, at most 10', () => {
    assert.deepEqual(texts('TODO: x one\nTODO: x one'), ['TODO: x one']);
    assert.ok(texts(`TODO ${'a'.repeat(500)}`)[0].length <= 240);
    assert.equal(extractDeferred(Array.from({ length: 30 }, (_, i) => `TODO item ${i}`).join('\n')).length, 10);
  });

  test('empty or missing text', () => {
    assert.deepEqual(extractDeferred(''), []);
    assert.deepEqual(extractDeferred(undefined), []);
  });
});
