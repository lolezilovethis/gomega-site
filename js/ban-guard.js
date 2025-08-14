// /js/ban-guard.js
// Place <script type="module" src="/js/ban-guard.js"></script> at the very top of every page (in <head>).
//
// Purpose:
// - Prevent signed-in users with active bans from using the site.
// - Treat an explicit `banned: false` as authoritative (do not redirect).
// - Avoid redirect loop when already on the ban page.
// - Fail-open on errors (don't block users if guard errors).

import { auth, db } from '/js/firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/*
  Edit this if your not-approved page is served at a different public path.
  Use '/not-approved.html' if your host requires the file name.
*/
const BAN_REDIRECT = '/not-approved';
const BAN_PAGE_PATHS = [BAN_REDIRECT, '/not-approved.html'];

// avoid infinite loop when already viewing the ban page
function isOnBanPage() {
  const p = location.pathname.replace(/\/+$/, ''); // trim trailing slash
  return BAN_PAGE_PATHS.some(sp => p === sp || p.endsWith(sp));
}

// helper: parse possible timestamp values (Firestore Timestamp, Date, ISO string)
function toMillis(ts) {
  if (ts === undefined || ts === null) return null;
  try {
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (ts instanceof Date) return ts.getTime();
    const n = Number(ts);
    if (!isNaN(n)) return n;
    const parsed = Date.parse(ts);
    return isNaN(parsed) ? null : parsed;
  } catch (e) {
    return null;
  }
}

// helper: checks whether a ban entry is currently active
function banIsActive(b) {
  try {
    const now = Date.now();
    const startMs = toMillis(b?.start);
    const endMs = toMillis(b?.end);
    const start = (startMs !== null) ? startMs : -Infinity;
    const end = (endMs !== null) ? endMs : Infinity;
    return (start <= now) && (now <= end);
  } catch (e) {
    return false;
  }
}

// small tolerance to avoid immediately redirecting right after a reactivation write
function recentlyReactivated(data, windowMs = 5000) {
  try {
    if (!data) return false;
    const ra = data.reactivatedAt || data.lastUnbannedAt;
    if (!ra) return false;
    const raMs = toMillis(ra);
    if (!raMs) return false;
    return (Date.now() - raMs) < windowMs;
  } catch (e) {
    return false;
  }
}

// main guard
onAuthStateChanged(auth, async (user) => {
  try {
    // if not signed in, don't block (signed-out users should not be redirected)
    if (!user) return;

    // avoid infinite loop when already viewing the ban page
    if (isOnBanPage()) return;

    const uref = doc(db, 'users', user.uid);

    // read user doc (simple approach using getDoc)
    let snap;
    try {
      snap = await getDoc(uref);
    } catch (e) {
      console.error('ban-guard: failed to read user doc', e);
      // fail open: don't block users if we can't read the doc
      return;
    }

    if (!snap || !snap.exists()) {
      // no user doc — nothing to do
      return;
    }

    const data = snap.data();

    // If admin/client explicitly cleared banned flag, treat that as authoritative: do not redirect.
    if (data && data.banned === false) {
      // allow user even if bans array contains stale/active entries
      console.debug('ban-guard: banned === false — allowing user');
      return;
    }

    // If recently reactivated, avoid immediate redirect (helps race conditions).
    if (recentlyReactivated(data)) {
      console.debug('ban-guard: recent reactivation detected — allowing user briefly');
      return;
    }

    // Otherwise, check bans array for any active entries
    const arrayBanned = Array.isArray(data.bans) && data.bans.some(banIsActive);

    if (data.banned || arrayBanned) {
      // block: redirect to ban page (replace so back button won't return to a page that immediately redirects)
      console.warn('ban-guard: redirecting user to ban page', { uid: user.uid, banned: !!data.banned, activeBanCount: Array.isArray(data.bans) ? data.bans.filter(banIsActive).length : 0 });
      location.replace(BAN_REDIRECT);
    } else {
      // allowed
      console.debug('ban-guard: no active ban found; user allowed');
    }
  } catch (err) {
    // Fail open — do not block users if guard errors. Log for debugging.
    console.error('ban-guard error', err);
  }
});
