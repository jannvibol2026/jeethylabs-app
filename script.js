"use strict";

// ── MODELS ─────────────────────────────────────────────────
const GEMINI_CHAT_MODEL  = "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation";
const LYRIA_MODEL        = "lyria-realtime-exp";

// ── PLAN LIMITS ────────────────────────────────────────────
const PLAN_LIMITS = {
  free: { requests: 10,  label: "Free", color: "#a78bfa" },
  pro:  { requests: 100, label: "Pro",  color: "#06b6d4" },
  max:  { requests: 500, label: "Max",  color: "#fbbf24" }
};

// ── STATE ──────────────────────────────────────────────────
let currentPanel  = 0;
let userPlan      = "free";
let proCustomKey  = "";
let useOwnKey     = false;
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

// ── INIT ───────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setWelcomeTime();
  initSwipe();
  renderPlanBadge();
  await fetchOwnerKey();
  await checkExistingSession();
});

async function fetchOwnerKey() {
  try {
    const r = await fetch("/api/key");
    if (r.ok) { const d = await r.json(); ownerApiKey = d.key || ""; }
  } catch (e) { ownerApiKey = ""; }
}

async function checkExistingSession() {
  try {
    const r = await fetch("/api/me", { credentials: "include" });
    if (r.ok) { const d = await r.json(); onLoginSuccess(d.user, false); }
  } catch (e) {}
}

function getActiveApiKey() {
  if (userPlan === "pro" && useOwnKey && proCustomKey) return proCustomKey;
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
  badge.textContent    = plan.label;
  badge.style.color    = plan.color;
  badge.style.borderColor = plan.color + "66";
}

// ══ PANEL NAV ══════════════════════════════════════════════
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

// ══ AUTH MODAL ═════════════════════════════════════════════
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

// ── SIGNUP ─────────────────────────────────────────────────
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
      showAuthMsg("Code ត្រូវបានផ្ញើ! សូមពិនិត្យ Email.", "success");
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
      showAuthMsg("Welcome, " + data.user.name + "! Account created!", "success");
      setTimeout(() => onLoginSuccess(data.user, true), 900);
    } else { showAuthMsg(data.error || "Invalid or expired code.", "error"); }
  } catch (ex) { showAuthMsg("Network error.", "error"); }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-check-circle"></i> Verify & Create Account';
}

async function resendOtp() {
  if (!_otpPending) return;
  clearAuthMsg();
  try {
    const res  = await fetch("/api/send-otp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify(_otpPending)
    });
    const data = await res.json();
    if (res.ok) { showAuthMsg("Code ថ្មីត្រូវបានផ្ញើ!", "success"); startResendTimer(60); }
    else showAuthMsg(data.error || "Failed to resend.", "error");
  } catch (ex) { showAuthMsg("Network error.", "error"); }
}

function backToSignup() {
  document.getElementById("authOtpForm").style.display   = "none";
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

// ── LOGIN ──────────────────────────────────────────────────
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
      showAuthMsg("Welcome back, " + data.user.name + "!", "success");
      setTimeout(() => onLoginSuccess(data.user, true), 800);
    } else { showAuthMsg(data.error || "Invalid email or password.", "error"); }
  } catch (ex) { showAuthMsg("Network error.", "error"); }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Login';
}

// ── onLoginSuccess ─────────────────────────────────────────
function onLoginSuccess(user, runPending) {
  currentUser = user;
  window.currentUser = user;
  if (user.plan && PLAN_LIMITS[user.plan]) {
    userPlan = user.plan;
    renderPlanBadge();
  }
  updateNavAvatar(user);
  closeAuthModal();
  if (runPending) {
    const action = pendingAction; pendingAction = null;
    if (action === "chat")  setTimeout(() => _sendChat(),      100);
    if (action === "image") setTimeout(() => _generateImage(), 100);
    if (action === "song")  setTimeout(() => _generateSong(),  100);
  }
}

// ── LOGOUT ─────────────────────────────────────────────────
async function doLogout() {
  currentUser = null; window.currentUser = null;
  const wrap = document.getElementById("userProfileWrap");
  if (wrap) wrap.style.display = "none";
  closeDd();
  try { await fetch("/api/logout", { method: "POST", credentials: "include" }); } catch (e) {}
  showToast("Signed out", "error");
}

// ── NAV AVATAR ─────────────────────────────────────────────
function updateNavAvatar(user) {
  const wrap    = document.getElementById("userProfileWrap");
  const navBtn  = document.getElementById("userAvatarBtn");
  const initial = (user.name || "U").charAt(0).toUpperCase();
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

// ── DROPDOWN ───────────────────────────────────────────────
function toggleDropdown(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const dd = document.getElementById("profileDropdown");
  if (dd) dd.classList.toggle("open");
}
function closeDd() {
  const dd = document.getElementById("profileDropdown");
  if (dd) dd.classList.remove("open");
}
document.addEventListener("click", e => {
  const wrap = document.getElementById("userProfileWrap");
  if (wrap && !wrap.contains(e.target)) closeDd();
}, true);

// ── PROFILE SHEET ──────────────────────────────────────────
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
      const r = await fetch("/api/upload-avatar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ avatar_url: url })
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

// ══ PLAN MODAL ═════════════════════════════════════════════
function openPlanModal() {
  const m = document.getElementById("planModal");
  if (!m) return;
  m.classList.add("open");
  document.querySelectorAll(".plan-card").forEach(c => c.classList.toggle("selected", c.dataset.plan === userPlan));
}
function closePlanModal() { const m = document.getElementById("planModal"); if (m) m.classList.remove("open"); }
function selectPlan(plan) {
  userPlan = plan;
  document.querySelectorAll(".plan-card").forEach(c => c.classList.toggle("selected", c.dataset.plan === plan));
  renderPlanBadge();
  const ps = document.getElementById("proSettingsInModal");
  if (ps) ps.style.display = plan === "pro" ? "block" : "none";
}
function confirmPlan() { closePlanModal(); showToast(PLAN_LIMITS[userPlan].label + " plan activated!", "success"); }

// ══ SETTINGS ═══════════════════════════════════════════════
function openSettings() {
  if (userPlan !== "pro") { showToast("Settings available on Pro plan", "error"); openPlanModal(); return; }
  const m = document.getElementById("settingsModal"); if (!m) return;
  m.classList.add("open");
  document.getElementById("customKeyInput").value   = proCustomKey;
  document.getElementById("useOwnKeyToggle").checked = useOwnKey;
  updateSettingsUI();
}
function closeSettings() { const m = document.getElementById("settingsModal"); if (m) m.classList.remove("open"); }
function updateSettingsUI() {
  const t = document.getElementById("useOwnKeyToggle");
  const s = document.getElementById("customKeySection");
  if (t && s) s.style.display = t.checked ? "block" : "none";
}
function saveSettings() {
  const t = document.getElementById("useOwnKeyToggle");
  const k = document.getElementById("customKeyInput").value.trim();
  if (!t) return;
  useOwnKey = t.checked;
  if (useOwnKey) {
    if (!k) return showToast("Enter your API key first", "error");
    proCustomKey = k; showToast("Using your own API key", "success");
  } else { proCustomKey = k; showToast("Using JeeThy Labs owner key", "success"); }
  closeSettings();
}

// ══ UPGRADE MODAL ══════════════════════════════════════════
function showUpgradeModal()  { const m = document.getElementById("upgradeModal"); if (m) m.classList.add("open"); }
function closeUpgradeModal() { const m = document.getElementById("upgradeModal"); if (m) m.classList.remove("open"); }
function upgradeNow()        { closeUpgradeModal(); if (userPlan === "free") openPlanModal(); }
function requirePro(btn, groupId) {
  if (userPlan === "pro") selectChip(btn, groupId);
  else { showUpgradeModal(); showToast("HD is available on Pro plan only", "error"); }
}

// ══ CHAT ═══════════════════════════════════════════════════
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
    appendMessage("bot", "⚠️ " + err.message);
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
  const avatar = document.createElement("div"); avatar.className = "msg-avatar"; avatar.innerHTML = '<i class="fas fa-brain"></i>';
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

// ══ IMAGE GENERATE ═════════════════════════════════════════
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
  const qty    = parseInt(getActiveChip("imgQtyGroup")) || 1;
  const aspectRatio = ({ "1:1": "1:1", "9:16": "9:16", "16:9": "16:9" })[ratio] || "1:1";
  const fullPrompt  = `${prompt}, style: ${style}`;
  const btn       = document.getElementById("imgGenBtn");
  const resultsEl = document.getElementById("imgResults");
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
  resultsEl.innerHTML = `<div class="loading-card"><div class="loading-spinner"></div><div class="loading-label">Generating ${qty} image${qty > 1 ? "s" : ""} with AI...</div></div>`;

  async function fetchOne(p, k) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${k}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: p }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageGenerationConfig: { aspectRatio } } }) }
    );
    if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || `HTTP ${r.status}`); }
    const d = await r.json();
    for (const c of (d.candidates || []))
      for (const pt of (c.content?.parts || []))
        if (pt.inlineData?.data) return pt.inlineData;
    throw new Error("No image in response");
  }

  try {
    const results = await Promise.allSettled(Array.from({ length: qty }, () => fetchOne(fullPrompt, key)));
    const imgs    = results.filter(r => r.status === "fulfilled").map(r => r.value);
    if (!imgs.length) throw new Error("No images generated. Try a different prompt.");
    const card = document.createElement("div"); card.className = "img-result-card";
    const grid = document.createElement("div"); grid.className = `img-grid qty-${imgs.length}`;
    const blobs = [];
    imgs.forEach((d, i) => {
      const bytes = atob(d.data); const arr = new Uint8Array(bytes.length);
      for (let j = 0; j < bytes.length; j++) arr[j] = bytes.charCodeAt(j);
      const blob    = new Blob([arr], { type: d.mimeType || "image/png" });
      const blobUrl = URL.createObjectURL(blob);
      blobs.push({ blobUrl, mime: d.mimeType || "image/png" });
      const img = document.createElement("img"); img.src = blobUrl; img.alt = `Generated ${i + 1}`;
      img.onclick = () => openFullscreen(blobUrl);
      grid.appendChild(img);
    });
    card.appendChild(grid);
    const dlWrap = document.createElement("div");
    dlWrap.style.cssText = "padding:12px;display:flex;flex-direction:column;gap:8px;";
    blobs.forEach(({ blobUrl, mime }, i) => {
      const ext = mime.split("/")[1] || "png";
      const a   = document.createElement("a"); a.className = "btn-download";
      a.href = blobUrl; a.download = `jeethy-image-${Date.now()}-${i + 1}.${ext}`;
      a.innerHTML = `<i class="fas fa-download"></i> Download Image${blobs.length > 1 ? " " + (i + 1) : ""}`;
      dlWrap.appendChild(a);
    });
    card.appendChild(dlWrap);
    resultsEl.innerHTML = ""; resultsEl.appendChild(card);
    document.querySelector(".panel-image .panel-inner-scroll")?.scrollTo({ top: 99999, behavior: "smooth" });
    incrementRequest();
  } catch (err) {
    resultsEl.innerHTML = `<div class="error-card"><i class="fas fa-circle-exclamation"></i> ${escapeHtml(err.message)}</div>`;
  }
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Image';
}

function openFullscreen(src) {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;cursor:pointer;";
  const img = document.createElement("img"); img.src = src;
  img.style.cssText = "max-width:100%;max-height:100%;border-radius:12px;object-fit:contain;";
  ov.appendChild(img); ov.onclick = () => ov.remove(); document.body.appendChild(ov);
}

// ══ SONG GENERATE ══════════════════════════════════════════
function generateSong() {
  if (!currentUser) { openAuthModal("song"); return; }
  _generateSong();
}
async function _generateSong() {
  const key = getActiveApiKey();
  if (!key) return showToast("Service unavailable.", "error");
  if (!checkQuota()) return;
  const prompt = document.getElementById("songPrompt").value.trim();
  if (!prompt) return showToast("Please enter a song description", "error");
  const style     = getActiveChip("songStyleGroup");
  const voice     = getActiveChip("songVoiceGroup").replace(/[^\w\s]/g, "").trim();
  const isKhmer   = /[\u1780-\u17FF]/.test(prompt);
  const btn       = document.getElementById("songGenBtn");
  const resultsEl = document.getElementById("songResults");
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Composing...';
  resultsEl.innerHTML = `<div class="loading-card green-loader"><div class="loading-spinner"></div><div class="loading-label">Generating song with Lyria 3... (~20s)</div></div>`;
  try {
    const voiceHint   = voice.toLowerCase().includes("female") ? "female vocalist" : "male vocalist";
    const langHint    = isKhmer ? "Lyrics must be in Khmer language." : "";
    const lyriaPrompt = `Create a full ${style} song about: ${prompt}. ${voiceHint}, ${style} genre, full instrumental, verses, chorus and bridge. ${langHint}`.trim();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${LYRIA_MODEL}:generateContent?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: lyriaPrompt }] }] }) }
    );
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || `HTTP ${res.status}`); }
    const data = await res.json();
    let audioB64 = null, audioMime = "audio/mp3", lyricsText = "", songTitle = `${style} Song`;
    for (const c of (data.candidates || []))
      for (const p of (c.content?.parts || [])) {
        if (p.inlineData?.data && !audioB64) { audioB64 = p.inlineData.data; audioMime = p.inlineData.mimeType || "audio/mp3"; }
        if (p.text) lyricsText += p.text;
      }
    if (!audioB64) throw new Error("No audio generated. Please try again.");
    const raw = atob(audioB64); const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const audioBlob    = new Blob([bytes], { type: audioMime });
    const audioBlobUrl = URL.createObjectURL(audioBlob);
    const m = lyricsText.match(/(?:title|song name)[:\s]+([^\n]+)/i);
    if (m) songTitle = m[1].trim();
    const card = document.createElement("div"); card.className = "song-result-card";
    card.innerHTML = `
      <div class="song-result-title">
        <i class="fas fa-music"></i> ${escapeHtml(songTitle)}
        <span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:auto">${escapeHtml(style)} · ${escapeHtml(voiceHint)}</span>
      </div>
      <audio controls preload="auto" style="width:100%;margin-bottom:10px"></audio>
      ${lyricsText ? `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:12px;color:var(--muted);max-height:140px;overflow-y:auto;white-space:pre-wrap;line-height:1.6;margin:0 14px 10px">${escapeHtml(lyricsText)}</div>` : ""}`;
    card.querySelector("audio").src = audioBlobUrl;
    const a = document.createElement("a"); a.className = "btn-download";
    a.href = audioBlobUrl; a.download = `jeethy-song-${Date.now()}.mp3`;
    a.innerHTML = '<i class="fas fa-download"></i> Download Song';
    card.appendChild(a);
    resultsEl.innerHTML = ""; resultsEl.appendChild(card);
    document.querySelector(".panel-song .panel-inner-scroll")?.scrollTo({ top: 99999, behavior: "smooth" });
    incrementRequest();
  } catch (err) {
    resultsEl.innerHTML = `<div class="error-card"><i class="fas fa-circle-exclamation"></i> ${escapeHtml(err.message)}</div>`;
  }
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Song';
}

// ══ UTILITIES ══════════════════════════════════════════════
function getActiveChip(groupId) {
  const el = document.querySelector(`#${groupId} .chip.active`);
  return el ? el.textContent.trim() : "";
}
function selectChip(el, groupId) {
  document.querySelectorAll(`#${groupId} .chip`).forEach(c => c.classList.remove("active"));
  el.classList.add("active");
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
