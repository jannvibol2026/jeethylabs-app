"use strict";

// ======================= MODELS =======================
let GEMINI_CHAT_MODEL    = "gemini-2.5-flash";
let GEMINI_IMAGE_MODELS  = [];
let GEMINI_TTS_MODELS    = [];

// ==================== PLAN LIMITS ====================
const PLAN_LIMITS = {
  free: { requests: 10,  label: "Free", color: "#a78bfa" },
  pro:  { requests: 100, label: "Pro",  color: "#06b6d4" },
  max:  { requests: 500, label: "Max",  color: "#fbbf24" }
};

// ======================= STATE =======================
let currentPanel  = 0;
let userPlan      = "free";
let proCustomKey  = "";
let useOwnKey     = false;
let _ownKeyOn     = false;
let _refImgBase64 = null;
let _refImgMime   = null;
let ownerApiKey   = "";
let requestCount  = 0;
let chatHistory   = [];
let isChatLoading = false;
let touchStartX   = 0;
let touchStartY   = 0;
let currentUser   = null;
let pendingAction = null;
let _otpPending   = null;
let _resendTimer  = null;
let authToken     = null;

// ======================== INIT ========================
document.addEventListener("DOMContentLoaded", async () => {
  setWelcomeTime();
  initSwipe();
  renderPlanBadge();
  await fetchOwnerKey();
  await fetchAvailableModels();
  await checkExistingSession();
  if (!currentUser) enforceAuthGate();
});

// ===================== AUTH GATE =====================
function enforceAuthGate() {
  const chatInput   = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");
  if (chatInput)   { chatInput.disabled = true; chatInput.placeholder = "🔒 Sign in to start chatting..."; }
  if (chatSendBtn) chatSendBtn.disabled = true;
  showPanelOverlay("panel-chat",  "chat");
  showPanelOverlay("panel-image", "image");
  showPanelOverlay("panel-song",  "song");
}

function showPanelOverlay(panelClass, action) {
  const panel = document.querySelector("." + panelClass);
  if (!panel) return;
  const existing = panel.querySelector(".auth-gate-overlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.className = "auth-gate-overlay";
  overlay.style.cssText = `
    position:absolute;inset:0;z-index:50;
    background:rgba(10,10,20,0.82);
    display:flex;flex-direction:column;
    align-items:center;justify-content:center;
    gap:16px;backdrop-filter:blur(6px);
    border-radius:inherit;
  `;
  const icon  = action === "chat" ? "fa-comments" : action === "image" ? "fa-image" : "fa-music";
  const label = action === "chat" ? "AI Assistant" : action === "image" ? "Image Generator" : "Song Generator";
  overlay.innerHTML = `
    <div style="width:64px;height:64px;border-radius:50%;background:rgba(124,58,237,.18);border:2px solid rgba(124,58,237,.4);display:flex;align-items:center;justify-content:center;">
      <i class="fas ${icon}" style="font-size:24px;color:#a855f7;"></i>
    </div>
    <div style="text-align:center;padding:0 24px;">
      <div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:6px;">Sign In Required</div>
      <div style="font-size:13px;color:#9ca3af;line-height:1.5;">
        Please create an account or sign in<br/>to use the <strong style="color:#c4b5fd;">${label}</strong>.
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;width:220px;">
      <button onclick="openAuthModal('${action}')"
        style="padding:12px;border-radius:24px;border:none;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:.3px;">
        <i class="fas fa-arrow-right-to-bracket"></i> Sign In / Sign Up
      </button>
    </div>
  `;
  const style = window.getComputedStyle(panel);
  if (style.position === "static") panel.style.position = "relative";
  panel.appendChild(overlay);
}

function removeAuthGate() {
  document.querySelectorAll(".auth-gate-overlay").forEach(el => el.remove());
  const chatInput   = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");
  if (chatInput)   { chatInput.disabled = false; chatInput.placeholder = "Type a message..."; }
  if (chatSendBtn) chatSendBtn.disabled = false;
}

async function fetchOwnerKey() {
  try {
    const r = await fetch("/api/key");
    if (r.ok) { const d = await r.json(); ownerApiKey = d.key || ""; }
  } catch (e) { ownerApiKey = ""; }
}

async function fetchAvailableModels() {
  try {
    const r = await fetch("/api/models");
    if (!r.ok) { console.warn("[models] HTTP", r.status); return; }
    const d = await r.json();
    if (d.error) console.warn("[models] error:", d.error);
    if (d.recommended?.chat) GEMINI_CHAT_MODEL = d.recommended.chat;
    if (Array.isArray(d.imageModels) && d.imageModels.length) GEMINI_IMAGE_MODELS = d.imageModels;
    if (Array.isArray(d.ttsModels)   && d.ttsModels.length)   GEMINI_TTS_MODELS   = d.ttsModels;
    console.log("[models] chat:", GEMINI_CHAT_MODEL,
                "| image:", GEMINI_IMAGE_MODELS[0] || "(server decides)",
                "| tts:",   GEMINI_TTS_MODELS[0]   || "(server decides)");
  } catch (e) { console.warn("[models] fetch failed:", e.message); }
}

async function checkExistingSession() {
  try {
    const r = await fetch("/api/me", { credentials: "include" });
    if (r.ok) { const d = await r.json(); onLoginSuccess(d.user, false); return; }
    const stored = localStorage.getItem("jl_token");
    if (stored) {
      authToken = stored;
      const r2 = await fetch("/api/me", {
        credentials: "include",
        headers: { "Authorization": "Bearer " + stored }
      });
      if (r2.ok) { const d = await r2.json(); onLoginSuccess(d.user, false); }
      else { localStorage.removeItem("jl_token"); authToken = null; }
    }
  } catch (e) {}
}

function getActiveApiKey() {
 // ✅ NEW
if ((userPlan === "pro" || userPlan === "max") && useOwnKey && proCustomKey) return proCustomKey;
  return ownerApiKey;
}

function checkQuota() {
  const limit = PLAN_LIMITS[userPlan]?.requests ?? 10;
  if (requestCount >= limit) { showUpgradeModal(); return false; }
  return true;
}
function incrementRequest() { requestCount++; }

function setWelcomeTime() {
  const el = document.getElementById("welcomeTime");
  if (el) el.textContent = formatTime(new Date());
}

function renderPlanBadge() {
  const badge = document.getElementById("planBadge");
  if (!badge) return;
  const plan = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  badge.textContent       = plan.label;
  badge.style.color       = plan.color;
  badge.style.borderColor = plan.color + "66";
}

// ===================== PANEL NAV =====================
function goToPanel(index) {
  currentPanel = index;
  const track = document.getElementById("panelsTrack");
  if (track) track.style.transform = `translateX(-${index * 33.333}%)`;
  document.querySelectorAll(".tab").forEach((t, i) => t.classList.toggle("active", i === index));
}

function initSwipe() {
  const wrap = document.getElementById("panelsWrap");
  if (!wrap) return;
  wrap.addEventListener("touchstart", e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  wrap.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0 && currentPanel < 2) goToPanel(currentPanel + 1);
      if (dx > 0 && currentPanel > 0) goToPanel(currentPanel - 1);
    }
  }, { passive: true });
}

// ===================== AUTH MODAL =====================
function openAuthModal(action) {
  pendingAction = action || null;
  const m = document.getElementById("authModal");
  if (m) m.classList.add("open");
  clearAuthMsg();
  switchAuthTab("login");
}
function closeAuthModal() {
  const m = document.getElementById("authModal");
  if (m) m.classList.remove("open");
  pendingAction = null;
}
function switchAuthTab(tab) {
  const lf = document.getElementById("authLoginForm");
  const sf = document.getElementById("authSignupForm");
  const of = document.getElementById("authOtpForm");
  const tl = document.getElementById("authTabLogin");
  const ts = document.getElementById("authTabSignup");
  clearAuthMsg();
  if (of) of.style.display = "none";
  if (tab === "login") {
    if (lf) lf.style.display = "flex";
    if (sf) sf.style.display = "none";
    if (tl) { tl.style.background = "linear-gradient(135deg,#7c3aed,#a855f7)"; tl.style.color = "#fff"; }
    if (ts) { ts.style.background = "transparent"; ts.style.color = "#9ca3af"; }
  } else {
    if (lf) lf.style.display = "none";
    if (sf) sf.style.display = "flex";
    if (ts) { ts.style.background = "linear-gradient(135deg,#7c3aed,#a855f7)"; ts.style.color = "#fff"; }
    if (tl) { tl.style.background = "transparent"; tl.style.color = "#9ca3af"; }
  }
}
function showAuthMsg(msg, type) {
  const el = document.getElementById("authMsg");
  if (!el) return;
  el.style.display    = "block";
  el.style.background = type === "error" ? "rgba(239,68,68,.12)" : "rgba(16,185,129,.12)";
  el.style.color      = type === "error" ? "#f87171" : "#34d399";
  el.style.border     = "1px solid " + (type === "error" ? "rgba(239,68,68,.3)" : "rgba(16,185,129,.3)");
  el.textContent = msg;
}
function clearAuthMsg() {
  const el = document.getElementById("authMsg");
  if (el) { el.style.display = "none"; el.textContent = ""; }
}

// ======================= SIGNUP =======================
async function submitSignup(e) {
  e.preventDefault(); clearAuthMsg();
  const btn   = document.getElementById("authSignupBtn");
  const name  = document.getElementById("authSignupName").value.trim();
  const email = document.getElementById("authSignupEmail").value.trim();
  const pass  = document.getElementById("authSignupPass").value;
  if (!name)  return showAuthMsg("Please enter your name.", "error");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAuthMsg("Please enter a valid email.", "error");
  if (pass.length < 8) return showAuthMsg("Password must be at least 8 characters.", "error");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending code...';
  try {
    const res  = await fetch("/api/send-otp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ name, email, password: pass })
    });
    const data = await res.json();
    if (res.ok) {
      _otpPending = { name, email, password: pass };
      document.getElementById("otpEmailDisplay").textContent = email;
      document.getElementById("authSignupForm").style.display = "none";
      const of = document.getElementById("authOtpForm");
      of.style.display = "flex";
      document.getElementById("authOtpInput").value = "";
      startResendTimer(60);
      showAuthMsg("Code verified!‚ Email.", "success");
    } else { showAuthMsg(data.error || "Failed to send code.", "error"); }
  } catch (ex) { showAuthMsg("Network error. Check connection.", "error"); }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Verification Code';
}

async function submitOtp() {
  clearAuthMsg();
  const otp = document.getElementById("authOtpInput").value.trim();
  const btn = document.getElementById("authOtpBtn");
  if (!otp || otp.length !== 6) return showAuthMsg("Please enter the 6-digit code.", "error");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
  try {
    const res  = await fetch("/api/verify-otp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ ..._otpPending, otp })
    });
    const data = await res.json();
    if (res.ok) {
      _otpPending = null;
      if (data.token) { authToken = data.token; localStorage.setItem("jl_token", data.token); }
      showAuthMsg("Welcome, " + data.user.name + "! Account created!", "success");
      setTimeout(() => onLoginSuccess(data.user, true), 900);
    } else { showAuthMsg(data.error || "Invalid or expired code.", "error"); }
  } catch (ex) { showAuthMsg("Network error.", "error"); }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-check-circle"></i> Verify & Create Account';
}

async function resendOtp() {
  if (!_otpPending) return; clearAuthMsg();
  try {
    const res  = await fetch("/api/send-otp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify(_otpPending)
    });
    const data = await res.json();
    if (res.ok) { showAuthMsg("Code sent!", "success"); startResendTimer(60); }
    else showAuthMsg(data.error || "Failed to resend.", "error");
  } catch (ex) { showAuthMsg("Network error.", "error"); }
}

function backToSignup() {
  document.getElementById("authOtpForm").style.display    = "none";
  document.getElementById("authSignupForm").style.display = "flex";
  clearAuthMsg();
  if (_resendTimer) clearInterval(_resendTimer);
}

function startResendTimer(sec) {
  const btn   = document.getElementById("resendOtpBtn");
  const timer = document.getElementById("resendTimer");
  if (!btn || !timer) return;
  btn.style.display = "none"; timer.style.display = "inline";
  let s = sec;
  if (_resendTimer) clearInterval(_resendTimer);
  _resendTimer = setInterval(() => {
    timer.textContent = "Resend in " + s + "s";
    s--;
    if (s < 0) {
      clearInterval(_resendTimer);
      btn.style.display   = "inline";
      timer.style.display = "none";
    }
  }, 1000);
}

// ======================= LOGIN =======================
async function submitLogin(e) {
  e.preventDefault(); clearAuthMsg();
  const btn   = document.getElementById("authLoginBtn");
  const email = document.getElementById("authLoginEmail").value.trim();
  const pass  = document.getElementById("authLoginPass").value;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
  try {
    const res  = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ email, password: pass })
    });
    const data = await res.json();
    if (res.ok) {
      if (data.token) { authToken = data.token; localStorage.setItem("jl_token", data.token); }
      showAuthMsg("Welcome back, " + data.user.name + "!", "success");
      setTimeout(() => onLoginSuccess(data.user, true), 800);
    } else { showAuthMsg(data.error || "Invalid email or password.", "error"); }
  } catch (ex) { showAuthMsg("Network error.", "error"); }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Login';
}

// =================== onLoginSuccess ===================
function onLoginSuccess(user, runPending) {
  currentUser = user;
  window.currentUser = user;
  if (user.plan && PLAN_LIMITS[user.plan]) {
    userPlan = user.plan;
    renderPlanBadge();
    initSongPlanBadge();
  }
  updateNavAvatar(user);
  removeAuthGate();
  closeAuthModal();
  if (runPending) {
    const action = pendingAction; pendingAction = null;
    if (action === "chat")  setTimeout(() => _sendChat(),      100);
    if (action === "image") setTimeout(() => _generateImage(), 100);
    if (action === "song")  setTimeout(() => _generateSong(),  100);
  }
}

// Call on page ready if user already logged in
(function() {
  const orig = window.onload || function(){};
  window.addEventListener("DOMContentLoaded", function() {
    setTimeout(initSongPlanBadge, 500);
  });
})();

// ======================= LOGOUT =======================
async function doLogout() {
  currentUser = null; window.currentUser = null;
  authToken   = null;
  localStorage.removeItem("jl_token");
  userPlan    = "free";
  requestCount = 0;
  chatHistory  = [];
  renderPlanBadge();
  const wrap = document.getElementById("userProfileWrap");
  if (wrap) wrap.style.display = "none";
  closeDd();
  try { await fetch("/api/logout", { method: "POST", credentials: "include" }); } catch (e) {}
  showToast("Signed out", "error");
  enforceAuthGate();
}

// ===================== NAV AVATAR =====================
function updateNavAvatar(user) {
  const wrap     = document.getElementById("userProfileWrap");
  const navBtn   = document.getElementById("userAvatarBtn");
  const initial  = (user.name || "U").charAt(0).toUpperCase();
  const planInfo = PLAN_LIMITS[user.plan || "free"] || PLAN_LIMITS.free;
  if (wrap)   wrap.style.display = "flex";
  if (navBtn) {
    navBtn.innerHTML = user.avatar_url
      ? `<img src="${user.avatar_url}" alt="${escapeHtml(initial)}"/>`
      : `<span>${escapeHtml(initial)}</span>`;
  }
  const pdAv = document.getElementById("pdAv");
  if (pdAv) pdAv.innerHTML = user.avatar_url
    ? `<img src="${user.avatar_url}" alt="${escapeHtml(initial)}"/>`
    : `<span>${escapeHtml(initial)}</span>`;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || ""; };
  set("pdName",  user.name);
  set("pdEmail", user.email);
  set("pdBadge", planInfo.label);
}

// ====================== DROPDOWN ======================
function toggleDropdown(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const dd = document.getElementById("profileDropdown");
  if (dd) dd.classList.toggle("open");
}
function closeDd() {
  const dd = document.getElementById("profileDropdown");
  if (dd) dd.classList.remove("open");
}
// ✅ AFTER (bubble phase = normal):
document.addEventListener("click", e => {
  const wrap = document.getElementById("userProfileWrap");
  if (wrap && !wrap.contains(e.target)) closeDd();
});

// =================== PROFILE SHEET ===================
function openProfileSheet()  { syncProfileSheet(); document.getElementById("ppOverlay").classList.add("open"); }
function closeProfileSheet() { document.getElementById("ppOverlay").classList.remove("open"); }
function closePPif(e)        { if (e.target === document.getElementById("ppOverlay")) closeProfileSheet(); }

function syncProfileSheet() {
  const u     = currentUser;
  const plan  = (u && u.plan) || userPlan || "free";
  const info  = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const limit = info.requests;
  const used  = requestCount;
  const pct   = Math.min(100, Math.round(used / limit * 100));
  if (u) {
    const init = (u.name || "U").charAt(0).toUpperCase();
    const set  = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || "—"; };
    set("ppHeroName",   u.name);
    set("ppHeroEmail",  u.email);
    set("ppInfoName",   u.name);
    set("ppInfoEmail",  u.email);
    set("ppInfoPlan",   info.label);
    set("ppInfoJoined", u.created_at ? new Date(u.created_at).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : "Today");
    const av = document.getElementById("ppAvatarEl");
    if (av) av.innerHTML = u.avatar_url
      ? `<img src="${u.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${init}"/>`
      : `<span>${escapeHtml(init)}</span>`;
    const badge = document.getElementById("ppPlanBadge");
    if (badge) badge.innerHTML = `<i class="fas fa-star"></i> ${info.label} Plan`;
    const ub = document.getElementById("ppUpgradeBanner");
    if (ub) ub.style.display = (plan === "pro" || plan === "max") ? "none" : "flex";
  }
  const uc = document.getElementById("ppUsageCount");
  if (uc) uc.textContent = used + " / " + limit;
  const ub2 = document.getElementById("ppUsageBar");
  if (ub2) {
    ub2.style.width      = pct + "%";
    ub2.style.background = pct >= 80 ? "#f87171" : pct >= 50 ? "#fbbf24" : "#a855f7";
  }
}

async function handleAvatarUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    const url = ev.target.result;
    try {
      const headers = { "Content-Type": "application/json" };
      if (authToken) headers["Authorization"] = "Bearer " + authToken;
      const r = await fetch("/api/upload-avatar", {
        method: "POST", headers, credentials: "include",
        body: JSON.stringify({ avatar_url: url })
      });
      if (r.ok) {
        if (currentUser) currentUser.avatar_url = url;
        updateNavAvatar(currentUser);
        syncProfileSheet();
        showToast("Avatar updated!", "success");
      }
    } catch (ex) { showToast("Upload failed", "error"); }
  };
  reader.readAsDataURL(file);
}

// ===================== PLAN MODAL =====================
function openPlanModal() {
  const m = document.getElementById("planModal");
  if (!m) return;
  m.classList.add("open");
  document.querySelectorAll(".plan-card").forEach(c => c.classList.toggle("selected", c.dataset.plan === userPlan));
}
function closePlanModal() {
  const m = document.getElementById("planModal");
  if (m) m.classList.remove("open");
}
function selectPlan(plan) {
  document.querySelectorAll(".plan-card").forEach(c => c.classList.toggle("selected", c.dataset.plan === plan));
  const ps = document.getElementById("proSettingsInModal");
  if (ps) ps.style.display = (plan === "pro" || plan === "max") ? "block" : "none";
}

// ================ confirmPlan (FIXED) ================
async function confirmPlan() {
  const selected = document.querySelector(".plan-card.selected");
  if (!selected) { showToast("Please select a plan first", "error"); return; }
  const plan = selected.dataset.plan;
  if (!currentUser) { closePlanModal(); openAuthModal(null); return; }
  if (plan === userPlan) {
    closePlanModal();
    showToast("You are already on " + (PLAN_LIMITS[plan]?.label || plan) + " plan", "success");
    return;
  }
  // Find confirm button and show loading
  const btn     = document.querySelector("#planModal .btn-confirm, #planModal button[onclick='confirmPlan()'], #planModal button[onclick=\"confirmPlan()\"]");
  const oldHtml = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...'; }
  try {
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = "Bearer " + authToken;
    const res = await fetch("/api/subscribe", {
      method: "POST", headers, credentials: "include",
      body: JSON.stringify({ plan })
    });
    const d = await res.json();
    // Stripe checkout redirect
    if (d.checkoutUrl) { window.location.href = d.checkoutUrl; return; }
    if (!res.ok) throw new Error(d.error || "Could not change plan.");
    // ============ Success  update local state ============
    userPlan = d.user?.plan || plan;
    if (currentUser) currentUser.plan = userPlan;
    renderPlanBadge();
    updateNavAvatar(currentUser);
    syncProfileSheet();
    closePlanModal();
    showToast((PLAN_LIMITS[userPlan]?.label || userPlan) + " plan activated! 🎉", "success");
  } catch (err) {
    showToast(err.message || "Network error.", "error");
  } finally {
    if (btn && oldHtml !== null) { btn.disabled = false; btn.innerHTML = oldHtml; }
  }
}

// ====================== SETTINGS ======================
// ✅ NEW
function openSettings() {
  if (userPlan !== "pro" && userPlan !== "max") { showToast("Settings available on Pro and Max plans", "error"); openPlanModal(); return; }
  const m = document.getElementById("settingsModal"); if (!m) return;
  m.classList.add("open");
  document.getElementById("customKeyInput").value    = proCustomKey;
  _ownKeyOn = useOwnKey;
  updateSettingsUI();
}
function closeSettings() { const m = document.getElementById("settingsModal"); if (m) m.classList.remove("open"); }
function updateSettingsUI() {
  const btn  = document.getElementById("ownKeyToggleBtn");
  const knob = document.getElementById("ownKeyKnob");
  const sec  = document.getElementById("customKeySection");
  if (btn)  btn.style.background  = _ownKeyOn ? "var(--primary)" : "rgba(255,255,255,.12)";
  if (btn)  btn.style.borderColor = _ownKeyOn ? "var(--primary)" : "var(--border)";
  if (knob) knob.style.transform  = _ownKeyOn ? "translateX(20px)" : "translateX(0)";
  if (sec)  sec.style.display     = _ownKeyOn ? "block" : "none";
}
function toggleOwnKey() {
  _ownKeyOn = !_ownKeyOn;
  updateSettingsUI();
}
function saveSettings() {
  const k = document.getElementById("customKeyInput").value.trim();
  useOwnKey = _ownKeyOn;
  if (useOwnKey) {
    if (!k) return showToast("Enter your API key first", "error");
    proCustomKey = k; showToast("Using your own API key", "success");
  } else { proCustomKey = k; showToast("Using JeeThy Labs owner key", "success"); }
  closeSettings();
}

// =================== UPGRADE MODAL ===================
function showUpgradeModal()  { const m = document.getElementById("upgradeModal"); if (m) m.classList.add("open"); }
function closeUpgradeModal() { const m = document.getElementById("upgradeModal"); if (m) m.classList.remove("open"); }
function upgradeNow()        { closeUpgradeModal(); if (userPlan === "free") openPlanModal(); }
function requirePro(btn, groupId) {
  if (userPlan === "pro" || userPlan === "max") selectChip(btn, groupId);
  else { showUpgradeModal(); showToast("HD is available on Pro plan only", "error"); }
}

// ======================== CHAT ========================
function autoResize(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 100) + "px"; }
function handleChatKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }

function sendChat() {
  if (!currentUser) { openAuthModal("chat"); return; }
  _sendChat();
}

async function _sendChat() {
  if (isChatLoading) return;
  const key = getActiveApiKey();
  if (!key) { showToast("Service unavailable.", "error"); return; }
  if (!checkQuota()) return;
  const input = document.getElementById("chatInput");
  const text  = input.value.trim();
  if (!text) return;
  appendMessage("user", text);
  input.value = ""; input.style.height = "auto";
  isChatLoading = true;
  const sendBtn = document.getElementById("chatSendBtn");
  if (sendBtn) sendBtn.disabled = true;
  chatHistory.push({ role: "user", parts: [{ text }] });
  const typingId = appendTyping();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:generateContent?key=${key}`,
      {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: "You are JeeThy Assistant, a helpful and friendly AI created by JeeThy Labs.\nAnswer in the same language the user writes in.\nBe concise but thorough. Use markdown for formatting." }] },
          contents: chatHistory
        })
      }
    );
    removeTyping(typingId);
    if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || `HTTP ${res.status}`); }
    const data  = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, could not generate a response.";
    chatHistory.push({ role: "model", parts: [{ text: reply }] });
    appendMessage("bot", reply);
    incrementRequest();
  } catch (err) {
    removeTyping(typingId);
    appendMessage("bot", "⚠ " + err.message);
  }
  isChatLoading = false;
  if (sendBtn) sendBtn.disabled = false;
}

function appendMessage(role, text) {
  const container = document.getElementById("chatMessages"); if (!container) return;
  const isUser = role === "user";
  const div    = document.createElement("div");
  div.className = `msg ${isUser ? "msg-user" : "msg-bot"}`;
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  if (isUser && currentUser) {
    avatar.textContent = (currentUser.name || "U").charAt(0).toUpperCase();
    avatar.style.fontSize = "13px"; avatar.style.fontWeight = "700";
  } else { avatar.innerHTML = isUser ? '<i class="fas fa-user"></i>' : '<i class="fas fa-brain"></i>'; }
  const bubble = document.createElement("div"); bubble.className = "msg-bubble";
  if (isUser) bubble.textContent = text;
  else bubble.innerHTML = `<div class="prose-response">${formatMarkdown(text)}</div>`;
  const time = document.createElement("span"); time.className = "msg-time"; time.textContent = formatTime(new Date());
  bubble.appendChild(time);
  div.appendChild(avatar); div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendTyping() {
  const container = document.getElementById("chatMessages"); if (!container) return null;
  const id  = "typing-" + Date.now();
  const div = document.createElement("div"); div.className = "msg msg-bot"; div.id = id;
  const avatar = document.createElement("div"); avatar.className = "msg-avatar";
  avatar.innerHTML = '<i class="fas fa-brain"></i>';
  const bubble = document.createElement("div"); bubble.className = "msg-bubble";
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  div.appendChild(avatar); div.appendChild(bubble);
  container.appendChild(div); container.scrollTop = container.scrollHeight;
  return id;
}
function removeTyping(id) { if (!id) return; const el = document.getElementById(id); if (el) el.remove(); }

function formatMarkdown(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^### (.+)$/gm, "<h4 style=\"font-size:14px;font-weight:700;margin:8px 0 4px\">$1</h4>")
    .replace(/^## (.+)$/gm,  "<h3 style=\"font-size:15px;font-weight:700;margin:8px 0 4px\">$1</h3>")
    .replace(/^- (.+)$/gm,   "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)+/g, "<ul>$&</ul>")
    .replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br/>");
}

// =================== IMAGE GENERATE ===================
// ── Reference Image Upload ──────────────────────────────────
function openRefImgUpload() {
  if (userPlan !== "pro" && userPlan !== "max") {
    showUpgradeModal();
    showToast("Reference image upload is available on Pro & Max plans only", "error");
    return;
  }
  const inp = document.getElementById("refImgInput");
  if (!inp) return;
  inp.value = "";
  setTimeout(() => inp.click(), 50);
}
function handleRefImgUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Please select an image file", "error"); return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast("Image too large. Max 10MB.", "error"); return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    const dataUrl   = ev.target.result;
    _refImgBase64   = dataUrl.split(',')[1];
    _refImgMime     = file.type || 'image/jpeg';
    document.getElementById('refImgThumb').src                  = dataUrl;
    document.getElementById('refImgPlaceholder').style.display  = 'none';
    document.getElementById('refImgPreview').style.display      = 'block';
    document.getElementById('refImgDropZone').style.borderColor = 'var(--cyan,#06b6d4)';
    document.getElementById('refImgDropZone').style.background  = 'rgba(6,182,212,.06)';
  };
  reader.onerror = () => showToast("Failed to read image. Try another file.", "error");
  reader.readAsDataURL(file);
}
function clearRefImg(e) {
  if (e) e.stopPropagation();
  _refImgBase64 = null;
  _refImgMime   = null;
  const inp = document.getElementById('refImgInput');
  if (inp) inp.value = '';
  const ph  = document.getElementById('refImgPlaceholder');
  const pv  = document.getElementById('refImgPreview');
  const dz  = document.getElementById('refImgDropZone');
  if (ph) ph.style.display = 'block';
  if (pv) pv.style.display = 'none';
  if (dz) { dz.style.borderColor = 'var(--border)'; dz.style.background = 'rgba(255,255,255,.03)'; }
}

function generateImage() {
  if (!currentUser) { openAuthModal("image"); return; }
  _generateImage();
}
async function _generateImage() {
  const key = getActiveApiKey();
  if (!key) return showToast("Service unavailable.", "error");
  if (!checkQuota()) return;
  const prompt = document.getElementById("imgPrompt").value.trim();
  if (!prompt) return showToast("Please enter a prompt", "error");
  const style  = getActiveChip("imgStyleGroup");
  const ratio  = getActiveChip("imgRatioGroup");
  const qty       = parseInt(getActiveChip("imgQtyGroup")) || 1;
  const refBase64 = _refImgBase64 || null;
  const refMime   = _refImgMime   || null;

  // Inject ratio hint into prompt so AI generates composition matching the ratio
  const RATIO_HINTS = {
    "1:1":  "square composition, centered subject, 1:1 aspect ratio",
    "9:16": "portrait orientation, vertical composition, tall frame, 9:16 aspect ratio, subject centered vertically",
    "16:9": "landscape orientation, wide horizontal composition, 16:9 aspect ratio, subject centered"
  };
  const ratioHint  = RATIO_HINTS[ratio] || "";
  const styleHint  = style && style.toLowerCase() !== "none" ? `, ${style} style` : "";
  const fullPrompt = `${prompt}${styleHint}, ${ratioHint}`;

  const btn       = document.getElementById("imgGenBtn");
  const resultsEl = document.getElementById("imgResults");
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
  resultsEl.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><div class="loading-label">Generating ${qty} image${qty > 1 ? "s" : ""} with AI...</div></div>`;

  async function fetchOne() {
    const r = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: fullPrompt, aspectRatio: ratio, style,
        ...(refBase64 ? { referenceImageBase64: refBase64, referenceImageMime: refMime } : {})
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    if (!d.data) throw new Error("No image returned. Try a more descriptive prompt.");
    return { data: d.data, mimeType: d.mimeType || "image/png" };
  }

  try {
    resultsEl.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><div class="loading-label">Generating ${qty} image${qty > 1 ? "s" : ""}images... (up to 3 retries)</div></div>`;
    const results = await Promise.allSettled(Array.from({ length: qty }, () => fetchOne()));
    const imgs    = results.filter(r => r.status === "fulfilled").map(r => r.value);
    const errors  = results.filter(r => r.status === "rejected").map(r => r.reason?.message);
    if (errors.length) console.warn("[image] Some requests failed:", errors);
    if (!imgs.length) throw new Error(errors[0] || "No images generated. Try a different prompt.");

    // Decode blobs
    const blobs = imgs.map(d => {
      const bytes = atob(d.data); const arr = new Uint8Array(bytes.length);
      for (let j = 0; j < bytes.length; j++) arr[j] = bytes.charCodeAt(j);
      return { blobUrl: URL.createObjectURL(new Blob([arr], { type: d.mimeType || "image/png" })), mime: d.mimeType || "image/png" };
    });

    // Render all blobs onto canvas with the correct aspect ratio (cover-fill)
    // renderedUrls is used for BOTH display and download
    const renderedUrls = await Promise.all(blobs.map(b => renderCoverCanvas(b.blobUrl, ratio)));

    const card = document.createElement("div"); card.className = "img-result-card";
    const grid = document.createElement("div"); grid.className = `img-grid qty-${renderedUrls.length}`;

    renderedUrls.forEach((url, i) => {
      const img = document.createElement("img");
      img.src = url;
      img.alt = `Generated image ${i + 1}`;
      img.style.cssText = "width:100%;height:auto;display:block;border-radius:10px;cursor:pointer;";
      img.onclick = () => openFullscreen(url, ratio);
      grid.appendChild(img);
    });
    card.appendChild(grid);

    const dlWrap = document.createElement("div");
    dlWrap.style.cssText = "padding:12px;display:flex;flex-direction:column;gap:8px;";
    renderedUrls.forEach((url, i) => {
      const a = document.createElement("a"); a.className = "btn-download";
      a.href = url; a.download = `jeethy-image-${Date.now()}-${i + 1}.jpg`;
      a.innerHTML = `<i class="fas fa-download"></i> Download Image${renderedUrls.length > 1 ? " " + (i + 1) : ""}`;
      dlWrap.appendChild(a);
    });
    card.appendChild(dlWrap);
    resultsEl.innerHTML = ""; resultsEl.appendChild(card);
    document.querySelector(".panel-image .panel-inner-scroll")?.scrollTo({ top: 99999, behavior: "smooth" });
    incrementRequest();
  } catch (err) {
    const isOverload = /overload|high demand|quota|rate.?limit/i.test(err.message || "");
    resultsEl.innerHTML = `
      <div class="error-card">
        <i class="fas fa-circle-exclamation"></i>
        ${escapeHtml(err.message)}
        ${isOverload ? "<br/><small style='opacity:.7'>AI is busy — please wait</small>" : ""}
        <br/><button onclick="_generateImage()" style="margin-top:10px;padding:6px 16px;border-radius:20px;border:none;background:var(--accent,#7c3aed);color:#fff;font-size:12px;cursor:pointer;font-weight:600;">
          <i class="fas fa-rotate-right"></i> Try Again
        </button>
      </div>`;
  }
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Image';
}

// Render image onto canvas using cover-fill (zoom to fill ratio exactly).
// Robust: toBlob + toDataURL fallback + try/catch for Android Chrome compatibility.
function renderCoverCanvas(blobUrl, ratioStr) {
  return new Promise((resolve) => {
    const RATIO_MAP = { "1:1": 1, "9:16": 9 / 16, "16:9": 16 / 9 };
    const targetRatio = RATIO_MAP[ratioStr];
    if (!targetRatio) { resolve(blobUrl); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const srcW = img.naturalWidth  || 512;
      const srcH = img.naturalHeight || 512;
      let cW, cH;
      if (targetRatio >= 1) {
        cW = Math.max(srcW, srcH);
        cH = Math.round(cW / targetRatio);
      } else {
        cH = Math.max(srcW, srcH);
        cW = Math.round(cH * targetRatio);
      }
      const scale = Math.max(cW / srcW, cH / srcH);
      const dW = Math.round(srcW * scale);
      const dH = Math.round(srcH * scale);
      const dx = Math.round((cW - dW) / 2);
      const dy = Math.round((cH - dH) / 2);
      try {
        const canvas = document.createElement("canvas");
        canvas.width  = cW;
        canvas.height = cH;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(blobUrl); return; }
        ctx.drawImage(img, dx, dy, dW, dH);
        if (typeof canvas.toBlob === "function") {
          canvas.toBlob(blob => {
            resolve((blob && blob.size > 0) ? URL.createObjectURL(blob) : canvas.toDataURL("image/jpeg", 0.95));
          }, "image/jpeg", 0.95);
        } else {
          resolve(canvas.toDataURL("image/jpeg", 0.95));
        }
      } catch (e) {
        console.error("[renderCoverCanvas]", e);
        resolve(blobUrl);
      }
    };
    img.onerror = () => resolve(blobUrl);
    img.src = blobUrl;
  });
}


function openFullscreen(src, ratio) {
  const RATIO_CSS_MAP = { "1:1":"1/1", "9:16":"9/16", "16:9":"16/9" };
  const ratioCss = RATIO_CSS_MAP[ratio] || null;

  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.96);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out;";

  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative;display:flex;align-items:center;justify-content:center;max-width:100%;max-height:100%;";

  const img = document.createElement("img");
  img.src = src;
  // Apply correct aspect-ratio so fullscreen matches original generation
  if (ratioCss) {
    img.style.cssText = `aspect-ratio:${ratioCss};object-fit:contain;border-radius:14px;max-height:90vh;max-width:92vw;display:block;box-shadow:0 8px 48px rgba(0,0,0,.6);`;
  } else {
    img.style.cssText = "max-width:92vw;max-height:90vh;border-radius:14px;object-fit:contain;display:block;box-shadow:0 8px 48px rgba(0,0,0,.6);";
  }

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
  closeBtn.style.cssText = "position:fixed;top:16px;right:16px;background:rgba(255,255,255,.12);border:none;color:#fff;width:38px;height:38px;border-radius:50%;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);z-index:100000;transition:.2s;";
  closeBtn.onmouseenter = () => closeBtn.style.background = "rgba(255,255,255,.22)";
  closeBtn.onmouseleave = () => closeBtn.style.background = "rgba(255,255,255,.12)";
  closeBtn.onclick = (e) => { e.stopPropagation(); ov.remove(); };

  // Ratio badge
  if (ratio) {
    const badge = document.createElement("div");
    badge.textContent = ratio;
    badge.style.cssText = "position:fixed;top:16px;left:16px;background:rgba(124,58,237,.75);color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;backdrop-filter:blur(8px);z-index:100000;letter-spacing:.4px;";
    ov.appendChild(badge);
  }

  wrap.appendChild(img);
  ov.appendChild(closeBtn);
  ov.appendChild(wrap);
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };

  // Close on Escape key
  const onKey = (e) => { if (e.key === "Escape") { ov.remove(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);

  document.body.appendChild(ov);
}

// =================== SONG GENERATE ===================
// ════ Song Plan Badge ════
function initSongPlanBadge() {
  const badge = document.getElementById("song-plan-badge");
  const hint  = document.getElementById("song-duration-hint");
  if (badge) {
    const labels = { free:"FREE", pro:"PRO", max:"MAX" };
    const colors = { free:"#9ca3af", pro:"#7c3aed", max:"#f59e0b" };
    badge.textContent = labels[userPlan] || "FREE";
    badge.style.color = colors[userPlan] || "#9ca3af";
    badge.style.borderColor = (colors[userPlan] || "#9ca3af") + "55";
    badge.style.display = "inline-block";
  }
  if (hint) {
    const hints = { free:"~30s", pro:"~45s", max:"~60s" };
    hint.textContent = hints[userPlan] || "~30s";
  }
}

// ════ Custom Genre Chip (pops up instrument/tempo/mood panel) ════
function selectChipCustom(btn) {
  const group = document.getElementById('songStyleGroup');
  const panel = document.getElementById('custom-style-panel');
  if (!group || !panel) return;

  const wasActive = btn.classList.contains('active');

  // Deactivate all chips in genre group
  group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));

  if (!wasActive) {
    // Activate Custom chip + show panel
    btn.classList.add('active');
    panel.style.removeProperty('transition');
    panel.style.removeProperty('opacity');
    panel.style.removeProperty('transform');
    panel.style.display = 'block';
  } else {
    // Deactivate → hide panel + re-activate Pop
    panel.style.display = 'none';
    const firstChip = group.querySelector('.chip:not(.chip-custom)');
    if (firstChip) firstChip.classList.add('active');
  }
}

function generateSong() {
  if (!currentUser) { openAuthModal("song"); return; }
  _generateSong();
}
async function _generateSong() {
  if (!checkQuota()) return;
  const prompt = document.getElementById("songPrompt").value.trim();
  if (!prompt) return showToast("Please enter a song description", "error");
  const rawStyle    = getActiveChip("songStyleGroup");
  const isCustom    = rawStyle.trim().toLowerCase() === "custom";
  // Khmer rhythm: if a Khmer style key is selected, build descriptive prompt
  const _khmerRhythmPrompt = (typeof buildKhmerRhythmPrompt === 'function') ? buildKhmerRhythmPrompt(rawStyle) : null;

  // When NOT Custom, reset instrument/tempo/mood to Auto so they don't bleed into the style
  if (!isCustom) {
    document.querySelectorAll("[data-multi='instrument']").forEach(c => c.classList.remove("active"));
    const _ai = document.querySelector("[data-multi='instrument']");
    if (_ai) _ai.classList.add("active");
    ["songTempoGroup","songMoodGroup"].forEach(gid => {
      const g = document.getElementById(gid);
      if (!g) return;
      g.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      const autoChip = g.querySelector(".chip");
      if (autoChip) autoChip.classList.add("active");
    });
  }

  const instrumentArr = isCustom ? getMultiChips("instrument") : ["Auto"];
  const instrument = instrumentArr.join(", ");
  const tempo       = isCustom ? (getActiveChip("songTempoGroup")      || "Auto") : "Auto";
  const mood        = isCustom ? (getActiveChip("songMoodGroup")       || "Auto") : "Auto";

  // Build style: if Custom → combine instrument+tempo+mood; else → use genre chip value
  const style = isCustom
    ? [
        (instrumentArr.length === 1 && instrumentArr[0] === 'Auto') ? '' : instrumentArr.join(' + ') + ' instrument',
        tempo      !== "Auto" ? tempo + " tempo"      : "",
        mood       !== "Auto" ? mood + " mood"        : "",
      ].filter(Boolean).join(", ") || "Pop"
    : (_khmerRhythmPrompt || rawStyle);
  const voice      = getActiveChip("songVoiceGroup").replace(/[^\w\s]/g, "").trim();
  // instrument/tempo/mood read above with isCustom logic
  const customLyrics = null; // Custom lyrics removed — use prompt textarea
  const voiceHint = voice.toLowerCase().includes("female") ? "female vocalist" : "male vocalist";
  const btn       = document.getElementById("songGenBtn");
  const resultsEl = document.getElementById("songResults");
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Composing...';
  resultsEl.innerHTML = `<div class="loading-card green-loader"><div class="loading-spinner"></div><div class="loading-label" id="songLoadingLabel">Writing lyrics &amp; generating music with Lyria... (~20-40s)</div></div>`;

  const retryHintTimer = setTimeout(() => {
    const lbl = document.getElementById("songLoadingLabel");
    if (lbl) lbl.textContent = "Lyria is composing..., if slow, falling back to TTS, please wait";
  }, 20000);

  try {
    const res = await fetch("/api/song", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt, style, voice,
        ...(instrument !== "Auto" ? { instrument } : {}),
        ...(tempo      !== "Auto" ? { tempo }      : {}),
        ...(mood       !== "Auto" ? { mood }        : {}),
        ...(customLyrics          ? { customLyrics } : {})
      })
    });
    clearTimeout(retryHintTimer);
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }
    const data = await res.json();
    const { audio: audioB64, mimeType: audioMime, title: songTitle, lyrics: lyricsText, ttsMessage, audioSource } = data;

    const card = document.createElement("div"); card.className = "song-result-card";

    const header = document.createElement("div"); header.className = "song-result-title";
    const isLyria = audioSource && audioSource.toLowerCase().includes("lyria");
    const sourceBadge = audioSource
      ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;margin-left:6px;background:${isLyria ? "rgba(168,85,247,.18)" : "rgba(16,185,129,.15)"};color:${isLyria ? "#a855f7" : "#10b981"};border:1px solid ${isLyria ? "rgba(168,85,247,.3)" : "rgba(16,185,129,.3)"};">${isLyria ? "🎵 Lyria" : "🔊 TTS"}</span>`
      : "";
    header.innerHTML = `<i class="fas fa-music"></i> ${escapeHtml(songTitle || style + " Song")}${sourceBadge}<span style="font-size:11px;color:var(--text2);font-weight:400;margin-left:auto">${escapeHtml(style)} . ${escapeHtml(voiceHint)}</span>`;
    card.appendChild(header);

    if (audioB64) {
      const raw = atob(audioB64); const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const audioBlob    = new Blob([bytes], { type: audioMime || "audio/wav" });
      const audioBlobUrl = URL.createObjectURL(audioBlob);
      const audioEl = document.createElement("audio");
      audioEl.controls = true; audioEl.preload = "auto";
      audioEl.style.cssText = "width:100%;padding:10px 14px 0;accent-color:var(--green);";
      audioEl.src = audioBlobUrl;
      card.appendChild(audioEl);
      const a = document.createElement("a"); a.className = "btn-download";
      const ext = (audioMime || "audio/wav").split("/")[1] || "wav";
      a.href = audioBlobUrl; a.download = `jeethy-song-${Date.now()}.${ext}`;
      a.innerHTML = '<i class="fas fa-download"></i> Download Audio';
      card.appendChild(a);
    } else {
      const notice = document.createElement("div");
      notice.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:10px 14px;font-size:12px;color:var(--text2);background:rgba(74,222,128,.06);border-bottom:1px solid var(--border);";
      const msg = ttsMessage || "Audio generation is temporarily unavailable, your lyrics are ready below. Try again in a few minutes.";
      notice.innerHTML = `<div style="display:flex;align-items:flex-start;gap:8px;"><i class="fas fa-circle-info" style="color:var(--green);flex-shrink:0;margin-top:2px"></i><span>${escapeHtml(msg)}</span></div>
        <button onclick="_generateSong()" style="align-self:flex-start;padding:5px 14px;border-radius:20px;border:none;background:var(--green,#10b981);color:#fff;font-size:11px;cursor:pointer;font-weight:600;">
          <i class="fas fa-rotate-right"></i> Retry Audio
        </button>`;
      card.appendChild(notice);
    }

    if (lyricsText) {
      const lyricsWrap = document.createElement("div");
      lyricsWrap.style.cssText = "background:var(--surface2);border-top:1px solid var(--border);padding:14px;font-size:13px;color:var(--text2);white-space:pre-wrap;line-height:1.75;max-height:320px;overflow-y:auto;";
      lyricsWrap.textContent = lyricsText;
      card.appendChild(lyricsWrap);
    }

    resultsEl.innerHTML = ""; resultsEl.appendChild(card);
    document.querySelector(".panel-song .panel-inner-scroll")?.scrollTo({ top: 99999, behavior: "smooth" });
    incrementRequest();
  } catch (err) {
    clearTimeout(retryHintTimer);
    const isOverload = /overload|high demand|quota|rate.?limit/i.test(err.message || "");
    resultsEl.innerHTML = `
      <div class="error-card">
        <i class="fas fa-circle-exclamation"></i>
        ${escapeHtml(err.message)}
        ${isOverload ? "<br/><small style='opacity:.7'>The TTS model is experiencing high demand. Please try again.</small>" : ""}
        <br/><button onclick="_generateSong()" style="margin-top:10px;padding:6px 16px;border-radius:20px;border:none;background:var(--green,#10b981);color:#fff;font-size:12px;cursor:pointer;font-weight:600;">
          <i class="fas fa-rotate-right"></i> Try Again
        </button>
      </div>`;
  }
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Song';
}

// ===================== UTILITIES =====================
function getActiveChip(groupId) {
  const el = document.querySelector(`#${groupId} .chip.active`);
  if (!el) return "";
  // If "Other" genre chip is active, return the stored _otherStyleValue
  if (el.id === 'chipOtherStyle') {
    return (typeof _otherStyleValue !== 'undefined' && _otherStyleValue) ? _otherStyleValue : 'Pop';
  }
  return el.textContent.trim();
}
// ════ Multi-select Chip (for Instrument) ════
const INSTRUMENT_MAX = 3; // max selectable instruments (excluding Auto)

function toggleMultiChip(el, groupId) {
  const isAuto = el.textContent.trim().startsWith("Auto");
  const allMulti = document.querySelectorAll(`[data-multi="${el.dataset.multi}"]`);

  if (isAuto) {
    // Auto → clear all, activate only Auto
    allMulti.forEach(c => c.classList.remove("active"));
    el.classList.add("active");
    return;
  }

  // Deactivate Auto
  allMulti.forEach(c => { if (c.textContent.trim().startsWith("Auto")) c.classList.remove("active"); });

  const currentActive = Array.from(allMulti).filter(c =>
    c.classList.contains("active") && !c.textContent.trim().startsWith("Auto")
  );

  if (el.classList.contains("active")) {
    // Deselect this chip
    el.classList.remove("active");
    const stillActive = Array.from(allMulti).filter(c =>
      c.classList.contains("active") && !c.textContent.trim().startsWith("Auto")
    );
    // If nothing left → fall back to Auto
    if (!stillActive.length) {
      allMulti.forEach(c => { if (c.textContent.trim().startsWith("Auto")) c.classList.add("active"); });
    }
  } else {
    // Select — enforce max limit
    if (currentActive.length >= INSTRUMENT_MAX) {
      // Show shake + toast warning
      el.style.animation = "none";
      el.offsetHeight; // reflow
      el.style.animation = "chipShake .35s ease";
      showToast(`Max ${INSTRUMENT_MAX} instruments allowed`, "error");
      return;
    }
    el.classList.add("active");
  }
}

// Helper: get all selected multi chips for a data-multi key (returns array of labels)
function getMultiChips(multiKey) {
  const chips = document.querySelectorAll(`[data-multi="${multiKey}"].active`);
  const vals = Array.from(chips).map(c => c.textContent.trim()).filter(v => v !== "Auto");
  return vals.length ? vals : ["Auto"];
}

function selectChip(el, groupId) {
  document.querySelectorAll(`#${groupId} .chip`).forEach(c => c.classList.remove("active"));
  el.classList.add("active");
  // If selecting a non-custom genre chip → hide panel + reset instrument/tempo/mood to Auto
  if (groupId === 'songStyleGroup' && !el.classList.contains('chip-custom') && !el.classList.contains('chip-other')) {
    const panel = document.getElementById('custom-style-panel');
    if (panel) panel.style.display = 'none';
    // Reset custom sub-chips to Auto immediately (incl. multi-select instrument chips)
    document.querySelectorAll("[data-multi='instrument']").forEach(c => c.classList.remove("active"));
    const autoInstr = document.querySelector("[data-multi='instrument']");
    if (autoInstr) autoInstr.classList.add("active");
    ["songTempoGroup","songMoodGroup"].forEach(gid => {
      const g = document.getElementById(gid);
      if (!g) return;
      g.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      const autoChip = g.querySelector(".chip");
      if (autoChip) autoChip.classList.add("active");
    });
  }
}
function formatTime(d) { return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function escapeHtml(t = "") {
  return String(t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function showToast(msg, type = "info") {
  const t = document.createElement("div");
  t.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:${type === "error" ? "#ef4444" : "#10b981"};color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:99999;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis;animation:msgIn 0.3s ease;`;
  t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}


// ════ Khmer Music Rhythm Dataset v1 — JeeThy Labs ════
const KHMER_RHYTHM_DB = {
  romvong:     {label:'រាំវង់ (Romvong)',      bpm:[90,110],  desc:'Romvong traditional Cambodian circular dance music, steady 4/4 groove at 90-110 BPM, smooth flowing feel, suitable for slow circular partner dancing'},
  romkbach:    {label:'រាំក្បាច់ (Romkbach)',  bpm:[80,100],  desc:'Romkbach Cambodian smooth elegant dance style at 80-100 BPM, sparse kick pattern, relaxed snare, graceful flowing movement'},
  saravan:     {label:'សារ៉ាវ៉ាន់ (Saravan)',  bpm:[95,115],  desc:'Saravan Cambodian folk dance at 95-115 BPM, syncopated kick pattern, bouncy energetic groove stronger than Romvong, lively Khmer folk feel'},
  kantreum:    {label:'កន្ទ្រឹម (Kantreum)',   bpm:[110,130], desc:'Kantreum fast traditional Cambodian dance at 110-130 BPM, 16-step syncopated kick and snare, full 16th-note hi-hat grid, energetic bounce for fast leg dancing'},
  madison:     {label:'ម៉ាឌីសុន (Madison)',    bpm:[100,120], desc:'Madison Cambodian-adapted structured dance at 100-120 BPM, clean kick pattern, syncopated hi-hat, blends well with modern EDM and Pop production'},
  cha_cha_cha: {label:'ឆា ឆា ឆា (Cha Cha)',  bpm:[110,130], desc:'Cha Cha Cha latin-influenced Cambodian dance at 110-130 BPM, syncopated kick with latin clave rhythmic pattern, lively and playful'},
  taloong:     {label:'តាឡូង (Taloong)',       bpm:[120,140], desc:'Taloong fast driving Cambodian rhythm at 120-140 BPM, kick on every 2 steps creating urgency, high energy traditional Khmer dance'},
  slow:        {label:'ចង្វាក់យឺត (Slow)',     bpm:[60,80],   desc:'Khmer Slow Ballad at 60-80 BPM, minimal kick on beat 1, classic snare on 2 and 4, sparse hi-hat, deeply emotional and romantic Cambodian feel'},
};

// Stored value for "Other" chip selection
let _otherStyleValue = null;

function openOtherStyleModal() {
  const bd = document.getElementById('otherStyleBackdrop');
  const md = document.getElementById('otherStyleModal');
  if (bd) bd.style.display = 'block';
  if (md) md.style.display = 'block';
  document.body.style.overflow = 'hidden';
}
function closeOtherStyleModal() {
  const bd = document.getElementById('otherStyleBackdrop');
  const md = document.getElementById('otherStyleModal');
  if (bd) bd.style.display = 'none';
  if (md) md.style.display = 'none';
  document.body.style.overflow = '';
}
function selectOtherStyle(el, value) {
  // Deactivate all main genre chips
  document.querySelectorAll('#songStyleGroup .chip').forEach(c => c.classList.remove('active'));
  // Deactivate all other-style chips in modal
  document.querySelectorAll('.other-style-chip').forEach(c => c.classList.remove('active'));
  // Activate selected chip
  el.classList.add('active');
  // Activate the Other button
  const otherBtn = document.getElementById('chipOtherStyle');
  if (otherBtn) otherBtn.classList.add('active');
  // Store value
  _otherStyleValue = value;
  // Update Other button label
  const label = el.textContent.trim();
  const short = label.length > 12 ? label.substring(0, 11) + '…' : label;
  if (otherBtn) otherBtn.innerHTML = '<i class="fas fa-grid-2" style="font-size:11px"></i> ' + short;
  // Close modal
  closeOtherStyleModal();
  // Hide custom panel if open
  const panel = document.getElementById('custom-style-panel');
  if (panel) panel.style.display = 'none';
}
function buildKhmerRhythmPrompt(key) {
  const r = KHMER_RHYTHM_DB[key ? key.toLowerCase().replace(/[^a-z_]/g,'') : ''];
  if (!r) return null;
  const bpmMid = Math.round((r.bpm[0] + r.bpm[1]) / 2);
  return r.desc + '. Target tempo: ' + bpmMid + ' BPM (range ' + r.bpm[0] + '-' + r.bpm[1] + ' BPM). This is traditional Cambodian Khmer music — generate authentic Khmer rhythmic feel and sound.';
}
