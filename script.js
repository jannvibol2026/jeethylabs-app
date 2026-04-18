/* ══════════════════════════════════════════
   JEETHY LABS APP — script.js
   Swipe · Chat · Image · Song
   Plan-based API key system (Free / Pro)
══════════════════════════════════════════ */

'use strict';

// ── MODELS (updated: gemini-2.5-flash) ───
const GEMINI_CHAT_MODEL  = 'gemini-2.5-flash';
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const GEMINI_TTS_MODEL   = 'gemini-2.5-pro-preview-tts';
const HOME_URL = 'https://jeethylabs.site';

// ── OWNER KEY (injected at deploy time) ──
// Railway injects this via /api/key endpoint or window.OWNER_API_KEY
// Fallback: empty string (users won't get errors — they'll see plan modal)
const OWNER_KEY_PLACEHOLDER = '__OWNER_API_KEY__'; // replaced by server

// ── PLAN LIMITS ───────────────────────────
const PLAN_LIMITS = {
  free: { requests: 10, label: 'Free', color: '#a78bfa' },
  pro:  { requests: 100, label: 'Pro',  color: '#06b6d4' }
};

// ── STATE ─────────────────────────────────
let currentPanel  = 0;
let userPlan      = 'free';        // 'free' | 'pro'
let proCustomKey  = '';            // Pro user's own key (optional)
let useOwnKey     = false;         // Pro: toggled to use their own key
let ownerApiKey   = '';            // resolved at startup from /api/key
let requestCount  = 0;            // in-session counter
let chatHistory   = [];
let isChatLoading = false;
let touchStartX   = 0;
let touchStartY   = 0;

// ── INIT ──────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadState();
  setWelcomeTime();
  initSwipe();
  renderPlanBadge();
  await fetchOwnerKey();
});

// State is kept in-memory only (no localStorage/sessionStorage)
function saveState() {
  // In-memory — variables already updated in place
}
function loadState() {
  // Nothing to restore — fresh session starts with defaults
}

// Fetch owner key from the /api/key endpoint (Railway serves this)
async function fetchOwnerKey() {
  try {
    const res = await fetch('/api/key');
    if (res.ok) {
      const data = await res.json();
      ownerApiKey = data.key || '';
    }
  } catch(e) {
    // Running locally or no backend — leave ownerApiKey empty
    ownerApiKey = '';
  }
}

// ── RESOLVE ACTIVE API KEY ─────────────────
function getActiveApiKey() {
  if (userPlan === 'pro' && useOwnKey && proCustomKey) {
    return proCustomKey;
  }
  return ownerApiKey;
}

// ── CHECK QUOTA ───────────────────────────
function checkQuota() {
  const limit = PLAN_LIMITS[userPlan]?.requests ?? 10;
  if (requestCount >= limit) {
    showUpgradeModal();
    return false;
  }
  return true;
}

function incrementRequest() {
  requestCount++;
  saveState();
}

// ── WELCOME TIME ──────────────────────────
function setWelcomeTime() {
  const el = document.getElementById('welcomeTime');
  if (el) el.textContent = formatTime(new Date());
}

// ── PLAN BADGE ────────────────────────────
function renderPlanBadge() {
  const badge = document.getElementById('planBadge');
  if (!badge) return;
  const plan = PLAN_LIMITS[userPlan];
  badge.textContent = plan.label;
  badge.style.color = plan.color;
  badge.style.borderColor = plan.color + '66';
}

// ── PANEL NAVIGATION ─────────────────────
function goToPanel(index) {
  currentPanel = index;
  const track = document.getElementById('panelsTrack');
  track.style.transform = `translateX(-${index * 33.333}%)`;

  document.querySelectorAll('.dot').forEach((d, i) =>
    d.classList.toggle('active', i === index));
  document.querySelectorAll('.tab').forEach((t, i) =>
    t.classList.toggle('active', i === index));
}

// ── TOUCH SWIPE ──────────────────────────
function initSwipe() {
  const wrap = document.getElementById('panelsWrap');

  wrap.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  wrap.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0 && currentPanel < 2) goToPanel(currentPanel + 1);
      if (dx > 0 && currentPanel > 0) goToPanel(currentPanel - 1);
    }
  }, { passive: true });
}

// ══════════════════════════════════════════
//  PLAN MODAL (select Free / Pro)
// ══════════════════════════════════════════
function openPlanModal() {
  const m = document.getElementById('planModal');
  m.classList.add('open');
  // Reflect current plan
  document.querySelectorAll('.plan-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.plan === userPlan);
  });
}

function closePlanModal() {
  document.getElementById('planModal').classList.remove('open');
}

function selectPlan(plan) {
  userPlan = plan;
  document.querySelectorAll('.plan-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.plan === plan);
  });
  renderPlanBadge();
  saveState();

  // Show settings section if Pro
  const proSettings = document.getElementById('proSettingsInModal');
  if (proSettings) proSettings.style.display = plan === 'pro' ? 'block' : 'none';
}

function confirmPlan() {
  closePlanModal();
  showToast(`${PLAN_LIMITS[userPlan].label} plan activated!`, 'success');
}

// ══════════════════════════════════════════
//  SETTINGS PANEL (Pro only)
// ══════════════════════════════════════════
function openSettings() {
  if (userPlan !== 'pro') {
    showToast('Settings available on Pro plan', 'error');
    openPlanModal();
    return;
  }
  const m = document.getElementById('settingsModal');
  m.classList.add('open');
  // Reflect saved state
  document.getElementById('customKeyInput').value = proCustomKey;
  document.getElementById('useOwnKeyToggle').checked = useOwnKey;
  updateSettingsUI();
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

function updateSettingsUI() {
  const toggle = document.getElementById('useOwnKeyToggle');
  const keySection = document.getElementById('customKeySection');
  if (keySection) keySection.style.display = toggle.checked ? 'block' : 'none';
}

function saveSettings() {
  const toggle = document.getElementById('useOwnKeyToggle');
  const keyInput = document.getElementById('customKeyInput').value.trim();

  useOwnKey = toggle.checked;

  if (useOwnKey) {
    if (!keyInput) return showToast('Enter your API key first', 'error');
    proCustomKey = keyInput;
    showToast('Using your own API key', 'success');
  } else {
    proCustomKey = keyInput; // save but don't activate
    showToast("Using JeeThy Labs owner key", 'success');
  }

  saveState();
  closeSettings();
}

// ══════════════════════════════════════════
//  UPGRADE MODAL (quota exceeded)
// ══════════════════════════════════════════
function showUpgradeModal() {
  const m = document.getElementById('upgradeModal');
  if (m) m.classList.add('open');
}

function closeUpgradeModal() {
  document.getElementById('upgradeModal').classList.remove('open');
}

function upgradeNow() {
  closeUpgradeModal();
  if (userPlan === 'free') {
    openPlanModal();
  }
}

// Require Pro plan to use a feature chip — otherwise show upgrade modal
function requirePro(btn, groupId) {
  if (userPlan === 'pro') {
    selectChip(btn, groupId);
  } else {
    showUpgradeModal();
    showToast('1080p is available on Pro plan only', 'error');
  }
}

// ══════════════════════════════════════════
//  PANEL 1 — AI ASSISTANT
// ══════════════════════════════════════════

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
}

async function sendChat() {
  if (isChatLoading) return;

  const key = getActiveApiKey();
  if (!key) {
    showToast('Service unavailable. Please try again later.', 'error');
    return;
  }

  if (!checkQuota()) return;

  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  appendMessage('user', text);
  input.value = '';
  input.style.height = 'auto';
  isChatLoading = true;
  document.getElementById('chatSendBtn').disabled = true;

  chatHistory.push({ role: 'user', parts: [{ text }] });

  const typingId = appendTyping();

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{
              text: `You are JeeThy Assistant, a helpful and friendly AI assistant created by JeeThy Labs.
Answer in the same language the user writes in.
Be concise but thorough. Format responses clearly with paragraphs.
When appropriate use bullet points for lists.
Never say you cannot do something — always try to help.`
            }]
          },
          contents: chatHistory
        })
      }
    );

    removeTyping(typingId);

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';

    chatHistory.push({ role: 'model', parts: [{ text: reply }] });
    appendMessage('bot', reply);
    incrementRequest();

  } catch (err) {
    removeTyping(typingId);
    appendMessage('bot', `⚠️ ${err.message}`);
  }

  isChatLoading = false;
  document.getElementById('chatSendBtn').disabled = false;
}

function appendMessage(role, text) {
  const container = document.getElementById('chatMessages');
  const isUser = role === 'user';

  const div = document.createElement('div');
  div.className = `msg ${isUser ? 'msg-user' : 'msg-bot'}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.innerHTML = isUser
    ? '<i class="fas fa-user"></i>'
    : '<i class="fas fa-brain"></i>';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  if (isUser) {
    bubble.textContent = text;
  } else {
    bubble.innerHTML = `<div class="prose-response">${formatMarkdown(text)}</div>`;
  }

  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = formatTime(new Date());
  bubble.appendChild(time);

  div.appendChild(avatar);
  div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendTyping() {
  const container = document.getElementById('chatMessages');
  const id = 'typing-' + Date.now();

  const div = document.createElement('div');
  div.className = 'msg msg-bot';
  div.id = id;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.innerHTML = '<i class="fas fa-brain"></i>';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

  div.appendChild(avatar);
  div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function formatMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h4 style="font-size:14px;font-weight:700;margin:8px 0 4px">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="font-size:15px;font-weight:700;margin:8px 0 4px">$1</h3>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>')
    .replace(/^(.)/gm, (m, p) => p === '<' ? m : `<p>${m}`)
    .replace(/([^>])$/gm, (m, p) => `${m}</p>`)
    .replace(/<p><\/p>/g, '')
    .replace(/<p>(<[uoh])/g, '$1')
    .replace(/(<\/[uoh][l4]>)<\/p>/g, '$1');
}

// ══════════════════════════════════════════
//  PANEL 2 — IMAGE GENERATE
// ══════════════════════════════════════════

async function generateImage() {
  const key = getActiveApiKey();
  if (!key) return showToast('Service unavailable. Please try again later.', 'error');
  if (!checkQuota()) return;

  const prompt  = document.getElementById('imgPrompt').value.trim();
  if (!prompt) return showToast('Please enter a prompt', 'error');

  const style   = getActiveChip('imgStyleGroup');
  const ratio   = getActiveChip('imgRatioGroup');
  const quality = getActiveChip('imgQualityGroup');
  const qty     = parseInt(getActiveChip('imgQtyGroup')) || 1;

  const ratioMap = { '1:1': '1:1', '9:16': '9:16', '16:9': '16:9' };
  const aspectRatio = ratioMap[ratio] || '1:1';

  const qualityHint = quality === '1080p' ? 'ultra high resolution, sharp details, professional photography' : 'standard resolution';
  const fullPrompt = `${prompt}, style: ${style}, ${qualityHint}, aspect ratio ${aspectRatio}`;

  const btn = document.getElementById('imgGenBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

  const resultsEl = document.getElementById('imgResults');
  resultsEl.innerHTML = `
    <div class="loading-card">
      <div class="loading-spinner"></div>
      <div class="loading-label">Generating ${qty} image${qty > 1 ? 's' : ''} with AI...</div>
    </div>`;

  // Helper: single image request
  async function fetchOneImage(prompt, k) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${k}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        })
      }
    );
    if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || `HTTP ${r.status}`); }
    const d = await r.json();
    const pts = d.candidates?.[0]?.content?.parts || [];
    const img = pts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (!img) throw new Error('No image in response');
    return img.inlineData;
  }

  try {
    // Call API qty times in parallel (Gemini returns 1 image per call)
    const requests = Array.from({ length: qty }, () => fetchOneImage(fullPrompt, key));
    const results  = await Promise.allSettled(requests);

    const imageParts = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    if (!imageParts.length) throw new Error('No images generated. Try a different prompt.');

    const card = document.createElement('div');
    card.className = 'img-result-card';

    const grid = document.createElement('div');
    grid.className = `img-grid qty-${imageParts.length}`;

    const blobUrls = [];

    imageParts.forEach((inlineData, i) => {
      const base64 = inlineData.data;
      const mime   = inlineData.mimeType || 'image/png';
      const byteChars = atob(base64);
      const byteArr = new Uint8Array(byteChars.length);
      for (let j = 0; j < byteChars.length; j++) byteArr[j] = byteChars.charCodeAt(j);
      const blob = new Blob([byteArr], { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.push({ blobUrl, mime });

      const img = document.createElement('img');
      img.src = blobUrl;
      img.alt = `Generated image ${i + 1}`;
      img.onclick = () => openImageFullscreen(blobUrl);
      grid.appendChild(img);
    });

    card.appendChild(grid);

    const dlWrap = document.createElement('div');
    dlWrap.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:8px;';

    blobUrls.forEach(({ blobUrl, mime }, i) => {
      const ext = mime.split('/')[1] || 'png';
      const a = document.createElement('a');
      a.className = 'btn-download';
      a.href = blobUrl;
      a.download = `jeethy-image-${Date.now()}-${i + 1}.${ext}`;
      a.innerHTML = `<i class="fas fa-download"></i> Download Image ${blobUrls.length > 1 ? i + 1 : ''}`;
      dlWrap.appendChild(a);
    });

    card.appendChild(dlWrap);

    resultsEl.innerHTML = '';
    resultsEl.appendChild(card);

    document.querySelector('.panel-image .panel-inner-scroll').scrollTo({
      top: 99999, behavior: 'smooth'
    });

    incrementRequest();

  } catch (err) {
    resultsEl.innerHTML = `<div class="error-card"><i class="fas fa-circle-exclamation"></i> ${err.message}</div>`;
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Image';
}

function openImageFullscreen(src) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:999;
    display:flex;align-items:center;justify-content:center;padding:20px;
    cursor:pointer;animation:msgIn 0.2s ease;
  `;
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:100%;max-height:100%;border-radius:12px;object-fit:contain;';
  overlay.appendChild(img);
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

// ══════════════════════════════════════════
//  PANEL 3 — SONG GENERATE
// ══════════════════════════════════════════

async function generateSong() {
  const key = getActiveApiKey();
  if (!key) return showToast('Service unavailable. Please try again later.', 'error');
  if (!checkQuota()) return;

  const prompt = document.getElementById('songPrompt').value.trim();
  if (!prompt) return showToast('Please enter a song description', 'error');

  const style = getActiveChip('songStyleGroup');
  const voice = getActiveChip('songVoiceGroup').replace(/[^\w]/g, '').trim();

  const btn = document.getElementById('songGenBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Composing...';

  const resultsEl = document.getElementById('songResults');
  resultsEl.innerHTML = `
    <div class="loading-card green-loader">
      <div class="loading-spinner"></div>
      <div class="loading-label">Composing your song with AI... (~30s)</div>
    </div>`;

  try {
    // Step 1: Generate lyrics
    const lyricsRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{
              text: `You are a professional ${style} songwriter. Write a complete SINGABLE song — NOT spoken word or poetry, but real song lyrics with rhythm, rhyme, and melody flow.

Requirements:
- Theme: ${prompt}
- Genre: ${style} (lyrics must match this genre's rhythm and energy)
- Vocalist: ${voice} voice
- Language: use the EXACT same language as the theme input. If input is in Khmer (ភាសាខ្មែរ), write ALL lyrics in Khmer script only.
- Each line must have natural rhythm and rhyme that can be sung, not just read
- Include brief musical cues like (soft verse), (build up), (strong beat chorus)

Format EXACTLY as below:
TITLE: [song title]
GENRE: ${style}
VOICE: ${voice}

[VERSE 1]
(4-6 lines with clear rhythm and rhyme)

[PRE-CHORUS]
(2-4 lines building energy)

[CHORUS]
(4-6 catchy, emotional, repeatable lines — the heart of the song)

[VERSE 2]
(4-6 lines continuing the story)

[CHORUS]
(repeat chorus)

[BRIDGE]
(2-4 emotional peak lines)

[FINAL CHORUS]
(chorus variation to close)

CRITICAL: Every line must sound natural when SUNG with a melody — rhythmic, musical, not prose.`
            }]
          }]
        })
      }
    );

    if (!lyricsRes.ok) {
      const err = await lyricsRes.json();
      throw new Error(err.error?.message || `HTTP ${lyricsRes.status}`);
    }

    const lyricsData = await lyricsRes.json();
    const lyrics = lyricsData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const titleMatch = lyrics.match(/TITLE:\s*(.+)/);
    const songTitle = titleMatch ? titleMatch[1].trim() : `${style} Song`;

    // Step 2: TTS
    const ttsRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: lyrics.split('\n').filter(l => !l.startsWith('TITLE:') && !l.startsWith('GENRE:') && !l.startsWith('VOICE:')).join('\n').trim() }]
          }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice.toLowerCase().includes('female') ? 'Kore' : 'Fenrir'
                }
              }
            }
          }
        })
      }
    );

    if (!ttsRes.ok) {
      const err = await ttsRes.json();
      throw new Error(err.error?.message || `TTS HTTP ${ttsRes.status}`);
    }

    const ttsData = await ttsRes.json();
    const audioB64  = ttsData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    const audioMime = ttsData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType || 'audio/wav';

    if (!audioB64) throw new Error('No audio generated. Try a different prompt.');

    // Convert base64 → PCM bytes
    const pcmChars = atob(audioB64);
    const pcmBytes = new Uint8Array(pcmChars.length);
    for (let i = 0; i < pcmChars.length; i++) pcmBytes[i] = pcmChars.charCodeAt(i);

    // Wrap raw PCM in a proper WAV container so browsers can play it
    // Gemini TTS returns 16-bit PCM @ 24000 Hz mono
    const sampleRate   = 24000;
    const numChannels  = 1;
    const bitsPerSample = 16;
    const byteRate     = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign   = numChannels * bitsPerSample / 8;
    const dataSize     = pcmBytes.length;
    const wavBuffer    = new ArrayBuffer(44 + dataSize);
    const view         = new DataView(wavBuffer);
    function writeStr(off, s) { for (let i=0;i<s.length;i++) view.setUint8(off+i, s.charCodeAt(i)); }
    writeStr(0,  'RIFF');
    view.setUint32(4,  36 + dataSize, true);
    writeStr(8,  'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1,  true);  // PCM
    view.setUint16(22, numChannels,  true);
    view.setUint32(24, sampleRate,   true);
    view.setUint32(28, byteRate,     true);
    view.setUint16(32, blockAlign,   true);
    view.setUint16(34, bitsPerSample,true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    new Uint8Array(wavBuffer, 44).set(pcmBytes);

    const audioBlob    = new Blob([wavBuffer], { type: 'audio/wav' });
    const audioBlobUrl = URL.createObjectURL(audioBlob);

    const card = document.createElement('div');
    card.className = 'song-result-card';
    card.innerHTML = `
      <div class="song-result-title">
        <i class="fas fa-music"></i> ${escapeHtml(songTitle)}
        <span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:auto">${style} · ${voice} voice</span>
      </div>
      <audio controls preload="auto" style="width:100%;margin-bottom:10px"></audio>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:12px;color:var(--muted);max-height:140px;overflow-y:auto;white-space:pre-wrap;line-height:1.6;margin-bottom:10px">${escapeHtml(lyrics)}</div>
    `;

    // Set audio src after inserting into DOM (fixes mobile autoplay issue)
    const audioEl = card.querySelector('audio');
    audioEl.src = audioBlobUrl;

    const a = document.createElement('a');
    a.className = 'btn-download';
    a.href = audioBlobUrl;
    a.download = `jeethy-song-${Date.now()}.wav`;
    a.innerHTML = '<i class="fas fa-download"></i> Download Song';
    card.appendChild(a);

    resultsEl.innerHTML = '';
    resultsEl.appendChild(card);

    document.querySelector('.panel-song .panel-inner-scroll').scrollTo({
      top: 99999, behavior: 'smooth'
    });

    incrementRequest();

  } catch (err) {
    resultsEl.innerHTML = `<div class="error-card"><i class="fas fa-circle-exclamation"></i> ${err.message}</div>`;
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Song';
}

// ── UTILITIES ────────────────────────────

function getActiveChip(groupId) {
  const el = document.querySelector(`#${groupId} .chip.active`);
  return el ? el.textContent.trim() : '';
}

function selectChip(el, groupId) {
  document.querySelectorAll(`#${groupId} .chip`).forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function formatTime(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:${type === 'error' ? '#ef4444' : '#10b981'};
    color:#fff;padding:10px 20px;border-radius:20px;
    font-size:13px;font-weight:600;z-index:9999;
    animation:msgIn 0.3s ease;white-space:nowrap;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
