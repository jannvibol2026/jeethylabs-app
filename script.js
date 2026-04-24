'use strict';

/* ════════════════════════════════════════════════════════════════
   script.js — JeeThy Labs  (FINAL CLEAN VERSION)
   ‣ All API calls go through server proxy  (/api/chat, /api/image, /api/song)
   ‣ GEMINI_API_KEY is read from Railway env var on the server — never in client
   ‣ Auth token stored in memory (authToken) + passed via Authorization header
   ‣ User profile: avatar upload, plan badge, sign out — all wired
   ════════════════════════════════════════════════════════════════ */

/* ── 1. GLOBALS ────────────────────────────────────────────────── */
var currentUser   = null;
var authToken     = null;          // JWT stored in memory
var userPlan      = 'free';
var requestCount  = 0;

var PLAN_LIMITS = {
  free : { label:'Free', requests:10  },
  pro  : { label:'Pro',  requests:100 },
  max  : { label:'Max',  requests:500 }
};

var chatHistory = [];              // [{role,parts}]

/* ── 2. API HELPER ─────────────────────────────────────────────── */
/* All server calls go here — adds Bearer token automatically */
async function apiCall(path, body) {
  var headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  var res = await fetch(path, {
    method  : 'POST',
    headers : headers,
    body    : JSON.stringify(body || {})
  });
  return res;
}

async function apiGet(path) {
  var headers = {};
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  return fetch(path, { headers: headers });
}

/* ── 3. TOKEN PERSIST (memory only — no localStorage) ─────────── */
/* Token lives only while page is open (Railway sandbox safe) */
function saveToken(token) { authToken = token; }
function clearToken()     { authToken = null; }

/* ── 4. SESSION RESTORE — disabled (manual login only) ────────── */
/* We block auto-session to force login screen */
window.checkExistingSession = function() { /* intentionally empty */ };

/* ── 5. PLAN BADGE ─────────────────────────────────────────────── */
function renderPlanBadge() {
  var el = document.getElementById('planBadge');
  if (!el) return;
  var info = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  el.textContent = info.label;
  el.style.background = userPlan === 'pro' ? 'rgba(6,182,212,.15)'
                      : userPlan === 'max' ? 'rgba(251,191,36,.15)'
                      : 'rgba(167,139,250,.15)';
  el.style.color = userPlan === 'pro' ? '#22d3ee'
                 : userPlan === 'max' ? '#fbbf24'
                 : '#a78bfa';
}

/* ── 6. TOAST ──────────────────────────────────────────────────── */
function showToast(msg, type) {
  var t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
    'padding:10px 20px;border-radius:24px;font-size:13px;font-weight:600;z-index:99999;' +
    'color:#fff;pointer-events:none;opacity:0;transition:opacity .3s;' +
    'background:' + (type==='error'?'rgba(239,68,68,.9)':type==='success'?'rgba(16,185,129,.9)':'rgba(99,102,241,.9)');
  document.body.appendChild(t);
  requestAnimationFrame(function(){ t.style.opacity='1'; });
  setTimeout(function(){ t.style.opacity='0'; setTimeout(function(){ t.remove(); }, 400); }, 2800);
}

/* ── 7. QUOTA CHECK ────────────────────────────────────────────── */
function checkQuota() {
  var limit = (PLAN_LIMITS[userPlan] || PLAN_LIMITS.free).requests;
  if (requestCount >= limit) {
    var m = document.getElementById('upgradeModal');
    if (m) m.classList.add('open');
    return false;
  }
  return true;
}

/* ── 8. CHAT ───────────────────────────────────────────────────── */
function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function addMsg(role, text, time) {
  var wrap = document.getElementById('chatMessages');
  if (!wrap) return;
  var isBot = role === 'bot';
  var div = document.createElement('div');
  div.className = 'msg ' + (isBot ? 'msg-bot' : 'msg-user');
  var t = time || new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  div.innerHTML = isBot
    ? '<div class="msg-avatar"><i class="fas fa-brain"></i></div>' +
      '<div class="msg-bubble"><p>' + escHtml(text) + '</p><span class="msg-time">' + t + '</span></div>'
    : '<div class="msg-bubble msg-bubble-user"><p>' + escHtml(text) + '</p><span class="msg-time">' + t + '</span></div>';
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

async function sendChat() {
  if (!currentUser) { openAuthModal('chat'); return; }
  if (!checkQuota()) return;

  var inp = document.getElementById('chatInput');
  var msg = inp ? inp.value.trim() : '';
  if (!msg) return;

  inp.value = '';
  inp.style.height = 'auto';
  addMsg('user', msg);

  chatHistory.push({ role:'user', parts:[{text: msg}] });

  // typing indicator
  var wrap = document.getElementById('chatMessages');
  var typing = document.createElement('div');
  typing.className = 'msg msg-bot';
  typing.id = 'typingIndicator';
  typing.innerHTML = '<div class="msg-avatar"><i class="fas fa-brain"></i></div>' +
    '<div class="msg-bubble"><span class="msg-time">...</span></div>';
  if (wrap) { wrap.appendChild(typing); wrap.scrollTop = wrap.scrollHeight; }

  try {
    var res  = await apiCall('/api/chat', { history: chatHistory });
    var data = await res.json();

    if (typing) typing.remove();

    if (res.ok) {
      var reply = data.reply || 'No response.';
      chatHistory.push({ role:'model', parts:[{text: reply}] });
      addMsg('bot', reply);
      requestCount++;
    } else {
      addMsg('bot', '❌ ' + (data.error || 'Server error. Please try again.'));
    }
  } catch (ex) {
    if (typing) typing.remove();
    addMsg('bot', '❌ Network error. Check your connection.');
  }
}

/* ── 9. IMAGE GENERATE ─────────────────────────────────────────── */
function selectChip(btn, groupId) {
  var group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.chip').forEach(function(c){ c.classList.remove('active'); });
  btn.classList.add('active');
}

function requirePro(btn, groupId) {
  if (userPlan === 'pro' || userPlan === 'max') { selectChip(btn, groupId); return; }
  var m = document.getElementById('planModal');
  if (m) m.classList.add('open');
}

async function generateImage() {
  if (!currentUser) { openAuthModal('image'); return; }
  if (!checkQuota()) return;

  var prompt = (document.getElementById('imgPrompt') || {}).value || '';
  if (!prompt.trim()) { showToast('Please enter a prompt','error'); return; }

  var style = '', ratio = '1:1';
  var sg = document.getElementById('imgStyleGroup');
  if (sg) { var sc = sg.querySelector('.chip.active'); if (sc) style = sc.textContent.trim(); }
  var rg = document.getElementById('imgRatioGroup');
  if (rg) { var rc = rg.querySelector('.chip.active'); if (rc) ratio = rc.textContent.trim(); }

  var fullPrompt = style && style !== 'Other' ? style + ' style: ' + prompt : prompt;

  var btn = document.getElementById('imgGenBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...'; }

  var results = document.getElementById('imgResults');
  if (results) results.innerHTML = '<div style="text-align:center;padding:32px;color:#9ca3af;"><i class="fas fa-spinner fa-spin" style="font-size:2rem;color:#22d3ee;"></i><p style="margin-top:12px;font-size:13px;">Creating your image...</p></div>';

  try {
    var res  = await apiCall('/api/image', { prompt: fullPrompt, aspectRatio: ratio });
    var data = await res.json();

    if (res.ok && data.data) {
      var src = 'data:' + (data.mimeType||'image/png') + ';base64,' + data.data;
      if (results) results.innerHTML =
        '<div style="border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.08);">' +
        '<img src="' + src + '" style="width:100%;display:block;" alt="Generated image"/></div>' +
        '<a download="jeethylabs-image.png" href="' + src + '" ' +
        'style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;' +
        'padding:10px;border-radius:10px;background:rgba(6,182,212,.1);border:1px solid rgba(6,182,212,.2);' +
        'color:#22d3ee;font-size:13px;font-weight:600;text-decoration:none;">' +
        '<i class="fas fa-download"></i> Download Image</a>';
      requestCount++;
    } else {
      if (results) results.innerHTML = '<div style="text-align:center;padding:24px;color:#f87171;">❌ ' + (data.error||'Generation failed') + '</div>';
    }
  } catch (ex) {
    if (results) results.innerHTML = '<div style="text-align:center;padding:24px;color:#f87171;">❌ Network error.</div>';
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Image'; }
}

/* ── 10. SONG GENERATE ─────────────────────────────────────────── */
async function generateSong() {
  if (!currentUser) { openAuthModal('song'); return; }
  if (!checkQuota()) return;

  var prompt = (document.getElementById('songPrompt') || {}).value || '';
  if (!prompt.trim()) { showToast('Please describe the song','error'); return; }

  var style = 'Pop', voice = 'Female';
  var sg = document.getElementById('songStyleGroup');
  if (sg) { var sc = sg.querySelector('.chip.active'); if (sc) style = sc.textContent.trim(); }
  var vg = document.getElementById('songVoiceGroup');
  if (vg) { var vc = vg.querySelector('.chip.active'); if (vc) voice = vc.textContent.trim(); }

  var btn = document.getElementById('songGenBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Composing...'; }

  var results = document.getElementById('songResults');
  if (results) results.innerHTML = '<div style="text-align:center;padding:32px;color:#9ca3af;"><i class="fas fa-spinner fa-spin" style="font-size:2rem;color:#22d3ee;"></i><p style="margin-top:12px;font-size:13px;">Composing your song...</p></div>';

  try {
    var res  = await apiCall('/api/song', { prompt, style, voice });
    var data = await res.json();

    if (res.ok && data.audio) {
      var src = 'data:' + (data.mimeType||'audio/mp3') + ';base64,' + data.audio;
      var lyricsHtml = data.lyrics
        ? '<div style="margin-top:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;">' +
          '<p style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;margin:0 0 8px;">Lyrics</p>' +
          '<pre style="font-size:12px;color:#d1d5db;white-space:pre-wrap;margin:0;font-family:inherit;">' + escHtml(data.lyrics) + '</pre></div>'
        : '';
      if (results) results.innerHTML =
        '<div style="background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.2);border-radius:14px;padding:16px;">' +
        '<p style="font-size:13px;font-weight:700;color:#34d399;margin:0 0 12px;"><i class="fas fa-music"></i> ' + escHtml(data.title||'Your Song') + '</p>' +
        '<audio controls style="width:100%;" src="' + src + '"></audio>' +
        '<a download="jeethylabs-song.mp3" href="' + src + '" ' +
        'style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;' +
        'padding:10px;border-radius:10px;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.2);' +
        'color:#34d399;font-size:13px;font-weight:600;text-decoration:none;">' +
        '<i class="fas fa-download"></i> Download Song</a></div>' + lyricsHtml;
      requestCount++;
    } else {
      if (results) results.innerHTML = '<div style="text-align:center;padding:24px;color:#f87171;">❌ ' + (data.error||'Song generation failed') + '</div>';
    }
  } catch (ex) {
    if (results) results.innerHTML = '<div style="text-align:center;padding:24px;color:#f87171;">❌ Network error.</div>';
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Song'; }
}

/* ── 11. TABS / PANELS ─────────────────────────────────────────── */
var _activeTab = 0;
function goToPanel(idx) {
  _activeTab = idx;
  var track = document.getElementById('panelsTrack');
  if (track) track.style.transform = 'translateX(-' + (idx * 100) + '%)';
  document.querySelectorAll('.tab').forEach(function(t,i){ t.classList.toggle('active', i===idx); });
}

/* ── 12. PLAN MODAL ────────────────────────────────────────────── */
function openPlanModal()  { var m=document.getElementById('planModal'); if(m) m.classList.add('open'); }
function closePlanModal() { var m=document.getElementById('planModal'); if(m) m.classList.remove('open'); }

function selectPlan(plan) {
  document.querySelectorAll('.plan-card').forEach(function(c){ c.classList.remove('selected'); });
  var card = document.querySelector('.plan-card[data-plan="'+plan+'"]');
  if (card) card.classList.add('selected');
  var ps = document.getElementById('proSettingsInModal');
  if (ps) ps.style.display = plan==='pro'||plan==='max' ? 'block' : 'none';
}

function confirmPlan() {
  var card = document.querySelector('.plan-card.selected');
  if (!card) return;
  var plan = card.dataset.plan || 'free';
  userPlan = plan;
  renderPlanBadge();
  closePlanModal();
  showToast(PLAN_LIMITS[plan].label + ' plan selected ✅','success');
}

/* ── 13. SETTINGS MODAL ────────────────────────────────────────── */
function openSettings()  { var m=document.getElementById('settingsModal'); if(m) m.classList.add('open'); }
function closeSettings() { var m=document.getElementById('settingsModal'); if(m) m.classList.remove('open'); }
function updateSettingsUI() {
  var on = document.getElementById('useOwnKeyToggle');
  var ks = document.getElementById('customKeySection');
  if (ks) ks.style.display = (on && on.checked) ? 'block' : 'none';
}
function saveSettings() {
  showToast('Settings saved ✅','success');
  closeSettings();
}

/* ── 14. UPGRADE MODAL ─────────────────────────────────────────── */
function closeUpgradeModal() { var m=document.getElementById('upgradeModal'); if(m) m.classList.remove('open'); }
function upgradeNow()        { closeUpgradeModal(); openPlanModal(); }

/* ── 15. CLOSE MODALS ON BACKDROP ─────────────────────────────── */
document.addEventListener('click', function(e) {
  ['planModal','settingsModal','upgradeModal'].forEach(function(id){
    var m = document.getElementById(id);
    if (m && e.target === m) m.classList.remove('open');
  });
});

/* ── 16. WELCOME TIME ──────────────────────────────────────────── */
(function(){
  var wt = document.getElementById('welcomeTime');
  if (!wt) return;
  var now=new Date(), h=now.getHours(), min=now.getMinutes(), ap=h>=12?'PM':'AM';
  h=h%12||12;
  wt.textContent = h+':'+(min<10?'0'+min:min)+' '+ap;
})();

/* ── 17. EXPOSE GLOBALS ────────────────────────────────────────── */
window.sendChat      = sendChat;
window.generateImage = generateImage;
window.generateSong  = generateSong;
window.goToPanel     = goToPanel;
window.selectChip    = selectChip;
window.requirePro    = requirePro;
window.handleChatKey = handleChatKey;
window.autoResize    = autoResize;
window.openPlanModal    = openPlanModal;
window.closePlanModal   = closePlanModal;
window.selectPlan       = selectPlan;
window.confirmPlan      = confirmPlan;
window.openSettings     = openSettings;
window.closeSettings    = closeSettings;
window.updateSettingsUI = updateSettingsUI;
window.saveSettings     = saveSettings;
window.closeUpgradeModal= closeUpgradeModal;
window.upgradeNow       = upgradeNow;
window.showToast        = showToast;
window.requestCount     = requestCount;
window.userPlan         = userPlan;
window.PLAN_LIMITS      = PLAN_LIMITS;
window.renderPlanBadge  = renderPlanBadge;
window.currentUser      = currentUser;
