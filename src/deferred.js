// "Deferred / needs you": what the agent said it left undone, and questions it ended on.
//
// Read from the session's final assistant message only, where agents put their summary. A line
// counts when it uses one of the phrases below, ends in a question, or is a bullet under a
// heading such as "Next steps" or "Not done". Code blocks are skipped: they are output, not asks.
// Heuristic by design, so every item cites the transcript line it came from.

const PHRASES = new RegExp(
  [
    String.raw`\bTODO\b`,
    String.raw`\bFIXME\b`,
    String.raw`\b(?:I|we)\s+(?:could(?:n'?t| not)|did(?:n'?t| not)|was(?:n'?t| not) able to|wasn'?t able|have(?:n'?t| not)|can(?:'?t|not)|ran out of)\b`,
    String.raw`\b(?:you(?:'ll| will)?|someone)\s+(?:(?:may |might )?needs? to|ha(?:ve|s) to|should|must)\b`,
    String.raw`\b(?:needs?|requires?)\s+(?:your|a human|manual|you)\b`,
    String.raw`\bmanual(?:ly)?\s+(?:step|steps|check|review|setup|set up|action)\b`,
    String.raw`\b(?:skipped|deferred|postponed|left (?:out|for you|as is)|not (?:yet )?(?:implemented|done|tested|verified|run)|out of scope|follow[- ]up)\b`,
    String.raw`\b(?:blocked|waiting) (?:on|for)\b`,
    String.raw`\bstill (?:fail(?:s|ing)|broken|red)\b`,
  ].join('|'),
  'i',
);
const HEADING = /^(?:#{1,6}\s*|\*\*)?(?:next steps?|follow[- ]ups?|todo|to do|not done|left to do|remaining(?: work)?|open questions?|deferred|needs you|blockers?|known issues?|what'?s left|limitations)\b.*$/i;
const BULLET = /^(?:[-*+•]|\d+[.)])\s+/;
const MAX_ITEMS = 10;
const MAX_LEN = 240;

/** Strips fenced code blocks, keeping line positions so line offsets still match. */
function withoutCode(text) {
  let inFence = false;
  return text.split('\n').map((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return '';
    }
    return inFence ? '' : line;
  });
}

const tidy = (line) =>
  line
    .replace(BULLET, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*/g, '')
    .trim();

/**
 * @param {string} text the agent's final message
 * @returns {{ text: string, kind: 'deferred' | 'question' }[]}
 */
export function extractDeferred(text) {
  const items = [];
  const seen = new Set();
  let underHeading = false;
  for (const raw of withoutCode(String(text ?? ''))) {
    const line = raw.trim();
    if (!line) continue;
    const isBullet = BULLET.test(line);
    const looksLikeHeading = /^#{1,6}\s|^\*\*/.test(line) || (!isBullet && /:$/.test(line));
    if (looksLikeHeading) {
      underHeading = HEADING.test(tidy(line));
      if (underHeading) continue;
    } else if (!isBullet) {
      underHeading = false;
    }
    const content = tidy(line);
    if (!content || content.length < 4) continue;
    let kind = null;
    if (/\?["')\]]*$/.test(content)) kind = 'question';
    else if ((underHeading && isBullet) || PHRASES.test(content)) kind = 'deferred';
    if (!kind) continue;
    const key = content.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ text: content.length > MAX_LEN ? `${content.slice(0, MAX_LEN - 1)}…` : content, kind });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}
