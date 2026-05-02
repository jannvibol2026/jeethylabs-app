/* ═══════════════════════════════════════════════════════════
   song-plan.js  —  JeeThy Labs  (FIXED v5)
   ═══════════════════════════════════════════════════════════ */

function _getSongToken() {
  const t = localStorage.getItem("jl_token");
  if (t) return t;
  return null;
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
    if (plan === "max") return { plan: "max", durationHint: "3 – 4 minutes (full song)", customLyrics: true };
    if (plan === "pro") return { plan: "pro", durationHint: "2 – 3 minutes",             customLyrics: true };
    return { plan: "free", durationHint: "under 1 minute", customLyrics: false };
  }
  if (window.userPlan) {
    const plan = window.userPlan.toLowerCase();
    if (plan === "max") return { plan: "max", durationHint: "3 – 4 minutes (full song)", customLyrics: true };
    if (plan === "pro") return { plan: "pro", durationHint: "2 – 3 minutes",             customLyrics: true };
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
    if (txt.includes("max")) return { plan: "max", durationHint: "3 – 4 minutes (full song)", customLyrics: true };
    if (txt.includes("pro")) return { plan: "pro", durationHint: "2 – 3 minutes",             customLyrics: true };
  }
  return { plan: "free", durationHint: "under 1 minute", customLyrics: false };
}

async function initSongSection() {
  const planInfo = await _detectPlan();
  _renderSongPlanUI(planInfo);
}

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
   generateSong — entry point from Generate Song button
───────────────────────────────────────────────────────── */
function generateSong() {
  if (!window.currentUser) {
    if (typeof openAuthModal === "function") openAuthModal("song");
    return;
  }
  _generateSong();
}

/* ─────────────────────────────────────────────────────────
   _generateSong — main song generation with full lyrics UI
───────────────────────────────────────────────────────── */
async function _generateSong() {
  if (typeof checkQuota === "function" && !checkQuota()) return;

  const prompt = (document.getElementById("songPrompt")?.value || "").trim();
  const customLyricsEl = document.getElementById("custom-lyrics-textarea");
  const customLyrics   = (customLyricsEl?.value || "").trim();

  if (!prompt && !customLyrics) {
    if (typeof showToast === "function") showToast("Please enter a song description", "error");
    return;
  }

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
        prompt: customLyrics || prompt,
        style,
        voice,
        customLyrics: customLyrics || null
      })
    });

    clearTimeout(retryHintTimer);
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }

    const data = await res.json();
    const { audio: audioB64, mimeType: audioMime, title: songTitle,
            lyrics: lyricsText, ttsMessage, audioSource } = data;

    const escHtml = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const card = document.createElement("div");
    card.className = "song-result-card";

    /* ── Header ── */
    const header = document.createElement("div");
    header.className = "song-result-title";
    const isLyria     = audioSource && audioSource.toLowerCase().includes("lyria");
    const sourceBadge = audioSource
      ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;margin-left:6px;
          background:${isLyria ? "rgba(168,85,247,.18)" : "rgba(16,185,129,.15)"};
          color:${isLyria ? "#a855f7" : "#10b981"};
          border:1px solid ${isLyria ? "rgba(168,85,247,.3)" : "rgba(16,185,129,.3)"};">
          ${isLyria ? "🎵 Lyria" : "🔊 TTS"}</span>` : "";
    header.innerHTML = `
      <i class="fas fa-music"></i> ${escHtml(songTitle || style + " Song")}
      ${sourceBadge}
      <span style="font-size:11px;color:var(--text2);font-weight:400;margin-left:auto">
        ${escHtml(style)} · ${escHtml(voiceHint)}
      </span>`;
    card.appendChild(header);

    /* ── Audio player ── */
    if (audioB64) {
      const raw = atob(audioB64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const blob    = new Blob([bytes], { type: audioMime || "audio/wav" });
      const blobUrl = URL.createObjectURL(blob);

      const audioEl = document.createElement("audio");
      audioEl.controls = true;
      audioEl.preload  = "auto";
      audioEl.style.cssText = "width:100%;padding:10px 14px 0;accent-color:var(--green);";
      audioEl.src = blobUrl;
      card.appendChild(audioEl);

      const ext = (audioMime || "audio/wav").split("/")[1] || "wav";
      const a   = document.createElement("a");
      a.className = "btn-download";
      a.href      = blobUrl;
      a.download  = `jeethy-song-${Date.now()}.${ext}`;
      a.innerHTML = '<i class="fas fa-download"></i> Download Audio';
      card.appendChild(a);
    } else {
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
        <button onclick="_generateSong()"
          style="align-self:flex-start;padding:5px 14px;border-radius:20px;border:none;
          background:var(--green,#10b981);color:#fff;font-size:11px;cursor:pointer;font-weight:600;">
          <i class="fas fa-rotate-right"></i> Retry Audio
        </button>`;
      card.appendChild(notice);
    }

    /* ── Lyrics section ── */
    if (lyricsText) {
      /* Lyrics header row */
      const lyricsHeader = document.createElement("div");
      lyricsHeader.style.cssText = "display:flex;align-items:center;justify-content:space-between;"
        + "padding:10px 14px 6px;border-top:1px solid var(--border);";
      lyricsHeader.innerHTML = `
        <span style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;">
          <i class="fas fa-microphone-lines" style="margin-right:5px;color:var(--green)"></i>Lyrics
        </span>
        <button class="sp-lyrics-edit-btn" onclick="toggleLyricsEdit(this)"
          style="font-size:11px;padding:4px 12px;border-radius:20px;
          border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);
          color:#d1d5db;cursor:pointer;display:inline-flex;align-items:center;gap:5px;
          transition:all .2s;">
          <i class="fas fa-pen"></i> Edit
        </button>`;
      card.appendChild(lyricsHeader);

      /* Lyrics wrapper */
      const lyricsWrap = document.createElement("div");
      lyricsWrap.className = "lyrics-display-wrap";
      lyricsWrap.style.cssText = "background:rgba(255,255,255,.03);margin:0 12px 14px;"
        + "border-radius:10px;border:1px solid rgba(255,255,255,.07);overflow:hidden;";

      /* Display <pre> */
      const lyricsPre = document.createElement("pre");
      lyricsPre.className = "sp-lyrics-pre";
      lyricsPre.style.cssText = "padding:14px 16px;font-size:13px;color:#d1d5db;"
        + "white-space:pre-wrap;line-height:1.9;font-family:inherit;margin:0;"
        + "overflow-y:auto;max-height:320px;";
      lyricsPre.textContent = lyricsText;

      /* Edit <textarea> */
      const lyricsEditor = document.createElement("textarea");
      lyricsEditor.className = "sp-lyrics-editor";
      lyricsEditor.value = lyricsText;
      lyricsEditor.style.cssText = "display:none;width:100%;padding:14px 16px;font-size:13px;"
        + "color:#d1d5db;background:rgba(255,255,255,.05);border:none;outline:none;"
        + "line-height:1.9;font-family:inherit;resize:vertical;"
        + "min-height:220px;box-sizing:border-box;";
      lyricsEditor.addEventListener("input", function() {
        lyricsPre.textContent = this.value;
      });

      lyricsWrap.appendChild(lyricsPre);
      lyricsWrap.appendChild(lyricsEditor);
      card.appendChild(lyricsWrap);
    }

    if (resultsEl) { resultsEl.innerHTML = ""; resultsEl.appendChild(card); }
    document.querySelector(".panel-song .panel-inner-scroll")
      ?.scrollTo({ top: 99999, behavior: "smooth" });

    if (typeof incrementRequest === "function") incrementRequest();

  } catch (err) {
    clearTimeout(retryHintTimer);
    const isOverload = /overload|high demand|quota|rate.?limit/i.test(err.message || "");
    const escHtml = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s || "");
    if (resultsEl) resultsEl.innerHTML = `
      <div class="error-card">
        <i class="fas fa-circle-exclamation"></i>
        ${escHtml(err.message)}
        ${isOverload ? "<br/><small style='opacity:.7'>High demand — please wait a moment and retry.</small>" : ""}
        <br/><button onclick="_generateSong()"
          style="margin-top:10px;padding:6px 16px;border-radius:20px;border:none;
          background:var(--green,#10b981);color:#fff;font-size:12px;cursor:pointer;font-weight:600;">
          <i class="fas fa-rotate-right"></i> Try Again
        </button>
      </div>`;
  }

  if (btn) { btn.disabled = false; btn.innerHTML = origHTML || '<i class="fas fa-wand-magic-sparkles"></i> Generate Song'; }
}

/* ─────────────────────────────────────────────────────────
   toggleLyricsEdit — Edit / Done button handler
───────────────────────────────────────────────────────── */
function toggleLyricsEdit(btn) {
  const wrap    = btn.closest(".song-result-card") || document;
  const preview = wrap.querySelector(".sp-lyrics-pre");
  const editor  = wrap.querySelector(".sp-lyrics-editor");
  if (!preview || !editor) return;

  const isEditing = editor.style.display !== "none";

  if (isEditing) {
    /* Save → back to preview */
    preview.textContent     = editor.value;
    preview.style.display   = "block";
    editor.style.display    = "none";
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
    btn.innerHTML           = '<i class="fas fa-check"></i> Done';
    btn.style.borderColor   = "var(--green,#10b981)";
    btn.style.background    = "rgba(16,185,129,.12)";
    btn.style.color         = "var(--green,#10b981)";
  }
}

/* ─────────────────────────────────────────────────────────
   Toast helper
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
