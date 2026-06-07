'use strict';
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');

const app = express();

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'jeethylabs_secret_2026';
const SESSION_SECRET = process.env.SESSION_SECRET || JWT_SECRET;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const PORT = process.env.PORT || 8080;

const PLAN_CONFIG = {
  free: {
    durationHint: 'under 1 minute (target: ~55 seconds). CRITICAL: must end before 60 seconds.',
    durationSeconds: 55,
    structureHint: 'Short Instrumental Intro (8s) -> Verse (20s) -> Chorus (18s) -> Short Outro (9s) â€” total: ~55s',
    customLyrics: false,
    chatMsgDay: 20,
    imgDay: 5,
    songDay: 3,
    imgResolution: '720x720',
    audioQuality: 'standard',
  },
  pro: {
    durationHint: 'between 2 minutes 50 seconds and 3 minutes 05 seconds (target: 3 minutes). CRITICAL: must be at least 2:50.',
    durationSeconds: 180,
    structureHint: 'Instrumental Intro (20s) -> Verse 1 (30s) -> Pre-Chorus (10s) -> Chorus (25s) -> Break (20s) -> Verse 2 (25s) -> Chorus (25s) -> Final Chorus (20s) -> Outro (15s) â€” total: ~2:50-3:05',
    customLyrics: true,
    chatMsgDay: 100,
    imgDay: 25,
    songDay: 15,
    imgResolution: '1024x1024',
    audioQuality: 'high',
  },
  proplus: {
    durationHint: 'between 3 minutes 00 seconds and 3 minutes 25 seconds (target: 3:15). CRITICAL: must be at least 3:00.',
    durationSeconds: 200,
    structureHint: 'Extended Intro (25s) -> Verse 1 (30s) -> Pre-Chorus (12s) -> Chorus (25s) -> Break (22s) -> Verse 2 (28s) -> Pre-Chorus (12s) -> Chorus (25s) -> Bridge (15s) -> Final Chorus (25s) -> Outro (25s) â€” total: ~3:00-3:25',
    customLyrics: true,
    chatMsgDay: -1,
    imgDay: 150,
    songDay: 100,
    imgResolution: '2048x2048',
    audioQuality: 'best',
  },
  max: {
    durationHint: 'over 4 minutes 50 seconds when possible (target: ~5:10). IMPORTANT: current Lyria Pro models may not reliably sustain this full duration, so always try the latest available Lyria Pro model first and then hard-trim only if output exceeds 5:25.',
    durationSeconds: 310,
    minDurationSeconds: 290,
    structureHint: 'Extended Intro (35s) -> Verse 1 (40s) -> Pre-Chorus (18s) -> Chorus (32s) -> Break (30s) -> Verse 2 (40s) -> Pre-Chorus (18s) -> Chorus (32s) -> Bridge (24s) -> Solo (28s) -> Final Chorus (36s) -> Extended Outro (42s) â€” target total: ~4:50-5:20',
    customLyrics: true,
    chatMsgDay: -1,
    imgDay: -1,
    songDay: -1,
    imgResolution: '3840x2160',
    audioQuality: 'latest_lyria_pro',
  },
};

app.use(cors({ origin: true, credentials: true }));
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
    if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=UTF-8');
  }
}));

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.connect().then(c => { c.release(); initDb(); }).catch(e => console.error('DB Error:', e.message));

async function initDb() {
  const migrations = [
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      name TEXT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      email_verified BOOLEAN DEFAULT false,
      avatar_url TEXT,
      plan VARCHAR(32) DEFAULT 'free',
      status VARCHAR(32) DEFAULT 'active',
      country VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_active TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(32) DEFAULT 'free'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'active'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(64)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_plan VARCHAR(20)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); } catch (e) { console.error('[initDb]', e.message); }
  }
}

const otpStore = {};
const genOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
async function sendEmail(to, subject, html) {
  return transporter.sendMail({ from: `"JeeThy Labs" <${FROM_EMAIL}>`, to, subject, html });
}
function auth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : (req.session?.token) || (req.cookies?.jl_token) || null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}
async function getUserPlan(userId) {
  try {
    const { rows } = await pool.query('SELECT plan, plan_expires_at FROM users WHERE id=$1', [userId]);
    if (!rows.length) return 'free';
    const u = rows[0];
    const raw = (u.plan || 'free').toLowerCase().trim();
    if (raw !== 'free' && u.plan_expires_at && new Date(u.plan_expires_at) < new Date()) {
      await pool.query(`UPDATE users SET plan='free', plan_expires_at=NULL, updated_at=NOW() WHERE id=$1`, [userId]);
      return 'free';
    }
    return PLAN_CONFIG[raw] ? raw : 'free';
  } catch {
    return 'free';
  }
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', smtp: !!SMTP_USER && !!SMTP_PASS, gemini: !!GEMINI_KEY }));
app.get('/api/key', (req, res) => res.status(403).json({ error: 'Direct API key access is disabled.' }));

app.post('/api/send-otp', async (req, res) => {
  const { email, name, password } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const otp = genOTP();
  otpStore[email] = { otp, name: name || '', password: password || '', expires: Date.now() + 10 * 60 * 1000 };
  try {
    await sendEmail(email, 'Your Verification Code - JeeThy Labs', `<div><h2>JeeThy Labs</h2><p>Hello ${name || 'there'}</p><p>Your code is <b>${otp}</b></p></div>`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to send code: ' + e.message }); }
});

app.post('/api/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const rec = otpStore[email];
  if (!rec) return res.status(400).json({ error: 'No OTP found. Request a new one.' });
  if (Date.now() > rec.expires) { delete otpStore[email]; return res.status(400).json({ error: 'OTP expired.' }); }
  if (rec.otp !== String(otp || '').trim()) return res.status(400).json({ error: 'Invalid OTP.' });
  const rawPw = req.body.password || rec.password || '';
  if (!rawPw) return res.status(400).json({ error: 'Password missing.' });
  delete otpStore[email];
  try {
    const hash = await bcrypt.hash(rawPw, 10);
    const userName = req.body.name || rec.name || 'User';
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, plan, status, email_verified, avatar_url, country, created_at, last_active, updated_at)
       VALUES ($1, $2, $3, 'free', 'active', true, null, null, NOW(), NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, last_active=NOW(), updated_at=NOW()
       RETURNING id, user_id, name, email, plan, status, avatar_url, created_at`,
      [userName, email, hash]
    );
    const u = rows[0];
    const token = jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '30d' });
    req.session.token = token;
    res.cookie('jl_token', token, { httpOnly: false, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, token, user: { id: u.id, name: u.name, email: u.email, plan: u.plan || 'free', avatar_url: u.avatar_url || null, created_at: u.created_at } });
  } catch (e) { res.status(500).json({ error: 'Registration failed: ' + e.message }); }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const { rows } = await pool.query('SELECT id, name, email, password_hash, plan, avatar_url, created_at FROM users WHERE email = $1', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Email not found.' });
    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'Wrong password.' });
    await pool.query('UPDATE users SET last_active = NOW(), updated_at = NOW() WHERE id = $1', [u.id]);
    const token = jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '30d' });
    req.session.token = token;
    res.cookie('jl_token', token, { httpOnly: false, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, token, user: { id: u.id, name: u.name, email: u.email, plan: u.plan || 'free', avatar_url: u.avatar_url || null, created_at: u.created_at } });
  } catch (e) { res.status(500).json({ error: 'Login failed: ' + e.message }); }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id,user_id,name,email,avatar_url,plan,status,created_at,last_active FROM users WHERE id=$1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload-avatar', auth, async (req, res) => {
  const { avatar_url } = req.body;
  if (!avatar_url) return res.status(400).json({ error: 'No avatar data' });
  try {
    await pool.query('UPDATE users SET avatar_url=$1, last_active=NOW(), updated_at=NOW() WHERE id=$2', [avatar_url, req.user.id]);
    res.json({ success: true, avatar_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {});
  res.clearCookie('connect.sid');
  res.clearCookie('jl_token');
  res.json({ success: true });
});

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
function geminiKey() {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY is not set in Railway environment variables.');
  return GEMINI_KEY;
}
let _modelsCache = null, _modelsCacheTime = 0;
const MODELS_TTL = 10 * 60 * 1000;
async function fetchAvailableModels(key) {
  const now = Date.now();
  if (_modelsCache && now - _modelsCacheTime < MODELS_TTL) return _modelsCache;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`);
  if (!r.ok) throw new Error(`ListModels HTTP ${r.status}`);
  const data = await r.json();
  const models = (data.models || []).map(m => ({ name: m.name?.replace('models/', '') || '', displayName: m.displayName || '', supportedMethods: m.supportedGenerationMethods || [] }));
  _modelsCache = models;
  _modelsCacheTime = now;
  return models;
}
function classifyModels(models) {
  const gc = models.filter(m => m.supportedMethods.includes('generateContent'));
  const imageModels = gc.filter(m => /image.gen|imagen|flash.*image|image.*flash/i.test(m.name));
  const lyriaModels = gc.filter(m => /lyria/i.test(m.name) || /lyria/i.test(m.displayName));
  const ttsModels = gc.filter(m => /tts|text.to.speech/i.test(m.name));
  const chatModels = gc.filter(m => !imageModels.includes(m) && !ttsModels.includes(m) && !lyriaModels.includes(m));
  return { imageModels, lyriaModels, ttsModels, chatModels };
}
app.get('/api/models', async (req, res) => {
  try {
    const all = await fetchAvailableModels(geminiKey());
    const { imageModels, lyriaModels, ttsModels, chatModels } = classifyModels(all);
    const sortedLyria = [...lyriaModels].sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    res.json({
      all,
      imageModels: imageModels.map(m => m.name),
      lyriaModels: sortedLyria.map(m => m.name),
      ttsModels: ttsModels.map(m => m.name),
      chatModels: chatModels.map(m => m.name),
      recommended: {
        chat: chatModels.find(m => /2\.5.flash/i.test(m.name))?.name || 'gemini-2.5-flash',
        image: imageModels[0]?.name || null,
        lyria: sortedLyria.find(m => /pro/i.test(m.name))?.name || sortedLyria[0]?.name || 'lyria-3-pro-preview',
        tts: ttsModels.find(m => /flash/i.test(m.name))?.name || ttsModels[0]?.name || null,
      },
    });
  } catch (e) {
    res.json({ all: [], imageModels: [], lyriaModels: [], ttsModels: [], chatModels: ['gemini-2.5-flash'], recommended: { chat: 'gemini-2.5-flash', image: null, lyria: 'lyria-3-pro-preview', tts: null }, error: e.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const key = geminiKey();
    const history = req.body.history || req.body.contents || [];
    const model = req.body.model || 'gemini-2.5-flash';
    const system = req.body.system || 'You are JeeThy Assistant, a helpful AI by JeeThy Labs. Answer in the same language the user uses. Be concise and clear.';
    const CHAT_MODELS = [model, 'gemini-2.5-flash', 'gemini-2.0-flash'];
    const tried = new Set();
    let lastErr = null;
    for (const m of CHAT_MODELS) {
      if (!m || tried.has(m)) continue;
      tried.add(m);
      try {
        const r = await fetch(`${GEMINI}/${m}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents: history }),
        });
        const d = await r.json();
        if (!r.ok) {
          lastErr = d.error?.message || `HTTP ${r.status}`;
          continue;
        }
        return res.json({ reply: d.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.', model: m });
      } catch (e) {
        lastErr = e.message;
      }
    }
    res.status(503).json({ error: lastErr || 'All chat models unavailable.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function safeJson(response, label) {
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await response.text();
    throw new Error(`[${label}] non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}
async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 1; i <= maxAttempts; i++) {
    try { return await fn(i); }
    catch (err) {
      lastErr = err;
      const retryable = /overload|high demand|quota|rate.?limit|503|429/i.test(err.message || '');
      if (!retryable || i === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, i - 1)));
    }
  }
  throw lastErr;
}
function cleanLyricsText(raw) {
  if (!raw) return '';
  return raw.replace(/^\s*(mosic|bpm|duration_secs|good_crop|tempo|key|time_signature|mood|energy)\s*:.*$/gim, '').replace(/\[\[AO\]\]/gi, '').replace(/\[\[.*?\]\]/g, '').replace(/^---+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
function trimAudioBuffer(base64, seconds, mimeType) { return base64; }

app.post('/api/image', async (req, res) => {
  try {
    const key = geminiKey();
    const { prompt, style = '', aspectRatio = '1:1', quality = 720, referenceImageBase64, referenceImageMime, extraRefImages = [] } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const VALID_RATIOS = { '1:1': '1:1', '9:16': '9:16', '16:9': '16:9' };
    const mappedRatio = VALID_RATIOS[aspectRatio] || '1:1';
    const orientHint = mappedRatio === '9:16' ? ', portrait orientation, vertical composition, tall image' : mappedRatio === '16:9' ? ', landscape orientation, wide composition, horizontal image' : '';
    const fullPrompt = style && style.toLowerCase() !== 'none' ? `${prompt}, style: ${style}${orientHint}` : `${prompt}${orientHint}`;
    let IMAGE_MODELS = ['imagen-3.0-generate-002', 'imagen-3.0-generate-001', 'gemini-2.0-flash-preview-image-generation', 'gemini-2.0-flash'];
    try {
      const m = classifyModels(await fetchAvailableModels(key));
      if (m.imageModels.length) IMAGE_MODELS = m.imageModels.map(x => x.name);
    } catch {}
    let lastErr = null;
    for (const model of IMAGE_MODELS) {
      try {
        const img = await withRetry(async () => {
          const genConfig = { responseModalities: ['IMAGE', 'TEXT'] };
          if (/imagen/i.test(model)) {
            genConfig.outputOptions = { mimeType: 'image/jpeg', compressionQuality: quality >= 1280 ? 95 : 85 };
            genConfig.aspectRatio = mappedRatio;
          }
          const r = await fetch(`${GEMINI}/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [
                ...(referenceImageBase64 ? [{ inlineData: { mimeType: referenceImageMime || 'image/jpeg', data: referenceImageBase64 } }] : []),
                ...(extraRefImages.length > 0 ? extraRefImages.map(v => ({ inlineData: { mimeType: v.mime || 'image/jpeg', data: v.base64 } })) : []),
                { text: referenceImageBase64 ? 'Using the uploaded image as a visual reference (keep the same person/face/body), ' + fullPrompt : fullPrompt }
              ] }],
              generationConfig: genConfig,
            }),
          });
          const d = await safeJson(r, `/api/image ${model}`);
          if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
          for (const c of d.candidates || []) for (const p of c.content?.parts || []) if (p.inlineData?.data) return p.inlineData;
          throw new Error(`No image from ${model}`);
        }, { maxAttempts: 3, baseDelayMs: 1500 });
        return res.json({ data: img.data, mimeType: img.mimeType || 'image/png', aspectRatio: mappedRatio });
      } catch (err) { lastErr = err; }
    }
    res.status(500).json({ error: lastErr?.message || 'Image generation failed.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const LYRIA_MODELS_FALLBACK = ['lyria-3-pro-preview'];
const TTS_MODELS_FALLBACK = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'];
async function tryTts(key, text, voiceName) {
  let ttsModels = [...TTS_MODELS_FALLBACK];
  try {
    const m = classifyModels(await fetchAvailableModels(key));
    if (m.ttsModels.length) ttsModels = [...m.ttsModels.map(x => x.name), ...TTS_MODELS_FALLBACK];
  } catch {}
  ttsModels = [...new Set(ttsModels)];
  for (const model of ttsModels) {
    try {
      const result = await withRetry(async () => {
        const r = await fetch(`${GEMINI}/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
          }),
        });
        const d = await safeJson(r, `TTS/${model}`);
        if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
        for (const c of d.candidates || []) for (const p of c.content?.parts || []) if (p.inlineData?.data) return { data: p.inlineData.data, mimeType: p.inlineData.mimeType || 'audio/wav', model };
        throw new Error(`No TTS audio from ${model}`);
      });
      return result;
    } catch {}
  }
  return null;
}

app.get('/api/song/plan-info', auth, async (req, res) => {
  const planKey = await getUserPlan(req.user.id);
  const planCfg = PLAN_CONFIG[planKey];
  res.json({ plan: planKey, durationHint: planCfg.durationHint, customLyrics: planCfg.customLyrics });
});

app.post('/api/song', auth, async (req, res) => {
  try {
    const key = geminiKey();
    const planKey = await getUserPlan(req.user.id);
    const planCfg = PLAN_CONFIG[planKey] || PLAN_CONFIG.free;
    const { prompt = '', style = 'Pop', voice = 'Female', instrument = '', tempo = '', mood = '', customLyrics = '' } = req.body || {};
    if (!prompt.trim() && !String(customLyrics || '').trim()) return res.status(400).json({ error: 'Song prompt is required.' });

    const all = await fetchAvailableModels(key);
    const classified = classifyModels(all);
    const lyriaModels = [...new Set([
      ...classified.lyriaModels.map(x => x.name).sort((a, b) => b.localeCompare(a)),
      ...LYRIA_MODELS_FALLBACK
    ])];

    const voiceHint = String(voice || 'Female');
    const ttsVoice = /male/i.test(voiceHint) ? 'Kore' : 'Aoede';
    let lyricsText = String(customLyrics || '').trim();
    let audioResult = null;
    let usedModel = '';

    const musicPrompt = [
      `Create a full ${style} song.`,
      `Theme: ${prompt || customLyrics}.`,
      `Vocal style: ${voiceHint}.`,
      instrument ? `Featured instruments: ${instrument}.` : '',
      tempo ? `Tempo: ${tempo}.` : '',
      mood ? `Mood: ${mood}.` : '',
      `Song duration target: ${planCfg.durationHint}`,
      `Song structure: ${planCfg.structureHint}`,
      planKey === 'max'
        ? 'Use the latest and highest-capability Lyria Pro model available. Favor a long-form arrangement above 4:50 whenever the model allows. Do not shorten unless the model naturally stops earlier.'
        : 'Keep the arrangement aligned to the target plan duration.',
      customLyrics ? 'Use the provided lyrics/theme faithfully.' : 'Write original lyrics that fit the requested theme and structure.',
    ].filter(Boolean).join('\n');

    async function lyriaCall(modelName, promptText) {
      const r = await fetch(`${GEMINI}/${modelName}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: { responseModalities: ['AUDIO', 'TEXT'], temperature: 1.0 },
        }),
      });
      const d = await safeJson(r, `Lyria/${modelName}`);
      if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
      let txt = '';
      let audio = null;
      for (const c of d.candidates || []) {
        for (const p of c.content?.parts || []) {
          if (p.text) txt = p.text;
          if (p.inlineData?.data) audio = p.inlineData;
        }
      }
      if (!audio) throw new Error('No audio returned from ' + modelName);
      return { txt, audio };
    }

    for (const model of lyriaModels) {
      try {
        const result = await lyriaCall(model, musicPrompt);
        lyricsText = result.txt || lyricsText;
        const mime = result.audio.mimeType || 'audio/l16;rate=24000';
        const maxTrim = planKey === 'free' ? 60 : planKey === 'pro' ? 185 : planKey === 'proplus' ? 210 : 325;
        audioResult = { data: trimAudioBuffer(result.audio.data, maxTrim, mime), mimeType: mime };
        usedModel = model;
        break;
      } catch (err) {
        usedModel = '';
      }
    }

    if (!audioResult) {
      if (!lyricsText) {
        const lyricPrompt = [
          `Write a complete original ${style} song about: "${prompt}".`,
          `Vocalist: ${voiceHint}. Genre: ${style}.`,
          `Start with "Title: <song name>" on the first line.`,
          `Then write: ${planCfg.structureHint}.`,
          planKey === 'free' ? 'Keep it SHORT - under 1 minute worth of lyrics.' : `Full-length: ${planCfg.durationHint} worth of lyrics.`,
          'Write only the song - no commentary.',
        ].join('\n');
        try {
          const lr = await fetch(`${GEMINI}/gemini-2.5-flash:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: lyricPrompt }] }] }),
          });
          const ld = await safeJson(lr, 'lyrics-gen');
          if (lr.ok) lyricsText = ld.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } catch {}
      }
      if (lyricsText) {
        const cleanLyrics = lyricsText.replace(/^Title:.*$/im, '').trim();
        const ttsRes = await tryTts(key, cleanLyrics, ttsVoice);
        if (ttsRes) {
          audioResult = { data: ttsRes.data, mimeType: ttsRes.mimeType };
          usedModel = ttsRes.model;
        }
      }
    }

    const cleanedLyrics = cleanLyricsText(lyricsText);
    const titleMatch = cleanedLyrics.match(/^Title:\s*(.+)$/im);
    const songTitle = titleMatch ? titleMatch[1].trim() : `${style} Song`;
    const isLyria = usedModel.includes('lyria');

    return res.json({
      audio: audioResult ? audioResult.data : null,
      mimeType: audioResult ? (audioResult.mimeType || 'audio/mp3') : 'audio/mp3',
      title: songTitle,
      lyrics: cleanedLyrics,
      lyricsOnly: !audioResult,
      audioSource: usedModel ? (isLyria ? `Lyria (${usedModel})` : `TTS (${usedModel})`) : null,
      plan: planKey,
      ttsMessage: !audioResult ? 'Audio generation temporarily unavailable. Your lyrics are ready - please try again shortly.' : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`JeeThy Labs -> port ${PORT}`));
