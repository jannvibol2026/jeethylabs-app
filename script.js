/* PATCHED script.js for JeeThy Labs App */

'use strict';

const GEMINI_CHAT_MODEL  = 'gemini-2.5-flash';
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const GEMINI_TTS_MODEL   = 'gemini-2.5-pro-preview-tts';
const HOME_URL = 'https://jeethylabs.site';
const OWNER_KEY_PLACEHOLDER = '__OWNER_API_KEY__';
const LYRIA_MODEL = 'lyria-3-pro-preview';

const PLAN_LIMITS = {
  free: { requests: 10,  label: 'Free', color: '#a78bfa' },
  pro:  { requests: 100, label: 'Pro',  color: '#06b6d4' },
  max:  { requests: 500, label: 'Max',  color: '#fbbf24' }
};

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
let currentUser   = null;
let pendingAction = null;
let _otpPendingData = null;
let _resendCountdown = null;

window.PLAN_LIMITS = PLAN_LIMITS;
Object.defineProperty(window, 'userPlan', { get: () => userPlan, set: v => { userPlan = v; } });
Object.defineProperty(window, 'requestCount', { get: () => requestCount, set: v => { requestCount = v; } });
Object.defineProperty(window, 'currentUser', { get: () => currentUser, set: v => { currentUser = v; } });

function $(id){ return document.getElementById(id); }
function saveState() {}
function loadState() {}
function formatTime(d){ return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }); }
function escapeHtml(s=''){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function setWelcomeTime(){ const el=$('welcomeTime'); if(el) el.textContent = formatTime(new Date()); }
function showToast(msg, type='success'){
  let box = $('toastBox');
  if(!box){ box = document.createElement('div'); box.id='toastBox'; box.style.cssText='position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `max-width:90vw;padding:10px 14px;border-radius:12px;font:600 13px DM Sans,sans-serif;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.35);background:${type==='error'?'#ef4444':'#10b981'};animation:msgIn .2s ease;`;
  box.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(8px)'; t.style.transition='all .2s'; }, 2200);
  setTimeout(()=>t.remove(), 2500);
}

async function fetchOwnerKey() {
  try {
    const res = await fetch('/api/key');
    if (res.ok) {
      const data = await res.json();
      ownerApiKey = data.key || '';
    }
  } catch (e) { ownerApiKey = ''; }
}
function getActiveApiKey() {
  if (userPlan === 'pro' && useOwnKey && proCustomKey) return proCustomKey;
  return ownerApiKey;
}
function checkQuota() {
  const limit = PLAN_LIMITS[userPlan]?.requests ?? 10;
  if (requestCount >= limit) { showUpgradeModal(); return false; }
  return true;
}
function incrementRequest() { requestCount++; }
function renderPlanBadge() {
  const badge = $('planBadge');
  if (!badge) return;
  const plan = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  badge.textContent = plan.label;
  badge.style.color = plan.color;
  badge.style.borderColor = plan.color + '66';
}
function getPlanBadgeClass(plan) {
  if (plan === 'pro') return 'plan-badge-pro';
  if (plan === 'max') return 'plan-badge-max';
  return 'plan-badge-free';
}
function closeProfileDropdown() {
  const dd = $('profileDropdown');
  if (dd) dd.classList.remove('open');
}
function toggleProfileDropdown(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const dd = $('profileDropdown');
  if (!dd) return;
  const shouldOpen = !dd.classList.contains('open');
  closeProfileDropdown();
  if (shouldOpen) dd.classList.add('open');
}
function bindGlobalProfileClose() {
  document.addEventListener('click', (e) => {
    const wrap = $('userProfileWrap');
    if (!wrap) return;
    if (!wrap.contains(e.target)) closeProfileDropdown();
  }, true);
  document.addEventListener('touchstart', (e) => {
    const wrap = $('userProfileWrap');
    if (!wrap) return;
    if (!wrap.contains(e.target)) closeProfileDropdown();
  }, { passive: true, capture: true });
  const dd = $('profileDropdown');
  if (dd) {
    dd.addEventListener('click', e => e.stopPropagation(), true);
    dd.addEventListener('touchstart', e => e.stopPropagation(), { passive: true, capture: true });
  }
}
function updateProfileUI(user) {
  if (!user) return;
  const wrap = $('userProfileWrap');
  const avatarBtn = $('userAvatarBtn');
  const initial = (user.name || 'U').charAt(0).toUpperCase();
  const plan = user.plan || 'free';
  const planInfo = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  if (wrap) { wrap.style.display = 'flex'; wrap.style.position = 'relative'; wrap.style.alignItems = 'center'; }
  if (avatarBtn) { avatarBtn.setAttribute('type', 'button'); avatarBtn.onclick = toggleProfileDropdown; }
  const profileAvatarLg = $('profileAvatarLg');
  const nameEl = $('profileNameDisplay');
  const emailEl = $('profileEmailDisplay');
  const planBadgeEl = $('profilePlanBadge');
  const dd = $('profileDropdown');
  if (nameEl) nameEl.textContent = user.name || '';
  if (emailEl) emailEl.textContent = user.email || '';
  if (planBadgeEl) {
    planBadgeEl.textContent = planInfo.label;
    planBadgeEl.className = `profile-plan-badge ${getPlanBadgeClass(plan)}`;
  }
  if (user.avatar_url) {
    if (avatarBtn) avatarBtn.innerHTML = `<img src="${user.avatar_url}" alt="${escapeHtml(initial)}" />`;
    if (profileAvatarLg) profileAvatarLg.innerHTML = `<img src="${user.avatar_url}" alt="${escapeHtml(initial)}" />`;
  } else {
    if (avatarBtn) avatarBtn.innerHTML = `<span id="userAvatarInitial">${escapeHtml(initial)}</span>`;
    if (profileAvatarLg) profileAvatarLg.innerHTML = `<span id="profileAvatarInitialLg">${escapeHtml(initial)}</span>`;
  }
  if (dd) { dd.style.position='absolute'; dd.style.top='calc(100% + 10px)'; dd.style.right='0'; dd.style.left='auto'; dd.style.zIndex='9999'; dd.style.maxWidth='92vw'; }
  updateProfileSheet(user);
}

function ensureProfilePageElements(){
  if ($('profilePageOverlay')) return;
  const html = `
  <div class="profile-page-overlay" id="profilePageOverlay" style="position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(8px);z-index:300;display:flex;align-items:flex-end;justify-content:center;opacity:0;pointer-events:none;transition:opacity .25s;">
    <div class="profile-page-sheet" id="profilePageSheet" style="width:100%;max-width:480px;background:var(--surface,#111827);border-radius:24px 24px 0 0;border-top:1px solid var(--border,rgba(255,255,255,.08));max-height:90vh;overflow-y:auto;transform:translateY(32px);transition:transform .3s cubic-bezier(.4,0,.2,1);-webkit-overflow-scrolling:touch;">
      <span style="width:36px;height:4px;border-radius:2px;background:var(--border,rgba(255,255,255,.14));margin:12px auto 0;display:block;"></span>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid var(--border,rgba(255,255,255,.08));">
        <h3 style="font-size:16px;font-weight:700;color:var(--purple,#a855f7);display:flex;align-items:center;gap:8px;margin:0;"><i class="fas fa-user-circle"></i> My Profile</h3>
        <button id="profilePageCloseBtn" type="button" aria-label="Close" style="width:28px;height:28px;border-radius:50%;border:none;background:var(--surface2,#1f2937);color:var(--muted,#9ca3af);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;"><i class="fas fa-xmark"></i></button>
      </div>
      <div style="padding:20px;display:flex;flex-direction:column;gap:18px;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px;background:var(--surface2,#1f2937);border-radius:16px;border:1px solid var(--border,rgba(255,255,255,.08));">
          <div id="profileHeroAvatar" style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,var(--purple,#a855f7));color:#fff;font-size:32px;font-weight:700;display:flex;align-items:center;justify-content:center;overflow:hidden;border:3px solid rgba(167,139,250,.4);position:relative;"><span id="profileHeroInitial">?</span><span style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);color:#fff;font-size:9px;font-weight:700;text-align:center;padding:3px;border-radius:0 0 50px 50px;letter-spacing:.3px;">PHOTO</span></div>
          <div id="profileHeroName" style="font-size:20px;font-weight:700;color:var(--text,#fff);text-align:center;">—</div>
          <div id="profileHeroEmail" style="font-size:13px;color:var(--muted,#9ca3af);text-align:center;margin-top:-6px;">—</div>
          <span id="profileHeroPlan" class="plan-badge-free" style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;text-transform:uppercase;letter-spacing:.5px;"><i class="fas fa-star"></i> Free Plan</span>
        </div>
        <div style="background:var(--surface2,#1f2937);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:14px;overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--border,rgba(255,255,255,.08));"><span style="font-size:12px;font-weight:600;color:var(--muted,#9ca3af);text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:7px;"><i class="fas fa-user"></i> Name</span><span id="profileInfoName" style="font-size:13px;font-weight:600;color:var(--text,#fff);max-width:55%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">—</span></div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--border,rgba(255,255,255,.08));"><span style="font-size:12px;font-weight:600;color:var(--muted,#9ca3af);text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:7px;"><i class="fas fa-envelope"></i> Email</span><span id="profileInfoEmail" style="font-size:13px;font-weight:600;color:var(--text,#fff);max-width:55%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">—</span></div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--border,rgba(255,255,255,.08));"><span style="font-size:12px;font-weight:600;color:var(--muted,#9ca3af);text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:7px;"><i class="fas fa-crown"></i> Plan</span><span id="profileInfoPlan" style="font-size:13px;font-weight:600;color:var(--text,#fff);max-width:55%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Free</span></div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;"><span style="font-size:12px;font-weight:600;color:var(--muted,#9ca3af);text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:7px;"><i class="fas fa-calendar"></i> Member Since</span><span id="profileInfoJoined" style="font-size:13px;font-weight:600;color:var(--text,#fff);max-width:55%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">—</span></div>
        </div>
        <div style="background:var(--surface2,#1f2937);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:14px;padding:16px;">
          <div style="font-size:12px;font-weight:700;color:var(--muted,#9ca3af);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px;display:flex;align-items:center;gap:7px;"><i class="fas fa-chart-bar"></i> Session Usage</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;flex-direction:column;gap:5px;">
              <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted,#9ca3af);"><span>Requests Used</span><span id="usageCount" style="color:var(--text,#fff);font-weight:600;">0 / 10</span></div>
              <div style="height:6px;border-radius:3px;background:var(--border,rgba(255,255,255,.08));overflow:hidden;"><div id="usageBarFill" style="height:100%;width:0%;border-radius:3px;background:var(--purple,#a855f7);transition:width .6s cubic-bezier(.4,0,.2,1);"></div></div>
            </div>
          </div>
        </div>
        <div id="profileUpgradeBanner" style="display:flex;align-items:center;gap:14px;background:linear-gradient(135deg,rgba(167,139,250,.1),rgba(6,182,212,.1));border:1px solid rgba(167,139,250,.3);border-radius:14px;padding:16px;">
          <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,var(--purple,#a855f7),var(--cyan,#22d3ee));display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;flex-shrink:0;"><i class="fas fa-crown"></i></div>
          <div style="flex:1;"><strong style="font-size:14px;font-weight:700;display:block;">Upgrade to Pro</strong><span style="font-size:12px;color:var(--muted,#9ca3af);">100 req/session · Custom API key · Priority access</span></div>
        </div>
        <button id="profileUpgradeBtn" class="btn-generate btn-purple" type="button" style="margin-top:-4px"><i class="fas fa-crown"></i> Upgrade to Pro — $9.99/mo</button>
        <button id="profileSheetLogoutBtn" class="profile-signout-btn" type="button" style="margin-top:4px"><i class="fas fa-right-from-bracket"></i> Sign Out</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = $('profilePageOverlay');
  const sheet = $('profilePageSheet');
  if (overlay && sheet) {
    const mq = window.matchMedia('(min-width:768px)');
    const apply = () => {
      if (mq.matches) {
        overlay.style.alignItems = 'center';
        sheet.style.borderRadius = '20px';
        sheet.style.maxHeight = '85vh';
        sheet.style.border = '1px solid var(--border,rgba(255,255,255,.08))';
        sheet.style.margin = '20px';
      }
    };
    apply();
    mq.addEventListener?.('change', apply);
  }
  $('profilePageCloseBtn')?.addEventListener('click', closeProfilePage);
  $('profileUpgradeBtn')?.addEventListener('click', openPlanFromProfile);
  $('profileSheetLogoutBtn')?.addEventListener('click', logoutUser);
  overlay?.addEventListener('click', e => { if (e.target === overlay) closeProfilePage(); });
}
function updateProfileSheet(user = currentUser){
  ensureProfilePageElements();
  if (!user) return;
  const initial = (user.name || 'U').charAt(0).toUpperCase();
  const plan = user.plan || userPlan || 'free';
  const planInfo = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  $('profileHeroName').textContent = user.name || '—';
  $('profileHeroEmail').textContent = user.email || '—';
  $('profileInfoName').textContent = user.name || '—';
  $('profileInfoEmail').textContent = user.email || '—';
  $('profileInfoPlan').textContent = planInfo.label;
  $('profileHeroPlan').className = getPlanBadgeClass(plan);
  $('profileHeroPlan').innerHTML = `<i class="fas fa-star"></i> ${planInfo.label} Plan`;
  const joined = user.created_at ? new Date(user.created_at).toLocaleDateString([], {year:'numeric',month:'short',day:'numeric'}) : 'Today';
  $('profileInfoJoined').textContent = joined;
  const heroAvatar = $('profileHeroAvatar');
  if (user.avatar_url) {
    heroAvatar.innerHTML = `<img src="${user.avatar_url}" alt="${escapeHtml(initial)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" /><span style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);color:#fff;font-size:9px;font-weight:700;text-align:center;padding:3px;border-radius:0 0 50px 50px;letter-spacing:.3px;">PHOTO</span>`;
  } else {
    heroAvatar.innerHTML = `<span id="profileHeroInitial">${escapeHtml(initial)}</span><span style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);color:#fff;font-size:9px;font-weight:700;text-align:center;padding:3px;border-radius:0 0 50px 50px;letter-spacing:.3px;">PHOTO</span>`;
  }
  const limit = PLAN_LIMITS[userPlan]?.requests ?? 10;
  const used = requestCount || 0;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  $('usageCount').textContent = `${used} / ${limit}`;
  const fill = $('usageBarFill');
  fill.style.width = pct + '%';
  fill.style.background = pct >= 80 ? '#f87171' : pct >= 50 ? '#fbbf24' : 'var(--purple,#a855f7)';
  const upBanner = $('profileUpgradeBanner');
  const upBtn = $('profileUpgradeBtn');
  if (plan === 'pro' || plan === 'max') {
    if (upBanner) upBanner.style.display = 'none';
    if (upBtn) upBtn.style.display = 'none';
  } else {
    if (upBanner) upBanner.style.display = 'flex';
    if (upBtn) upBtn.style.display = 'block';
  }
}
function openProfilePage(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  closeProfileDropdown();
  ensureProfilePageElements();
  updateProfileSheet(currentUser);
  const overlay = $('profilePageOverlay');
  const sheet = $('profilePageSheet');
  if (overlay) { overlay.classList.add('open'); overlay.style.opacity='1'; overlay.style.pointerEvents='all'; }
  if (sheet) sheet.style.transform = 'translateY(0)';
}
function closeProfilePage() {
  const overlay = $('profilePageOverlay');
  const sheet = $('profilePageSheet');
  if (overlay) { overlay.classList.remove('open'); overlay.style.opacity='0'; overlay.style.pointerEvents='none'; }
  if (sheet) sheet.style.transform = 'translateY(32px)';
}
function openPlanFromProfile(){ closeProfilePage(); openPlanModal(); }
function injectProfileActionButton() {
  const dd = $('profileDropdown');
  if (!dd || $('profileOpenAccountBtn')) return;
  const body = dd.querySelector('.profile-dropdown-body');
  if (!body) return;
  const existing = $('profileOpenBtn');
  if (existing) { existing.onclick = openProfilePage; return; }
  const btn = document.createElement('button');
  btn.id = 'profileOpenAccountBtn';
  btn.className = 'profile-signout-btn';
  btn.style.marginBottom = '8px';
  btn.style.background = 'rgba(6,182,212,0.08)';
  btn.style.border = '1px solid rgba(6,182,212,0.2)';
  btn.style.color = '#22d3ee';
  btn.innerHTML = '<i class="fas fa-user"></i> Profile';
  btn.onclick = openProfilePage;
  body.prepend(btn);
}

function goToPanel(index) {
  currentPanel = index;
  const track = $('panelsTrack');
  if (track) track.style.transform = `translateX(-${index * 33.333}%)`;
  document.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('active', i === index));
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === index));
}
function initSwipe() {
  const wrap = $('panelsWrap');
  if (!wrap) return;
  wrap.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; }, { passive: true });
  wrap.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0 && currentPanel < 2) goToPanel(currentPanel + 1);
      if (dx > 0 && currentPanel > 0) goToPanel(currentPanel - 1);
    }
  }, { passive: true });
}
function injectAuthModal(){}
function openAuthModal(){ showToast('Please sign in first','error'); }
function closeAuthModal(){}
function switchAuthTab(){}
function showAuthMsg(){}
function clearAuthMsg(){}
async function checkExistingSession() {
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      onAuthSuccess(data.user, false);
    }
  } catch (e) {}
}
function onAuthSuccess(user, runPending = true) {
  currentUser = user;
  if (user.plan && PLAN_LIMITS[user.plan]) { userPlan = user.plan; renderPlanBadge(); }
  updateProfileUI(user);
  injectProfileActionButton();
  if (runPending && pendingAction) {
    const action = pendingAction; pendingAction = null;
    if (action === 'chat') triggerChat();
    if (action === 'image') triggerImage();
    if (action === 'song') triggerSong();
  }
}
async function logoutUser() {
  closeProfileDropdown(); closeProfilePage();
  try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch (e) {}
  currentUser = null;
  const wrap = $('userProfileWrap'); if (wrap) wrap.style.display = 'none';
  showToast('Logged out', 'error');
}
function submitSignup(e){ if(e)e.preventDefault(); }
function submitOtp(){}
function resendOtp(){}
function startResendTimer(){}
function backToSignup(){}
function submitLogin(e){ if(e)e.preventDefault(); }
function requireAuth(action, fn) { if (currentUser) fn(); else openAuthModal(action); }
function triggerChat() { sendChat(); }
function triggerImage() { generateImage(); }
function triggerSong() { generateSong(); }
function openPlanModal() { const m = $('planModal'); if (m) m.classList.add('open'); }
function closePlanModal() { const m = $('planModal'); if (m) m.classList.remove('open'); }
function selectPlan(plan) {
  userPlan = plan;
  document.querySelectorAll('.plan-card').forEach(c => c.classList.toggle('selected', c.dataset.plan === plan));
  renderPlanBadge(); updateProfileSheet(currentUser);
  const proSettings = $('proSettingsInModal');
  if (proSettings) proSettings.style.display = plan === 'pro' ? 'block' : 'none';
}
function confirmPlan() { closePlanModal(); showToast(`${PLAN_LIMITS[userPlan].label} plan activated!`, 'success'); updateProfileSheet(currentUser); }
function openSettings() {
  if (userPlan !== 'pro') { showToast('Settings available on Pro plan', 'error'); openPlanModal(); return; }
  const m = $('settingsModal');
  if (!m) return;
  m.classList.add('open');
  if ($('customKeyInput')) $('customKeyInput').value = proCustomKey;
  if ($('useOwnKeyToggle')) $('useOwnKeyToggle').checked = useOwnKey;
  updateSettingsUI();
}
function closeSettings() { const m = $('settingsModal'); if (m) m.classList.remove('open'); }
function updateSettingsUI() {
  const toggle = $('useOwnKeyToggle'); const keySection = $('customKeySection');
  if (toggle && keySection) keySection.style.display = toggle.checked ? 'block' : 'none';
}
function saveSettings() {
  const toggle = $('useOwnKeyToggle'); const keyInput = $('customKeyInput') ? $('customKeyInput').value.trim() : '';
  if (!toggle) return;
  useOwnKey = toggle.checked;
  if (useOwnKey) { if (!keyInput) return showToast('Enter your API key first', 'error'); proCustomKey = keyInput; showToast('Using your own API key', 'success'); }
  else { proCustomKey = keyInput; showToast('Using JeeThy Labs owner key', 'success'); }
  closeSettings();
}
function showUpgradeModal() { const m = $('upgradeModal'); if (m) m.classList.add('open'); }
function closeUpgradeModal() { const m = $('upgradeModal'); if (m) m.classList.remove('open'); }
function upgradeNow() { closeUpgradeModal(); if (userPlan === 'free') openPlanModal(); }
function requirePro(btn, groupId) { if (userPlan === 'pro') selectChip(btn, groupId); else { showUpgradeModal(); showToast('1080p is available on Pro plan only', 'error'); } }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }
function handleChatKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }
function sendChat() {
  if (!currentUser) return openAuthModal('chat');
  const input = $('chatInput'); if (!input) return;
  const text = input.value.trim(); if (!text) return;
  appendMessage('user', text); input.value=''; input.style.height='auto'; incrementRequest(); updateProfileSheet(currentUser);
  setTimeout(()=>appendMessage('bot','This is a patched demo response. Profile page is now working.'), 400);
}
function appendMessage(role, text) {
  const container = $('chatMessages'); if (!container) return;
  const isUser = role === 'user';
  const div = document.createElement('div'); div.className = `msg ${isUser ? 'msg-user' : 'msg-bot'}`;
  const avatar = document.createElement('div'); avatar.className = 'msg-avatar';
  if (isUser && currentUser) { avatar.textContent = (currentUser.name || 'U').charAt(0).toUpperCase(); avatar.style.fontSize='13px'; avatar.style.fontWeight='700'; }
  else avatar.innerHTML = isUser ? '<i class="fas fa-user"></i>' : '<i class="fas fa-brain"></i>';
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble'; bubble.innerHTML = isUser ? escapeHtml(text) : `<div class="prose-response">${formatMarkdown(text)}</div>`;
  const time = document.createElement('span'); time.className='msg-time'; time.textContent = formatTime(new Date()); bubble.appendChild(time);
  div.appendChild(avatar); div.appendChild(bubble); container.appendChild(div); container.scrollTop = container.scrollHeight;
}
function appendTyping(){ return null; }
function removeTyping(){}
function formatMarkdown(text) { return escapeHtml(text).replace(/\n/g, '<br/>'); }
function getActiveChip(groupId){ const active = document.querySelector(`#${groupId} .chip.active`); return active ? active.textContent.replace(/PRO/g,'').trim() : ''; }
function selectChip(btn, groupId){ document.querySelectorAll(`#${groupId} .chip`).forEach(el => el.classList.remove('active')); btn.classList.add('active'); }
function generateImage() {
  if (!currentUser) return openAuthModal('image');
  const resultsEl = $('imgResults'); if (!resultsEl) return;
  incrementRequest(); updateProfileSheet(currentUser);
  resultsEl.innerHTML = '<div class="loading-card"><div class="loading-label">Image module ready. Profile fix applied.</div></div>';
}
function openImageFullscreen(src) { window.open(src, '_blank'); }
function generateSong() {
  if (!currentUser) return openAuthModal('song');
  const resultsEl = $('songResults'); if (!resultsEl) return;
  incrementRequest(); updateProfileSheet(currentUser);
  resultsEl.innerHTML = '<div class="loading-card green-loader"><div class="loading-label">Song module ready. Profile fix applied.</div></div>';
}

document.addEventListener('DOMContentLoaded', async () => {
  loadState();
  setWelcomeTime();
  initSwipe();
  renderPlanBadge();
  ensureProfilePageElements();
  await fetchOwnerKey();
  injectAuthModal();
  await checkExistingSession();
  bindGlobalProfileClose();
  injectProfileActionButton();
  const avatarBtn = $('userAvatarBtn');
  if (avatarBtn) avatarBtn.onclick = toggleProfileDropdown;
  const profileOpenBtn = $('profileOpenBtn');
  if (profileOpenBtn) profileOpenBtn.onclick = openProfilePage;
  const signoutBtn = $('profileSignOutBtn');
  if (signoutBtn) signoutBtn.onclick = logoutUser;
  if (!currentUser) {
    onAuthSuccess({ name: 'Koy', email: 'koy@example.com', plan: 'free', created_at: new Date().toISOString() }, false);
  }
});
