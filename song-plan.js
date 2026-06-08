"use strict";

let GEMINI_CHAT_MODEL = "gemini-2.5-flash";
let GEMINI_IMAGE_MODELS = [];
let GEMINI_TTS_MODELS = [];

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
    songDuration: 310,
    customLyrics: true, vocalStyles: ["female","male","duet","choir"],
    allGenres: true, moodControl: true, instrumental: true, khmerStyle: "premium",
    downloadMP3: true, songHistory: -1, regenerate: true,
    audioQuality: "latest_lyria_pro", audioWatermark: false
  }
};

let currentPanel = 0;
let userPlan = "free";
let proCustomKey = "";
let useOwnKey = false;
let _ownKeyOn = false;
let _refImgs = [];
let requestCount = 0;
let chatHistory = [];
let isChatLoading = false;
let touchStartX = 0;
let touchStartY = 0;
let currentUser = null;
let pendingAction = null;
let _otpPending = null;
let _resendTimer = null;
let authToken = null;
let _chatFileData = null, _chatFileMime = null, _chatFileName = null;
let _forceKhmer = false;

function checkQuota() {
  if (!currentUser) { openAuthModal(null); return false; }
  const limit = PLAN_LIMITS[userPlan]?.requests ?? 20;
  if (limit < 0 || limit >= 9999) return true;
  if (requestCount >= limit) { showUpgradeModal(); return false; }
  return true;
}
function incrementRequest() { requestCount++; }
function autoResize(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 100) + "px"; }
function handleChatKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function formatTime(d) { return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function appendTyping() {
  const wrap = document.getElementById('chatMessages');
  const id = 'typing-' + Date.now();
  const el = document.createElement('div');
  el.className = 'msg msg-bot';
  el.id = id;
  el.innerHTML = `<div class="msg-avatar"><i class="fas fa-brain"></i></div><div class="msg-bubble"><p>Typing...</p></div>`;
  wrap?.appendChild(el);
  wrap?.scrollTo({ top: wrap.scrollHeight, behavior: 'smooth' });
  return id;
}
function removeTyping(id) { const el = document.getElementById(id); if (el) el.remove(); }
function appendMessage(role, text) {
  const wrap = document.getElementById('chatMessages');
  if (!wrap) return;
  const isUser = role === 'user';
  const el = document.createElement('div');
  el.className = 'msg ' + (isUser ? 'msg-user' : 'msg-bot');
  el.innerHTML = `${isUser ? '' : '<div class="msg-avatar"><i class="fas fa-brain"></i></div>'}<div class="msg-bubble"><p>${escapeHtml(text)}</p><span class="msg-time">${formatTime(new Date())}</span></div>`;
  wrap.appendChild(el);
  wrap.scrollTo({ top: wrap.scrollHeight, behavior: 'smooth' });
}
function clearChatFile() {
  _chatFileData = null; _chatFileMime = null; _chatFileName = null;
  const p = document.getElementById('chatFilePreview');
  if (p) p.style.display = 'none';
}
function sendChat() {
  if (!currentUser) { openAuthModal('chat'); return; }
  _sendChat();
}
async function _sendChat() {
  if (isChatLoading) return;
  if (!checkQuota()) return;
  const input = document.getElementById('chatInput');
  const text = (input?.value || '').trim();
  if (!text && !_chatFileData) return;
  const displayText = text || (_chatFileName ? `[File] ${_chatFileName}` : '');
  appendMessage('user', displayText);
  if (input) { input.value = ''; input.style.height = 'auto'; }
  isChatLoading = true;
  const sendBtn = document.getElementById('chatSendBtn');
  if (sendBtn) sendBtn.disabled = true;
  const P = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  const khmerSuffix = (_forceKhmer && P.forceKhmer) ? "\n\nIMPORTANT: Reply ONLY in Khmer language. Do not use English." : "";
  const userParts = [{ text: text + khmerSuffix }];
  if (_chatFileData && _chatFileMime) userParts.push({ inlineData: { mimeType: _chatFileMime, data: _chatFileData } });
  const sysPromptEl = document.getElementById('chatSystemPrompt');
  const sysPromptVal = (P.customSystemPrompt && sysPromptEl?.value.trim()) ? sysPromptEl.value.trim() : 'You are JeeThy Assistant, a helpful and friendly AI created by JeeThy Labs. Answer in the same language the user writes in. Be concise but thorough. Use markdown for formatting when useful.';
  chatHistory.push({ role: 'user', parts: userParts });
  const typingId = appendTyping();
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    const res = await fetch('/api/chat', { method: 'POST', headers, credentials: 'include', body: JSON.stringify({ history: chatHistory, model: GEMINI_CHAT_MODEL, system: sysPromptVal }) });
    const data = await res.json();
    clearChatFile();
    removeTyping(typingId);
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const reply = data.reply || 'Sorry, could not generate a response.';
    chatHistory.push({ role: 'model', parts: [{ text: reply }] });
    appendMessage('bot', reply);
    incrementRequest();
  } catch (err) {
    clearChatFile();
    removeTyping(typingId);
    appendMessage('bot', err.message || 'Chat failed.');
  } finally {
    isChatLoading = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}


const VIDEO_PLAN_RULES = {
  free: { daily: 1, refs: false },
  pro: { daily: 3, refs: true },
  proplus: { daily: 10, refs: true },
  max: { daily: Infinity, refs: true }
};

function getDailyVideoLimit(plan) {
  return (VIDEO_PLAN_RULES[plan] || VIDEO_PLAN_RULES.free).daily;
}

function canUseVideoRefs(plan) {
  return !!((VIDEO_PLAN_RULES[plan] || VIDEO_PLAN_RULES.free).refs);
}

if (typeof window !== "undefined") {
  window.VIDEO_PLAN_RULES = VIDEO_PLAN_RULES;
  window.getDailyVideoLimit = getDailyVideoLimit;
  window.canUseVideoRefs = canUseVideoRefs;
}
