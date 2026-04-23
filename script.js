/* ═══════════════════════════════════════════════════════
   JEETHY LABS — script.js  (FIXED & MERGED)
   Auth: Signup/OTP/Login → Retool DB (cookie session)
   Profile Sheet: avatar upload, plan badge, sign out
   All inline-script logic merged here.
═══════════════════════════════════════════════════════ */
'use strict';

// ── MODELS ──────────────────────────────────────────
const GEMINI_CHAT_MODEL   = 'gemini-2.5-flash';
const GEMINI_IMAGE_MODEL  = 'gemini-2.5-flash-image';
const GEMINI_TTS_MODEL    = 'gemini-2.5-pro-preview-tts';
const LYRIA_MODEL         = 'lyria-3-pro-preview';
const HOME_URL            = 'https://jeethylabs.site';
const OWNER_KEY_PLACEHOLDER = '__OWNER_API_KEY__';

// ── PLAN LIMITS ──────────────────────────────────────
const PLAN_LIMITS = {
  free: { requests: 10,  label: 'Free', color: '#a78bfa' },
  pro:  { requests: 100, label: 'Pro',  color: '#06b6d4' },
  max:  { requests: 500, label: 'Max',  color: '#fbbf24' }
};

// ── STATE ────────────────────────────────────────────
let currentPanel    = 0;
let userPlan        = 'free';
let proCustomKey    = '';
let useOwnKey       = false;
let ownerApiKey     = '';
let requestCount    = 0;
let chatHistory     = [];
let isChatLoading   = false;
let touchStartX     = 0;
let touchStartY     = 0;
let currentUser     = null;
let pendingAction   = null;
let _otpPendingData = null;
let _resendCountdown = null;

// expose to inline script if any
window.PLAN_LIMITS = PLAN_LIMITS;

// ── HELPERS ──────────────────────────────────────────
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function formatTime(d){ return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
function saveState(){}
function loadState(){}

function showToast(msg, type='success'){
  let box = $('toastBox');
  if(!box){
    box = document.createElement('div');
    box.id = 'toastBox';
    box.style.cssText = 'position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `max-width:90vw;padding:10px 18px;border-radius:12px;font:600 13px 'DM Sans',sans-serif;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.35);background:${type==='error'?'#ef4444':'#10b981'};`;
  box.appendChild(t);
  setTimeout(()=>{ t.style.transition='opacity .3s,transform .3s'; t.style.opacity='0'; t.style.transform='translateY(6px)'; },2200);
  setTimeout(()=>t.remove(),2500);
}

// ── INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadState();
  setWelcomeTime();
  initSwipe();
  renderPlanBadge();
  await fetchOwnerKey();
  await checkExistingSession();
  bindGlobalDropdownClose();
});

// ── OWNER KEY ────────────────────────────────────────
async function fetchOwnerKey(){
  try {
    const r = await fetch('/api/key');
    if(r.ok){ const d = await r.json(); ownerApiKey = d.key||''; }
  } catch(e){ ownerApiKey=''; }
}
function getActiveApiKey(){
  if(userPlan==='pro' && useOwnKey && proCustomKey) return proCustomKey;
  return ownerApiKey;
}

// ── QUOTA ────────────────────────────────────────────
function checkQuota(){
  const limit = PLAN_LIMITS[userPlan]?.requests ?? 10;
  if(requestCount >= limit){ showUpgradeModal(); return false; }
  return true;
}
function incrementRequest(){ requestCount++; syncProfileSheet(); }

// ── WELCOME TIME ─────────────────────────────────────
function setWelcomeTime(){
  const el = $('welcomeTime');
  if(el) el.textContent = formatTime(new Date());
}

// ── PLAN BADGE (nav) ─────────────────────────────────
function renderPlanBadge(){
  const badge = $('planBadge');
  if(!badge) return;
  const p = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  badge.textContent  = p.label;
  badge.style.color  = p.color;
  badge.style.borderColor = p.color+'66';
}

// ══════════════════════════════════════════════════════
// SESSION CHECK
// ══════════════════════════════════════════════════════
async function checkExistingSession(){
  try {
    const r = await fetch('/api/me', { credentials:'include' });
    if(r.ok){
      const d = await r.json();
      if(d.user) onLoginSuccess(d.user, false);
    }
  } catch(e){}
}

// ══════════════════════════════════════════════════════
// ON LOGIN SUCCESS
// ══════════════════════════════════════════════════════
function onLoginSuccess(user, runPending=true){
  currentUser = user;
  window.currentUser = user;
  if(user.plan && PLAN_LIMITS[user.plan]){
    userPlan = user.plan;
    renderPlanBadge();
  }
  updateNavAvatar(user);
  closeAuthModal();
  syncProfileSheet();
  if(runPending && pendingAction){
    const a = pendingAction; pendingAction = null;
    if(a==='chat')  setTimeout(()=>{ if(currentUser) sendChat(); },100);
    if(a==='image') setTimeout(()=>{ if(currentUser) generateImage(); },100);
    if(a==='song')  setTimeout(()=>{ if(currentUser) generateSong(); },100);
  }
}

// ── AUTH GUARD ───────────────────────────────────────
function requireAuth(action, fn){
  if(currentUser) return fn();
  pendingAction = action;
  openAuthModal();
}

// ══════════════════════════════════════════════════════
// AUTH MODAL (Login / Signup / OTP)
// ══════════════════════════════════════════════════════
function openAuthModal(action){
  if(action) pendingAction = action;
  const m = $('authModal');
  if(m) m.classList.add('open');
  clearAuthMsg();
  switchAuthTab('login');
}
function closeAuthModal(){
  const m = $('authModal');
  if(m) m.classList.remove('open');
}
function switchAuthTab(tab){
  const lf=$('authLoginForm'), sf=$('authSignupForm'), of=$('authOtpForm');
  const tl=$('authTabLogin'),  ts=$('authTabSignup');
  clearAuthMsg();
  if(of) of.style.display='none';
  const ON  = 'background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;';
  const OFF = 'background:transparent;color:#9ca3af;';
  if(tab==='login'){
    if(lf) lf.style.display='flex';
    if(sf) sf.style.display='none';
    if(tl) tl.style.cssText += ON;
    if(ts) ts.style.cssText += OFF;
  } else {
    if(lf) lf.style.display='none';
    if(sf) sf.style.display='flex';
    if(ts) ts.style.cssText += ON;
    if(tl) tl.style.cssText += OFF;
  }
}
function showAuthMsg(msg, type){
  const el = $('authMsg'); if(!el) return;
  el.style.display  = 'block';
  el.style.background = type==='error'?'rgba(239,68,68,.12)':'rgba(16,185,129,.12)';
  el.style.color    = type==='error'?'#f87171':'#34d399';
  el.style.border   = `1px solid ${type==='error'?'rgba(239,68,68,.3)':'rgba(16,185,129,.3)'}`;
  el.textContent    = msg;
}
function clearAuthMsg(){ const el=$('authMsg'); if(el){el.style.display='none';el.textContent='';} }

// ─ SIGNUP ────────────────────────────────────────────
async function submitSignup(e){
  e.preventDefault(); clearAuthMsg();
  const btn   = $('authSignupBtn');
  const name  = $('authSignupName').value.trim();
  const email = $('authSignupEmail').value.trim();
  const pass  = $('authSignupPass').value;
  if(!name) return showAuthMsg('Please enter your name.','error');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAuthMsg('Please enter a valid email.','error');
  if(pass.length<8) return showAuthMsg('Password must be at least 8 characters.','error');
  btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Sending code...';
  try {
    const r = await fetch('/api/send-otp',{
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({name,email,password:pass})
    });
    const d = await r.json();
    if(r.ok){
      _otpPendingData = {name,email,password:pass};
      $('otpEmailDisplay').textContent = email;
      $('authSignupForm').style.display = 'none';
      $('authOtpForm').style.display    = 'flex';
      $('authOtpInput').value = '';
      startResendTimer(60);
      showAuthMsg('Code ត្រូវបានផ្ញើ! សូមពិនិត្យ Email.','success');
    } else showAuthMsg(d.error||'Failed to send code.','error');
  } catch(ex){ showAuthMsg('Network error. Check connection.','error'); }
  btn.disabled=false; btn.innerHTML='<i class="fas fa-paper-plane"></i> Send Verification Code';
}

// ─ OTP VERIFY ────────────────────────────────────────
async function submitOtp(){
  clearAuthMsg();
  const otp = $('authOtpInput').value.trim();
  const btn = $('authOtpBtn');
  if(!otp||otp.length!==6) return showAuthMsg('Please enter the 6-digit code.','error');
  btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Verifying...';
  try {
    const r = await fetch('/api/verify-otp',{
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({..._otpPendingData, otp})
    });
    const d = await r.json();
    if(r.ok){
      _otpPendingData = null;
      showAuthMsg(`Welcome, ${d.user.name}! 🎉 Account created!`,'success');
      setTimeout(()=>onLoginSuccess(d.user),900);
    } else showAuthMsg(d.error||'Invalid or expired code.','error');
  } catch(ex){ showAuthMsg('Network error.','error'); }
  btn.disabled=false; btn.innerHTML='<i class="fas fa-check-circle"></i> Verify & Create Account';
}

async function resendOtp(){
  if(!_otpPendingData) return;
  clearAuthMsg();
  try {
    const r = await fetch('/api/send-otp',{
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(_otpPendingData)
    });
    const d = await r.json();
    if(r.ok){ showAuthMsg('Code ថ្មីត្រូវបានផ្ញើ!','success'); startResendTimer(60); }
    else showAuthMsg(d.error||'Failed to resend.','error');
  } catch(ex){ showAuthMsg('Network error.','error'); }
}

function backToSignup(){
  $('authOtpForm').style.display    = 'none';
  $('authSignupForm').style.display = 'flex';
  clearAuthMsg();
  if(_resendCountdown) clearInterval(_resendCountdown);
}

function startResendTimer(sec){
  const btn=$('resendOtpBtn'), timer=$('resendTimer');
  if(!btn||!timer) return;
  btn.style.display='none'; timer.style.display='inline';
  let s=sec;
  if(_resendCountdown) clearInterval(_resendCountdown);
  _resendCountdown = setInterval(()=>{
    timer.textContent=`Resend in ${s}s`; s--;
    if(s<0){ clearInterval(_resendCountdown); btn.style.display='inline'; timer.style.display='none'; }
  },1000);
}

// ─ LOGIN ─────────────────────────────────────────────
async function submitLogin(e){
  e.preventDefault(); clearAuthMsg();
  const btn   = $('authLoginBtn');
  const email = $('authLoginEmail').value.trim();
  const pass  = $('authLoginPass').value;
  btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Logging in...';
  try {
    const r = await fetch('/api/login',{
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email, password:pass})
    });
    const d = await r.json();
    if(r.ok){
      showAuthMsg(`Welcome back, ${d.user.name}! ✅`,'success');
      setTimeout(()=>onLoginSuccess(d.user),800);
    } else showAuthMsg(d.error||'Invalid email or password.','error');
  } catch(ex){ showAuthMsg('Network error. Check connection.','error'); }
  btn.disabled=false; btn.innerHTML='<i class="fas fa-arrow-right-to-bracket"></i> Login';
}

// ── LOGOUT ───────────────────────────────────────────
async function logoutUser(){
  closeDd(); closeProfileSheet();
  try { await fetch('/api/logout',{method:'POST',credentials:'include'}); } catch(e){}
  currentUser = null; window.currentUser = null;
  const wrap = $('userProfileWrap');
  if(wrap) wrap.style.display='none';
  showToast('Signed out','error');
}
// alias for inline HTML onclick="doLogout()"
window.doLogout = logoutUser;

// ══════════════════════════════════════════════════════
// NAV AVATAR + DROPDOWN
// ══════════════════════════════════════════════════════
function updateNavAvatar(user){
  const wrap   = $('userProfileWrap');
  const navBtn = $('userAvatarBtn');
  const init   = (user.name||'U').charAt(0).toUpperCase();
  const plan   = user.plan||'free';
  const planLbl= (PLAN_LIMITS[plan]||PLAN_LIMITS.free).label;
  if(wrap)   wrap.style.display='flex';
  if(navBtn){
    navBtn.innerHTML = user.avatar_url
      ? `<img src="${user.avatar_url}" alt="${esc(init)}" />`
      : `<span>${esc(init)}</span>`;
  }
  const pdAv = $('pdAv');
  if(pdAv) pdAv.innerHTML = user.avatar_url
    ? `<img src="${user.avatar_url}" alt="${esc(init)}" />`
    : `<span>${esc(init)}</span>`;
  const nm=$('pdName'); if(nm) nm.textContent=user.name||'';
  const em=$('pdEmail'); if(em) em.textContent=user.email||'';
  const bd=$('pdBadge'); if(bd){ bd.textContent=planLbl; _applyPlanBadgeStyle(bd,plan); }
}

function _applyPlanBadgeStyle(el,plan){
  const styles={
    free:'background:rgba(167,139,250,.15);color:#a78bfa;border-color:rgba(167,139,250,.4)',
    pro: 'background:rgba(6,182,212,.15);color:#22d3ee;border-color:rgba(6,182,212,.4)',
    max: 'background:rgba(251,191,36,.15);color:#fbbf24;border-color:rgba(251,191,36,.4)'
  };
  el.style.cssText=(el.style.cssText||'')+';'+( styles[plan]||styles.free);
}

function toggleDropdown(e){
  if(e){e.preventDefault();e.stopPropagation();}
  const dd=$('profileDropdown'); if(!dd) return;
  dd.classList.toggle('open');
}
// alias used in HTML: onclick="toggleDropdown(event)"
window.toggleDropdown = toggleDropdown;

function closeDd(){ const dd=$('profileDropdown'); if(dd) dd.classList.remove('open'); }
window.closeDd = closeDd;

function bindGlobalDropdownClose(){
  document.addEventListener('click', e=>{
    const wrap=$('userProfileWrap');
    if(wrap&&!wrap.contains(e.target)) closeDd();
  }, true);
}

// ══════════════════════════════════════════════════════
// PROFILE SHEET  (#ppOverlay / #ppSheet in index.html)
// ══════════════════════════════════════════════════════
function openProfileSheet(){
  syncProfileSheet();
  const ov=$('ppOverlay'); if(ov) ov.classList.add('open');
}
window.openProfileSheet = openProfileSheet;

function closeProfileSheet(){
  const ov=$('ppOverlay'); if(ov) ov.classList.remove('open');
}
window.closeProfileSheet = closeProfileSheet;

function closePPif(e){
  if(e.target===$('ppOverlay')) closeProfileSheet();
}
window.closePPif = closePPif;

function syncProfileSheet(){
  const u     = currentUser;
  const plan  = (u&&u.plan)||userPlan||'free';
  const info  = PLAN_LIMITS[plan]||PLAN_LIMITS.free;
  const limit = info.requests;
  const used  = requestCount||0;
  const pct   = Math.min(100,Math.round(used/limit*100));

  /* hero */
  const init = (u&&u.name||'U').charAt(0).toUpperCase();
  const set  = (id,v)=>{ const e=$(id); if(e) e.textContent=v||'—'; };
  set('ppHeroName',  u&&u.name);
  set('ppHeroEmail', u&&u.email);
  set('ppInfoName',  u&&u.name);
  set('ppInfoEmail', u&&u.email);
  set('ppInfoPlan',  info.label);
  set('ppInfoJoined', u&&u.created_at
    ? new Date(u.created_at).toLocaleDateString([],{year:'numeric',month:'short',day:'numeric'})
    : 'Today');

  /* avatar */
  const av=$('ppAvatarEl');
  if(av) av.innerHTML = (u&&u.avatar_url)
    ? `<img src="${u.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${esc(init)}"/>`
    : `<span id="ppInitial">${esc(init)}</span>`;

  /* plan badge */
  const badge=$('ppPlanBadge');
  if(badge){
    const styleMap={
      free:'rgba(167,139,250,.15);color:#a78bfa;border:1px solid rgba(167,139,250,.4)',
      pro: 'rgba(6,182,212,.15);color:#22d3ee;border:1px solid rgba(6,182,212,.4)',
      max: 'rgba(251,191,36,.15);color:#fbbf24;border:1px solid rgba(251,191,36,.4)'
    };
    badge.style.cssText=`display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;padding:3px 12px;border-radius:20px;text-transform:uppercase;letter-spacing:.5px;background:${styleMap[plan]||styleMap.free}`;
    badge.innerHTML=`<i class="fas fa-${plan==='max'?'gem':plan==='pro'?'crown':'star'}"></i> ${info.label} Plan`;
  }

  /* upgrade banner */
  const ub=$('ppUpgradeBanner');
  if(ub) ub.style.display=(plan==='free')?'flex':'none';

  /* usage bar */
  const cnt=$('ppUsageCount'); if(cnt) cnt.textContent=`${used} / ${limit}`;
  const bar=$('ppUsageBar');
  if(bar){
    bar.style.width=pct+'%';
    bar.style.background=pct>=80?'#f87171':pct>=50?'#fbbf24':'#a855f7';
  }
}

// ── AVATAR UPLOAD ────────────────────────────────────
async function handleAvatarUpload(e){
  const file = e.target.files&&e.target.files[0];
  if(!file||!currentUser) return;
  const status=$('ppAvatarStatus');
  const showStatus=(msg,ok)=>{
    if(!status) return;
    status.style.display='block';
    status.style.background=ok?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)';
    status.style.color=ok?'#34d399':'#f87171';
    status.textContent=msg;
  };
  if(file.size>5*1024*1024) return showStatus('File too large (max 5MB).',false);
  showStatus('Uploading...','info');
  const fd=new FormData(); fd.append('avatar',file);
  try {
    const r = await fetch('/api/profile/avatar',{method:'POST',credentials:'include',body:fd});
    const d = await r.json();
    if(r.ok && d.avatar_url){
      currentUser.avatar_url = d.avatar_url;
      window.currentUser = currentUser;
      updateNavAvatar(currentUser);
      syncProfileSheet();
      showStatus('Profile photo updated!',true);
      setTimeout(()=>{ if(status) status.style.display='none'; },3000);
    } else showStatus(d.error||'Upload failed.', false);
  } catch(ex){ showStatus('Network error during upload.',false); }
}
window.handleAvatarUpload = handleAvatarUpload;

// ══════════════════════════════════════════════════════
// PANEL NAVIGATION + SWIPE
// ══════════════════════════════════════════════════════
function goToPanel(index){
  currentPanel = index;
  const track=$('panelsTrack');
  if(track) track.style.transform=`translateX(-${index*33.333}%)`;
  document.querySelectorAll('.dot').forEach((d,i)=>d.classList.toggle('active',i===index));
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',i===index));
}
window.goToPanel = goToPanel;

function initSwipe(){
  const wrap=$('panelsWrap'); if(!wrap) return;
  wrap.addEventListener('touchstart',e=>{ touchStartX=e.touches[0].clientX; touchStartY=e.touches[0].clientY; },{passive:true});
  wrap.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-touchStartX;
    const dy=e.changedTouches[0].clientY-touchStartY;
    if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>50){
      if(dx<0&&currentPanel<2) goToPanel(currentPanel+1);
      if(dx>0&&currentPanel>0) goToPanel(currentPanel-1);
    }
  },{passive:true});
}

// ══════════════════════════════════════════════════════
// PLAN MODAL
// ══════════════════════════════════════════════════════
function openPlanModal(){ const m=$('planModal'); if(m) m.classList.add('open'); }
function closePlanModal(){ const m=$('planModal'); if(m) m.classList.remove('open'); }
window.openPlanModal=openPlanModal; window.closePlanModal=closePlanModal;

function selectPlan(plan){
  userPlan=plan;
  document.querySelectorAll('.plan-card').forEach(c=>c.classList.toggle('selected',c.dataset.plan===plan));
  renderPlanBadge(); syncProfileSheet();
  const ps=$('proSettingsInModal');
  if(ps) ps.style.display=plan==='pro'?'block':'none';
}
window.selectPlan=selectPlan;

function confirmPlan(){
  closePlanModal();
  showToast(`${PLAN_LIMITS[userPlan].label} plan activated!`,'success');
  syncProfileSheet();
}
window.confirmPlan=confirmPlan;

// ══════════════════════════════════════════════════════
// SETTINGS MODAL (Pro only)
// ══════════════════════════════════════════════════════
function openSettings(){
  if(userPlan!=='pro'){ showToast('Settings available on Pro plan','error'); openPlanModal(); return; }
  const m=$('settingsModal'); if(!m) return;
  m.classList.add('open');
  if($('customKeyInput')) $('customKeyInput').value=proCustomKey;
  if($('useOwnKeyToggle')) $('useOwnKeyToggle').checked=useOwnKey;
  updateSettingsUI();
}
function closeSettings(){ const m=$('settingsModal'); if(m) m.classList.remove('open'); }
function updateSettingsUI(){
  const t=$('useOwnKeyToggle'), ks=$('customKeySection');
  if(t&&ks) ks.style.display=t.checked?'block':'none';
}
function saveSettings(){
  const t=$('useOwnKeyToggle');
  const key=$('customKeyInput')?$('customKeyInput').value.trim():'';
  if(!t) return;
  useOwnKey=t.checked;
  if(useOwnKey&&!key) return showToast('Enter your API key first','error');
  proCustomKey=key;
  showToast(useOwnKey?'Using your own API key':'Using JeeThy Labs owner key','success');
  closeSettings();
}
window.openSettings=openSettings; window.closeSettings=closeSettings;
window.updateSettingsUI=updateSettingsUI; window.saveSettings=saveSettings;

// ══════════════════════════════════════════════════════
// UPGRADE MODAL
// ══════════════════════════════════════════════════════
function showUpgradeModal(){ const m=$('upgradeModal'); if(m) m.classList.add('open'); }
function closeUpgradeModal(){ const m=$('upgradeModal'); if(m) m.classList.remove('open'); }
function upgradeNow(){ closeUpgradeModal(); openPlanModal(); }
window.showUpgradeModal=showUpgradeModal; window.closeUpgradeModal=closeUpgradeModal; window.upgradeNow=upgradeNow;

function requirePro(btn,groupId){
  if(userPlan==='pro') selectChip(btn,groupId);
  else { showUpgradeModal(); showToast('1080p is available on Pro plan only','error'); }
}
window.requirePro=requirePro;

// ══════════════════════════════════════════════════════
// CHAT
// ══════════════════════════════════════════════════════
function autoResize(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,100)+'px'; }
function handleChatKey(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChat(); } }
window.autoResize=autoResize; window.handleChatKey=handleChatKey;

async function sendChat(){
  if(!currentUser){ pendingAction='chat'; return openAuthModal(); }
  if(!checkQuota()) return;
  const input=$('chatInput'); if(!input) return;
  const text=input.value.trim(); if(!text) return;
  appendMessage('user',text);
  input.value=''; input.style.height='auto';
  incrementRequest();
  if(isChatLoading) return;
  isChatLoading=true;
  const typingId=appendTyping();
  chatHistory.push({role:'user',parts:[{text}]});
  try {
    const key=getActiveApiKey();
    if(!key){ removeTyping(typingId); appendMessage('bot','❌ No API key configured.'); isChatLoading=false; return; }
    const body={
      contents: chatHistory,
      generationConfig:{temperature:.9,maxOutputTokens:2048}
    };
    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:generateContent?key=${key}`,{
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
    });
    const d=await r.json();
    removeTyping(typingId);
    if(r.ok){
      const reply=d.candidates?.[0]?.content?.parts?.[0]?.text||'No response.';
      chatHistory.push({role:'model',parts:[{text:reply}]});
      appendMessage('bot',reply);
    } else appendMessage('bot',`❌ Error: ${d.error?.message||'API error'}`);
  } catch(ex){ removeTyping(typingId); appendMessage('bot','❌ Network error.'); }
  isChatLoading=false;
}
window.sendChat=sendChat;

function appendMessage(role,text){
  const c=$('chatMessages'); if(!c) return;
  const isUser=role==='user';
  const wrap=document.createElement('div'); wrap.className=`msg ${isUser?'msg-user':'msg-bot'}`;
  const av=document.createElement('div'); av.className='msg-avatar';
  if(isUser&&currentUser){ av.textContent=(currentUser.name||'U').charAt(0).toUpperCase(); av.style.cssText='font-size:13px;font-weight:700;'; }
  else av.innerHTML=isUser?'<i class="fas fa-user"></i>':'<i class="fas fa-brain"></i>';
  const bubble=document.createElement('div'); bubble.className='msg-bubble';
  bubble.innerHTML=isUser?esc(text):`<div class="prose-response">${formatMarkdown(text)}</div>`;
  const ts=document.createElement('span'); ts.className='msg-time'; ts.textContent=formatTime(new Date());
  bubble.appendChild(ts);
  wrap.appendChild(av); wrap.appendChild(bubble);
  c.appendChild(wrap); c.scrollTop=c.scrollHeight;
}

function appendTyping(){
  const c=$('chatMessages'); if(!c) return null;
  const id='typing_'+Date.now();
  const wrap=document.createElement('div'); wrap.id=id; wrap.className='msg msg-bot';
  wrap.innerHTML='<div class="msg-avatar"><i class="fas fa-brain"></i></div><div class="msg-bubble"><span class="typing-dots"><span></span><span></span><span></span></span></div>';
  c.appendChild(wrap); c.scrollTop=c.scrollHeight;
  return id;
}
function removeTyping(id){ if(id){ const el=$(id); if(el) el.remove(); } }
function formatMarkdown(text){
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`(.+?)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br/>');
}

// ══════════════════════════════════════════════════════
// IMAGE GENERATE
// ══════════════════════════════════════════════════════
function getActiveChip(groupId){
  const el=document.querySelector(`#${groupId} .chip.active`);
  return el?el.textContent.replace(/PRO/g,'').trim():'';
}
function selectChip(btn,groupId){
  document.querySelectorAll(`#${groupId} .chip`).forEach(c=>c.classList.remove('active'));
  btn.classList.add('active');
}
window.selectChip=selectChip;

async function generateImage(){
  if(!currentUser){ pendingAction='image'; return openAuthModal(); }
  if(!checkQuota()) return;
  const prompt=$('imgPrompt')?.value.trim();
  if(!prompt) return showToast('Please enter a prompt','error');
  const style=getActiveChip('imgStyleGroup');
  const ratio=getActiveChip('imgRatioGroup');
  const quality=getActiveChip('imgQualityGroup');
  const qty=parseInt(getActiveChip('imgQtyGroup'))||1;
  const resultsEl=$('imgResults'); if(!resultsEl) return;
  const btn=$('imgGenBtn');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Generating...'; }
  resultsEl.innerHTML='<div class="loading-card"><div class="loading-spinner cyan"></div><div class="loading-label">Creating your image…</div></div>';
  incrementRequest();
  const key=getActiveApiKey();
  if(!key){ resultsEl.innerHTML='<div class="error-card">❌ No API key configured.</div>'; if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-wand-magic-sparkles"></i> Generate Image';} return; }
  const fullPrompt=`${style} style: ${prompt}`;
  try {
    const promises=Array.from({length:qty},()=>fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${key}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contents:[{parts:[{text:fullPrompt}]}],generationConfig:{responseModalities:['TEXT','IMAGE']}}) }
    ).then(r=>r.json()));
    const results=await Promise.all(promises);
    resultsEl.innerHTML='';
    let found=0;
    results.forEach(d=>{
      const parts=d.candidates?.[0]?.content?.parts||[];
      parts.forEach(p=>{
        if(p.inlineData?.mimeType?.startsWith('image/')){
          found++;
          const src=`data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
          const card=document.createElement('div'); card.className='image-result-card';
          card.innerHTML=`<img src="${src}" alt="Generated" loading="lazy" onclick="openImageFullscreen('${src}')" style="cursor:zoom-in;"/><div class="image-actions"><a href="${src}" download="jeethylabs_image.png" class="btn-action"><i class="fas fa-download"></i> Save</a></div>`;
          resultsEl.appendChild(card);
        }
      });
    });
    if(!found) resultsEl.innerHTML='<div class="error-card">⚠️ No image returned. Try a different prompt.</div>';
  } catch(ex){ resultsEl.innerHTML='<div class="error-card">❌ Network error during image generation.</div>'; }
  if(btn){ btn.disabled=false; btn.innerHTML='<i class="fas fa-wand-magic-sparkles"></i> Generate Image'; }
}
window.generateImage=generateImage;

function openImageFullscreen(src){
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  ov.innerHTML=`<img src="${src}" style="max-width:95vw;max-height:95vh;border-radius:12px;" />`;
  ov.onclick=()=>ov.remove();
  document.body.appendChild(ov);
}
window.openImageFullscreen=openImageFullscreen;

// ══════════════════════════════════════════════════════
// SONG GENERATE
// ══════════════════════════════════════════════════════
async function generateSong(){
  if(!currentUser){ pendingAction='song'; return openAuthModal(); }
  if(!checkQuota()) return;
  const prompt=$('songPrompt')?.value.trim();
  if(!prompt) return showToast('Please enter a song description','error');
  const style=getActiveChip('songStyleGroup');
  const voice=getActiveChip('songVoiceGroup');
  const resultsEl=$('songResults'); if(!resultsEl) return;
  const btn=$('songGenBtn');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Composing...'; }
  resultsEl.innerHTML='<div class="loading-card green-loader"><div class="loading-spinner green"></div><div class="loading-label">Composing your song…</div></div>';
  incrementRequest();
  const key=getActiveApiKey();
  if(!key){ resultsEl.innerHTML='<div class="error-card">❌ No API key configured.</div>'; if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-wand-magic-sparkles"></i> Generate Song';} return; }
  const fullPrompt=`Create a ${style} song with ${voice.toLowerCase()} vocalist about: ${prompt}`;
  try {
    const r=await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${key}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contents:[{parts:[{text:fullPrompt}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:voice.toLowerCase()==='female'?'Aoede':'Charon'}}}}}) }
    );
    const d=await r.json();
    const parts=d.candidates?.[0]?.content?.parts||[];
    const audioPart=parts.find(p=>p.inlineData?.mimeType?.startsWith('audio/'));
    if(audioPart){
      const src=`data:${audioPart.inlineData.mimeType};base64,${audioPart.inlineData.data}`;
      resultsEl.innerHTML=`
        <div class="song-result-card">
          <div class="song-card-header"><i class="fas fa-music"></i><strong>Your Song</strong></div>
          <audio controls src="${src}" style="width:100%;margin:10px 0;border-radius:8px;"></audio>
          <a href="${src}" download="jeethylabs_song.wav" class="btn-action"><i class="fas fa-download"></i> Download</a>
        </div>`;
    } else {
      resultsEl.innerHTML='<div class="error-card">⚠️ No audio returned. Try a different description.</div>';
    }
  } catch(ex){ resultsEl.innerHTML='<div class="error-card">❌ Network error during song generation.</div>'; }
  if(btn){ btn.disabled=false; btn.innerHTML='<i class="fas fa-wand-magic-sparkles"></i> Generate Song'; }
}
window.generateSong=generateSong;

// ── expose auth functions for inline HTML onsubmit / onclick ──
window.submitLogin=submitLogin;
window.submitSignup=submitSignup;
window.submitOtp=submitOtp;
window.resendOtp=resendOtp;
window.backToSignup=backToSignup;
window.openAuthModal=openAuthModal;
window.closeAuthModal=closeAuthModal;
window.switchAuthTab=switchAuthTab;
window.logoutUser=logoutUser;
window.syncProfileSheet=syncProfileSheet;
