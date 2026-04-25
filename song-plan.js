/* ═══════════════════════════════════════════════════════════
   song-plan.js  —  JeeThy Labs
   Plan-aware Song UI: FREE / PRO / MAX
   Include AFTER script.js:  <script src="song-plan.js"></script>
   ═══════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────
   1.  Init — called when Song tab is opened
   ────────────────────────────────────────── */
async function initSongSection() {
  const token = (typeof getToken === 'function') ? getToken() : '';

  let planInfo = { plan: 'free', durationHint: 'under 1 minute', customLyrics: false };

  if (token) {
    try {
      const r = await fetch('/api/song/plan-info', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (r.ok) planInfo = await r.json();
    } catch (e) {
      console.warn('[song-plan] plan-info fetch error:', e.message);
    }
  }

  _renderSongPlanUI(planInfo);
}

/* ──────────────────────────────────────────
   2.  Render plan UI
   ────────────────────────────────────────── */
function _renderSongPlanUI(planInfo) {
  var plan = (planInfo.plan || 'free').toLowerCase();

  /* Plan badge */
  var badge = document.getElementById('song-plan-badge');
  if (badge) {
    var colors = { free: '#6b7280', pro: '#7c3aed', max: '#d97706' };
    badge.textContent       = plan.toUpperCase();
    badge.style.background  = colors[plan] || '#6b7280';
    badge.style.display     = 'inline-block';
  }

  /* Duration hint */
  var hint = document.getElementById('song-duration-hint');
  if (hint) {
    hint.textContent = '\u23F1 ~' + (planInfo.durationHint || 'under 1 minute');
  }

  /* Custom lyrics panel */
  var panel  = document.getElementById('custom-lyrics-panel');
  var notice = document.getElementById('custom-lyrics-upgrade-notice');

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
   3.  File upload binding (only once)
   ────────────────────────────────────────── */
function _bindLyricsFileUpload() {
  var fileInput = document.getElementById('lyrics-file-input');
  var textarea  = document.getElementById('custom-lyrics-textarea');
  if (!fileInput || !textarea || fileInput._bound) return;
  fileInput._bound = true;

  fileInput.addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (file.size > 50000) { _songToast('File too large. Max 50KB.'); return; }
    var reader = new FileReader();
    reader.onload = function(ev) {
      textarea.value = ev.target.result;
      fileInput.value = '';
      _songToast('Lyrics loaded \u2705');
    };
    reader.readAsText(file, 'utf-8');
  });
}

/* ──────────────────────────────────────────
   4.  generateSong  (replaces old function)
   ────────────────────────────────────────── */
async function generateSong() {
  var token = (typeof getToken === 'function') ? getToken() : '';
  if (!token) {
    if (typeof openAuthModal === 'function') openAuthModal();
    else alert('Please sign in first.');
    return;
  }

  var prompt  = (document.getElementById('songPrompt')?.value || '').trim();
  var styleEl = document.querySelector('#songStyleGroup .chip.active');
  var style   = styleEl ? styleEl.textContent.trim() : 'Pop';
  var voiceEl = document.querySelector('#songVoiceGroup .chip.active');
  var voiceTxt = voiceEl ? voiceEl.textContent.trim() : 'Female';
  var voice   = voiceTxt.toLowerCase().includes('male') && !voiceTxt.toLowerCase().includes('female') ? 'Male' : 'Female';
  var customLyrics = (document.getElementById('custom-lyrics-textarea')?.value || '').trim();

  if (!prompt && !customLyrics) {
    _songToast('Please enter a song description or custom lyrics.');
    return;
  }

  /* Loading state */
  var btn = document.getElementById('songGenBtn');
  var origHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...'; }

  var results = document.getElementById('songResults');
  if (results) results.innerHTML = '';

  try {
    var r = await fetch('/api/song', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ prompt: prompt || customLyrics, style: style, voice: voice, customLyrics: customLyrics })
    });

    var data = await r.json();

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
   5.  Display song result
   ────────────────────────────────────────── */
function _displaySongResult(data, container) {
  if (!container) return;

  var audioBlock = '';
  var blobUrl    = null;

  if (data.audio) {
    try {
      var mime = data.mimeType || 'audio/mp3';
      var bin  = atob(data.audio);
      var buf  = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      blobUrl = URL.createObjectURL(new Blob([buf], { type: mime }));
      var ext = mime.includes('wav') ? 'wav' : 'mp3';
      var safeName = (data.title || 'song').replace(/[^a-zA-Z0-9\u1780-\u17FF _-]/g, '');

      audioBlock = '<div class="song-result-card">'
        + '<div class="song-result-header">'
        + '<i class="fas fa-music" style="color:#22c55e;"></i>'
        + '<strong class="song-result-title">' + _esc(data.title || 'Generated Song') + '</strong>'
        + (data.audioSource ? '<span class="song-source-badge">' + _esc(data.audioSource) + '</span>' : '')
        + '</div>'
        + '<audio controls src="' + blobUrl + '" style="width:100%;border-radius:8px;margin:8px 0 4px;outline:none;"></audio>'
        + '<button class="btn-generate btn-green" style="margin-top:8px;font-size:13px;padding:10px;"'
        + ' onclick="var a=document.createElement(\'a\');a.href=\'' + blobUrl + '\';a.download=\'' + safeName + '.' + ext + '\';a.click();">'
        + '<i class="fas fa-download"></i> Download Audio</button>'
        + '</div>';
    } catch (ex) {
      console.error('[song] blob error:', ex);
    }
  }

  var lyricsBlock = '';
  if (data.lyrics) {
    lyricsBlock = '<div class="song-lyrics-card">'
      + '<div class="song-lyrics-label"><i class="fas fa-align-left"></i> Lyrics</div>'
      + '<pre class="song-lyrics-pre">' + _esc(data.lyrics) + '</pre>'
      + '</div>';
  }

  container.innerHTML = audioBlock + lyricsBlock;

  if (data.ttsMessage || data.lyricsOnly) {
    _songToast(data.ttsMessage || 'Audio unavailable — lyrics ready. Try again shortly.', 5000);
  }

  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ──────────────────────────────────────────
   6.  Upgrade modal (custom-lyrics lock)
   ────────────────────────────────────────── */
function _showSongUpgradeModal(message) {
  var modal = document.getElementById('upgrade-modal');
  var msg   = document.getElementById('upgrade-modal-message');
  if (msg) msg.textContent = message || 'Upgrade to PRO or MAX to use this feature.';
  if (modal) modal.style.display = 'flex';
}

/* ──────────────────────────────────────────
   7.  Helpers
   ────────────────────────────────────────── */
function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _songToast(msg, ms) {
  ms = ms || 3000;
  if (typeof showNotification === 'function') { showNotification(msg); return; }
  var t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);'
    + 'background:#1f2937;color:#fff;padding:10px 18px;border-radius:10px;'
    + 'z-index:9999;font-size:13px;max-width:85vw;text-align:center;'
    + 'box-shadow:0 4px 20px rgba(0,0,0,.5);line-height:1.5;pointer-events:none;';
  document.body.appendChild(t);
  setTimeout(function() { t.remove(); }, ms);
}

/* ──────────────────────────────────────────
   8.  Hook into tab switching
   Patch: in your script.js goToPanel(),
   add:  if (index === 2) initSongSection();
   OR auto-detect below:
   ────────────────────────────────────────── */
(function() {
  var _orig = window.goToPanel;
  if (typeof _orig === 'function') {
    window.goToPanel = function(index) {
      _orig.call(this, index);
      if (index === 2) initSongSection();
    };
  }

  /* Also init if Song tab is default active on load */
  document.addEventListener('DOMContentLoaded', function() {
    var activeTab = document.querySelector('.tab.active');
    if (activeTab) {
      var tabs = Array.from(document.querySelectorAll('.tab'));
      if (tabs.indexOf(activeTab) === 2) initSongSection();
    }
  });
})();
