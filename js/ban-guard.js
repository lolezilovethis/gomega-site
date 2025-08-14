// /js/ban-guard.js
// Place <script type="module" src="/js/ban-guard.js"></script> at the very top of every page (in <head>).
//
// Production guard:
// - Prevents signed-in users with active bans from using the site.
// - Treats explicit `banned: false` as authoritative (avoids bouncing when bans array still contains stale entries).
// - Avoids redirect loop when already on the ban page.
// - Fails-open on read errors (won't block users if guard fails).

import { auth, db } from '/js/firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* Adjust if your ban page path differs (e.g. /not-approved.html) */
const BAN_REDIRECT = '/not-approved';
const BAN_PAGE_PATHS = [BAN_REDIRECT, '/not-approved.html'];

// avoid infinite loop when already viewing the ban page
function isOnBanPage() {
  const p = location.pathname.replace(/\/+$/, ''); // trim trailing slash
  return BAN_PAGE_PATHS.some(sp => p === sp || p.endsWith(sp));
}

// parse possible timestamp values (Firestore Timestamp, Date, ISO string, millis)
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

// checks whether a ban entry is currently active
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

// small tolerance to avoid redirecting immediately after a reactivation write
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
    // not signed in => do nothing
    if (!user) return;

    // already on ban page => avoid loop
    if (isOnBanPage()) return;

    const uref = doc(db, 'users', user.uid);

    // Try to read user doc. If read fails, fail-open (do not block).
    let snap;
    try {
      snap = await getDoc(uref);
    } catch (e) {
      console.error('ban-guard: failed to read user doc', e);
      return;
    }

    if (!snap || !snap.exists()) {
      // no user doc — nothing to do
      return;
    }

    const data = snap.data();

    // If explicit banned:false — treat authoritative and allow
    if (data && data.banned === false) {
      return;
    }

    // allow brief window after reactivation write to avoid races
    if (recentlyReactivated(data)) {
      return;
    }

    // check bans array for active entry
    const arrayBanned = Array.isArray(data.bans) && data.bans.some(banIsActive);

    if (data.banned || arrayBanned) {
      // redirect to ban page (replace so back button doesn't go back to redirecting page)
      location.replace(BAN_REDIRECT);
    } else {
      // allowed — nothing to do
    }
  } catch (err) {
    // Fail open — do not block users if guard errors. Log for debugging.
    console.error('ban-guard error', err);
  }
});
