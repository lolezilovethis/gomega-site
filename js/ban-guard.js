// /js/ban-guard.js
// Put <script type="module" src="/js/ban-guard.js"></script> at the very top of every page (in <head>).

import { auth, db } from '/js/firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/*
  Configure this to the public path you serve the not-approved page at.
  Many servers route /not-approved -> /not-approved.html; adjust to your hosting.
*/
const BAN_REDIRECT = '/not-approved'; // change to '/not-approved.html' if your host requires file
const BAN_PAGE_PATHS = [BAN_REDIRECT, '/not-approved.html'];

// avoid infinite loop when already viewing the ban page
function isOnBanPage() {
  try {
    const p = location.pathname.replace(/\/+$/, ''); // trim trailing slash
    return BAN_PAGE_PATHS.some(sp => p === sp || p.endsWith(sp));
  } catch (e) {
    return false;
  }
}

// helper: checks whether a ban entry is currently active
function banIsActive(b) {
  try {
    const now = Date.now();
    // Firestore Timestamp objects have .toDate(), otherwise assume JS Date or ISO string
    const start = b?.start && typeof b.start.toDate === 'function'
      ? b.start.toDate().getTime()
      : b?.start ? new Date(b.start).getTime() : -Infinity;
    const end = b?.end && typeof b.end.toDate === 'function'
      ? b.end.toDate().getTime()
      : b?.end ? new Date(b.end).getTime() : Infinity;
    return (start <= now) && (now <= end);
  } catch (e) {
    return false;
  }
}

/*
  getFreshDoc(uref, opts)
  - tries to resolve a server-fresh snapshot by listening to onSnapshot and checking
    snapshot.metadata.fromCache === false. If a non-cache snapshot arrives within
    `opts.timeoutMs` ms we resolve with it. Otherwise we fall back to getDoc().
  - This avoids redirecting on stale cached data while staying responsive.
*/
function getFreshDoc(uref, opts = {}) {
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 2200;
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsub = null;

    // Safely attach real-time listener to get metadata.fromCache info
    try {
      unsub = onSnapshot(uref, snap => {
        // If snapshot is from server (not cache) we can trust it as fresh
        if (!snap.metadata || snap.metadata.fromCache === false) {
          if (!settled) {
            settled = true;
            try { if (unsub) unsub(); } catch(_) {}
            resolve(snap);
          }
        } else {
          // cache result — keep waiting until timeout or server result
        }
      }, err => {
        if (!settled) {
          settled = true;
          try { if (unsub) unsub(); } catch(_) {}
          // fallback to getDoc which may itself use cache; caller should handle errors
          getDoc(uref).then(s => resolve(s)).catch(e => reject(e));
        }
      });
    } catch (e) {
      // If onSnapshot isn't available or throws, fallback immediately
      getDoc(uref).then(s => resolve(s)).catch(err => reject(err));
      return;
    }

    // Timeout: if server snapshot didn't arrive in reasonable time, fallback to getDoc()
    const to = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { if (unsub) unsub(); } catch(_) {}
      getDoc(uref).then(s => resolve(s)).catch(e => reject(e));
    }, timeoutMs);

    // cleanup when resolved/rejected
    const cleanup = () => {
      clearTimeout(to);
      try { if (unsub) unsub(); } catch (_) {}
    };
    // wrap resolve/reject to cleanup automatically (defensive)
    const origResolve = resolve;
    const origReject = reject;
    resolve = (v) => { cleanup(); origResolve(v); };
    reject = (e) => { cleanup(); origReject(e); };
  });
}

// main guard
onAuthStateChanged(auth, async (user) => {
  try {
    // If not signed in, do nothing (signed-out users should not be redirected)
    if (!user) return;

    // If already on the ban page, don't redirect (prevents loop)
    if (isOnBanPage()) return;

    const uref = doc(db, 'users', user.uid);

    // Try to get a fresh server-backed snapshot (but fall back gracefully)
    let snap;
    try {
      snap = await getFreshDoc(uref, { timeoutMs: 2200 });
    } catch (err) {
      // If fresh fetch fails, fall back to standard getDoc
      try {
        snap = await getDoc(uref);
      } catch (e) {
        // Fail open: don't redirect if we can't reliably read server state
        console.error('ban-guard: failed to read user doc (fallback failed)', e);
        return;
      }
    }

    if (!snap || !snap.exists()) return;

    const data = snap.data();

    // Two ways an account can be considered banned:
    // 1) explicit boolean flag `banned: true`
    // 2) any entry in `bans` array is currently active (start/end)
    const flagBanned = !!data.banned;
    const arrayBanned = Array.isArray(data.bans) && data.bans.some(banIsActive);

    if (flagBanned || arrayBanned) {
      // Use replace() so the back button doesn't just go back to the page that immediately redirects
      // Also guard: don't call replace if we're already on the ban page (double-check)
      if (!isOnBanPage()) {
        // throttle quick repeated redirects in same session (defensive)
        try {
          const lastRedirect = sessionStorage.getItem('__gomega_last_ban_redirect') || '0';
          const now = Date.now();
          // if we redirected in the last 2s, avoid doing it again to prevent thrash
          if (now - Number(lastRedirect) > 2000) {
            sessionStorage.setItem('__gomega_last_ban_redirect', String(now));
            location.replace(BAN_REDIRECT);
          }
        } catch (e) {
          // if sessionStorage fails, just replace once
          location.replace(BAN_REDIRECT);
        }
      }
    }
  } catch (err) {
    // Fail open — do not block users if guard errors
    // But log so you can debug in console
    console.error('ban-guard error', err);
  }
});
