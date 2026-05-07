/*  * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * 
   song-plan.js   "  JeeThy Labs  (FIXED v5)
    * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *  */

function _getSongToken() {
  try {
    return localStorage.getItem("jl_token")
        || sessionStorage.getItem("jl_token")
        || window._jlToken
        || window.authToken
        || null;
  } catch(e) {
    return window._jlToken || window.authToken || null;
  }
}

function _isUserLoggedIn() {
  if (window.currentUser && window.currentUser.email) return true;
  if (localStorage.getItem("jl_token")) return true;
  const wrap = document.getElementById("userProfileWrap");
  if (wrap && wrap.style.display !== "none" && wrap.style.display !== "") return true;
  return false;
}

async function _detectPlan() {
  const user = window.currentUser;
  if (user && user.plan) {
    const plan = user.plan.toLowerCase();
    if (plan === "max")     return { plan: "max",     durationHint: "4:25–5:25 (full song)", customLyrics: true };
    if (plan === "proplus") return { plan: "proplus", durationHint: "3:00–3:25",              customLyrics: true };
    if (plan === "pro")     return { plan: "pro",     durationHint: "2:50–3:05",              customLyrics: true };
    return { plan: "free", durationHint: "~55s", customLyrics: false };
  }
  if (window.userPlan) {
    const plan = window.userPlan.toLowerCase();
    if (plan === "max")     return { plan: "max",     durationHint: "4:25–5:25 (full song)", customLyrics: true };
    if (plan === "proplus") return { plan: "proplus", durationHint: "3:00–3:25",              customLyrics: true };
    if (plan === "pro")     return { plan: "pro",     durationHint: "2:50–3:05",              customLyrics: true };
  }
  const token = _getSongToken();
  if (token) {
    try {
      const r = await fetch("/api/song/plan-info", {
        credentials: "include",
        headers: { "Authorization": "Bearer " + token }
      });
      if (r.ok) {
        const data = await r.json();
        if (data && data.plan) return data;
      }
    } catch (e) { /* ignore */ }
  }
  const selectors = ["#planBadge","#pdBadge","#ppInfoPlan","#ppPlanBadge"];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const txt = el.textContent.trim().toLowerCase();
    if (txt.includes("max"))                              return { plan: "max",     durationHint: "4:25–5:25 (full song)", customLyrics: true };
    if (txt.includes("pro+") || txt.includes("proplus")) return { plan: "proplus", durationHint: "3:00–3:25",              customLyrics: true };
    if (txt.includes("pro"))                             return { plan: "pro",     durationHint: "2:50–3:05",              customLyrics: true };
  }
  return { plan: "free", durationHint: "~55s", customLyrics: false };
}

async function initSongSection() {
  const planInfo = await _detectPlan();
  _renderSongPlanUI(planInfo);
}

function _renderSongPlanUI(planInfo) {
  const plan   = (planInfo.plan || "free").toLowerCase();
  window._spCurrentPlan = plan; /* store for lyrics auto-fill */
  const colors = { free: "#9ca3af", pro: "#06b6d4", proplus: "#a855f7", max: "#fbbf24" };

  const badge = document.getElementById("song-plan-badge");
  if (badge) {
    badge.textContent      = plan === "proplus" ? "PRO+" : plan.toUpperCase();
    badge.style.background = colors[plan] || "#6b7280";
    badge.style.display    = "inline-block";
  }

  const hint = document.getElementById("song-duration-hint");
  if (hint) hint.textContent = "~" + (planInfo.durationHint || "under 1 minute");

  const panel  = document.getElementById("custom-lyrics-panel");
  const notice = document.getElementById("custom-lyrics-upgrade-notice");
  if (planInfo.customLyrics) {
    if (panel)  panel.style.display  = "block";
    if (notice) notice.style.display = "none";
    _bindLyricsFileUpload();
  } else {
    if (panel)  panel.style.display  = "none";
    if (notice) notice.style.display = "block";
  }
}

function _bindLyricsFileUpload() {
  const fileInput = document.getElementById("lyrics-file-input");
  const textarea  = document.getElementById("custom-lyrics-textarea");
  if (!fileInput || !textarea || fileInput._bound) return;
  fileInput._bound = true;
  fileInput.addEventListener("change", function(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 50000) { _spToast("File too large. Max 50KB."); return; }
    const reader = new FileReader();
    reader.onload = function(ev) {
      textarea.value = ev.target.result;
      fileInput.value = "";
      _spToast("Lyrics loaded  ...");
    };
    reader.readAsText(file, "utf-8");
  });
}

/*  " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " 
   generateSong -  entry point from Generate Song button
 " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "  */
function _generateSongSP() {
  if (!window.currentUser) {
    if (typeof openAuthModal === "function") openAuthModal("song");
    return;
  }
  _generateSong();
}


function toggleLyricsEdit(btn) {
  const wrap    = btn.closest(".song-result-card") || document;
  const preview = wrap.querySelector(".sp-lyrics-pre");
  const editor  = wrap.querySelector(".sp-lyrics-editor");
  const footer  = wrap.querySelector(".sp-regen-footer");
  if (!preview || !editor) return;

  const isEditing = editor.style.display !== "none";

  if (isEditing) {
    /* Save  ' back to preview */
    preview.textContent     = editor.value;
    preview.style.display   = "block";
    editor.style.display    = "none";
    if (footer) footer.style.display = "none";
    btn.innerHTML           = '<i class="fas fa-pen"></i> Edit';
    btn.style.borderColor   = "rgba(255,255,255,.15)";
    btn.style.background    = "rgba(255,255,255,.06)";
    btn.style.color         = "#d1d5db";
  } else {
    /* Switch to editor */
    editor.value            = preview.textContent;
    preview.style.display   = "none";
    editor.style.display    = "block";
    editor.focus();
    if (footer) footer.style.display = "block";
    btn.innerHTML           = '<i class="fas fa-check"></i> Done';
    btn.style.borderColor   = "var(--green,#10b981)";
    btn.style.background    = "rgba(16,185,129,.12)";
    btn.style.color         = "var(--green,#10b981)";
  }
}

/*  " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " 
   Toast helper
 " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "  */
function _spToast(msg, ms) {
  if (typeof showToast === "function") { showToast(msg, "info"); return; }
  ms = ms || 3000;
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%);"
    + "background:#1f2937;color:#fff;padding:10px 18px;border-radius:10px;z-index:9999;"
    + "font-size:13px;max-width:85vw;text-align:center;pointer-events:none;"
    + "box-shadow:0 4px 20px rgba(0,0,0,.5);";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/*  " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " 
   Auto-hook into goToPanel (Song tab = index 2)
 " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " "  */
(function () {
  function patch() {
    if (typeof goToPanel === "function" && !goToPanel._spPatched) {
      const _orig = goToPanel;
      window.goToPanel = function (index) {
        _orig.call(this, index);
        if (index === 2) setTimeout(initSongSection, 120);
      };
      window.goToPanel._spPatched = true;
      return true;
    }
    return false;
  }

  if (!patch()) document.addEventListener("DOMContentLoaded", patch);

  document.addEventListener("DOMContentLoaded", function () {
    const tabs = document.querySelectorAll(".tab");
    tabs.forEach(function (tab, idx) {
      if (idx === 2 && tab.classList.contains("active")) setTimeout(initSongSection, 200);
    });
  });

  document.addEventListener("click", function (e) {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    const idx = Array.from(document.querySelectorAll(".tab")).indexOf(tab);
    if (idx === 2) setTimeout(initSongSection, 120);
  });
})();
