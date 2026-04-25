/* ═══════════════════════════════════════════════════════════
   song-plan.js  —  JeeThy Labs  (FIXED v4 — matches script.js)
   ═══════════════════════════════════════════════════════════

   KEY FACTS from script.js:
   - Token key:   localStorage.getItem("jl_token")
   - Auth state:  window.currentUser  (set by onLoginSuccess)
   - Auth modal:  openAuthModal("song")
   - Song call:   _generateSong_extended() — defined in script.js, we MUST NOT
                  override generateSong() or _generateSong_extended() here.
                  Instead we EXTEND the song section UI only.
   ═══════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────
   Token — uses exact key from script.js ("jl_token")
   ───────────────────────────────────────────────────────── */
function _getSongToken() {
  // Primary: exact key used in script.js
  const t = localStorage.getItem("jl_token");
  if (t) return t;

  // Secondary: session cookie (script.js uses credentials:"include")
  // (cookies are sent automatically — just return a placeholder so
  //  _isUserLoggedIn() knows auth may still be valid)
  return null;
}

/* ─────────────────────────────────────────────────────────
   Auth state — reads window.currentUser set by script.js
   ───────────────────────────────────────────────────────── */
function _isUserLoggedIn() {
  // Best: currentUser set by onLoginSuccess in script.js
  if (window.currentUser && window.currentUser.email) return true;
  // Fallback: token in localStorage
  if (localStorage.getItem("jl_token")) return true;
  // Fallback: profile wrap visible
  const wrap = document.getElementById("userProfileWrap");
  if (wrap && wrap.style.display !== "none" && wrap.style.display !== "") return true;
  return false;
}

/* ─────────────────────────────────────────────────────────
   Plan — reads from window.currentUser + PLAN_LIMITS
   (both set by script.js)
   ───────────────────────────────────────────────────────── */
async function _detectPlan() {
  // 1. currentUser.plan is the source of truth (set by onLoginSuccess)
  const user = window.currentUser;
  if (user && user.plan) {
    const plan = user.plan.toLowerCase();
    if (plan === "max") return { plan: "max", durationHint: "3 – 4 minutes (full song)", customLyrics: true };
    if (plan === "pro") return { plan: "pro", durationHint: "2 – 3 minutes",             customLyrics: true };
    return { plan: "free", durationHint: "under 1 minute", customLyrics: false };
  }

  // 2. userPlan global (set by script.js selectPlan / confirmPlan)
  if (window.userPlan) {
    const plan = window.userPlan.toLowerCase();
    if (plan === "max") return { plan: "max", durationHint: "3 – 4 minutes (full song)", customLyrics: true };
    if (plan === "pro") return { plan: "pro", durationHint: "2 – 3 minutes",             customLyrics: true };
  }

  // 3. Try API with "jl_token"
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

  // 4. DOM badges (planBadge set by renderPlanBadge in script.js)
  const selectors = ["#planBadge","#pdBadge","#ppInfoPlan","#ppPlanBadge"];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const txt = el.textContent.trim().toLowerCase();
    if (txt.includes("max")) return { plan: "max", durationHint: "3 – 4 minutes (full song)", customLyrics: true };
    if (txt.includes("pro")) return { plan: "pro", durationHint: "2 – 3 minutes",             customLyrics: true };
  }

  return { plan: "free", durationHint: "under 1 minute", customLyrics: false };
}

/* ─────────────────────────────────────────────────────────
   Init Song UI — called when Song tab opens
   ───────────────────────────────────────────────────────── */
async function initSongSection() {
  const planInfo = await _detectPlan();
  _renderSongPlanUI(planInfo);
}

/* ─────────────────────────────────────────────────────────
   Render plan UI badges / custom lyrics panel
   ───────────────────────────────────────────────────────── */
function _renderSongPlanUI(planInfo) {
  const plan   = (planInfo.plan || "free").toLowerCase();
  const colors = { free: "#6b7280", pro: "#7c3aed", max: "#d97706" };

  const badge = document.getElementById("song-plan-badge");
  if (badge) {
    badge.textContent      = plan.toUpperCase();
    badge.style.background = colors[plan] || "#6b7280";
    badge.style.display    = "inline-block";
  }

  const hint = document.getElementById("song-duration-hint");
  if (hint) hint.textContent = "⏱ ~" + (planInfo.durationHint || "under 1 minute");

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

/* ─────────────────────────────────────────────────────────
   Custom lyrics file upload
   ───────────────────────────────────────────────────────── */
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
      _spToast("Lyrics loaded ✅");
    };
    reader.readAsText(file, "utf-8");
  });
}

/* ─────────────────────────────────────────────────────────
   generateSong — replaces the one in script.js
   Uses window.currentUser (same as script.js does)
   ───────────────────────────────────────────────────────── */
function generateSong() {
  // Use EXACTLY the same auth check as script.js
  if (!window.currentUser) {
    if (typeof openAuthModal === "function") openAuthModal("song");
    return;
  }
  // Call the extended version
  _generateSong_extended();
}

/* ─────────────────────────────────────────────────────────
   Extended _generateSong_extended — adds custom lyrics support
   while preserving 100% of the original script.js logic
   ───────────────────────────────────────────────────────── */
async function _generateSong_extended() {
  // Quota check — use script.js checkQuota()
  if (typeof checkQuota === "function" && !checkQuota()) return;

  const prompt = (document.getElementById("songPrompt")?.value || "").trim();
  const customLyricsEl = document.getElementById("custom-lyrics-textarea");
  const customLyrics   = (customLyricsEl?.value || "").trim();

  if (!prompt && !customLyrics) {
    if (typeof showToast === "function") showToast("Please enter a song description", "error");
    return;
  }

  // Use script.js getActiveChip if available
  const getChip = (id) => {
    if (typeof getActiveChip === "function") return getActiveChip(id);
    return document.querySelector(`#${id} .chip.active`)?.textContent?.trim() || "";
  };

  const style     = getChip("songStyleGroup");
  const voiceRaw  = getChip("songVoiceGroup");
  const voice     = voiceRaw.replace(/[^\w\s]/g, "").trim();
  const voiceHint = voice.toLowerCase().includes("female") ? "female vocalist" : "male vocalist";
  const btn       = document.getElementById("songGenBtn");
  const resultsEl = document.getElementById("songResults");

  const origHTML = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Composing...'; }
  if (resultsEl) resultsEl.innerHTML = `
    <div class="loading-card green-loader">
      <div class="loading-spinner"></div>
      <div class="loading-label" id="songLoadingLabel">Writing lyrics &amp; generating music with Lyria… (~20–40s)</div>
    </div>`;

  const retryHintTimer = setTimeout(() => {
    const lbl = document.getElementById("songLoadingLabel");
    if (lbl) lbl.textContent = "Lyria is composing… if slow, falling back to TTS — please wait";
  }, 20000);

  try {
    const token   = _getSongToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;

    const res = await fetch("/api/song", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        prompt: customLyrics || prompt,  // custom lyrics takes priority
        style,
        voice,
        customLyrics: customLyrics || null
      })
    });

    clearTimeout(retryHintTimer);
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }

    const data = await res.json();
    const { audio: audioB64, mimeType: audioMime, title: songTitle,
            lyrics: lyricsText, lyricsOnly, ttsMessage, audioSource } = data;

    const escHtml = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s||"")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

    const card = document.createElement("div"); card.className = "song-result-card";

    // Header
    const header = document.createElement("div"); header.className = "song-result-title";
    const isLyria     = audioSource && audioSource.toLowerCase().includes("lyria");
    const sourceBadge = audioSource
      ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;margin-left:6px;
          background:${isLyria?"rgba(168,85,247,.18)":"rgba(16,185,129,.15)"};
          color:${isLyria?"#a855f7":"#10b981"};
          border:1px solid ${isLyria?"rgba(168,85,247,.3)":"rgba(16,185,129,.3)"};">
          ${isLyria?"🎵 Lyria":"🔊 TTS"}</span>` : "";
    header.innerHTML = `<i class="fas fa-music"></i> ${escHtml(songTitle || style + " Song")}
      ${sourceBadge}
      <span style="font-size:11px;color:var(--text2);font-weight:400;margin-left:auto">
        ${escHtml(style)} · ${escHtml(voiceHint)}
      </span>`;
    card.appendChild(header);

    // Audio player
    if (audioB64) {
      const raw = atob(audioB64); const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const blob    = new Blob([bytes], { type: audioMime || "audio/wav" });
      const blobUrl = URL.createObjectURL(blob);
      const audioEl = document.createElement("audio");
      audioEl.controls = true; audioEl.preload = "auto";
      audioEl.style.cssText = "width:100%;padding:10px 14px 0;accent-color:var(--green);";
      audioEl.src = blobUrl;
      card.appendChild(audioEl);

      const ext = (audioMime || "audio/wav").split("/")[1] || "wav";
      const a   = document.createElement("a"); a.className = "btn-download";
      a.href = blobUrl; a.download = `jeethy-song-${Date.now()}.${ext}`;
      a.innerHTML = '<i class="fas fa-download"></i> Download Audio';
      card.appendChild(a);
    } else {
      // Lyrics-only notice
      const notice = document.createElement("div");
      notice.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:10px 14px;"
        + "font-size:12px;color:var(--text2);background:rgba(74,222,128,.06);"
        + "border-bottom:1px solid var(--border);";
      const msg = ttsMessage || "Audio generation temporarily unavailable — lyrics ready below. Try again shortly.";
      notice.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:8px;">
          <i class="fas fa-circle-info" style="color:var(--green);flex-shrink:0;margin-top:2px"></i>
          <span>${escHtml(msg)}</span>
        </div>
        <button onclick="_generateSong_extended()"
          style="align-self:flex-start;padding:5px 14px;border-radius:20px;border:none;
          background:var(--green,#10b981);color:#fff;font-size:11px;cursor:pointer;font-weight:600;">
          <i class="fas fa-rotate-right"></i> Retry Audio
        </button>`;
      card.appendChild(notice);
    }

    // Lyrics display
    if (lyricsText) {
      const lyricsWrap = document.createElement("div");
      lyricsWrap.style.cssText = "background:var(--surface2);border-top:1px solid var(--border);"
        + "padding:14px;font-size:13px;color:var(--text2);white-space:pre-wrap;"
        + "line-height:1.75;max-height:320px;overflow-y:auto;";
      lyricsWrap.textContent = lyricsText;
      card.appendChild(lyricsWrap);
    }

    if (resultsEl) { resultsEl.innerHTML = ""; resultsEl.appendChild(card); }
    document.querySelector(".panel-song .panel-inner-scroll")
      ?.scrollTo({ top: 99999, behavior: "smooth" });

    if (typeof incrementRequest === "function") incrementRequest();

  } catch (err) {
    clearTimeout(retryHintTimer);
    const isOverload = /overload|high demand|quota|rate.?limit/i.test(err.message || "");
    const escHtml = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s||"");
    if (resultsEl) resultsEl.innerHTML = `
      <div class="error-card">
        <i class="fas fa-circle-exclamation"></i>
        ${escHtml(err.message)}
        ${isOverload ? "<br/><small style='opacity:.7'>High demand — please wait a moment and retry.</small>" : ""}
        <br/><button onclick="_generateSong_extended()"
          style="margin-top:10px;padding:6px 16px;border-radius:20px;border:none;
          background:var(--green,#10b981);color:#fff;font-size:12px;cursor:pointer;font-weight:600;">
          <i class="fas fa-rotate-right"></i> Try Again
        </button>
      </div>`;
  }

  if (btn) { btn.disabled = false; btn.innerHTML = origHTML || '<i class="fas fa-wand-magic-sparkles"></i> Generate Song'; }
}

/* ─────────────────────────────────────────────────────────
   Toast helper (uses script.js showToast if available)
   ───────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────
   Auto-hook into goToPanel (Song tab = index 2)
   ───────────────────────────────────────────────────────── */
(function() {
  function patch() {
    if (typeof goToPanel === "function" && !goToPanel._spPatched) {
      const _orig = goToPanel;
      window.goToPanel = function(index) {
        _orig.call(this, index);
        if (index === 2) setTimeout(initSongSection, 120);
      };
      window.goToPanel._spPatched = true;
      return true;
    }
    return false;
  }

  if (!patch()) {
    document.addEventListener("DOMContentLoaded", patch);
  }

  document.addEventListener("DOMContentLoaded", function() {
    const tabs = document.querySelectorAll(".tab");
    tabs.forEach(function(tab, idx) {
      if (idx === 2 && tab.classList.contains("active")) setTimeout(initSongSection, 200);
    });
  });

  // Song tab click safety net
  document.addEventListener("click", function(e) {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    const idx = Array.from(document.querySelectorAll(".tab")).indexOf(tab);
    if (idx === 2) setTimeout(initSongSection, 120);
  });
})();
