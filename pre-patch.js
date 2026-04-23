/* ══════════════════════════════════════════
   pre-patch.js  —  MUST load BEFORE script.js
   Kills checkExistingSession before DOMContentLoaded
   so session cookie NEVER auto-restores user
══════════════════════════════════════════ */

/* 1. Kill session restore immediately */
window.checkExistingSession = async function () {
  /* intentionally empty — user must login manually */
};

/* 2. Override updateProfileUI so avatar wrap stays hidden
      unless user explicitly logs in via the auth form */
window._authFlowCompleted = false;

var _nativeUpdateProfileUI = null;

/* We wrap it: if called without login flow → ignore */
Object.defineProperty(window, 'updateProfileUI', {
  configurable: true,
  set: function (fn) { _nativeUpdateProfileUI = fn; },
  get: function () {
    return function (user) {
      if (!window._authFlowCompleted) return; /* block auto-restore */
      if (typeof _nativeUpdateProfileUI === 'function') {
        _nativeUpdateProfileUI(user);
      }
      /* ensure wrap visible only after real login */
      var wrap = document.getElementById('userProfileWrap');
      if (wrap && user) wrap.style.display = 'flex';
    };
  }
});

/* 3. Also kill injectProfileActionButton duplication */
window.injectProfileActionButton = function () {};

/* 4. Force-hide avatar wrap as soon as body exists */
function _forceHideAvatar() {
  var wrap = document.getElementById('userProfileWrap');
  if (wrap) {
    wrap.style.display = 'none';
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _forceHideAvatar);
} else {
  _forceHideAvatar();
}
