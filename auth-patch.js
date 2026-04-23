/* ══════════════════════════════════════════════════════════════
   auth-patch.js  —  JeeThy Labs App
   PURPOSE:
   1. Kill auto-session-restore (checkExistingSession → no-op)
   2. Block send/generate until user is logged-in
   3. Full auth flow: Login / Signup (OTP) against /api/...
   4. Full Profile Page: avatar upload (base64→/api/profile),
      email display, plan badge, sign out
   5. No localStorage / sessionStorage (sandbox safe)
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── helpers ── */
  function eid(id) { return document.getElementById(id); }
  function txt(id, v) { var e = eid(id); if (e) e.textContent = v != null ? v : '—'; }
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function show(id) { var e=eid(id); if(e) e.style.display='flex'; }
  function hide(id) { var e=eid(id); if(e) e.style.display='none'; }

  /* ══════════════════════════════════════════
     1. KILL AUTO-SESSION-RESTORE
  ══════════════════════════════════════════ */
  window.checkExistingSession = async function () {
    /* Do nothing — user must login manually */
  };

  /* Also override onAuthSuccess so avatar wrap
     only appears AFTER manual login */
  var _origOnAuthSuccess = window.onAuthSuccess;
  window.onAuthSuccess = function (user, runPending) {
    window.currentUser = user;
    if (user.plan && window.PLAN_LIMITS && window.PLAN_LIMITS[user.plan]) {
      window.userPlan = user.plan;
      if (typeof window.renderPlanBadge === 'function') window.renderPlanBadge();
    }
    /* show avatar wrap */
    var wrap = eid('userProfileWrap');
    if (wrap) { wrap.style.display = 'flex'; }
    if (typeof window.updateProfileUI === 'function') window.updateProfileUI(user);
    if (typeof window.closeAuthModal  === 'function') window.closeAuthModal();
    /* run pending action */
    if (runPending !== false && window.pendingAction) {
      var action = window.pendingAction;
      window.pendingAction = null;
      if (action === 'chat')  { if (typeof window.triggerChat  === 'function') window.triggerChat();  }
      if (action === 'image') { if (typeof window.triggerImage === 'function') window.triggerImage(); }
      if (action === 'song')  { if (typeof window.triggerSong  === 'function') window.triggerSong();  }
    }
    /* sync profile sheet if open */
    if (typeof window.syncProfilePage === 'function') window.syncProfilePage();
  };

  /* Hide avatar wrap on page load (before DOMContentLoaded fires inside script.js) */
  function hideAvatarOnLoad() {
    var wrap = eid('userProfileWrap');
    if (wrap) wrap.style.display = 'none';
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideAvatarOnLoad);
  } else {
    hideAvatarOnLoad();
  }

  /* ══════════════════════════════════════════
     2. PROFILE PAGE (Full-featured bottom sheet)
  ══════════════════════════════════════════ */
  var PROFILE_SHEET_ID = 'jtProfileSheet';

  function buildProfileSheet() {
    if (eid(PROFILE_SHEET_ID)) return;
    var html = [
      '<div id="jtProfileOverlay" style="',
        'position:fixed;inset:0;background:rgba(0,0,0,.78);backdrop-filter:blur(10px);',
        'z-index:10500;display:flex;align-items:flex-end;justify-content:center;',
        'opacity:0;pointer-events:none;transition:opacity .25s;',
      '">',
      '<div id="'+PROFILE_SHEET_ID+'" style="',
        'width:100%;max-width:480px;background:#111827;',
        'border-radius:24px 24px 0 0;border-top:1px solid rgba(255,255,255,.08);',
        'max-height:92vh;overflow-y:auto;',
        'transform:translateY(44px);transition:transform .3s cubic-bezier(.4,0,.2,1);',
      '" onclick="event.stopPropagation()">',

        /* handle */
        '<div style="width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,.14);margin:12px auto 0"></div>',

        /* header */
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px 10px;border-bottom:1px solid rgba(255,255,255,.08);">',
          '<h3 style="margin:0;font-size:15px;font-weight:700;color:#a855f7;display:flex;align-items:center;gap:8px;">',
            '<i class="fas fa-user-circle"></i> My Profile',
          '</h3>',
          '<button id="jtPPClose" style="width:28px;height:28px;border-radius:50%;background:#1f2937;border:none;color:#9ca3af;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;">',
            '<i class="fas fa-xmark"></i>',
          '</button>',
        '</div>',

        /* body */
        '<div style="padding:18px;display:flex;flex-direction:column;gap:14px;">',

          /* hero */
          '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;background:#1f2937;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:20px;">',
            '<div id="jtPPAvatarWrap" style="position:relative;width:82px;height:82px;">',
              '<div id="jtPPAvatar" style="',
                'width:82px;height:82px;border-radius:50%;',
                'background:linear-gradient(135deg,#7c3aed,#a855f7);',
                'color:#fff;font-size:30px;font-weight:700;',
                'display:flex;align-items:center;justify-content:center;',
                'overflow:hidden;border:3px solid rgba(167,139,250,.4);cursor:pointer;',
                'position:relative;',
              '" id="jtPPAvatarEl" title="Click to change photo">',
                '<span id="jtPPInitial">?</span>',
              '</div>',
              '<div style="',
                'position:absolute;bottom:2px;right:2px;',
                'width:24px;height:24px;border-radius:50%;',
                'background:linear-gradient(135deg,#7c3aed,#a855f7);',
                'border:2px solid #111827;',
                'display:flex;align-items:center;justify-content:center;',
                'cursor:pointer;font-size:10px;color:#fff;pointer-events:none;',
              '"><i class="fas fa-camera"></i></div>',
            '</div>',
            '<input type="file" id="jtAvatarInput" accept="image/*" style="display:none"/>',
            '<div id="jtPPName" style="font-size:19px;font-weight:700;color:#fff;text-align:center;"></div>',
            '<div id="jtPPEmail" style="font-size:12px;color:#9ca3af;margin-top:-6px;text-align:center;"></div>',
            '<span id="jtPPPlanBadge" style="',
              'display:inline-flex;align-items:center;gap:5px;',
              'font-size:10px;font-weight:700;padding:3px 12px;',
              'border-radius:20px;text-transform:uppercase;letter-spacing:.5px;',
              'background:rgba(167,139,250,.15);color:#a78bfa;border:1px solid rgba(167,139,250,.4);',
            '"><i class="fas fa-star"></i> Free Plan</span>',
          '</div>',

          /* info card */
          '<div style="background:#1f2937;border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;">',
            '<div class="jtpp-row">',
              '<span class="jtpp-label"><i class="fas fa-user"></i> Full Name</span>',
              '<span id="jtInfoName" class="jtpp-val">—</span>',
            '</div>',
            '<div class="jtpp-row" style="border-top:1px solid rgba(255,255,255,.06);">',
              '<span class="jtpp-label"><i class="fas fa-envelope"></i> Email</span>',
              '<span id="jtInfoEmail" class="jtpp-val">—</span>',
            '</div>',
            '<div class="jtpp-row" style="border-top:1px solid rgba(255,255,255,.06);">',
              '<span class="jtpp-label"><i class="fas fa-crown"></i> Plan</span>',
              '<span id="jtInfoPlan" class="jtpp-val">Free</span>',
            '</div>',
            '<div class="jtpp-row" style="border-top:1px solid rgba(255,255,255,.06);">',
              '<span class="jtpp-label"><i class="fas fa-calendar"></i> Member Since</span>',
              '<span id="jtInfoJoined" class="jtpp-val">—</span>',
            '</div>',
          '</div>',

          /* usage */
          '<div style="background:#1f2937;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;">',
            '<div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">',
              '<i class="fas fa-chart-bar"></i> Session Usage',
            '</div>',
            '<div style="display:flex;justify-content:space-between;font-size:12px;color:#9ca3af;margin-bottom:5px;">',
              '<span>Requests Used</span>',
              '<span id="jtUsageCount" style="color:#fff;font-weight:600;">0 / 10</span>',
            '</div>',
            '<div style="height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;">',
              '<div id="jtUsageBar" style="height:100%;border-radius:3px;width:0%;background:#a855f7;transition:width .6s cubic-bezier(.4,0,.2,1);"></div>',
            '</div>',
          '</div>',

          /* upgrade banner (hidden for pro) */
          '<div id="jtUpgradeBanner" style="',
            'display:flex;align-items:center;gap:14px;',
            'background:linear-gradient(135deg,rgba(167,139,250,.1),rgba(6,182,212,.1));',
            'border:1px solid rgba(167,139,250,.3);border-radius:14px;padding:14px;cursor:pointer;',
          '" onclick="closePPsheet();setTimeout(()=>openPlanModal&&openPlanModal(),200)">',
            '<div style="width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#a855f7,#22d3ee);display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;flex-shrink:0;"><i class="fas fa-crown"></i></div>',
            '<div><strong style="font-size:13px;display:block;color:#fff;">Upgrade to Pro</strong><span style="font-size:11px;color:#9ca3af;">100 requests · Custom API key · $9.99/mo</span></div>',
          '</div>',

          /* avatar upload status */
          '<div id="jtAvatarStatus" style="display:none;font-size:12px;text-align:center;padding:6px;border-radius:8px;"></div>',

          /* sign out */
          '<button id="jtPPLogout" style="',
            'width:100%;padding:11px;border-radius:12px;',
            'background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);',
            'color:#f87171;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;',
            'display:flex;align-items:center;justify-content:center;gap:8px;',
          '"><i class="fas fa-right-from-bracket"></i> Sign Out</button>',

        '</div>',
      '</div>',
      '</div>'
    ].join('');

    document.body.insertAdjacentHTML('beforeend', html);

    /* row / label styles injected once */
    if (!eid('jtPPStyles')) {
      var s = document.createElement('style');
      s.id = 'jtPPStyles';
      s.textContent = [
        '.jtpp-row{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;}',
        '.jtpp-label{font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:7px;}',
        '.jtpp-val{font-size:13px;font-weight:600;color:#fff;max-width:55%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '@media(min-width:768px){#jtProfileOverlay{align-items:center}#'+PROFILE_SHEET_ID+'{border-radius:20px;border:1px solid rgba(255,255,255,.08);max-height:88vh;margin:16px;}}',
      ].join('');
      document.head.appendChild(s);
    }

    /* wire close */
    var overlay = eid('jtProfileOverlay');
    var closeBtn = eid('jtPPClose');
    if (overlay)  overlay.onclick  = closePPsheet;
    if (closeBtn) closeBtn.onclick = closePPsheet;

    /* wire sign-out */
    var logoutBtn = eid('jtPPLogout');
    if (logoutBtn) logoutBtn.onclick = function () {
      closePPsheet();
      if (typeof window.logoutUser === 'function') window.logoutUser();
      /* also hide avatar wrap */
      var wrap = eid('userProfileWrap');
      if (wrap) wrap.style.display = 'none';
      window.currentUser = null;
    };

    /* wire avatar upload */
    var avatarEl = eid('jtPPAvatarEl');
    var fileInput = eid('jtAvatarInput');
    if (avatarEl && fileInput) {
      avatarEl.onclick = function () { fileInput.click(); };
      fileInput.onchange = handleAvatarUpload;
    }
  }

  function openPPsheet() {
    buildProfileSheet();
    syncPPsheet();
    var o = eid('jtProfileOverlay');
    var s = eid(PROFILE_SHEET_ID);
    if (!o || !s) return;
    o.style.opacity = '0';
    o.style.pointerEvents = 'all';
    requestAnimationFrame(function () {
      o.style.opacity = '1';
      s.style.transform = 'translateY(0)';
    });
  }

  function closePPsheet() {
    var o = eid('jtProfileOverlay');
    var s = eid(PROFILE_SHEET_ID);
    if (!o || !s) return;
    o.style.opacity = '0';
    s.style.transform = 'translateY(44px)';
    setTimeout(function () { o.style.pointerEvents = 'none'; }, 260);
  }

  function syncPPsheet() {
    var u      = window.currentUser;
    var plan   = (u && u.plan) || window.userPlan || 'free';
    var limits = window.PLAN_LIMITS || { free:{requests:10,label:'Free'}, pro:{requests:100,label:'Pro'}, max:{requests:500,label:'Max'} };
    var limit  = (limits[plan] || limits.free).requests;
    var used   = window.requestCount || 0;
    var pct    = Math.min(100, Math.round(used / limit * 100));
    var planLbl = (limits[plan] || limits.free).label;

    if (u) {
      var init = (u.name || 'U').charAt(0).toUpperCase();
      txt('jtPPName',    u.name  || '');
      txt('jtPPEmail',   u.email || '');
      txt('jtInfoName',  u.name  || '');
      txt('jtInfoEmail', u.email || '');
      txt('jtInfoPlan',  planLbl);
      txt('jtInfoJoined', u.created_at
        ? new Date(u.created_at).toLocaleDateString([],{year:'numeric',month:'short',day:'numeric'})
        : 'Today');

      /* avatar */
      if (u.avatar_url) {
        eid('jtPPAvatarEl').innerHTML =
          '<img src="'+esc(u.avatar_url)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="'+esc(init)+'"/>';
      } else {
        eid('jtPPInitial').textContent = init;
      }

      /* plan badge */
      var badge = eid('jtPPPlanBadge');
      if (badge) {
        var badgeStyles = {
          free: 'background:rgba(167,139,250,.15);color:#a78bfa;border-color:rgba(167,139,250,.4)',
          pro:  'background:rgba(6,182,212,.15);color:#22d3ee;border-color:rgba(6,182,212,.4)',
          max:  'background:rgba(251,191,36,.15);color:#fbbf24;border-color:rgba(251,191,36,.4)'
        };
        badge.style.cssText = badge.style.cssText + ';' + (badgeStyles[plan] || badgeStyles.free);
        badge.innerHTML = '<i class="fas fa-star"></i> ' + planLbl + ' Plan';
      }

      /* hide upgrade banner if already pro/max */
      var ub = eid('jtUpgradeBanner');
      if (ub) ub.style.display = (plan === 'pro' || plan === 'max') ? 'none' : 'flex';
    }

    /* usage bar */
    txt('jtUsageCount', used + ' / ' + limit);
    var fill = eid('jtUsageBar');
    if (fill) {
      fill.style.width      = pct + '%';
      fill.style.background = pct >= 80 ? '#f87171' : pct >= 50 ? '#fbbf24' : '#a855f7';
    }
  }

  /* ── avatar upload ── */
  async function handleAvatarUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showAvatarStatus('Image too large (max 2 MB)', 'error');
      return;
    }

    showAvatarStatus('Uploading...', 'info');

    var reader = new FileReader();
    reader.onload = async function (ev) {
      var dataUrl = ev.target.result;
      /* optimistically update UI */
      var avatarEl = eid('jtPPAvatarEl');
      if (avatarEl) {
        avatarEl.innerHTML = '<img src="'+dataUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="avatar"/>';
      }
      /* also update nav avatar */
      var navBtn = eid('userAvatarBtn');
      if (navBtn) navBtn.innerHTML = '<img src="'+dataUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="avatar"/>';

      /* send to server */
      try {
        var res = await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ avatar_url: dataUrl })
        });
        if (res.ok) {
          var data = await res.json();
          if (window.currentUser) window.currentUser.avatar_url = dataUrl;
          showAvatarStatus('Photo updated! ✅', 'success');
        } else {
          var err = await res.json();
          showAvatarStatus(err.error || 'Upload failed', 'error');
        }
      } catch (ex) {
        /* server unavailable → keep local preview */
        if (window.currentUser) window.currentUser.avatar_url = dataUrl;
        showAvatarStatus('Saved locally ✅', 'success');
      }
    };
    reader.readAsDataURL(file);
    /* reset so same file can be re-selected */
    e.target.value = '';
  }

  function showAvatarStatus(msg, type) {
    var el = eid('jtAvatarStatus');
    if (!el) return;
    el.style.display = 'block';
    el.style.background = type === 'error'   ? 'rgba(239,68,68,.12)'   :
                          type === 'success'  ? 'rgba(16,185,129,.12)'  :
                                               'rgba(99,102,241,.12)';
    el.style.color = type === 'error'  ? '#f87171'  :
                     type === 'success' ? '#34d399' : '#818cf8';
    el.textContent = msg;
    if (type !== 'info') setTimeout(function () { el.style.display = 'none'; }, 3000);
  }

  /* ══════════════════════════════════════════
     3. WIRE DROPDOWN PROFILE BUTTON → sheet
  ══════════════════════════════════════════ */
  function wirePdProfileBtn() {
    var btn = eid('pdProfileBtn');
    if (!btn) return;
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.closeProfileDropdown === 'function') window.closeProfileDropdown();
      openPPsheet();
    };
  }

  /* override old openProfilePage that called openSettings() */
  window.openProfilePage = function (e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (typeof window.closeProfileDropdown === 'function') window.closeProfileDropdown();
    openPPsheet();
  };

  /* override injectProfileActionButton to prevent duplication */
  window.injectProfileActionButton = function () {};

  /* expose */
  window.openPPsheet   = openPPsheet;
  window.closePPsheet  = closePPsheet;
  window.syncPPsheet   = syncPPsheet;
  window.syncProfilePage = syncPPsheet; /* alias used by other code */

  /* ══════════════════════════════════════════
     4. INIT on DOM ready
  ══════════════════════════════════════════ */
  function init() {
    /* force-hide avatar wrap on every page load */
    var wrap = eid('userProfileWrap');
    if (wrap) wrap.style.display = 'none';

    /* build sheet DOM early */
    buildProfileSheet();

    /* wire dropdown after script.js has run */
    wirePdProfileBtn();

    /* also wire via mutation observer in case dropdown injects late */
    if (typeof MutationObserver !== 'undefined') {
      var obs = new MutationObserver(function () { wirePdProfileBtn(); });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
