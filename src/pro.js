// The Pro link (REVENUE.md). One line at the end of the Markdown file written by --out, nowhere else:
// the terminal and --json stay clean, and the digest is pushed to a phone every morning.
// Pro is a supporter license on an honour system: the code is MIT and nothing is gated or checked,
// so any non-blank OVERNIGHT_RECEIPTS_LICENSE hides the line. Its value is never printed.
import fs from 'node:fs';

export const PRO_PRICE = '$12';
export const LICENSE_ENV = 'OVERNIGHT_RECEIPTS_LICENSE';

/**
 * The https URL in package.json's `funding` (what `npm fund` lists), the one place the URL lives.
 * npm allows a string, { type, url } or an array of either; the first entry wins. Read with fs, not a
 * JSON import, which warns on some Node 22 releases. Any problem means no URL, so no footer: the
 * footer must never be the reason the CLI fails.
 */
export function fundingUrl(file = new URL('../package.json', import.meta.url)) {
  let funding;
  try {
    ({ funding } = JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
  const first = Array.isArray(funding) ? funding[0] : funding;
  const url = typeof first === 'string' ? first : first?.url;
  // No whitespace, brackets or parentheses: any of them could end the Markdown link early.
  return typeof url === 'string' && /^https:\/\/[^\s()<>[\]]+$/.test(url) ? url : null;
}

export const PRO_URL = fundingUrl();

/** The footer line, or null when a supporter license is set or there's nowhere to link. */
export function proFooter(env = process.env, url = PRO_URL) {
  if (!url || env[LICENSE_ENV]?.trim()) return null;
  return `Made with overnight-receipts, free and MIT. If it saved you a morning: [Pro, ${PRO_PRICE} once](${url}). Already a supporter? Set \`${LICENSE_ENV}\` to hide this line.`;
}
