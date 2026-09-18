// Which URLs the overlay hands to the OS (main.js 'open-external'). http(s) for links out of the HUD; the
// iRacing UI's own scheme for the desk's "Open in iRacing", and only its racing routes — the UI accepts
// help/racing/receipt/settings/shop under `iracing://web/` (docs/race-join-findings.md §1), and nothing here
// needs the other four. Exact, lower-case, no query: the UI's own matcher is case-sensitive.
const IRACING_ROUTE = /^iracing:\/\/web\/racing\/[a-z0-9\-\/]*$/;

function isAllowedExternalUrl(urlStr) {
  if (typeof urlStr !== 'string') return false;
  if (IRACING_ROUTE.test(urlStr)) return true;
  try {
    const url = new URL(urlStr);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

module.exports = { isAllowedExternalUrl };
