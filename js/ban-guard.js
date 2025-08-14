// /js/ban-guard.js
// Put <script type="module" src="/js/ban-guard.js"></script> at the very top of every page (in <head>).

import { auth, db } from '/js/firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/*
  Configure this to the public path you serve the not-approved page at.
  Many servers route /not-approved -> /not-approved.html; adjust to your hosting.
*/
const BAN_REDIRECT = '/not-approved'; // change to '/not-approved.html' if your host requires file
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
    // Firestore Timestamp objects have .toDate(), otherwise assume JS Date or ISO string
    const start = b?.start && b.start.toDate ? b.start.toDate().getTime()
                : b?.start ? new Date(b.start).getTime() : -Infinity;
    const end   = b?.end   && b.end.toDate   ? b.end.toDate().getTime()
                : b?.end   ? new Date(b.end).getTime() : Infinity;
    return (start <= now) && (now <= end);
  } catch (e) {
    return false;
  }
}

// main guard
onAuthStateChanged(auth, async (user) => {
  try {
    // If not signed in, do nothing (signed-out users should not be redirected)
    if (!user) return;

    // If already on the ban page, don't redirect (prevents loop)
    if (isOnBanPage()) return;

    const uref = doc(db, 'users', user.uid);
    const snap = await getDoc(uref);
    if (!snap.exists()) return;

    const data = snap.data();

    // Two ways an account can be considered banned:
    // 1) explicit boolean flag `banned: true`
    // 2) any entry in `bans` array is currently active (start/end)
    const flagBanned = !!data.banned;
    const arrayBanned = Array.isArray(data.bans) && data.bans.some(banIsActive);

    if (flagBanned || arrayBanned) {
      // Use replace() so the back button doesn't just go back to the page that immediately redirects
      location.replace(BAN_REDIRECT);
    }
  } catch (err) {
    // Fail open — do not block users if guard errors
    // But log so you can debug in console
    console.error('ban-guard error', err);
  }
});
