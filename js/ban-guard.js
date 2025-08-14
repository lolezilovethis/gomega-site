// /js/ban-guard.js
// Place <script type="module" src="/js/ban-guard.js"></script> at the very top of every page (in <head>).

import { auth, db } from '/js/firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  // getDocFromServer is available in firestore v10+; if it isn't present the try/catch below will handle it.
  getDocFromServer
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/*
  Configure this to the public path you serve the not-approved page at.
  Many hosts route /not-approved -> /not-approved.html; change to '/not-approved.html' if your host requires an actual file.
*/
const BAN_REDIRECT = '/not-approved';
const BAN_PAGE_PATHS = [BAN_REDIRECT, '/not-approved.html'];

// avoid infinite loop when already viewing the ban page
function isOnBanPage() {
  const p = location.pathname.replace(/\/+$/, ''); // trim trailing slash
  return BAN_PAGE_PATHS.some(sp => p === sp || p.endsWith(sp));
}

// helper: checks whether a ban entry is currently active
function banIsActive(b) {
  try {
    const now = Date.now();
    // small tolerance to avoid false positives from near-immediate changes
    const EPS_MS = 1000; // 1 second tolerance

    const start = b?.start && b.start.toDate ? b.start.toDate().getTime()
                : b?.start ? new Date(b.start).getTime() : -Infinity;
    const end   = b?.end   && b.end.toDate   ? b.end.toDate().getTime()
                : b?.end   ? new Date(b.end).getTime() : Infinity;

    // If end is already sufficiently in the past, treat as not active
    if (isFinite(end) && end <= (now - EPS_MS)) return false;

    // Consider active only if now is between start and (end - EPS_MS)
    return (start <= now) && (now <= (end - EPS_MS));
  } catch (e) {
    return false;
  }
}

// If user was reactivated very recently (client just wrote reactivatedAt),
// don't immediately redirect them. This prevents race conditions.
function recentlyReactivated(data) {
  try {
    if (!data) return false;
    const ra = data.reactivatedAt;
    if (!ra) return false;
    const raMs = ra && ra.toDate ? ra.toDate().getTime() : new Date(ra).getTime();
    const now = Date.now();
    // window to consider "recent" — 5 seconds
    return (now - raMs) < 5000;
  } catch (e) {
    return false;
  }
}

// Main guard
onAuthStateChanged(auth, async (user) => {
  try {
    // If not signed in, do nothing (signed-out users are not redirected)
    if (!user) return;

    // If already on the ban page, don't redirect (prevents loop)
    if (isOnBanPage()) return;

    const uref = doc(db, 'users', user.uid);

    // Try server copy first (fresh). If getDocFromServer isn't available or fails, fallback to getDoc().
    let snap = null;
    try {
      if (typeof getDocFromServer === 'function') {
        snap = await getDocFromServer(uref);
      } else {
        // In older setups getDocFromServer might not be exported — throw to jump to fallback
        throw new Error('getDocFromServer unavailable');
      }
    } catch (e) {
      // server fetch failed (network/offline or function missing) -> fallback to cached getDoc
      try {
        snap = await getDoc(uref);
      } catch (e2) {
        // If both fail, log and fail open (do not block)
        console.error('ban-guard: failed to fetch user doc (server fallback failed)', e2);
        return;
      }
    }

    if (!snap || !snap.exists()) return;
    const data = snap.data();

    // If we detect a very recent reactivation, skip redirect to avoid immediate bounce
    if (recentlyReactivated(data)) {
      console.debug('ban-guard: recent reactivation detected, skipping redirect.');
      return;
    }

    const flagBanned = !!data.banned;
    const arrayBanned = Array.isArray(data.bans) && data.bans.some(banIsActive);

    if (flagBanned || arrayBanned) {
      // Use replace() so the back button doesn't simply go back to the page that immediately redirects
      location.replace(BAN_REDIRECT);
    }
  } catch (err) {
    // Fail open — do not block users if guard errors
    console.error('ban-guard error', err);
  }
});
