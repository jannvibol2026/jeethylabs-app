"use strict";

const VIDEO_PLAN_LIMITS = { free: 1, pro: 3, proplus: 10, max: Infinity };
const TOTAL_PANELS = 4;
let videoDuration = "5s";
let videoRefs = { start: null, end: null };

// ======================= MODELS =======================
let GEMINI_CHAT_MODEL    = "gemini-2.5-flash";
let GEMINI_IMAGE_MODELS  = [];
let GEMINI_TTS_MODELS    = [];

// ==================== PLAN LIMITS ====================
const PLAN_LIMITS = {
  free: {
    requests: 20, label: "Free", color: "#9ca3af", price: "$0",
    chatMsg: 20, imgDay: 5, songDay: 3,
    chatModel: "gemini-2.5-flash",
    contextMemory: "session", fileUpload: false, chatHistory: 0,
    exportChat: false, customSystemPrompt: false, forceKhmer: false,
    imgResolution: "720x720", aspectRatios: ["1:1"], stylePresets: 3,
    refImages: 0, batchGenerate: 1, downloadHD: false,
    imgHistory: 0, imgWatermark: true,
    songDuration: 55, customLyrics: false, vocalStyles: ["female","male"],
    allGenres: false, moodControl: false, instrumental: false, khmerStyle: false,
    downloadMP3: true, songHistory: 0, regenerate: false,
    audioQuality: "standard", audioWatermark: true
  },
  pro: {
    requests: 100, label: "Pro", color: "#06b6d4", price: "$5.99/mo",
    chatMsg: 100, imgDay: 25, songDay: 15,
    chatModel: "gemini-2.5-flash",
    contextMemory: "session", fileUpload: "images", chatHistory: 10,
    exportChat: false, customSystemPrompt: false, forceKhmer: false,
    imgResolution: "1024x1024", aspectRatios: ["1:1","9:16","16:9"], stylePresets: 10,
    refImages: 1, batchGenerate: 2, downloadHD: true,
    imgHistory: 10, imgWatermark: false,
    songDuration: 185, customLyrics: true, vocalStyles: ["female","male"],
    allGenres: false, moodControl: true, instrumental: true, khmerStyle: true,
    downloadMP3: true, songHistory: 5, regenerate: true,
    audioQuality: "high", audioWatermark: false
  },
  proplus: {
    requests: 999, label: "Pro+", color: "#a855f7", price: "$24.99/mo",
    chatMsg: -1, imgDay: 150, songDay: 100,
    chatModel: "gemini-2.5-pro",
    contextMemory: "persistent", fileUpload: "images+docs", chatHistory: -1,
    exportChat: true, customSystemPrompt: true, forceKhmer: true,
    imgResolution: "2048x2048", aspectRatios: ["1:1","9:16","16:9","all"], stylePresets: -1,
    refImages: -1, batchGenerate: 4, downloadHD: true,
    imgHistory: 50, imgWatermark: false,
    songDuration: 200, customLyrics: true, vocalStyles: ["female","male","duet","choir"],
    allGenres: true, moodControl: true, instrumental: true, khmerStyle: "premium",
    downloadMP3: true, songHistory: 30, regenerate: true,
    audioQuality: "best", audioWatermark: false
  },
  max: {
    requests: 9999, label: "Max", color: "#fbbf24", price: "TBA",
    chatMsg: -1, imgDay: -1, songDay: -1,
    chatModel: "gemini-2.5-pro",
    contextMemory: "persistent", fileUpload: "images+docs", chatHistory: -1,
    exportChat: true, customSystemPrompt: true, forceKhmer: true,
    imgResolution: "3840x2160", aspectRatios: ["1:1","9:16","16:9","all"], stylePresets: -1,
    refImages: -1, batchGenerate: 4, downloadHD: true,
    imgHistory: -1, imgWatermark: false,
    songDuration: 300, customLyrics: true, vocalStyles: ["female","male","duet","choir"],
    allGenres: true, moodControl: true, instrumental: true, khmerStyle: "premium",
    downloadMP3: true, songHistory: -1, regenerate: true,
    audioQuality: "best_lyria_pro", audioWatermark: false,
    comingSoon: true
  }
};


// ==================== PLAN FEATURE INIT ====================
function initPlanFeatures() {
  const P = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;

// ── CHAT: model
  if (P.chatModel) GEMINI_CHAT_MODEL = P.chatModel;

// ── CHAT: file upload button
  const fileUploadBtn = document.getElementById("chatFileUploadBtn");
  if (fileUploadBtn) {
    if (!P.fileUpload) {
      fileUploadBtn.style.display = "none";
    } else {
      fileUploadBtn.style.display = "flex";
      fileUploadBtn.title = "Upload " + (P.fileUpload === "images+docs" ? "images & docs" : "images");
    }
  }

// ── CHAT: export button
  const exportBtn = document.getElementById("chatExportBtn");
  if (exportBtn) exportBtn.style.display = P.exportChat ? "flex" : "none";

// ── CHAT: custom system prompt
  const sysPromptWrap = document.getElementById("chatSystemPromptWrap");
  if (sysPromptWrap) sysPromptWrap.style.display = P.customSystemPrompt ? "block" : "none";

// ── CHAT: force Khmer button
  const khmerBtn = document.getElementById("chatForceKhmerBtn");
  if (khmerBtn) khmerBtn.style.display = P.forceKhmer ? "flex" : "none";

// ── IMAGE: aspect ratio
  const ratioChips = document.querySelectorAll("#imgRatioGroup .chip");
  ratioChips.forEach(chip => {
    chip.removeAttribute("onclick");
    const val = chip.firstChild?.textContent?.trim() || chip.textContent.trim().replace(/PRO.*$/,'').trim();
    if (P.aspectRatios[0] === "1:1" && P.aspectRatios.length === 1 && val !== "1:1") {
      chip.classList.add("pro-locked");
      const existing = chip.querySelector(".pro-badge");
      if (!existing) {
        const b = document.createElement("span"); b.className = "pro-badge"; b.textContent = "PRO";
        chip.appendChild(b);
      }
    } else {
      chip.classList.remove("pro-locked");
      // Remove any injected badge when unlocked
      const badge = chip.querySelector(".pro-badge");
      if (badge) badge.remove();
      // Re-attach click handler since we removed onclick attribute
      if (!chip._ratioHandler) { chip._ratioHandler = function(){ selectChip(this,"imgRatioGroup"); }; chip.addEventListener("click", chip._ratioHandler); }
    }
  });

// ── IMAGE: batch qty
  const qtyChips = document.querySelectorAll("#imgQtyGroup .chip");
  qtyChips.forEach(chip => {
    chip.removeAttribute("onclick");
    const val = parseInt(chip.firstChild?.textContent?.trim() || chip.textContent.trim());
    if (val > P.batchGenerate) {
      chip.classList.add("pro-locked");
    } else {
      chip.classList.remove("pro-locked");
      if (!chip._qtyHandler) { chip._qtyHandler = function(){ selectChip(this,"imgQtyGroup"); }; chip.addEventListener("click", chip._qtyHandler); }
    }
  });

// ── IMAGE: quality
  const qualChips = document.querySelectorAll("#imgQualityGroup .chip");
  qualChips.forEach(chip => {
    chip.removeAttribute("onclick");
    const q = parseInt(chip.dataset.quality || "720");
    if (q <= 720) {
      chip.classList.remove("pro-locked");
      chip.onclick = () => selectChip(chip, "imgQualityGroup");
    } else if (q <= 1280) {
      if (P.downloadHD) {
        chip.classList.remove("pro-locked");
        chip.onclick = () => selectChip(chip, "imgQualityGroup");
      } else {
        chip.classList.add("pro-locked");
        chip.onclick = () => { openPlanModal(); showToast("HD 1280p requires Pro plan", "error"); };
      }
    } else {
      const is2K = userPlan === "proplus" || userPlan === "max";
      if (is2K) {
        chip.classList.remove("pro-locked");
        chip.onclick = () => selectChip(chip, "imgQualityGroup");
      } else {
        chip.classList.add("pro-locked");
        chip.onclick = () => { openPlanModal(); showToast("2K quality requires Pro+ plan", "error"); };
      }
    }
  });

// ── SONG: choir/duet lock
  const voiceChips = document.querySelectorAll("#songVoiceGroup .chip");
  voiceChips.forEach(chip => {
    chip.removeAttribute("onclick");
    const val = (chip.dataset.voice || chip.firstChild?.textContent?.replace(/[^a-zA-Z]/g,"").trim() || chip.textContent.replace(/[^a-zA-Z]/g,"").trim()).toLowerCase();
    const allowed = P.vocalStyles.map(v => v.toLowerCase());
    if (!allowed.includes(val)) {
      chip.classList.add("pro-locked");
      if (!chip.querySelector(".pro-badge")) {
        const b = document.createElement("span"); b.className = "pro-badge"; b.textContent = "PRO+";
        b.style.cssText = "background:linear-gradient(90deg,#a855f7,#7c3aed);font-size:9px";
        chip.appendChild(b);
      }
    } else {
      chip.classList.remove("pro-locked");
      const badge = chip.querySelector(".pro-badge");
      if (badge) badge.remove();
      if (!chip._voiceHandler) { chip._voiceHandler = function(){ selectChip(this,"songVoiceGroup"); }; chip.addEventListener("click", chip._voiceHandler); }
    }
  });

// ── Profile sheet usage label
  syncProfileSheet();
  initSongPlanBadge();
}

// ======================= STATE =======================
let currentPanel  = 0;
let userPlan      = "free";
let proCustomKey  = "";
let useOwnKey     = false;
let _ownKeyOn     = false;
let _refImgs = []; // [{base64, mime, dataUrl}] - multi ref images
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
// ── Delegated chip group click handlers ──
  // Handles chips even after removeAttribute("onclick") by initPlanFeatures
  const CHIP_GROUPS = [
    { id: "imgRatioGroup",  groupId: "imgRatioGroup"  },
    { id: "imgQtyGroup",    groupId: "imgQtyGroup"    },
    { id: "songVoiceGroup", groupId: "songVoiceGroup" },
  ];
  CHIP_GROUPS.forEach(({ id, groupId }) => {
    const group = document.getElementById(id);
    if (!group) return;
    group.addEventListener("click", function(e) {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      selectChip(chip, groupId);
    });
  });
  setWelcomeTime();
  initSwipe();
  renderPlanBadge();
  initPlanFeatures();
  await fetchOwnerKey();
  await fetchAvailableModels();
  await checkExistingSession();
  if (!currentUser) enforceAuthGate();
});

// ===================== AUTH GATE =====================
function enforceAuthGate() {
  const chatInput   = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");
  if (chatInput)   { chatInput.disabled = true; chatInput.placeholder = "Ã°Å¸â€â€™ Sign in to start chatting..."; }
  if (chatSendBtn) chatSendBtn.disabled = true;
  showPanelOverlay("panel-chat",  "chat");
  showPanelOverlay("panel-image", "image");
  showPanelOverlay("panel-song",  "song");
  showPanelOverlay("panel-video", "video");
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
  const icon  = action === "chat"  ? "fa-comments"
              : action === "image" ? "fa-image"
              : action === "song"  ? "fa-music"
              : "fa-video";
  const label = action === "chat"  ? "AI Assistant"
              : action === "image" ? "Image Generator"
              : action === "song"  ? "Song Generator"
              : "Video Generator";
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
      window._jlToken = stored;
      window.authToken = stored;
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
  if ((userPlan === "pro" || userPlan === "proplus" || userPlan === "max") && useOwnKey && proCustomKey) return proCustomKey;
  return ownerApiKey;
}

function checkQuota() {
  if (!currentUser) { openAuthModal(null); return false; }
  const limit = PLAN_LIMITS[userPlan]?.requests ?? 20;
  if (limit < 0 || limit >= 9999) return true; // unlimited (Pro+/Max)
  if (requestCount >= limit) { showUpgradeModal(); return false; }
  requestCount++;
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
  if (plan.comingSoon) badge.title = "Coming Soon";
  else badge.title = "";
}

// ===================== PANEL NAV =====================
function goToPanel(index) {
  const track = document.getElementById("panelsTrack");
  const tabs = document.querySelectorAll(".tab-bar .tab");
  currentPanel = Math.max(0, Math.min(index, TOTAL_PANELS - 1));
  if (track) track.style.transform = `translateX(-${currentPanel * 100}%)`;
  tabs.forEach((tab, i) => tab.classList.toggle("active", i === currentPanel));
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
      if (dx < 0 && currentPanel < TOTAL_PANELS - 1) goToPanel(currentPanel + 1);
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
      showAuthMsg("Code verified! Email confirmed.", "success");
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
      if (data.token) { authToken = data.token; localStorage.setItem("jl_token", data.token); window._jlToken = data.token; window.authToken = data.token; }
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
      if (data.token) { authToken = data.token; localStorage.setItem("jl_token", data.token); window._jlToken = data.token; window.authToken = data.token; }
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
  if (user.plan && (PLAN_LIMITS[user.plan] || user.plan === "proplus")) {
    userPlan = user.plan;
    renderPlanBadge();
    initSongPlanBadge();
    initPlanFeatures();
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
  window._jlToken = null;
  window.authToken = null;
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
function openProfileSheet() {
  if (!currentUser) { showToast("Please sign in first.", "error"); return; }
  syncProfileSheet();
  const ov = document.getElementById("ppOverlay");
  if (ov) ov.classList.add("open");
}
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
    const set  = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || "-"; };
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
    if (ub) ub.style.display = (plan === "pro" || plan === "proplus" || plan === "max") ? "none" : "flex";
  }
  const P2 = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const displayLimit = (P2.requests >= 9999 || P2.requests < 0) ? "∞" : String(limit);
  const uc = document.getElementById("ppUsageCount");
  if (uc) uc.textContent = used + " / " + displayLimit;
  const ub2 = document.getElementById("ppUsageBar");
  if (ub2) {
    const barPct = displayLimit === "∞" ? 0 : pct;
    ub2.style.width      = barPct + "%";
    ub2.style.background = barPct >= 80 ? "#f87171" : barPct >= 50 ? "#fbbf24" : "#a855f7";
  }
  // Show plan features summary in profile
  const planFeatEl = document.getElementById("ppPlanFeatures");
  if (planFeatEl && P2) {
    const chatLbl  = P2.chatMsg < 0 ? "∞" : P2.chatMsg;
    const imgLbl   = P2.imgDay  < 0 ? "∞" : P2.imgDay;
    const songLbl  = P2.songDay < 0 ? "∞" : P2.songDay;
    planFeatEl.innerHTML = `
  <div style="overflow:hidden;">
    <div class="pp-feat-row"><i class="fas fa-comments"></i> Chat: <b>${chatLbl}/day</b></div>
    <div class="pp-feat-row"><i class="fas fa-palette"></i> Images: <b>${imgLbl}/day</b></div>
    <div class="pp-feat-row"><i class="fas fa-music"></i> Songs: <b>${songLbl}/day</b></div>
  </div>
`;
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
  document.querySelectorAll(".plan-card, .plan-card-v2").forEach(c => c.classList.toggle("selected", c.dataset.plan === userPlan));
}
function closePlanModal() {
  const m = document.getElementById("planModal");
  if (m) m.classList.remove("open");
}
function selectPlan(plan) {
  document.querySelectorAll(".plan-card, .plan-card-v2").forEach(c => c.classList.toggle("selected", c.dataset.plan === plan));
  const ps = document.getElementById("proSettingsInModal");
  if (ps) ps.style.display = (plan === "pro" || plan === "proplus" || plan === "max") ? "block" : "none";
}

// ================ confirmPlan (FIXED) ================
async function confirmPlan() {
  const selected = document.querySelector(".plan-card.selected, .plan-card-v2.selected");
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
  if (!currentUser) { showToast("Please sign in first.", "error"); return; }  // ← បន្ថែម
  if (userPlan === "free") { showToast("Settings available on Pro, Pro+ and Max plans", "error"); openPlanModal(); return; }
  const m = document.getElementById("settingsModal"); if (!m) return;
  m.classList.add("open");
  const _ki = document.getElementById("customKeyInput"); if (_ki) _ki.value = proCustomKey;
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
function showUpgradeModal() {
  // Update modal content to suggest appropriate next plan
  const nextPlan = (userPlan === "free") ? "pro" : (userPlan === "pro") ? "proplus" : "proplus";
  const NP = PLAN_LIMITS[nextPlan] || PLAN_LIMITS.pro;
  const upgradeTitle = document.querySelector("#upgradeModal .upgrade-plan-name");
  const upgradeDesc  = document.querySelector("#upgradeModal .upgrade-plan-desc");
  const upgradeBtn   = document.querySelector("#upgradeModal .btn-upgrade-confirm");
  if (upgradeTitle) upgradeTitle.textContent = "Upgrade to " + NP.label;
  if (upgradeDesc)  upgradeDesc.textContent  = (NP.chatMsg < 0 ? "Unlimited" : NP.chatMsg) + " chat msg/day · " + NP.price;
  if (upgradeBtn)   upgradeBtn.textContent   = "👑 Upgrade to " + NP.label;
  const desc = document.getElementById("upgradeModalDesc");
  if (desc) {
    if (userPlan === "free") desc.innerHTML = 'You\'ve used all requests on the <strong>Free plan</strong>. Upgrade to unlock more.';
    else if (userPlan === "pro") desc.innerHTML = 'This feature requires <strong>Pro+ plan</strong>. Upgrade to unlock.';
    else desc.innerHTML = 'Upgrade your plan to unlock this feature.';
  }
  const m = document.getElementById("upgradeModal");
  if (m) m.classList.add("open");
}
function closeUpgradeModal() { const m = document.getElementById("upgradeModal"); if (m) m.classList.remove("open"); }
function upgradeNow()        { closeUpgradeModal(); openPlanModal(); }
function requirePro(btn, groupId) {
  if (userPlan === "pro" || userPlan === "proplus" || userPlan === "max") selectChip(btn, groupId);
  else { showUpgradeModal(); showToast("HD is available on Pro plan only", "error"); }
}

// ======================== CHAT ========================
function autoResize(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 100) + "px"; }
function handleChatKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }

function sendChat() {
  if (!currentUser) { openAuthModal("chat"); return; }
  _sendChat();
}

// Chat file upload state
let _chatFileData = null, _chatFileMime = null, _chatFileName = null;
let _forceKhmer = false;

function openChatFileUpload() {
  const P = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  if (!P.fileUpload) { showUpgradeModal(); showToast("File upload requires Pro plan", "error"); return; }
  document.getElementById("chatFileInput").click();
}
function handleChatFileUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const P = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  const isDoc = !file.type.startsWith("image/");
  if (isDoc && P.fileUpload !== "images+docs") { showToast("Document upload requires Pro+ plan", "error"); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    _chatFileData = ev.target.result.split(",")[1];
    _chatFileMime = file.type; _chatFileName = file.name;
    const prev = document.getElementById("chatFilePreview");
    const name = document.getElementById("chatFilePreviewName");
    if (prev) prev.style.display = "block";
    if (name) name.textContent = file.name;
  };
  reader.readAsDataURL(file);
}
function clearChatFile() {
  _chatFileData = null; _chatFileMime = null; _chatFileName = null;
  const prev = document.getElementById("chatFilePreview");
  if (prev) prev.style.display = "none";
  const inp = document.getElementById("chatFileInput"); if (inp) inp.value = "";
}
function toggleForceKhmer(btn) {
  _forceKhmer = !_forceKhmer;
  btn.style.background  = _forceKhmer ? "rgba(168,85,247,.25)" : "rgba(255,255,255,.08)";
  btn.style.color       = _forceKhmer ? "#a855f7" : "var(--text2)";
  btn.style.borderColor = _forceKhmer ? "#a855f7" : "var(--border)";
  showToast(_forceKhmer ? "Force Khmer ON 🇰🇭" : "Force Khmer OFF", "success");
}
function exportChat() {
  const P = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  if (!P.exportChat) { showUpgradeModal(); showToast("Export requires Pro+ plan", "error"); return; }
  const msgs = document.querySelectorAll("#chatMessages .msg");
  let text = "JeeThy Labs Chat Export\n" + new Date().toLocaleString() + "\n\n";
  msgs.forEach(m => {
    const isBot = m.classList.contains("msg-bot");
    m.querySelectorAll(".msg-bubble p, .msg-bubble .prose-response").forEach(line => {
      text += (isBot ? "AI: " : "You: ") + line.textContent + "\n";
    });
    text += "\n";
  });
  const blob = new Blob([text], {type: "text/plain"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "chat-export-" + Date.now() + ".txt"; a.click();
  showToast("Chat exported!", "success");
}

async function _sendChat() {
  if (isChatLoading) return;
  const key = getActiveApiKey();
  if (!key) { showToast("Service unavailable.", "error"); return; }
  if (!checkQuota()) return;
  const input = document.getElementById("chatInput");
  const text  = input.value.trim();
  if (!text && !_chatFileData) return;

  const displayText = text || ("Ã°Å¸â€œÅ½ " + (_chatFileName || "file"));
  appendMessage("user", displayText);
  input.value = ""; input.style.height = "auto";
  isChatLoading = true;
  const sendBtn = document.getElementById("chatSendBtn");
  if (sendBtn) sendBtn.disabled = true;

  // Build user parts
  const P = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  const khmerSuffix = (_forceKhmer && P.forceKhmer)
    ? "\n\n[IMPORTANT: Reply ONLY in Khmer language (Ã¡Å¾â€”Ã¡Å¾Â¶Ã¡Å¾Å¸Ã¡Å¾Â¶Ã¡Å¾ÂÃ¡Å¸â€™Ã¡Å¾ËœÃ¡Å¸â€šÃ¡Å¾Å¡). Do not use English.]" : "";
  const userParts = [{ text: (text || " ") + khmerSuffix }];
  if (_chatFileData && _chatFileMime) {
    userParts.push({ inlineData: { mimeType: _chatFileMime, data: _chatFileData } });
  }

  // System prompt
  const sysPromptEl = document.getElementById("chatSystemPrompt");
  const sysPromptVal = (P.customSystemPrompt && sysPromptEl?.value.trim())
    ? sysPromptEl.value.trim()
    : "You are JeeThy Assistant, a helpful and friendly AI created by JeeThy Labs.\nAnswer in the same language the user writes in.\nBe concise but thorough. Use markdown for formatting.";

  chatHistory.push({ role: "user", parts: userParts });
  const typingId = appendTyping();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:generateContent?key=${key}`,
      {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: sysPromptVal }] },
          contents: chatHistory
        })
      }
    );
    clearChatFile();
    removeTyping(typingId);
    if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || `HTTP ${res.status}`); }
    const data  = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, could not generate a response.";
    chatHistory.push({ role: "model", parts: [{ text: reply }] });
    appendMessage("bot", reply);
    incrementRequest();
   } catch (err) {
    clearChatFile();
    removeTyping(typingId);
    appendMessage("bot", "⚠️ " + err.message);
  } finally {
    isChatLoading = false;
    if (sendBtn) sendBtn.disabled = false;
  }
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
// ── Reference Image Upload ──────
function openRefImgUpload() {
  if (userPlan !== "pro" && userPlan !== "proplus" && userPlan !== "max") {
    showUpgradeModal();
    showToast("Reference image requires Pro plan", "error");
    return;
  }
  const maxRef = (userPlan === "proplus" || userPlan === "max") ? 4 : 1;
  if (_refImgs.length >= maxRef) {
    showToast(userPlan === "pro" ? "Pro plan supports 1 reference image" : "Max " + maxRef + " reference images", "error");
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
    const dataUrl = ev.target.result;
    _refImgs.push({ base64: dataUrl.split(',')[1], mime: file.type || 'image/jpeg', dataUrl });
    renderRefImgPreviews();
  };
  reader.onerror = () => showToast("Failed to read image.", "error");
  reader.readAsDataURL(file);
}

function renderRefImgPreviews() {
  const ph  = document.getElementById('refImgPlaceholder');
  const pv  = document.getElementById('refImgPreview');
  const dz  = document.getElementById('refImgDropZone');
  if (!pv) return;
  if (_refImgs.length === 0) {
    if (ph) ph.style.display = 'block';
    pv.style.display = 'none';
    if (dz) { dz.style.borderColor = 'var(--border)'; dz.style.background = 'rgba(255,255,255,.03)'; }
    return;
  }
  if (ph) ph.style.display = 'none';
  pv.style.display = 'block';
  if (dz) { dz.style.borderColor = 'var(--cyan,#06b6d4)'; dz.style.background = 'rgba(6,182,212,.06)'; }
  pv.innerHTML = _refImgs.map((img, i) => `
    <div style="position:relative;display:inline-block;margin:4px;">
      <img src="${img.dataUrl}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:2px solid var(--cyan,#06b6d4)" alt="ref ${i+1}"/>
      <button onclick="removeRefImg(event,${i})" style="position:absolute;top:-6px;right:-6px;background:#ef4444;border:none;border-radius:50%;width:20px;height:20px;color:#fff;font-size:11px;cursor:pointer;line-height:1;font-weight:700;">&#215;</button>
    </div>
  `).join('') + (((userPlan === 'proplus' || userPlan === 'max') && _refImgs.length < 4) || (userPlan === 'pro' && _refImgs.length < 2) ? `
    <div onclick="event.stopPropagation();openRefImgUpload();" style="display:inline-flex;align-items:center;justify-content:center;width:80px;height:80px;border:2px dashed var(--border);border-radius:8px;cursor:pointer;vertical-align:top;margin:4px;color:var(--text2);font-size:22px;background:rgba(255,255,255,.04)">+</div>
  ` : '');
}

function removeRefImg(e, idx) {
  if (e) e.stopPropagation();
  _refImgs.splice(idx, 1);
  renderRefImgPreviews();
}
function clearRefImg(e) {
  if (e) e.stopPropagation();
  _refImgs = [];
  const inp = document.getElementById('refImgInput');
  if (inp) inp.value = '';
  renderRefImgPreviews();
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
  const refBase64 = _refImgs.length > 0 ? _refImgs[0].base64 : null;
  const refMime   = _refImgs.length > 0 ? _refImgs[0].mime   : null;
  const extraRefs = _refImgs.slice(1); // additional ref images for Pro+/Max

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
        quality: parseInt(document.querySelector("#imgQualityGroup .chip.active")?.dataset?.quality || "720"),
        ...(refBase64 ? { referenceImageBase64: refBase64, referenceImageMime: refMime } : {}),
        ...(extraRefs.length > 0 ? { extraRefImages: extraRefs.map(r => ({ base64: r.base64, mime: r.mime })) } : {})
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
        ${isOverload ? "<br/><small style='opacity:.7'>AI is busy - please wait</small>" : ""}
        <br/><button onclick="_generateImage()" style="margin-top:10px;padding:6px 16px;border-radius:20px;border:none;background:var(--accent,#7c3aed);color:#fff;font-size:12px;cursor:pointer;font-weight:600;">
          <i class="fas fa-rotate-right"></i> Try Again
        </button>
  </div>`;
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Image';
  }
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
// •••• Song Plan Badge ••••
function initSongPlanBadge() {
  const badge = document.getElementById("song-plan-badge");
  const hint  = document.getElementById("song-duration-hint");
  if (badge) {
    const labels = { free:"FREE", pro:"PRO", proplus:"PRO+", max:"MAX" };
    const colors = { free:"#9ca3af", pro:"#06b6d4", proplus:"#a855f7", max:"#fbbf24" };
    badge.textContent      = labels[userPlan] || "FREE";
    badge.style.color      = colors[userPlan] || "#9ca3af";
    badge.style.borderColor = (colors[userPlan] || "#9ca3af") + "55";
    badge.style.display    = "inline-block";
  }
  if (hint) {
    const hints = {
      free:    "~55s",
      pro:     "~2:50–3:05",
      proplus: "~3:00–3:25",
      max:     "~4:25–5:25 (full song)"
    };
    hint.textContent = hints[userPlan] || "~55s";
  }
}

// •••• Custom Genre Chip (pops up instrument/tempo/mood panel) ••••
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
  const customLyrics = null; // Custom lyrics removed - use prompt textarea
  const voiceHint = voice.toLowerCase().includes("duet")
    ? "male and female duet vocalists, call-and-response singing, two voices"
    : voice.toLowerCase().includes("female") ? "female vocalist" : "male vocalist";
  const btn       = document.getElementById("songGenBtn");
  const resultsEl = document.getElementById("songResults");
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Composing...';
  resultsEl.innerHTML = `<div class="loading-card green-loader"><div class="loading-spinner"></div><div class="loading-label" id="songLoadingLabel">Writing lyrics &amp; generating music with Lyria... (~20-40s)</div></div>`;

  const retryHintTimer = setTimeout(() => {
    const lbl = document.getElementById("songLoadingLabel");
    if (lbl) lbl.textContent = "Lyria is composing... Please wait. If slow, it will fall back to TTS.";
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
      ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;margin-left:6px;background:${isLyria ? "rgba(168,85,247,.18)" : "rgba(16,185,129,.15)"};color:${isLyria ? "#a855f7" : "#10b981"};border:1px solid ${isLyria ? "rgba(168,85,247,.3)" : "rgba(16,185,129,.3)"};">${isLyria ? "🎵 Lyria" : "🎤 TTS"}</span>`
      : "";
    header.innerHTML = `<i class="fas fa-music"></i> ${escapeHtml(songTitle || style + " Song")}${sourceBadge}<span style="font-size:11px;color:var(--text2);font-weight:400;margin-left:auto">${escapeHtml(style)} - ${escapeHtml(voiceHint)}</span>`;
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

// ── Waveform beat effect ──
      const waveWrap = document.createElement('div');
      waveWrap.style.cssText = 'display:flex;align-items:flex-end;gap:3px;height:32px;padding:6px 14px 4px;';
      for (let wb = 0; wb < 22; wb++) {
        const wbar = document.createElement('div');
        wbar.style.cssText = 'width:3px;border-radius:3px;background:#22c55e;height:4px;transition:height 0.08s ease;';
        waveWrap.appendChild(wbar);
      }
      let _waveRaf = null;
      function _startWave() {
        const brs = waveWrap.children;
        function tick() {
          for (let wi = 0; wi < brs.length; wi++) {
            brs[wi].style.height = (3 + Math.random() * 24) + 'px';
          }
          _waveRaf = requestAnimationFrame(tick);
        }
        tick();
      }
      function _stopWave() {
        if (_waveRaf) { cancelAnimationFrame(_waveRaf); _waveRaf = null; }
        const brs = waveWrap.children;
        for (let wi = 0; wi < brs.length; wi++) brs[wi].style.height = '4px';
      }
      audioEl.addEventListener('play',  _startWave);
      audioEl.addEventListener('pause', _stopWave);
      audioEl.addEventListener('ended', _stopWave);
      card.appendChild(audioEl);
      card.appendChild(waveWrap);
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
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Song';
  }
}

// ===================== UTILITIES =====================

// ===================== UTILITIES =====================

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
// •••• Multi-select Chip (for Instrument) ••••
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
    // Select - enforce max limit
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
  // If chip is pro-locked, trigger upgrade modal instead of selecting
  if (el.classList.contains("pro-locked")) {
    const badge = el.querySelector(".pro-badge");
    const badgeTxt = badge ? badge.textContent.trim() : "PRO";
    if (badgeTxt === "PRO+") {
      showToast("This feature requires Pro+ plan", "error");
    } else {
      showToast("This feature requires Pro plan", "error");
    }
    showUpgradeModal();
    return;
  }
  document.querySelectorAll(`#${groupId} .chip`).forEach(c => c.classList.remove("active"));
  el.classList.add("active");
  // If selecting a non-custom, non-other genre chip → clear Other value + hide custom panel
  if (groupId === 'songStyleGroup' && !el.classList.contains('chip-custom') && !el.classList.contains('chip-other')) {
    _otherStyleValue = null;
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


// •••• Khmer Music Rhythm Dataset v1 - JeeThy Labs ••••
// ============================================================
// KHMER RHYTHM DATASET - Rich Lyria-optimized prompts v2.0
// Each entry contains: label, bpm range, full Lyria prompt
// Covers: drum patterns, instruments, scale/mode, mood, production style
// ============================================================

const KHMER_RHYTHM_DB = {

  romvong: {
    label: 'រាំវង់ (Romvong)',
    bpm: [90, 110],
    desc: 'Khmer Romvong - traditional Cambodian circular dance music with warm, friendly, wedding/party feel. '
        + 'Tempo: 90-110 BPM, 4/4 time signature, medium energy. '
        + 'Core Khmer instruments: Chhing (small cymbals) as the constant rhythmic heartbeat on every 8th note - this is the most important element. '
        + 'Skor Thom (deep barrel drum) as kick on beat 1 and beat 3. '
        + 'Sampho (mid drum) as soft snare accent on beat 2 and beat 4. '
        + 'Roneat Ek (bright xylophone) as the main melody - smooth, repetitive, easy Khmer folk ornamentation. '
        + 'Khim (hammered dulcimer) for light arpeggio layer. '
        + 'Tro U (bowed string) for soft bass melody. '
        + 'Chapey (long-neck lute) optional rhythmic chord support. '
        + 'Drum feel: human, not fully quantized - add 5-15ms swing variation. '
        + 'Bass: simple root notes, low volume, do not overplay. '
        + 'Melody: smooth circular phrasing with Khmer folk slides, trills, and call-and-response. '
        + 'Mix priority: Chhing is loudest timekeeper, then Roneat Ek melody, then Skor Thom, then Sampho, bass and Khim are subtle support. '
        + 'Do NOT use Western EDM drums. Keep rhythm human, danceable, and culturally Khmer.',
  },

  saravan: {
    label: 'សារ់ាវ់ាន់ (Saravan)',
    bpm: [95, 115],
    desc: 'Khmer Saravan - bouncy festive village dance music with playful, lively feel. '
        + 'Tempo: 95-115 BPM, 4/4 time signature, medium-high energy. '
        + 'Core Khmer instruments: Chhing (finger cymbals) as strong timekeeper with slight swing feel. '
        + 'Skor Thom (deep drum) with syncopated bouncy kick movement - more dynamic than Romvong. '
        + 'Sampho (mid drum) with stronger accents on beat 2 and beat 4. '
        + 'Roneat Ek (bright xylophone) as bright lead melody with lively ornaments. '
        + 'Khim (dulcimer) for rhythmic sparkle. '
        + 'Tro Sau (expressive bowed fiddle) as expressive melody layer. '
        + 'Drum feel: syncopated kick pattern, slight swing on Chhing pulse, human timing with 5-15ms variation. '
        + 'Bass: root-note bass with small rhythmic movement, not complex. '
        + 'Melody: short repeated Khmer folk phrases, lively ornaments, call-and-response structure. '
        + 'Mix priority: Chhing and Skor Thom and Roneat Ek equally prominent, Sampho strong backbeat, bass moderate. '
        + 'Do NOT use heavy Western drums. Keep energy festive and Khmer village folk style.',
  },

  kantreum: {
    label: 'កន្ត្រឹម (Kantreum)',
    bpm: [110, 135],
    desc: 'Khmer Kantreum - fast energetic folk dance music, powerful and festive. '
        + 'Tempo: 110-135 BPM, 4/4 time signature, high energy. '
        + 'Core Khmer instruments: Skor Thom (deep drum) as strong driving kick with syncopated pattern. '
        + 'Sampho or clap as sharp strong backbeat accent. '
        + 'Chhing (cymbals) in fast 16th-note or 8th-note pulse. '
        + 'Chapey (long-neck lute) for rhythmic plucked groove. '
        + 'Roneat Ek (xylophone) or bright synth lead for fast Khmer folk melody. '
        + 'Electric bass or Tro U for driving bass line. '
        + 'Drum feel: strong syncopated kick, sharp backbeat, fast Chhing pulse - powerful and driving. '
        + 'Slight human timing variation 5-15ms to keep it alive. '
        + 'Bass: stronger than Romvong, repetitive dance-focused root movement. '
        + 'Melody: fast Khmer folk phrases, repeated energetic hooks, ornaments. '
        + 'Mix priority: Skor Thom is the loudest driving force, bass strong, Sampho sharp, Chapey rhythmic, melody cuts through. '
        + 'This can use some modern production but must keep Khmer percussion identity clearly audible.',
  },

  madison: {
    label: 'ម់ាឌីសុន (Madison)',
    bpm: [100, 120],
    desc: 'Khmer Madison - structured Cambodian line dance with retro party feel, clean and danceable. '
        + 'Tempo: 100-120 BPM, 4/4 time signature, medium-high energy. '
        + 'Instruments: modern drum kit or Skor Thom hybrid kick on beat 1 and beat 3. '
        + 'Snare or Sampho on beat 2 and beat 4 - clean sharp backbeat. '
        + 'Hi-hat or Chhing on straight 8th notes. '
        + 'Bass guitar with simple walking or root-fifth movement. '
        + 'Piano or Khim (dulcimer) for harmonic support. '
        + 'Roneat Ek (xylophone) for Khmer melodic flavor and identity. '
        + 'Drum feel: clean and structured, more precise than Romvong, suitable for synchronized line dancing. '
        + 'Bass: simple root-fifth walking bass, clear and groovy. '
        + 'Melody: catchy, repetitive, danceable Khmer-inflected phrases. '
        + 'Mix priority: kick and snare prominent, bass strong and present, hi-hat steady, Roneat/Khim add Khmer color. '
        + 'Blend Khmer traditional instruments with modern pop production for 1970s Cambodian pop feel.',
  },

  romkbach: {
    label: 'រាំក្បាច់ (Romkbach)',
    bpm: [75, 95],
    desc: 'Khmer Romkbach - elegant graceful traditional Cambodian slow dance, refined and dignified. '
        + 'Tempo: 75-95 BPM, 4/4 time signature, low-medium energy. '
        + 'Core Khmer instruments: Tro Sau (expressive bowed fiddle) as the main emotional melody lead - most important. '
        + 'Roneat Ek (xylophone) for melodic decoration and response phrases. '
        + 'Khim (hammered dulcimer) for soft harmonic layer. '
        + 'Chhing (finger cymbals) very light and spaced timekeeper, do not overwhelm. '
        + 'Sampho (mid drum) very soft accents only, must not dominate. '
        + 'Drum feel: very soft percussion, human and relaxed, long spaces between hits. '
        + 'Bass: very soft, minimal, long sustained root notes only. '
        + 'Melody: graceful, deeply ornamented, emotional Khmer phrasing with slides, vibrato, and long sustained notes. '
        + 'Tro Sau should carry the full emotional weight - flowing and expressive like classical Apsara court music. '
        + 'Mix priority: Tro Sau is dominant, Roneat Ek secondary, Chhing and Khim are subtle texture, drums and bass barely audible. '
        + 'This is traditional Cambodian court dance music - ceremonial, dignified, ancient in feel.',
  },

  slow: {
    label: 'បត្រ័ត (Slow Ballad)',
    bpm: [60, 80],
    desc: 'Khmer Slow Ballad - deeply romantic emotional Cambodian ballad with nostalgic, heartfelt feel. '
        + 'Tempo: 60-80 BPM, 4/4 time signature, low energy, cinematic and intimate. '
        + 'Core Khmer instruments: Tro Sau or Tro U (bowed string) as emotional lead melody - must carry the feeling. '
        + 'Khim (dulcimer) or piano for soft harmonic support. '
        + 'Roneat Ek (xylophone) for light melodic response phrases. '
        + 'Minimal soft drum - very soft kick barely on beat 1. '
        + 'Soft Sampho or snare brushstroke on beat 2 and beat 4. '
        + 'Chhing or shaker only if needed - very quiet. '
        + 'Bass: very simple, warm, long sustained root notes, do not rush. '
        + 'Melody: slow and deeply emotional with slides, vibrato, and long sustained phrases. '
        + 'Long silence and space between notes - let the emotion breathe. '
        + 'Mix priority: lead Tro Sau melody at 100%, harmony instruments at 75%, bass minimal, drums barely present. '
        + 'Cinematic string swells, spacious reverb, intimate vocal quality. '
        + 'Reference feel: classic Khmer ballads by Sinn Sisamouth or Ros Sereysothea - timeless, emotional, Cambodian identity.',
  },

  taloong: {
    label: 'តាលូង (Taloong)',
    bpm: [125, 145],
    desc: 'Khmer Taloong - fastest and most driving traditional Cambodian dance rhythm, urgent and exhilarating. '
        + 'Tempo: 125-145 BPM, 4/4 time signature, very high energy. '
        + 'Core Khmer instruments: Skor Taloong (double-headed drum) as the primary rhythmic driver - relentless and powerful. '
        + 'Kick pattern: four-on-the-floor with additional kick on beat 2-and - dense and urgent. '
        + 'Chhing (finger cymbals) in very rapid double-time pulse. '
        + 'Roneat Ek (xylophone) playing fast pentatonic melodic runs up and down the scale. '
        + 'Electric bass or Tro U with driving eighth-note pulse. '
        + 'Snare or Sampho cracking hard on beat 2 and beat 4. '
        + 'Drum feel: intense, driving, slightly human - snare rolls and fills at phrase endings. '
        + 'Bass: strong and repetitive, pushing forward momentum. '
        + 'Melody: rapid Khmer pentatonic minor runs, fast ornaments, energetic hooks. '
        + 'Mix priority: Skor Taloong drum dominant, bass strong, Chhing rapid pulse, melody cuts through clearly. '
        + 'Traditional Khmer festival drumming at full sprint - wild, unstoppable, exhilarating.',
  },

  cha_cha_cha: {
    label: 'ចា ចា ចា (Cha Cha)',
    bpm: [110, 130],
    desc: 'Khmer Cha Cha - Latin-influenced Cambodian dance rhythm with Khmer melodic identity, playful and seductive. '
        + 'Tempo: 110-130 BPM, 4/4 time signature, medium-high energy. '
        + 'Rhythm: Latin 3-2 son clave pattern on woodblock or rim as rhythmic foundation. '
        + 'Kick syncopated on beat 1 and beat 4-and. '
        + 'Snare with ghost notes on beat 2 and beat 4. '
        + 'Maracas or hi-hat shaker on every 8th note for Latin texture. '
        + 'Chhing (finger cymbals) replacing or blending with Latin percussion for Khmer identity. '
        + 'Instruments: brass section stabs (trumpet, trombone), piano montuno pattern, '
        + 'congas and timbales for Latin percussion body, '
        + 'Cambodian Khloy flute or Roneat Ek for the melodic Khmer lead. '
        + 'Bass with tumbao pattern - syncopated Latin bass movement. '
        + 'Melody: Khmer-inflected mixolydian or minor scale with chromatic Latin voice leading. '
        + 'Mix priority: brass and percussion prominent, Roneat/Khloy for Khmer color, bass rhythmic and syncopated. '
        + 'Reference feel: Cambodian 1960s golden era - Sinn Sisamouth meets Latin salsa, couples dancing at Phnom Penh nightclubs.',
  },

  chapey: {
    label: 'ចាប័ី ដង វែង (Chapey Dang Veng)',
    bpm: [70, 95],
    desc: 'Chapey Dang Veng - ancient Cambodian long-neck lute storytelling tradition, UNESCO Intangible Cultural Heritage. '
        + 'Tempo: 70-95 BPM with rubato feel - tempo breathes naturally with the story. '
        + 'Primary instrument: Chapey dong veng (long two-string lute) - the entire music is built around this instrument. '
        + 'Rhythm comes from chapey plucking: steady bass thumb on beats 1 and 3, '
        + 'ornamented finger picking on off-beats, occasional percussive body slap for accent. '
        + 'Optional minimal skor hand drum for light rhythmic support. '
        + 'Chhing very lightly if present - must not dominate. '
        + 'Scale: Cambodian open modal tuning with microtonal bends, blues-adjacent but distinctly Khmer. '
        + 'Mood: ancient, wise, storytelling - like a monk reciting Khmer epic poetry about Angkor Wat. '
        + 'Spiritual, deeply rooted in Cambodian identity and oral tradition. '
        + 'Production: very raw and dry, close-mic acoustic, minimal processing - '
        + 'imperfections are authentic and beautiful, must sound ancient, not polished. '
        + 'Reference feel: Kong Nay or Chum Ngek playing chapey - Cambodia oldest living blues tradition.',
  },

  lbokkatob: {
    label: 'លបកតប់ / អាយៀាយ (Lbok Katob / Ayai)',
    bpm: [80, 100],
    desc: 'Lbok Katob - traditional Cambodian improvised call-and-response folk singing style, witty and playful. '
        + 'Tempo: 80-100 BPM, 4/4, moderate and conversational energy. '
        + 'Light syncopated percussion underneath vocal improvisation - space is very important. '
        + 'Skor drum accenting phrase endings to punctuate the vocal exchange. '
        + 'Chhing (finger cymbals) marking the steady beat gently as the timekeeper. '
        + 'Bass note every two beats anchoring the harmony, very simple. '
        + 'Roneat Ek (xylophone) filling melodic phrases between vocal exchanges. '
        + 'Chapey (long-neck lute) for bass harmonic support and rhythmic color. '
        + 'Scale: simple bright pentatonic in major mode - supports witty comedic vocal exchange. '
        + 'Mood: playful, humorous, spontaneous - two performers teasing each other in song. '
        + 'Production: lively and natural, moderate room reverb, dynamic space for call-and-response. '
        + 'Reference feel: Cambodian folk theater music - a living tradition of wit, storytelling, and village comedy in song.',
  },

};

// Stored value for "Other" chip selection
let _otherStyleValue = null;

function openOtherStyleModal() {
  // Ensure we're on Song tab (panel index 2)
  if (typeof goToPanel === 'function') goToPanel(2);
  // Deselect all other genre chips (mutual exclusion)
  document.querySelectorAll('#songStyleGroup .chip').forEach(c => c.classList.remove('active'));
  const otherChip = document.getElementById('chipOtherStyle');
  if (otherChip) otherChip.classList.add('active');
  const bd = document.getElementById('otherStyleBackdrop');
  const md = document.getElementById('otherStyleModal');
  if (bd) bd.style.display = 'block';
  if (md) md.style.display = 'flex';
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
  document.querySelectorAll('#songStyleGroup .chip').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.other-style-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const otherBtn = document.getElementById('chipOtherStyle');
  if (otherBtn) otherBtn.classList.add('active');
  _otherStyleValue = value;
  const label = el.textContent.trim();
  const short = label.length > 12 ? label.substring(0, 11) + '\u2026' : label;
  if (otherBtn) otherBtn.innerHTML = '<i class="fas fa-th-large" style="font-size:11px"></i> ' + short;
  closeOtherStyleModal();
  const panel = document.getElementById('custom-style-panel');
  if (panel) panel.style.display = 'none';
}
function buildKhmerRhythmPrompt(key) {
  const cleanKey = key ? key.toLowerCase().replace(/[^a-z_]/g, '') : '';
  const r = KHMER_RHYTHM_DB[cleanKey];
  if (!r) return null;
  const bpmMid = Math.round((r.bpm[0] + r.bpm[1]) / 2);
  return (
    r.desc
    + ' Target tempo: ' + bpmMid + ' BPM (range ' + r.bpm[0] + '-' + r.bpm[1] + ' BPM).'
    + ' Generate authentic Cambodian Khmer music. Prioritize Chhing as timekeeper, Skor Thom and Sampho as traditional drum foundation, Roneat Ek and Khim and Tro as melodic identity. Keep rhythm human with slight swing, danceable, and culturally Khmer. Do not use heavy Western trap drums or EDM drops.'
  );
}


function getVideoDailyLimit(plan = userPlan) {
  return VIDEO_PLAN_LIMITS[plan] ?? VIDEO_PLAN_LIMITS.free;
}

function canUseVideoReferences(plan = userPlan) {
  return ["pro", "proplus", "max"].includes(plan);
}

function getVideoUsageToday() {
  try {
    const raw = localStorage.getItem("jl_video_usage") || "{}";
    const data = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (data.date !== today) return 0;
    return Number(data.count || 0);
  } catch (_) {
    return 0;
  }
}

function setVideoUsageToday(count) {
  const today = new Date().toISOString().slice(0, 10);
  localStorage.setItem("jl_video_usage", JSON.stringify({ date: today, count: Number(count || 0) }));
}

function getRemainingVideoQuota(plan = userPlan) {
  const limit = getVideoDailyLimit(plan);
  if (!Number.isFinite(limit)) return Infinity;
  return Math.max(0, limit - getVideoUsageToday());
}

function updateVideoUI() {
  const badge = document.getElementById("video-plan-badge");
  const usage = document.getElementById("video-usage-text");
  const note = document.getElementById("videoRefPlanNote");
  const startInput = document.getElementById("videoStartImage");
  const endInput = document.getElementById("videoEndImage");
  const limit = getVideoDailyLimit();
  const used = getVideoUsageToday();
  const remaining = getRemainingVideoQuota();
  const refsAllowed = canUseVideoReferences();

  if (badge) badge.textContent = `Plan: ${(PLAN_LIMITS[userPlan]?.label || userPlan).toUpperCase()}`;
  if (usage) usage.textContent = Number.isFinite(limit)
    ? `Used ${used}/${limit} videos today · Remaining ${remaining}`
    : `Unlimited video generations today`;
  if (note) note.textContent = refsAllowed
    ? "Reference images unlocked. You can upload both a start image and an end image."
    : "Start image and end image are available on Pro, Pro+, and Max only.";

  [startInput, endInput].forEach((input) => {
    if (!input) return;
    input.disabled = !refsAllowed;
    input.style.opacity = refsAllowed ? "1" : ".6";
  });

  if (!refsAllowed) {
    videoRefs.start = null;
    videoRefs.end = null;
    const s = document.getElementById("videoStartPreview");
    const e = document.getElementById("videoEndPreview");
    if (s) s.textContent = "Upgrade to Pro to use start image";
    if (e) e.textContent = "Upgrade to Pro to use end image";
    if (startInput) startInput.value = "";
    if (endInput) endInput.value = "";
  }
}

function selectVideoDuration(value, el) {
  videoDuration = value;
  document.querySelectorAll("#videoDurationChips .chip").forEach(chip => chip.classList.remove("active"));
  if (el) el.classList.add("active");
}

function handleVideoRefUpload(kind, event) {
  if (!canUseVideoReferences()) {
    showUpgradeModal("pro", "Reference start/end image is available on Pro, Pro+, and Max only.");
    event.target.value = "";
    return;
  }
  const file = event?.target?.files?.[0];
  videoRefs[kind] = file || null;
  const preview = document.getElementById(kind === "start" ? "videoStartPreview" : "videoEndPreview");
  if (preview) preview.textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : "No file selected";
}

async function generateVideo() {
  if (!currentUser) {
    openAuthModal("video");
    return;
  }

  const promptEl = document.getElementById("videoPrompt");
  const btn = document.getElementById("videoGenBtn");
  const prompt = (promptEl?.value || "").trim();
  if (!prompt) return showToast("Please enter a video prompt", "error");

  const remaining = getRemainingVideoQuota();
  if (remaining <= 0) {
    showUpgradeModal(userPlan === "free" ? "pro" : "proplus", "You reached your daily video limit. Upgrade to continue generating more videos.");
    return;
  }

  const refsAllowed = canUseVideoReferences();
  if (!refsAllowed && (videoRefs.start || videoRefs.end)) {
    showUpgradeModal("pro", "Reference images are available on Pro, Pro+, and Max only.");
    return;
  }

  const fd = new FormData();
  fd.append("prompt", prompt);
  fd.append("duration", videoDuration);
  fd.append("plan", userPlan);
  if (videoRefs.start) fd.append("startImage", videoRefs.start);
  if (videoRefs.end) fd.append("endImage", videoRefs.end);

  const oldHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
  try {
    const res = await fetch("/api/video/generate", {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: fd
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Video generation failed");

    const nextCount = Number.isFinite(data.usageCount) ? data.usageCount : getVideoUsageToday() + 1;
    setVideoUsageToday(nextCount);
    updateVideoUI();

    const result = document.getElementById("videoResult");
    const player = document.getElementById("videoPlayer");
    const status = document.getElementById("videoStatusText");
    const dl = document.getElementById("videoDownloadBtn");
    if (player && data.videoUrl) player.src = data.videoUrl;
    if (dl && data.videoUrl) dl.href = data.videoUrl;
    if (status) status.textContent = data.message || `Video ready · ${data.planLabel || userPlan} plan`;
    if (result) result.style.display = "block";
    showToast("Video generated successfully", "success");
  } catch (err) {
    showToast(err.message || "Unable to generate video", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldHtml;
  }
}

function resetVideoForm() {
  const prompt = document.getElementById("videoPrompt");
  const result = document.getElementById("videoResult");
  const player = document.getElementById("videoPlayer");
  const startInput = document.getElementById("videoStartImage");
  const endInput = document.getElementById("videoEndImage");
  const startPreview = document.getElementById("videoStartPreview");
  const endPreview = document.getElementById("videoEndPreview");
  if (prompt) prompt.value = "";
  if (result) result.style.display = "none";
  if (player) player.removeAttribute("src");
  if (startInput) startInput.value = "";
  if (endInput) endInput.value = "";
  if (startPreview) startPreview.textContent = canUseVideoReferences() ? "No file selected" : "Upgrade to Pro to use start image";
  if (endPreview) endPreview.textContent = canUseVideoReferences() ? "No file selected" : "Upgrade to Pro to use end image";
  videoRefs = { start: null, end: null };
  selectVideoDuration("5s", document.querySelector('#videoDurationChips .chip[data-value="5s"]'));
}

window.addEventListener("load", () => {
  setTimeout(updateVideoUI, 120);
});


function initPanelLayout() {
  const track = document.getElementById("panelsTrack");
  if (!track) return;
  track.style.display = "flex";
  track.style.width = `${TOTAL_PANELS * 100}%`;
  track.style.maxWidth = "none";
  track.style.gridTemplateColumns = "none";
  document.querySelectorAll(".panel").forEach((panel, i, arr) => {
    panel.style.flex = `0 0 ${100 / TOTAL_PANELS}%`;
    panel.style.maxWidth = `${100 / TOTAL_PANELS}%`;
    panel.style.borderRight = i === arr.length - 1 ? "none" : "1px solid var(--border)";
  });
  goToPanel(typeof currentPanel === "number" ? currentPanel : 0);
}

window.addEventListener("load", () => {
  setTimeout(initPanelLayout, 50);
});
window.addEventListener("resize", initPanelLayout);
