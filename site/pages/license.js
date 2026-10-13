// thanks.html: after payment, the Stripe Payment Link redirects here with ?session_id={CHECKOUT_SESSION_ID}.
// That Checkout Session id is the buyer's license string. The CLI only checks that one is set (honour system),
// and the maintainer can find the payment by it for a refund or a lost string. Written with textContent only.
export const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{16,250}$/;

/** The license from a query string like location.search, or null when it isn't a Checkout Session id. */
export function licenseFrom(search) {
  const id = new URLSearchParams(search).get('session_id');
  return id !== null && SESSION_ID.test(id) ? id : null;
}

/** Fills and shows the license block; leaves the fallback text when there's no valid id. */
export function showLicense(doc, search) {
  const id = licenseFrom(search);
  const block = doc.getElementById('license');
  const value = doc.getElementById('license-value');
  const missing = doc.getElementById('license-missing');
  if (!id || !block || !value) return false;
  value.textContent = id;
  block.hidden = false;
  if (missing) missing.hidden = true;
  return true;
}

if (typeof document !== 'undefined') showLicense(document, window.location.search);
