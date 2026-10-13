// The visit beacon, so RepoHQ (the maintainer's project dashboard) can count real use of this site. It POSTs
// {"slug", "kind", "referrer"} to ENDPOINT, fire-and-forget, with no cookies and no identifier, for three events:
//   visit     a public page opened, once per browser session (sessionStorage)
//   activate  the install line copied, once per browser (localStorage): the site's closest step to running the tool,
//             which itself stays offline and sends nothing
//   checkout  the Buy button clicked
// `referrer` is document.referrer only when it's another site's page, else null, so this site's own URLs never leave.
// Nothing is sent to an automated browser (navigator.webdriver), off the production deploy (the build writes
// VERCEL_ENV into <meta name="vercel-env">), or when localStorage has "repohq:notrack" (the owner's browser).
// The privacy page describes exactly this; change both together.
export const ENDPOINT = 'https://repohq.vercel.app/api/ideas/signal';
export const SLUG = 'dawnlog';
export const NOTRACK_KEY = 'repohq:notrack';
export const VISIT_KEY = `repohq:visit:${SLUG}`;
export const ACTIVATE_KEY = `repohq:activate:${SLUG}`;

/** `referrer` when it's an http(s) URL on another origin than `origin`; otherwise null. */
export function externalReferrer(referrer, origin) {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    return /^https?:$/.test(url.protocol) && url.origin !== origin ? referrer : null;
  } catch {
    return null;
  }
}

/** True the first time `key` is seen in `storage`, which then remembers it. A storage that throws counts as seen. */
export function firstTime(storage, key) {
  try {
    if (storage.getItem(key) !== null) return false;
    storage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

/** The fetch options for one event: a JSON POST that outlives the page, without cookies or a Referer header. */
export function signalRequest(kind, referrer) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: SLUG, kind, referrer }),
    keepalive: true,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  };
}

/**
 * Wires the beacon into a page. Returns the send function, or null when nothing may be sent: an automated browser,
 * not the production deploy, the owner's opt-out, or storage that can't be read (then there's no way to send once).
 * @param {Window} win
 */
export function startBeacon(win) {
  let local;
  let session;
  try {
    local = win.localStorage;
    session = win.sessionStorage;
    if (win.navigator.webdriver) return null;
    if (win.document.querySelector('meta[name="vercel-env"]')?.getAttribute('content') !== 'production') return null;
    if (local.getItem(NOTRACK_KEY) !== null) return null;
  } catch {
    return null;
  }
  const referrer = externalReferrer(win.document.referrer, win.location.origin);
  const send = (kind) => {
    try {
      win.fetch(ENDPOINT, signalRequest(kind, referrer)).catch(() => {});
    } catch {
      // fire-and-forget: a refused request (keepalive quota, offline) must never break the page
    }
  };
  if (firstTime(session, VISIT_KEY)) send('visit');
  for (const el of win.document.querySelectorAll('[data-activate]')) {
    el.addEventListener('copy', () => {
      if (firstTime(local, ACTIVATE_KEY)) send('activate');
    });
  }
  win.document.querySelector('a#buy')?.addEventListener('click', () => send('checkout'));
  return send;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') startBeacon(window);
