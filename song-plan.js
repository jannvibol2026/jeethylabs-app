/* ═══════════════════════════════════════════════════════════
   song-plan.js  —  JeeThy Labs  (FIXED v2)
   ═══════════════════════════════════════════════════════════ */

/* ─── Token helper — tries multiple methods ─── */
function _getSongToken() {
  // 1. Use existing getToken() from script.js if available
  if (typeof getToken === 'function') {
    const t = getToken();
    if (t) return t;
  }
  // 2. Common localStorage keys used in JeeThy Labs
  const keys = ['jt_token','token','auth_token','jwt','accessToken','access_token','userToken'];
  for (const k of keys) {
    const t = localStorage.getItem(k) || sessionStorage.getItem(k);
    if (t) return t;
  }
  // 3. Check window-level token variables
  const winKeys = ['authToken','jwtToken','TOKEN','currentToken'];
  for (const k of winKeys) {
    if (window[k]) return window[k];
  }
  return null;
}

/* ─── Plan detection — tries server then falls back to DOM ─── */
async function _detectPlan() {
  const token = _getSongToken();

  // Default fallback
  let planInfo = { plan: 'free', durationHint: 'under 1 minute', customLyrics: false };

  if (token) {
    try {
      const r = await fetch('/api/song/plan-info', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (r.ok) {
        const data = await r.json();
        if (data && data.plan) return data;
      }
    } catch (e) {
      console.warn('[song-plan] /api/song/plan-info failed:', e.message);
    }
  }

  // Fallback: read plan from DOM (planBadge button text in nav)
  const badge = document.getElementById('planBadge');
  if (badge) {
    const txt = badge.textContent.trim().toLowerCase();
    if (txt.includes('max')) {
      planInfo = { plan: 'max', durationHint: '3 – 4 minutes (full song)', customLyrics: true };
    } else if (txt.includes('pro')) {
      planInfo = { plan: 'pro', durationHint: '2 – 3 minutes', customLyrics: true };
    }
  }

  // Fallback: read from pdBadge or ppInfoPlan in profile
  if (planInfo.plan === 'free') {
    const planEls = ['pdBadge','ppInfoPlan','ppPlanBadge'];
    for (const id of planEls) {
      const el = document.getElementById(id);
      if (el) {
        const txt = el.textContent.trim().toLowerCase();
        if (txt.includes('max')) {
          planInfo = { plan: 'max', durationHint: '3 – 4 minutes (full song)', customLyrics: true };
          break;
        } else if (txt.includes('pro')) {
          planInfo = { plan: 'pro', durationHint: '2 – 3 minutes', customLyrics: true };
          break;
        }
      }
    }
  }

  return planInfo;
}

/* ──────────────────────────────────────────
   Init — called when Song tab is opened
   ────────────────────────────────────────── */
async function initSongSection() {
  const planInfo = await _detectPlan();
  _renderSongPlanUI(planInfo);
}

/* ──────────────────────────────────────────
   Render plan UI
   ────────────────────────────────────────── */
function _renderSongPlanUI(planInfo) {
  const plan = (planInfo.plan || 'free').toLowerCase();
  const colors = { free: '#6b7280', pro: '#7c3aed', max: '#d97706' };

  // Plan badge
  const badge = document.getElementById('song-plan-badge');
  if (badge) {
    badge.textContent      = plan.toUpperCase();
    badge.style.background = colors[plan] || '#6b7280';
    badge.style.display    = 'inline-block';
  }

  // Duration hint
  const hint = document.getElementById('song-duration-hint');
  if (hint) hint.textContent = '\u23F1 ~' + (planInfo.durationHint || 'under 1 minute');

  // Custom lyrics panel
  const panel  = document.getElementById('custom-lyrics-panel');
  const notice = document.getElementById('custom-lyrics-upgrade-notice');

  if (planInfo.customLyrics) {
    if (panel)  panel.style.display  = 'block';
    if (notice) notice.style.display = 'none';
    _bindLyricsFileUpload();
  } else {
    if (panel)  panel.style.display  = 'none';
    if (notice) notice.style.display = 'block';
  }
}

/* ──────────────────────────────────────────
   File upload handler
   ────────────────────────────────────────── */
function _bindLyricsFileUpload() {
  const fileInput = document.getElementById('lyrics-file-input');
  const textarea  = document.getElementById('custom-lyrics-textarea');
  if (!fileInput || !textarea || fileInput._bound) return;
  fileInput._bound = true;
  fileInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 50000) { _songToast('File too large. Max 50KB.'); return; }
    const reader = new FileReader();
    reader.onload = function(ev) {
      textarea.value = ev.target.result;
      fileInput.value = '';
      _songToast('Lyrics loaded \u2705');
    };
    reader.readAsText(file, 'utf-8');
  });
}

/* ──────────────────────────────────────────
   generateSong — FIXED token + auth check
   ────────────────────────────────────────── */
async function generateSong() {
  const token = _getSongToken();

  // Auth check
  if (!token) {
    // Try existing openAuthModal from script.js
    if (typeof openAuthModal === 'function')  { openAuthModal(); return; }
    if (typeof showAuthModal === 'function')  { showAuthModal(); return; }
    // Fallback: trigger authModal directly
    const modal = document.getElementById('authModal');
    if (modal) modal.style.display = 'flex';
    return;
  }

  const prompt       = (document.getElementById('songPrompt')?.value || '').trim();
  const styleEl      = document.querySelector('#songStyleGroup .chip.active');
  const style        = styleEl ? styleEl.textContent.trim() : 'Pop';
  const voiceEl      = document.querySelector('#songVoiceGroup .chip.active');
  const voiceTxt     = voiceEl ? voiceEl.textContent.trim() : 'Female';
  const voice        = (voiceTxt.toLowerCase().includes('male') && !voiceTxt.toLowerCase().includes('female')) ? 'Male' : 'Female';
  const customLyrics = (document.getElementById('custom-lyrics-textarea')?.value || '').trim();

  if (!prompt && !customLyrics) {
    _songToast('Please enter a song description or custom lyrics.');
    return;
  }

  // Loading state
  const btn = document.getElementById('songGenBtn');
  const origHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...'; }
  const results = document.getElementById('songResults');
  if (results) results.innerHTML = '';

  try {
    const r = await fetch('/api/song', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ prompt: prompt || customLyrics, style, voice, customLyrics })
    });

    const data = await r.json();

    if (!r.ok) {
      if (data.upgradeRequired) {
        _showSongUpgradeModal(data.error);
      } else {
        _songToast('Error: ' + (data.error || 'Generation failed.'));
      }
      return;
    }

    _displaySongResult(data, results);

  } catch (e) {
    _songToast('Network error: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
  }
}

/* ──────────────────────────────────────────
   Display song result
   ────────────────────────────────────────── */
function _displaySongResult(data, container) {
  if (!container) return;
  let audioBlock = '', blobUrl = null;

  if (data.audio) {
    try {
      const mime = data.mimeType || 'audio/mp3';
      const bin  = atob(data.audio);
      const buf  = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      blobUrl = URL.createObjectURL(new Blob([buf], { type: mime }));
      const ext  = mime.includes('wav') ? 'wav' : 'mp3';
      const name = (data.title || 'song').replace(/[^a-zA-Z0-9\u1780-\u17FF _-]/g, '');

      audioBlock = `
        <div class="song-result-card">
          <div class="song-result-header">
            <i class="fas fa-music" style="color:#22c55e;"></i>
            <strong class="song-result-title">${_esc(data.title || 'Generated Song')}</strong>
            ${data.audioSource ? `<span class="song-source-badge">${_esc(data.audioSource)}</span>` : ''}
          </div>
          <audio controls src="${blobUrl}" style="width:100%;border-radius:8px;margin:8px 0 4px;"></audio>
          <button class="btn-generate btn-green" style="margin-top:8px;font-size:13px;padding:10px;"
            onclick="(function(){var a=document.createElement('a');a.href='${blobUrl}';a.download='${name}.${ext}';a.click();})()">
            <i class="fas fa-download"></i> Download Audio
          </button>
        </div>`;
    } catch (ex) { console.error('[song] blob error:', ex); }
  }

  const lyricsBlock = data.lyrics ? `
    <div class="song-lyrics-card">
      <div class="song-lyrics-label"><i class="fas fa-align-left"></i> Lyrics</div>
      <pre class="song-lyrics-pre">${_esc(data.lyrics)}</pre>
    </div>` : '';

  container.innerHTML = audioBlock + lyricsBlock;
  if (data.ttsMessage || data.lyricsOnly) {
    _songToast(data.ttsMessage || 'Audio unavailable — lyrics ready. Try again shortly.', 5000);
  }
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ──────────────────────────────────────────
   Helpers
   ────────────────────────────────────────── */
function _showSongUpgradeModal(message) {
  const modal = document.getElementById('upgrade-modal');
  const msg   = document.getElementById('upgrade-modal-message');
  if (msg)   msg.textContent = message || 'Upgrade to PRO or MAX to use this feature.';
  if (modal) modal.style.display = 'flex';
}

function _esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _songToast(msg, ms) {
  ms = ms || 3000;
  if (typeof showNotification === 'function') { showNotification(msg); return; }
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);'
    + 'background:#1f2937;color:#fff;padding:10px 18px;border-radius:10px;'
    + 'z-index:9999;font-size:13px;max-width:85vw;text-align:center;'
    + 'box-shadow:0 4px 20px rgba(0,0,0,.5);line-height:1.5;pointer-events:none;';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ──────────────────────────────────────────
   Hook into goToPanel (auto-patch)
   ────────────────────────────────────────── */
(function() {
  // Wait for script.js to load, then patch goToPanel
  function patchGoToPanel() {
    if (typeof goToPanel === 'function' && !goToPanel._songPatched) {
      const _orig = goToPanel;
      window.goToPanel = function(index) {
        _orig.call(this, index);
        if (index === 2) initSongSection();
      };
      window.goToPanel._songPatched = true;
    }
  }

  // Try immediately, then retry after DOM ready
  patchGoToPanel();
  document.addEventListener('DOMContentLoaded', function() {
    patchGoToPanel();
    // Auto-init if Song tab is currently active
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(function(tab, idx) {
      if (idx === 2 && tab.classList.contains('active')) initSongSection();
    });
  });

  // Also listen for tab clicks directly as a safety net
  document.addEventListener('click', function(e) {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const tabs = Array.from(document.querySelectorAll('.tab'));
    if (tabs.indexOf(tab) === 2) {
      setTimeout(initSongSection, 100);
    }
  });
})();
