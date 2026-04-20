/* ══════════════════════════════════════════
   JEETHY LABS APP — script.js
   Swipe · Chat · Image · Song
   Plan-based API key system (Free / Pro)
   + Auth Modal (Signup / Login → Retool DB)
══════════════════════════════════════════ */

'use strict';

// ── MODELS ───────────────────────────────
const GEMINI_CHAT_MODEL  = 'gemini-2.5-flash';
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const GEMINI_TTS_MODEL   = 'gemini-2.5-pro-preview-tts';
const HOME_URL = 'https://jeethylabs.site';

const OWNER_KEY_PLACEHOLDER = '__OWNER_API_KEY__';

// ── PLAN LIMITS ───────────────────────────
const PLAN_LIMITS = {
  free: { requests: 10, label: 'Free', color: '#a78bfa' },
  pro:  { requests: 100, label: 'Pro',  color: '#06b6d4' }
};

// ── STATE ─────────────────────────────────
let currentPanel  = 0;
let userPlan      = 'free';
let proCustomKey  = '';
let useOwnKey     = false;
let ownerApiKey   = '';
let requestCount  = 0;
let chatHistory   = [];
let isChatLoading = false;
let touchStartX   = 0;
let touchStartY   = 0;

// ── AUTH STATE ────────────────────────────
let currentUser   = null;   // { id, name, email, plan } after login
let pendingAction = null;   // 'chat' | 'image' | 'song'

// ── RETOOL DB CONFIG ──────────────────────
// Set these as Railway environment variables:
// RETOOL_DB_URL  = https://api.retool.com/v1/retooldb/YOUR_DB_ID/query
// RETOOL_API_KEY = your_retool_api_key
// They are injected via /api/auth-config endpoint on the server

// ── INIT ──────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadState();
  setWelcomeTime();
  initSwipe();
  renderPlanBadge();
  await fetchOwnerKey();
  injectAuthModal();
  checkExistingSession();
});

function saveState() {}
function loadState() {}

async function fetchOwnerKey() {
  try {
    const res = await fetch('/api/key');
    if (res.ok) {
      const data = await res.json();
      ownerApiKey = data.key || '';
    }
  } catch(e) {
    ownerApiKey = '';
  }
}

// ── RESOLVE ACTIVE API KEY ─────────────────
function getActiveApiKey() {
  if (userPlan === 'pro' && useOwnKey && proCustomKey) return proCustomKey;
  return ownerApiKey;
}

// ── CHECK QUOTA ───────────────────────────
function checkQuota() {
  const limit = PLAN_LIMITS[userPlan]?.requests ?? 10;
  if (requestCount >= limit) { showUpgradeModal(); return false; }
  return true;
}
function incrementRequest() { requestCount++; }

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
  document.querySelectorAll('.dot').forEach((d,i) => d.classList.toggle('active', i===index));
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', i===index));
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
//  AUTH MODAL — inject into DOM
// ══════════════════════════════════════════
function injectAuthModal() {
  const html = `
  <div class="modal-overlay" id="authModal">
    <div class="modal-box" style="max-width:420px">
      <div class="modal-header">
        <h3><i class="fas fa-lock"></i> <span id="authModalTitle">Sign in to continue</span></h3>
        <button class="modal-close" onclick="closeAuthModal()"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="modal-body" style="gap:10px">
        <!-- Tabs -->
        <div style="display:flex;gap:6px;background:var(--surface2);border:1px solid var(--border);padding:4px;border-radius:30px;">
          <button id="authTabLogin" onclick="switchAuthTab('login')"
            style="flex:1;padding:8px;border-radius:30px;border:none;font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;background:linear-gradient(135deg,#7c3aed,var(--purple));color:#fff;">
            Login
          </button>
          <button id="authTabSignup" onclick="switchAuthTab('signup')"
            style="flex:1;padding:8px;border-radius:30px;border:none;font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;background:transparent;color:var(--muted);">
            Sign Up
          </button>
        </div>

        <div id="authMsg" style="display:none;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:500;"></div>

        <!-- LOGIN FORM -->
        <form id="authLoginForm" onsubmit="submitLogin(event)" style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label class="form-label">Email</label>
            <input type="email" id="authLoginEmail" class="form-input" placeholder="you@example.com" required autocomplete="email"/>
          </div>
          <div>
            <label class="form-label">Password</label>
            <input type="password" id="authLoginPass" class="form-input" placeholder="Your password" required autocomplete="current-password"/>
          </div>
          <button type="submit" id="authLoginBtn" class="btn-generate btn-purple" style="margin-bottom:0">
            <i class="fas fa-arrow-right-to-bracket"></i> Login
          </button>
        </form>

        <!-- SIGNUP FORM (Step 1) -->
        <form id="authSignupForm" onsubmit="submitSignup(event)" style="display:none;flex-direction:column;gap:10px;">
          <div>
            <label class="form-label">Full Name</label>
            <input type="text" id="authSignupName" class="form-input" placeholder="Your name" required autocomplete="name"/>
          </div>
          <div>
            <label class="form-label">Email</label>
            <input type="email" id="authSignupEmail" class="form-input" placeholder="you@example.com" required autocomplete="email"/>
          </div>
          <div>
            <label class="form-label">Password</label>
            <input type="password" id="authSignupPass" class="form-input" placeholder="Minimum 8 characters" required minlength="8" autocomplete="new-password"/>
          </div>
          <button type="submit" id="authSignupBtn" class="btn-generate btn-purple" style="margin-bottom:0">
            <i class="fas fa-paper-plane"></i> Send Verification Code
          </button>
        </form>

        <!-- OTP FORM (Step 2) -->
        <div id="authOtpForm" style="display:none;flex-direction:column;gap:12px;">
          <div style="text-align:center;padding:8px 0;">
            <i class="fas fa-envelope-circle-check" style="font-size:2rem;color:var(--purple);margin-bottom:8px;display:block;"></i>
            <p style="font-size:13px;color:var(--muted);margin:0;">Code បានផ្ញើទៅ</p>
            <p id="otpEmailDisplay" style="font-size:14px;font-weight:700;color:var(--text);margin:4px 0 0;"></p>
          </div>
          <div>
            <label class="form-label">Verification Code (6 digits)</label>
            <input type="text" id="authOtpInput" class="form-input"
              placeholder="_ _ _ _ _ _"
              maxlength="6" pattern="[0-9]{6}" inputmode="numeric"
              style="text-align:center;font-size:1.5rem;font-weight:700;letter-spacing:0.4em;"
              oninput="this.value=this.value.replace(/[^0-9]/g,\'\')"/>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" onclick="backToSignup()" class="btn-generate" style="flex:1;margin-bottom:0;background:var(--surface2);color:var(--muted);">
              <i class="fas fa-arrow-left"></i> Back
            </button>
            <button type="button" onclick="submitOtp()" id="authOtpBtn" class="btn-generate btn-purple" style="flex:2;margin-bottom:0">
              <i class="fas fa-check-circle"></i> Verify & Create Account
            </button>
          </div>
          <div style="text-align:center;">
            <button type="button" onclick="resendOtp()" id="resendOtpBtn"
              style="background:none;border:none;color:var(--purple);font-size:12px;cursor:pointer;text-decoration:underline;">
              Resend code
            </button>
            <span id="resendTimer" style="font-size:12px;color:var(--muted);display:none;"></span>
          </div>
        </div>

      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function openAuthModal(action) {
  pendingAction = action;
  document.getElementById('authModal').classList.add('open');
  clearAuthMsg();
}

function closeAuthModal() {
  document.getElementById('authModal').classList.remove('open');
  pendingAction = null;
}

function switchAuthTab(tab) {
  const loginForm  = document.getElementById('authLoginForm');
  const signupForm = document.getElementById('authSignupForm');
  const tabLogin   = document.getElementById('authTabLogin');
  const tabSignup  = document.getElementById('authTabSignup');
  clearAuthMsg();
  if (tab === 'login') {
    loginForm.style.display  = 'flex';
    signupForm.style.display = 'none';
    tabLogin.style.background  = 'linear-gradient(135deg,#7c3aed,var(--purple))';
    tabLogin.style.color       = '#fff';
    tabSignup.style.background = 'transparent';
    tabSignup.style.color      = 'var(--muted)';
  } else {
    loginForm.style.display  = 'none';
    signupForm.style.display = 'flex';
    tabSignup.style.background = 'linear-gradient(135deg,#7c3aed,var(--purple))';
    tabSignup.style.color      = '#fff';
    tabLogin.style.background  = 'transparent';
    tabLogin.style.color       = 'var(--muted)';
  }
}

function showAuthMsg(msg, type) {
  const el = document.getElementById('authMsg');
  el.style.display     = 'block';
  el.style.background  = type === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)';
  el.style.color       = type === 'error' ? '#f87171' : '#34d399';
  el.style.border      = `1px solid ${type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`;
  el.textContent = msg;
}

function clearAuthMsg() {
  const el = document.getElementById('authMsg');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

// ── CHECK SESSION ─────────────────────────
async function checkExistingSession() {
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      onAuthSuccess(data.user, false);
    }
  } catch {}
}

// ── ON AUTH SUCCESS ───────────────────────
function onAuthSuccess(user, runPending = true) {
  currentUser = user;
  // Sync plan from DB (free/pro/max)
  if (user.plan && PLAN_LIMITS[user.plan]) {
    userPlan = user.plan;
    renderPlanBadge();
  }
  // Show user badge in nav
  let badge = document.getElementById('userAuthBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'userAuthBadge';
    badge.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--green);';
    badge.innerHTML = `<span style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#059669,var(--green));display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;" id="userAvatarBadge"></span><span id="userNameBadge" style="max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span><button onclick="logoutUser()" style="background:none;border:none;color:var(--muted);font-size:11px;cursor:pointer;padding:2px 6px;border-radius:8px;border:1px solid var(--border);">Out</button>`;
    const navActions = document.querySelector('.nav-actions');
    if (navActions) navActions.prepend(badge);
  }
  document.getElementById('userAvatarBadge').textContent = user.name.charAt(0).toUpperCase();
  document.getElementById('userNameBadge').textContent   = user.name.split(' ')[0];

  closeAuthModal();
  if (runPending && pendingAction) {
    const action = pendingAction;
    pendingAction = null;
    if (action === 'chat')  triggerChat();
    if (action === 'image') triggerImage();
    if (action === 'song')  triggerSong();
  }
}

// ── LOGOUT ────────────────────────────────
async function logoutUser() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  currentUser = null;
  const badge = document.getElementById('userAuthBadge');
  if (badge) badge.remove();
  showToast('Logged out', 'error');
}

// ── SUBMIT SIGNUP ─────────────────────────
// ── OTP STATE ─────────────────────────────
let _otpPendingData = null;
let _resendCountdown = null;

async function submitSignup(e) {
  e.preventDefault();
  clearAuthMsg();
  const btn   = document.getElementById('authSignupBtn');
  const name  = document.getElementById('authSignupName').value.trim();
  const email = document.getElementById('authSignupEmail').value.trim();
  const pass  = document.getElementById('authSignupPass').value;

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return showAuthMsg('Please enter a valid email address.', 'error');
  }
  if (pass.length < 8) {
    return showAuthMsg('Password must be at least 8 characters.', 'error');
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending code...';

  try {
    const res  = await fetch('/api/send-otp', {
      method:'POST', headers:{'Content-Type':'application/json'},
      credentials:'include', body: JSON.stringify({ name, email, password: pass })
    });
    const data = await res.json();
    if (res.ok) {
      _otpPendingData = { name, email, password: pass };
      document.getElementById('otpEmailDisplay').textContent = email;
      document.getElementById('authSignupForm').style.display = 'none';
      document.getElementById('authOtpForm').style.display = 'flex';
      document.getElementById('authOtpInput').value = '';
      startResendTimer(60);
      showAuthMsg('Code ត្រូវបានផ្ញើ! សូមពិនិត្យ Email.', 'success');
    } else {
      showAuthMsg(data.error || 'Failed to send code. Try again.', 'error');
    }
  } catch {
    showAuthMsg('Network error. Check your connection.', 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Verification Code';
}

async function submitOtp() {
  clearAuthMsg();
  const otp  = document.getElementById('authOtpInput').value.trim();
  const btn  = document.getElementById('authOtpBtn');
  if (!otp || otp.length !== 6) return showAuthMsg('Please enter the 6-digit code.', 'error');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
  try {
    const res  = await fetch('/api/verify-otp', {
      method:'POST', headers:{'Content-Type':'application/json'},
      credentials:'include',
      body: JSON.stringify({ ..._otpPendingData, otp })
    });
    const data = await res.json();
    if (res.ok) {
      _otpPendingData = null;
      showAuthMsg(`Welcome, ${data.user.name}! 🎉 Account created!`, 'success');
      setTimeout(() => onAuthSuccess(data.user, true), 900);
    } else {
      showAuthMsg(data.error || 'Invalid or expired code.', 'error');
    }
  } catch {
    showAuthMsg('Network error. Check your connection.', 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-check-circle"></i> Verify & Create Account';
}

async function resendOtp() {
  if (!_otpPendingData) return;
  clearAuthMsg();
  try {
    const res = await fetch('/api/send-otp', {
      method:'POST', headers:{'Content-Type':'application/json'},
      credentials:'include',
      body: JSON.stringify(_otpPendingData)
    });
    const data = await res.json();
    if (res.ok) {
      showAuthMsg('Code ថ្មីត្រូវបានផ្ញើ!', 'success');
      startResendTimer(60);
    } else {
      showAuthMsg(data.error || 'Failed to resend.', 'error');
    }
  } catch {
    showAuthMsg('Network error.', 'error');
  }
}

function startResendTimer(seconds) {
  const btn   = document.getElementById('resendOtpBtn');
  const timer = document.getElementById('resendTimer');
  btn.style.display   = 'none';
  timer.style.display = 'inline';
  let s = seconds;
  if (_resendCountdown) clearInterval(_resendCountdown);
  _resendCountdown = setInterval(() => {
    timer.textContent = `Resend in ${s}s`;
    s--;
    if (s < 0) {
      clearInterval(_resendCountdown);
      btn.style.display   = 'inline';
      timer.style.display = 'none';
    }
  }, 1000);
}

function backToSignup() {
  document.getElementById('authOtpForm').style.display   = 'none';
  document.getElementById('authSignupForm').style.display = 'flex';
  clearAuthMsg();
  if (_resendCountdown) clearInterval(_resendCountdown);
}

// ── SUBMIT LOGIN ──────────────────────────
async function submitLogin(e) {
  e.preventDefault();
  clearAuthMsg();
  const btn   = document.getElementById('authLoginBtn');
  const email = document.getElementById('authLoginEmail').value.trim();
  const pass  = document.getElementById('authLoginPass').value;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
  try {
    const res  = await fetch('/api/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      credentials:'include', body: JSON.stringify({ email, password: pass })
    });
    const data = await res.json();
    if (res.ok) {
      showAuthMsg(`Welcome back, ${data.user.name}! ✅`, 'success');
      setTimeout(() => onAuthSuccess(data.user, true), 800);
    } else {
      showAuthMsg(data.error || 'Invalid email or password.', 'error');
    }
  } catch {
    showAuthMsg('Network error. Check your connection.', 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Login';
}

// ══════════════════════════════════════════
//  AUTH GATE — wrap tool buttons
// ══════════════════════════════════════════
function requireAuth(action, fn) {
  if (currentUser) { fn(); }
  else { openAuthModal(action); }
}

// Trigger helpers called after login success
function triggerChat()  { sendChat(); }
function triggerImage() { generateImage(); }
function triggerSong()  { generateSong(); }

// ══════════════════════════════════════════
//  PLAN MODAL
// ══════════════════════════════════════════
function openPlanModal() {
  const m = document.getElementById('planModal');
  m.classList.add('open');
  document.querySelectorAll('.plan-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.plan === userPlan);
  });
}
function closePlanModal() { document.getElementById('planModal').classList.remove('open'); }

function selectPlan(plan) {
  userPlan = plan;
  document.querySelectorAll('.plan-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.plan === plan);
  });
  renderPlanBadge();
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
  if (userPlan !== 'pro') { showToast('Settings available on Pro plan', 'error'); openPlanModal(); return; }
  const m = document.getElementById('settingsModal');
  m.classList.add('open');
  document.getElementById('customKeyInput').value = proCustomKey;
  document.getElementById('useOwnKeyToggle').checked = useOwnKey;
  updateSettingsUI();
}
function closeSettings() { document.getElementById('settingsModal').classList.remove('open'); }
function updateSettingsUI() {
  const toggle = document.getElementById('useOwnKeyToggle');
  const keySection = document.getElementById('customKeySection');
  if (keySection) keySection.style.display = toggle.checked ? 'block' : 'none';
}
function saveSettings() {
  const toggle   = document.getElementById('useOwnKeyToggle');
  const keyInput = document.getElementById('customKeyInput').value.trim();
  useOwnKey = toggle.checked;
  if (useOwnKey) {
    if (!keyInput) return showToast('Enter your API key first', 'error');
    proCustomKey = keyInput;
    showToast('Using your own API key', 'success');
  } else {
    proCustomKey = keyInput;
    showToast("Using JeeThy Labs owner key", 'success');
  }
  closeSettings();
}

// ══════════════════════════════════════════
//  UPGRADE MODAL
// ══════════════════════════════════════════
function showUpgradeModal() { const m = document.getElementById('upgradeModal'); if (m) m.classList.add('open'); }
function closeUpgradeModal() { document.getElementById('upgradeModal').classList.remove('open'); }
function upgradeNow() { closeUpgradeModal(); if (userPlan === 'free') openPlanModal(); }
function requirePro(btn, groupId) {
  if (userPlan === 'pro') { selectChip(btn, groupId); }
  else { showUpgradeModal(); showToast('1080p is available on Pro plan only', 'error'); }
}

// ══════════════════════════════════════════
//  PANEL 1 — AI ASSISTANT (AUTH GATED)
// ══════════════════════════════════════════
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

// ── sendChat — gated ──────────────────────
function sendChat() {
  if (!currentUser) { openAuthModal('chat'); return; }
  _sendChat();
}

async function _sendChat() {
  if (isChatLoading) return;
  const key = getActiveApiKey();
  if (!key) { showToast('Service unavailable. Please try again later.', 'error'); return; }
  if (!checkQuota()) return;
  const input = document.getElementById('chatInput');
  const text  = input.value.trim();
  if (!text) return;
  appendMessage('user', text);
  input.value = ''; input.style.height = 'auto';
  isChatLoading = true;
  document.getElementById('chatSendBtn').disabled = true;
  chatHistory.push({ role: 'user', parts: [{ text }] });
  const typingId = appendTyping();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:generateContent?key=${key}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          system_instruction: { parts: [{ text: `You are JeeThy Assistant, a helpful and friendly AI assistant created by JeeThy Labs.\nAnswer in the same language the user writes in.\nBe concise but thorough. Format responses clearly with paragraphs.\nWhen appropriate use bullet points for lists.\nNever say you cannot do something — always try to help.` }] },
          contents: chatHistory }) }
    );
    removeTyping(typingId);
    if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || `HTTP ${res.status}`); }
    const data  = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';
    chatHistory.push({ role:'model', parts:[{ text: reply }] });
    appendMessage('bot', reply);
    incrementRequest();
  } catch (err) { removeTyping(typingId); appendMessage('bot', `⚠️ ${err.message}`); }
  isChatLoading = false;
  document.getElementById('chatSendBtn').disabled = false;
}

function appendMessage(role, text) {
  const container = document.getElementById('chatMessages');
  const isUser = role === 'user';
  const div    = document.createElement('div');
  div.className = `msg ${isUser ? 'msg-user' : 'msg-bot'}`;
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.innerHTML = isUser ? '<i class="fas fa-user"></i>' : '<i class="fas fa-brain"></i>';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (isUser) { bubble.textContent = text; }
  else { bubble.innerHTML = `<div class="prose-response">${formatMarkdown(text)}</div>`; }
  const time = document.createElement('span');
  time.className = 'msg-time'; time.textContent = formatTime(new Date());
  bubble.appendChild(time);
  div.appendChild(avatar); div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendTyping() {
  const container = document.getElementById('chatMessages');
  const id = 'typing-' + Date.now();
  const div = document.createElement('div'); div.className = 'msg msg-bot'; div.id = id;
  const avatar = document.createElement('div'); avatar.className = 'msg-avatar'; avatar.innerHTML = '<i class="fas fa-brain"></i>';
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble';
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  div.appendChild(avatar); div.appendChild(bubble);
  container.appendChild(div); container.scrollTop = container.scrollHeight;
  return id;
}
function removeTyping(id) { const el = document.getElementById(id); if (el) el.remove(); }

function formatMarkdown(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```([\s\S]*?)```/g,'<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/^### (.+)$/gm,'<h4 style="font-size:14px;font-weight:700;margin:8px 0 4px">$1</h4>')
    .replace(/^## (.+)$/gm,'<h3 style="font-size:15px;font-weight:700;margin:8px 0 4px">$1</h3>')
    .replace(/^- (.+)$/gm,'<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs,'<ul>$1</ul>')
    .replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br/>')
    .replace(/^(.)/gm,(m,p)=>p==='<'?m:`<p>${m}`)
    .replace(/([^>])$/gm,(m,p)=>`${m}</p>`)
    .replace(/<p><\/p>/g,'').replace(/<p>(<[uoh])/g,'$1')
    .replace(/(<\/[uoh][l4]>)<\/p>/g,'$1');
}

// ══════════════════════════════════════════
//  PANEL 2 — IMAGE GENERATE (AUTH GATED)
// ══════════════════════════════════════════
function generateImage() {
  if (!currentUser) { openAuthModal('image'); return; }
  _generateImage();
}

async function _generateImage() {
  const key = getActiveApiKey();
  if (!key) return showToast('Service unavailable. Please try again later.', 'error');
  if (!checkQuota()) return;
  const prompt = document.getElementById('imgPrompt').value.trim();
  if (!prompt) return showToast('Please enter a prompt', 'error');
  const style   = getActiveChip('imgStyleGroup');
  const ratio   = getActiveChip('imgRatioGroup');
  const quality = getActiveChip('imgQualityGroup');
  const qty     = parseInt(getActiveChip('imgQtyGroup')) || 1;
  const ratioMap = { '1:1':'1:1','9:16':'9:16','16:9':'16:9' };
  const aspectRatio = ratioMap[ratio] || '1:1';
  const qualityHint = quality === '1080p' ? 'ultra high resolution, sharp details, professional photography' : 'standard resolution';
  const fullPrompt  = `${prompt}, style: ${style}, ${qualityHint}, aspect ratio ${aspectRatio}`;
  const btn = document.getElementById('imgGenBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
  const resultsEl = document.getElementById('imgResults');
  resultsEl.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><div class="loading-label">Generating ${qty} image${qty>1?'s':''} with AI...</div></div>`;
  async function fetchOneImage(prompt, k) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${k}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{ responseModalities:['IMAGE'], imageConfig:{ aspectRatio } } }) }
    );
    if (!r.ok) { const e=await r.json(); throw new Error(e.error?.message||`HTTP ${r.status}`); }
    const d = await r.json();
    let imgData = null;
    for (const c of (d.candidates||[])) { for (const p of (c.content?.parts||[])) { if (p.inlineData?.data){ imgData=p.inlineData; break; } } if(imgData) break; }
    if (!imgData) throw new Error('No image in response');
    return imgData;
  }
  try {
    const requests = Array.from({length:qty},()=>fetchOneImage(fullPrompt,key));
    const results  = await Promise.allSettled(requests);
    const imageParts = results.filter(r=>r.status==='fulfilled').map(r=>r.value);
    if (!imageParts.length) throw new Error('No images generated. Try a different prompt.');
    const card = document.createElement('div'); card.className = 'img-result-card';
    const grid = document.createElement('div'); grid.className = `img-grid qty-${imageParts.length}`;
    const blobUrls = [];
    imageParts.forEach((inlineData,i)=>{
      const base64=inlineData.data, mime=inlineData.mimeType||'image/png';
      const byteChars=atob(base64), byteArr=new Uint8Array(byteChars.length);
      for(let j=0;j<byteChars.length;j++) byteArr[j]=byteChars.charCodeAt(j);
      const blob=new Blob([byteArr],{type:mime}), blobUrl=URL.createObjectURL(blob);
      blobUrls.push({blobUrl,mime});
      const img=document.createElement('img'); img.src=blobUrl; img.alt=`Generated image ${i+1}`;
      img.onclick=()=>openImageFullscreen(blobUrl); grid.appendChild(img);
    });
    card.appendChild(grid);
    const dlWrap=document.createElement('div'); dlWrap.style.cssText='padding:12px;display:flex;flex-direction:column;gap:8px;';
    blobUrls.forEach(({blobUrl,mime},i)=>{
      const ext=mime.split('/')[1]||'png', a=document.createElement('a');
      a.className='btn-download'; a.href=blobUrl; a.download=`jeethy-image-${Date.now()}-${i+1}.${ext}`;
      a.innerHTML=`<i class="fas fa-download"></i> Download Image ${blobUrls.length>1?i+1:''}`;
      dlWrap.appendChild(a);
    });
    card.appendChild(dlWrap);
    resultsEl.innerHTML=''; resultsEl.appendChild(card);
    document.querySelector('.panel-image .panel-inner-scroll').scrollTo({top:99999,behavior:'smooth'});
    incrementRequest();
  } catch(err) { resultsEl.innerHTML=`<div class="error-card"><i class="fas fa-circle-exclamation"></i> ${err.message}</div>`; }
  btn.disabled=false; btn.innerHTML='<i class="fas fa-wand-magic-sparkles"></i> Generate Image';
}

function openImageFullscreen(src) {
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:999;display:flex;align-items:center;justify-content:center;padding:20px;cursor:pointer;animation:msgIn 0.2s ease;';
  const img=document.createElement('img'); img.src=src;
  img.style.cssText='max-width:100%;max-height:100%;border-radius:12px;object-fit:contain;';
  overlay.appendChild(img); overlay.onclick=()=>overlay.remove(); document.body.appendChild(overlay);
}

// ══════════════════════════════════════════
//  PANEL 3 — SONG GENERATE (AUTH GATED)
// ══════════════════════════════════════════
const LYRIA_MODEL = 'lyria-3-pro-preview';

function generateSong() {
  if (!currentUser) { openAuthModal('song'); return; }
  _generateSong();
}

async function _generateSong() {
  const key = getActiveApiKey();
  if (!key) return showToast('Service unavailable. Please try again later.', 'error');
  if (!checkQuota()) return;
  const prompt = document.getElementById('songPrompt').value.trim();
  if (!prompt) return showToast('Please enter a song description', 'error');
  const style  = getActiveChip('songStyleGroup');
  const voice  = getActiveChip('songVoiceGroup').replace(/[^\w]/g,'').trim();
  const isKhmer = /[\u1780-\u17FF]/.test(prompt);
  const btn = document.getElementById('songGenBtn');
  btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Composing...';
  const resultsEl = document.getElementById('songResults');
  resultsEl.innerHTML=`<div class="loading-card green-loader"><div class="loading-spinner"></div><div class="loading-label">Generating song with Lyria 3... (~20s)</div></div>`;
  try {
    const voiceHint  = voice.toLowerCase().includes('female') ? 'female vocalist' : 'male vocalist';
    const langHint   = isKhmer ? 'Lyrics must be in Khmer language (ភាសាខ្មែរ).' : '';
    const lyriaPrompt = `Create a full ${style} song about: ${prompt}. ${voiceHint}, ${style} genre with full instrumental arrangement, verses, chorus and bridge. ${langHint}`.trim();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${LYRIA_MODEL}:generateContent?key=${key}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ contents:[{parts:[{text:lyriaPrompt}]}] }) }
    );
    if (!res.ok) { const err=await res.json(); throw new Error(err.error?.message||`HTTP ${res.status}`); }
    const data = await res.json();
    let audioB64=null, audioMime='audio/mp3', songTitle=`${style} Song`, lyricsText='';
    for (const c of (data.candidates||[])) {
      for (const p of (c.content?.parts||[])) {
        if (p.inlineData?.data&&!audioB64){ audioB64=p.inlineData.data; audioMime=p.inlineData.mimeType||'audio/mp3'; }
        if (p.text) lyricsText+=p.text;
      }
    }
    if (!audioB64) throw new Error('No audio generated. Please try again.');
    const raw=atob(audioB64), bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    const audioBlob=new Blob([bytes],{type:audioMime}), audioBlobUrl=URL.createObjectURL(audioBlob);
    const titleMatch=lyricsText.match(/(?:title|song name)[:\s]+([^\n]+)/i);
    if (titleMatch) songTitle=titleMatch[1].trim();
    const card=document.createElement('div'); card.className='song-result-card';
    card.innerHTML=`<div class="song-result-title"><i class="fas fa-music"></i> ${escapeHtml(songTitle)}<span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:auto">${style} · ${voiceHint}</span></div><audio controls preload="auto" style="width:100%;margin-bottom:10px"></audio>${lyricsText?`<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:12px;color:var(--muted);max-height:140px;overflow-y:auto;white-space:pre-wrap;line-height:1.6;margin-bottom:10px">${escapeHtml(lyricsText)}</div>`:''}`;
    card.querySelector('audio').src=audioBlobUrl;
    const a=document.createElement('a'); a.className='btn-download'; a.href=audioBlobUrl;
    a.download=`jeethy-song-${Date.now()}.mp3`; a.innerHTML='<i class="fas fa-download"></i> Download Song';
    card.appendChild(a); resultsEl.innerHTML=''; resultsEl.appendChild(card);
    document.querySelector('.panel-song .panel-inner-scroll').scrollTo({top:99999,behavior:'smooth'});
    incrementRequest();
  } catch(err) { resultsEl.innerHTML=`<div class="error-card"><i class="fas fa-circle-exclamation"></i> ${err.message}</div>`; }
  btn.disabled=false; btn.innerHTML='<i class="fas fa-wand-magic-sparkles"></i> Generate Song';
}

// ── UTILITIES ────────────────────────────
function getActiveChip(groupId) { const el=document.querySelector(`#${groupId} .chip.active`); return el?el.textContent.trim():''; }
function selectChip(el,groupId) { document.querySelectorAll(`#${groupId} .chip`).forEach(c=>c.classList.remove('active')); el.classList.add('active'); }
function formatTime(d) { return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
function escapeHtml(text) { return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function showToast(msg,type='info') {
  const t=document.createElement('div');
  t.style.cssText=`position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:${type==='error'?'#ef4444':'#10b981'};color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:9999;animation:msgIn 0.3s ease;white-space:nowrap;`;
  t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2500);
}
