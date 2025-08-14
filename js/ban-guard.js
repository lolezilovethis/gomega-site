// /js/ban-guard.js (debugging variant)
// Replace your existing /js/ban-guard.js with this while debugging.
// WARNING: This debug file disables automatic redirect and shows a debug overlay.
// Remove it and restore the production guard when done.

import { auth, db } from '/js/firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  // optional server-only read (v10+). We try and fallback.
  getDocFromServer
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const BAN_REDIRECT = '/not-approved';
const BAN_PAGE_PATHS = [BAN_REDIRECT, '/not-approved.html'];

function isOnBanPage() {
  const p = location.pathname.replace(/\/+$/, '');
  return BAN_PAGE_PATHS.some(sp => p === sp || p.endsWith(sp));
}

function parseTimestamp(ts) {
  if (ts === undefined || ts === null) return null;
  try {
    if (ts.toDate) return ts.toDate();
    return new Date(ts);
  } catch (e) {
    return String(ts);
  }
}
function fmt(d) {
  if (!d) return '—';
  if (typeof d === 'string') return d;
  try {
    return (d instanceof Date) ? d.toLocaleString() : String(d);
  } catch { return String(d); }
}
function banIsActive(b) {
  try {
    const now = Date.now();
    const EPS_MS = 1000;
    const start = b?.start && b.start.toDate ? b.start.toDate().getTime()
                : b?.start ? new Date(b.start).getTime() : -Infinity;
    const end   = b?.end   && b.end.toDate   ? b.end.toDate().getTime()
                : b?.end   ? new Date(b.end).getTime() : Infinity;
    if (isFinite(end) && end <= (now - EPS_MS)) return false;
    return (start <= now) && (now <= (end - EPS_MS));
  } catch (e) {
    return false;
  }
}

// Create a debug overlay on the page
function showOverlay(report) {
  // remove existing overlay if present
  const existing = document.getElementById('__ban_guard_debug_overlay');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = '__ban_guard_debug_overlay';
  wrap.style.position = 'fixed';
  wrap.style.zIndex = '2147483647';
  wrap.style.left = '12px';
  wrap.style.bottom = '12px';
  wrap.style.maxWidth = 'min(92vw,980px)';
  wrap.style.fontFamily = 'Inter, Arial, Helvetica, sans-serif';
  wrap.style.fontSize = '13px';
  wrap.style.color = '#001';
  wrap.style.background = 'linear-gradient(90deg, rgba(255,255,255,0.95), rgba(240,240,240,0.95))';
  wrap.style.border = '1px solid rgba(0,0,0,0.08)';
  wrap.style.boxShadow = '0 12px 48px rgba(0,0,0,0.35)';
  wrap.style.padding = '10px';
  wrap.style.borderRadius = '10px';
  wrap.style.backdropFilter = 'blur(4px)';

  const title = document.createElement('div');
  title.innerHTML = `<strong style="color:#b22222">BAN GUARD DEBUG</strong> — ${report.decision}`;
  wrap.appendChild(title);

  const info = document.createElement('div');
  info.style.marginTop = '8px';
  info.innerHTML = `
    <div><strong>UID:</strong> ${report.uid || '—'}</div>
    <div><strong>banned flag:</strong> ${String(report.banned)}</div>
    <div><strong>reactivatedAt:</strong> ${fmt(report.reactivatedAt)}</div>
    <div><strong>serverSource:</strong> ${report.source}</div>
    <div><strong>active bans found:</strong> ${report.activeCount}</div>
  `;
  wrap.appendChild(info);

  const btnRow = document.createElement('div');
  btnRow.style.marginTop = '10px';
  btnRow.style.display = 'flex';
  btnRow.style.gap = '8px';

  const forceBtn = document.createElement('button');
  forceBtn.textContent = 'Force Redirect → not-approved';
  forceBtn.style.padding = '8px 10px';
  forceBtn.style.borderRadius = '8px';
  forceBtn.style.border = 'none';
  forceBtn.style.cursor = 'pointer';
  forceBtn.style.background = '#ff6b6b';
  forceBtn.style.color = '#fff';
  forceBtn.onclick = () => location.replace(BAN_REDIRECT);

  const ignoreBtn = document.createElement('button');
  ignoreBtn.textContent = 'Ignore / Keep on page';
  ignoreBtn.style.padding = '8px 10px';
  ignoreBtn.style.borderRadius = '8px';
  ignoreBtn.style.border = '1px solid rgba(0,0,0,0.08)';
  ignoreBtn.style.cursor = 'pointer';
  ignoreBtn.onclick = () => wrap.remove();

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy Report';
  copyBtn.style.padding = '8px 10px';
  copyBtn.style.borderRadius = '8px';
  copyBtn.style.border = '1px solid rgba(0,0,0,0.08)';
  copyBtn.style.cursor = 'pointer';
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      copyBtn.textContent = 'Copied ✓';
      setTimeout(()=> copyBtn.textContent = 'Copy Report', 2000);
    } catch(e) {
      console.warn('copy failed', e);
      alert('Copy failed — open console and copy manually.');
    }
  };

  btnRow.appendChild(forceBtn);
  btnRow.appendChild(ignoreBtn);
  btnRow.appendChild(copyBtn);
  wrap.appendChild(btnRow);

  // Add per-ban summary (collapsible)
  const listWrap = document.createElement('div');
  listWrap.style.marginTop = '10px';
  listWrap.style.maxHeight = '280px';
  listWrap.style.overflow = 'auto';
  listWrap.style.paddingTop = '8px';
  listWrap.innerHTML = `<div style="font-weight:700;margin-bottom:6px">Bans (latest first)</div>`;

  report.bansDetailed.forEach((b, i) => {
    const card = document.createElement('div');
    card.style.borderTop = '1px solid rgba(0,0,0,0.04)';
    card.style.paddingTop = '8px';
    card.style.marginTop = '6px';
    card.innerHTML = `
      <div><strong>#${i+1}</strong> ${b.title || '(no title)'} ${b.active ? '<span style="color:#b22222">[ACTIVE]</span>' : ''}</div>
      <div style="font-size:12px;color:#333">start: ${fmt(b.start)} • end: ${fmt(b.end)} • reviewedAt: ${fmt(b.reviewedAt)}</div>
      <div style="margin-top:6px;font-size:12px;color:#222">${String(b.reason || '—')}</div>
    `;
    listWrap.appendChild(card);
  });

  wrap.appendChild(listWrap);

  document.body.appendChild(wrap);
}

// Main guard (debug)
onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) return;
    if (isOnBanPage()) return;

    const uref = doc(db, 'users', user.uid);

    // try server snapshot first
    let snap = null;
    let source = 'server';
    try {
      if (typeof getDocFromServer === 'function') {
        snap = await getDocFromServer(uref);
      } else {
        throw new Error('getDocFromServer not available');
      }
    } catch (e) {
      // fallback to cached getDoc and mark source
      try {
        snap = await getDoc(uref);
        source = 'cache';
      } catch (e2) {
        console.error('ban-guard-debug: failed to read user doc (server and cache attempts failed)', e2);
        // Show overlay indicating error and do not redirect
        showOverlay({
          uid: user.uid,
          error: 'Failed to read user doc (server+cache)',
          source: null,
          decision: 'read-failed',
          banned: null,
          reactivatedAt: null,
          activeCount: 0,
          bansDetailed: []
        });
        return;
      }
    }

    if (!snap || !snap.exists()) {
      console.warn('ban-guard-debug: user doc missing; not redirecting automatically.');
      showOverlay({
        uid: user.uid,
        source,
        decision: 'missing-doc',
        banned: null,
        reactivatedAt: null,
        activeCount: 0,
        bansDetailed: []
      });
      return;
    }

    const data = snap.data();

    // Build detailed report
    const bansArray = Array.isArray(data.bans) ? data.bans.slice().reverse() : [];
    const bansDetailed = bansArray.map(b => {
      const start = parseTimestamp(b?.start);
      const end = parseTimestamp(b?.end);
      const reviewedAt = parseTimestamp(b?.reviewedAt);
      const active = banIsActive(b);
      return {
        title: b?.title || '',
        reason: b?.reason || '',
        moderatorNote: b?.moderatorNote || '',
        offensiveItem: b?.offensiveItem || '',
        start,
        end,
        reviewedAt,
        active,
        raw: b
      };
    });

    const activeCount = bansDetailed.filter(x => x.active).length;
    const reactivatedAt = parseTimestamp(data.reactivatedAt);
    const bannedFlag = data.banned === true ? true : (data.banned === false ? false : null);

    const report = {
      uid: user.uid,
      source,
      decision: (bannedFlag === true || activeCount > 0) ? 'would-redirect' : 'would-allow',
      banned: bannedFlag,
      reactivatedAt,
      activeCount,
      bansDetailed,
      raw: data,
      timestamp: new Date().toISOString()
    };

    // console output (detailed)
    console.groupCollapsed('ban-guard-debug report');
    console.log('uid:', report.uid);
    console.log('source:', report.source);
    console.log('banned flag:', report.banned);
    console.log('reactivatedAt:', report.reactivatedAt);
    console.log('active ban count:', report.activeCount);
    console.log('bans (detailed):', report.bansDetailed);
    console.log('full user doc (raw):', report.raw);
    console.log('decision:', report.decision);
    console.groupEnd();

    // Show overlay with report and DO NOT auto-redirect. Provide Force Redirect button.
    showOverlay(report);

    // extra note: if you want to re-enable automatic redirect for testing, uncomment below:
    // if (report.decision === 'would-redirect') location.replace(BAN_REDIRECT);

  } catch (err) {
    console.error('ban-guard-debug error', err);
    // Show minimal overlay on fatal error so we can see it
    showOverlay({
      uid: (auth && auth.currentUser && auth.currentUser.uid) || null,
      source: null,
      decision: 'error',
      banned: null,
      reactivatedAt: null,
      activeCount: 0,
      bansDetailed: [],
      error: String(err)
    });
  }
});
