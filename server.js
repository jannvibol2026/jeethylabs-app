'use strict';
const express    = require('express');
const session    = require('express-session');
const { Pool }   = require('pg');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cors       = require('cors');
const path       = require('path');

const app = express();

/* â”€â”€ ENV â”€â”€ */
const DATABASE_URL  = process.env.DATABASE_URL;
const JWT_SECRET    = process.env.JWT_SECRET    || 'jeethylabs_secret_2026';
const SESSION_SECRET= process.env.SESSION_SECRET|| JWT_SECRET;
const SMTP_USER     = process.env.SMTP_USER     || '';
const SMTP_PASS     = process.env.SMTP_PASS     || '';
const FROM_EMAIL    = process.env.FROM_EMAIL    || SMTP_USER;
const GEMINI_KEY    = process.env.GEMINI_API_KEY|| '';
const PORT          = process.env.PORT          || 8080;

/* â”€â”€ CORS â”€â”€ */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

/* â”€â”€ SESSION â”€â”€ */
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname)));

console.log('=== JeeThy Labs Starting ===');
console.log('SMTP_USER:',  SMTP_USER  || 'MISSING');
console.log('SMTP_PASS:',  SMTP_PASS  ? 'SET' : 'MISSING');
console.log('GEMINI_KEY:', GEMINI_KEY ? 'SET âœ…' : 'âŒ MISSING â€” add GEMINI_API_KEY in Railway');

/* â”€â”€ SMTP â”€â”€ */
const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com', port: 587, secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});
transporter.verify(err => err
  ? console.error('SMTP Error:', err.message)
  : console.log('Brevo SMTP Ready âœ…'));

/* â”€â”€ DB â”€â”€ */
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.connect()
  .then(c => { console.log('DB Connected âœ…'); c.release(); initDb(); })
  .catch(e => console.error('DB Error:', e.message));

async function initDb() {
  const migrations = [
    `CREATE TABLE IF NOT EXISTS users (
       id            SERIAL PRIMARY KEY,
       user_id       TEXT,
       name          TEXT,
       email         TEXT UNIQUE NOT NULL,
       password_hash TEXT,
       email_verified BOOLEAN DEFAULT false,
       avatar_url    TEXT,
       plan          VARCHAR(32)  DEFAULT 'free',
       status        VARCHAR(32)  DEFAULT 'active',
       country       VARCHAR(64),
       created_at    TIMESTAMPTZ  DEFAULT NOW(),
       last_active   TIMESTAMPTZ  DEFAULT NOW()
     )`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url   TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan         VARCHAR(32)  DEFAULT 'free'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS status       VARCHAR(32)  DEFAULT 'active'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS country      VARCHAR(64)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ  DEFAULT NOW()`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active  TIMESTAMPTZ  DEFAULT NOW()`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN    DEFAULT false`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id      TEXT`,
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); }
    catch (e) { console.error('[initDb] migration error:', e.message); }
  }
  console.log('DB schema ready âœ…');
}

/* â”€â”€ HELPERS â”€â”€ */
const otpStore = {};
const genOTP   = () => Math.floor(100000 + Math.random() * 900000).toString();

async function sendEmail(to, subject, html) {
  const info = await transporter.sendMail({ from: `"JeeThy Labs" <${FROM_EMAIL}>`, to, subject, html });
  console.log('[email] sent to', to, '| id:', info.messageId);
  return info;
}

/* â”€â”€ AUTH MIDDLEWARE â”€â”€ */
function auth(req, res, next) {
  const hdr   = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : (req.session && req.session.token) || null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   AUTH ROUTES
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  smtp:   !!SMTP_USER && !!SMTP_PASS,
  gemini: !!GEMINI_KEY
}));

app.get('/api/key', (req, res) => {
  if (!GEMINI_KEY) return res.status(503).json({ error: 'API key not configured', key: '' });
  res.json({ key: GEMINI_KEY });
});

app.post('/api/send-otp', async (req, res) => {
  const { email, name, password } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const otp = genOTP();
  otpStore[email] = { otp, name: name||'', password: password||'', expires: Date.now() + 10*60*1000 };
  console.log('[otp] â†’', email, '| code:', otp);
  try {
    await sendEmail(email, 'Your Verification Code - JeeThy Labs',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#7c3aed;">JeeThy Labs</h2>
        <p>Hi <strong>${name||'there'}</strong>,</p>
        <p>Your verification code:</p>
        <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#7c3aed;text-align:center;padding:20px 0;">${otp}</div>
        <p style="color:#888;font-size:13px;">Expires in <strong>10 minutes</strong>.</p>
      </div>`);
    res.json({ success: true });
  } catch (e) {
    console.error('[otp] error:', e.message);
    res.status(500).json({ error: 'Failed to send code: ' + e.message });
  }
});

app.post('/api/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const rec = otpStore[email];
  if (!rec)                              return res.status(400).json({ error: 'No OTP found. Request a new one.' });
  if (Date.now() > rec.expires)          { delete otpStore[email]; return res.status(400).json({ error: 'OTP expired.' }); }
  if (rec.otp !== String(otp||'').trim()) return res.status(400).json({ error: 'Invalid OTP.' });
  const rawPw = req.body.password || rec.password || '';
  if (!rawPw) return res.status(400).json({ error: 'Password missing.' });
  delete otpStore[email];
  try {
    const hash = await bcrypt.hash(rawPw, 10);
    const now  = new Date();
    const { rows } = await pool.query(
      `INSERT INTO users (name,email,password_hash,plan,status,email_verified,avatar_url,country,created_at,last_active)
       VALUES ($1,$2,$3,'free','active',true,null,null,$4,$4)
       ON CONFLICT (email) DO UPDATE SET name=$1,password_hash=$3,last_active=$4
       RETURNING id,user_id,name,email,plan,status,avatar_url,created_at`,
      [req.body.name||rec.name||'User', email, hash, now]);
    const u = rows[0];
    const token = jwt.sign({ id:u.id, email:u.email }, JWT_SECRET, { expiresIn:'30d' });
    req.session.token = token;
    res.json({ success:true, token, user:{ id:u.id, name:u.name, email:u.email, plan:u.plan||'free', avatar_url:u.avatar_url||null, created_at:u.created_at } });
  } catch (e) {
    console.error('[verify-otp]', e.message);
    res.status(500).json({ error: 'Registration failed: ' + e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Email not found.' });
    const u = rows[0];
    if (!u.password_hash) return res.status(401).json({ error: 'Account has no password. Please sign up again.' });
    if (!await bcrypt.compare(password||'', u.password_hash)) return res.status(401).json({ error: 'Wrong password.' });
    await pool.query('UPDATE users SET last_active=$1 WHERE id=$2', [new Date(), u.id]);
    const token = jwt.sign({ id:u.id, email:u.email }, JWT_SECRET, { expiresIn:'30d' });
    req.session.token = token;
    res.json({ success:true, token, user:{ id:u.id, name:u.name, email:u.email, plan:u.plan||'free', avatar_url:u.avatar_url||null, created_at:u.created_at } });
  } catch (e) {
    res.status(500).json({ error: 'Login failed: ' + e.message });
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,user_id,name,email,avatar_url,plan,status,created_at,last_active FROM users WHERE id=$1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  const { rows } = await pool.query('SELECT id FROM users WHERE email=$1', [email]).catch(()=>({rows:[]}));
  if (!rows.length) return res.status(404).json({ error: 'Email not found.' });
  const otp = genOTP();
  otpStore[email] = { otp, expires: Date.now() + 10*60*1000, type:'reset' };
  try {
    await sendEmail(email, 'Password Reset - JeeThy Labs',
      `<div style="font-family:Arial;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#7c3aed;">Reset Your Password</h2>
        <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#7c3aed;text-align:center;padding:20px 0;">${otp}</div>
        <p style="color:#888;font-size:13px;">Expires in <strong>10 minutes</strong>.</p>
      </div>`);
    res.json({ success:true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const rec = otpStore[email];
  if (!rec || rec.otp !== String(otp||'').trim() || Date.now() > rec.expires) {
    delete otpStore[email];
    return res.status(400).json({ error: 'Invalid or expired code.' });
  }
  delete otpStore[email];
  try {
    const hash = await bcrypt.hash(newPassword||'', 10);
    await pool.query('UPDATE users SET password_hash=$1 WHERE email=$2', [hash, email]);
    res.json({ success:true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/profile', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,user_id,name,email,avatar_url,plan,status,country,created_at,last_active FROM users WHERE id=$1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/profile', auth, async (req, res) => {
  const { avatar_url, country, name } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE users SET avatar_url=COALESCE($1,avatar_url),country=COALESCE($2,country),name=COALESCE($3,name),last_active=$4
       WHERE id=$5 RETURNING id,name,email,avatar_url,plan,status,country,created_at`,
      [avatar_url||null, country||null, name||null, new Date(), req.user.id]);
    res.json({ success:true, user: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/avatar', auth, async (req, res) => {
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ error: 'No avatar data' });
  try {
    await pool.query('UPDATE users SET avatar_url=$1,last_active=$2 WHERE id=$3', [avatar, new Date(), req.user.id]);
    res.json({ success:true, avatar_url: avatar });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload-avatar', auth, async (req, res) => {
  const { avatar_url } = req.body;
  if (!avatar_url) return res.status(400).json({ error: 'No avatar data' });
  try {
    await pool.query('UPDATE users SET avatar_url=$1,last_active=$2 WHERE id=$3', [avatar_url, new Date(), req.user.id]);
    res.json({ success:true, avatar_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {});
  res.clearCookie('connect.sid');
  res.json({ success: true });
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   GEMINI PROXY ROUTES
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

function geminiKey() {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY is not set in Railway environment variables.');
  return GEMINI_KEY;
}

/* â”€â”€ Model discovery cache â”€â”€ */
let _modelsCache     = null;
let _modelsCacheTime = 0;
const MODELS_CACHE_TTL = 10 * 60 * 1000;

async function fetchAvailableModels(key) {
  const now = Date.now();
  if (_modelsCache && (now - _modelsCacheTime) < MODELS_CACHE_TTL) return _modelsCache;
  console.log('[models] Fetching available models...');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`ListModels failed (HTTP ${r.status}): ${text.slice(0, 200)}`);
  }
  const data = await r.json();
  const models = (data.models || []).map(m => ({
    name:             m.name?.replace('models/', '') || '',
    displayName:      m.displayName || '',
    supportedMethods: m.supportedGenerationMethods || [],
  }));
  _modelsCache     = models;
  _modelsCacheTime = now;
  console.log(`[models] Discovered ${models.length} models`);
  return models;
}

function classifyModels(models) {
  const generateContent = models.filter(m => m.supportedMethods.includes('generateContent'));
  const imageModels = generateContent.filter(m =>
    /image.gen|imagen|flash.*image|image.*flash/i.test(m.name) ||
    /image.gen|imagen/i.test(m.displayName)
  );
  const lyriaModels = generateContent.filter(m =>
    /lyria/i.test(m.name) || /lyria/i.test(m.displayName)
  );
  const ttsModels = generateContent.filter(m =>
    /tts|text.to.speech/i.test(m.name) ||
    /tts|text.to.speech/i.test(m.displayName)
  );
  const chatModels = generateContent.filter(m =>
    !imageModels.includes(m) && !ttsModels.includes(m) && !lyriaModels.includes(m)
  );
  return { imageModels, lyriaModels, ttsModels, chatModels, all: generateContent };
}

app.get('/api/models', async (req, res) => {
  try {
    const key    = geminiKey();
    const models = await fetchAvailableModels(key);
    const { imageModels, lyriaModels, ttsModels, chatModels } = classifyModels(models);
    res.json({
      all:         models,
      imageModels: imageModels.map(m => m.name),
      lyriaModels: lyriaModels.map(m => m.name),
      ttsModels:   ttsModels.map(m => m.name),
      chatModels:  chatModels.map(m => m.name),
      recommended: {
        chat:  chatModels.find(m => /2\.5.flash/i.test(m.name))?.name || chatModels[0]?.name || 'gemini-2.5-flash',
        image: imageModels[0]?.name || null,
        lyria: lyriaModels.find(m => /pro/i.test(m.name))?.name      || lyriaModels[0]?.name || 'lyria-3-pro-preview',
        tts:   ttsModels.find(m => /flash/i.test(m.name))?.name      || ttsModels[0]?.name   || null,
      }
    });
  } catch (e) {
    console.error('[/api/models]', e.message);
    res.json({
      all: [], imageModels: [], lyriaModels: [], ttsModels: [],
      chatModels: ['gemini-2.5-flash'],
      recommended: { chat: 'gemini-2.5-flash', image: null, lyria: 'lyria-3-pro-preview', tts: null },
      error: e.message
    });
  }
});

/* /api/chat */
app.post('/api/chat', async (req, res) => {
  try {
    const key     = geminiKey();
    const history = req.body.history || [];
    const r = await fetch(`${GEMINI}/gemini-2.5-flash:generateContent?key=${key}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        system_instruction: { parts:[{ text:'You are JeeThy Assistant, a helpful AI by JeeThy Labs.\nAnswer in the same language the user uses.\nBe concise and clear.' }] },
        contents: history
      })
    });
    const d = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: d.error?.message || 'Gemini error' });
    res.json({ reply: d.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.' });
  } catch (e) {
    console.error('[/api/chat]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* â”€â”€ Retry helper â”€â”€ */
async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 1000, label = 'op' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn(attempt); }
    catch (err) {
      lastErr = err;
      const isOverload = /overload|high demand|quota|rate.?limit|503|429/i.test(err.message || '');
      if (!isOverload || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[${label}] attempt ${attempt} failed â€” retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/* â”€â”€ Safe JSON parser â”€â”€ */
async function safeJson(response, label) {
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await response.text();
    console.error(`[${label}] Non-JSON (HTTP ${response.status}):`, text.slice(0, 300));
    throw new Error(`API returned non-JSON (HTTP ${response.status}). Check API key and endpoint.`);
  }
  return response.json();
}

/* /api/image */
const IMAGE_MODEL_FALLBACKS = [
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.0-flash',
];

app.post('/api/image', async (req, res) => {
  try {
    const key = geminiKey();
    const { prompt, aspectRatio = '1:1', style = '' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const styleHint  = style && style.toLowerCase() !== 'none' ? `, style: ${style}` : '';
    const fullPrompt = `${prompt}${styleHint}`;
    console.log('[/api/image] prompt:', fullPrompt.slice(0, 120), '| aspectRatio:', aspectRatio);

    let IMAGE_MODELS;
    try {
      const allModels = await fetchAvailableModels(key);
      const { imageModels } = classifyModels(allModels);
      IMAGE_MODELS = imageModels.map(m => m.name);
      if (!IMAGE_MODELS.length) IMAGE_MODELS = IMAGE_MODEL_FALLBACKS;
      else console.log('[/api/image] models:', IMAGE_MODELS);
    } catch (catalogErr) {
      console.warn('[/api/image] catalogue error:', catalogErr.message);
      IMAGE_MODELS = IMAGE_MODEL_FALLBACKS;
    }

    let lastErr = null;
    for (const model of IMAGE_MODELS) {
      try {
        const img = await withRetry(async (attempt) => {
          if (attempt > 1) console.log(`[/api/image] ${model} retry ${attempt}`);
          const r = await fetch(`${GEMINI}/${model}:generateContent?key=${key}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: fullPrompt }] }],
              generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
            })
          });
          const d = await safeJson(r, `/api/image ${model}`);
          if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
          for (const c of (d.candidates || []))
            for (const p of (c.content?.parts || []))
              if (p.inlineData?.data) return p.inlineData;
          const reason = d.candidates?.[0]?.finishReason || 'UNKNOWN';
          if (reason === 'IMAGE_SAFETY') throw new Error('Image blocked by safety filters.');
          throw new Error(`No image returned by ${model}.`);
        }, { maxAttempts: 3, baseDelayMs: 1500, label: `/api/image ${model}` });

        return res.json({ data: img.data, mimeType: img.mimeType || 'image/png' });
      } catch (err) {
        lastErr = err;
        console.warn(`[/api/image] ${model} failed:`, err.message);
      }
    }
    res.status(500).json({ error: lastErr?.message || 'Image generation failed.' });
  } catch (e) {
    console.error('[/api/image] exception:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   /api/song â€” Lyria 3 Pro  (~2â€“3 minute full song)
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Flow:
     1. lyria-3-pro-preview  â†’ full 2-3 min song (music + vocals + lyrics)
     2. lyria-3-clip-preview â†’ 30-sec clip fallback
     3. gemini-2.5-flash-preview-tts / gemini-2.5-pro-preview-tts â†’ TTS fallback
     4. Lyrics only          â†’ if all audio methods fail
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

const LYRIA_MODELS = [
  'lyria-3-pro-preview',   // Full song 2â€“3 min | vocals + instruments + lyrics
  'lyria-3-clip-preview',  // 30-sec clip fallback
];

const TTS_MODELS = [
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
];

/* TTS fallback helper */
async function tryTts(key, ttsText, voiceName) {
  for (const model of TTS_MODELS) {
    try {
      const result = await withRetry(async (attempt) => {
        if (attempt > 1) console.log(`[/api/song] TTS ${model} retry ${attempt}`);
        console.log(`[/api/song] TTS fallback: ${model} | voice: ${voiceName}`);
        const r = await fetch(`${GEMINI}/${model}:generateContent?key=${key}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: ttsText }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
            }
          })
        });
        const d = await safeJson(r, `/api/song TTS ${model}`);
        if (!r.ok) throw new Error(d.error?.message || `TTS HTTP ${r.status}`);
        for (const c of (d.candidates || []))
          for (const p of (c.content?.parts || []))
            if (p.inlineData?.data)
              return { data: p.inlineData.data, mimeType: p.inlineData.mimeType || 'audio/wav', model };
        const reason = d.candidates?.[0]?.finishReason;
        throw new Error(`No TTS audio from ${model} (${reason || 'UNKNOWN'})`);
      }, { maxAttempts: 3, baseDelayMs: 1000, label: `/api/song TTS ${model}` });
      if (result) return result;
    } catch (err) {
      console.warn(`[/api/song] TTS ${model} exhausted:`, err.message);
    }
  }
  return null;
}

app.post('/api/song', async (req, res) => {
  try {
    const key = geminiKey();
    const { prompt, style = 'Pop', voice = 'Female' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const isFemale  = !voice.toLowerCase().includes('male') || voice.toLowerCase().includes('female');
    const voiceHint = isFemale ? 'female vocalist' : 'male vocalist';
    const ttsVoice  = isFemale ? 'Aoede' : 'Charon';

    console.log(`[/api/song] "${prompt.slice(0,80)}" | style:${style} | voice:${voiceHint}`);

    /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
       Step 1: Build rich music prompt for Lyria
       Lyria 3 Pro generates audio + lyrics together
       from a descriptive music prompt.
       Duration hint: "2 to 3 minutes" / "full-length"
    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    const musicPrompt = [
      `Create a complete, full-length original ${style} song that is approximately 2 to 3 minutes long.`,
      `Theme / description: ${prompt}`,
      `Vocalist: ${voiceHint}.`,
      `Genre: ${style}.`,
      `Song structure: Intro â†’ Verse 1 â†’ Pre-Chorus â†’ Chorus â†’ Verse 2 â†’ Pre-Chorus â†’ Chorus â†’ Bridge â†’ Final Chorus â†’ Outro.`,
      `Language: Use the same language as the theme/description.`,
      `         Fully supports Khmer (áž—áž¶ážŸáž¶ážáŸ’áž˜áŸ‚ážš), English, and mixed-language lyrics.`,
      `Audio quality: high-quality stereo, full band instrumentation, clear lead vocals, backing harmonies.`,
      `Important: Generate the FULL song from start to finish â€” do not cut short. Target duration: 2â€“3 minutes.`,
    ].join('\n');

    let audioResult = null;
    let lyricsText  = '';
    let usedModel   = '';

    /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
       Step 2: Try Lyria models
    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    for (const model of LYRIA_MODELS) {
      try {
        console.log(`[/api/song] Trying Lyria: ${model}`);

        const r = await fetch(`${GEMINI}/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: musicPrompt }] }],
            generationConfig: {
              responseModalities: ['AUDIO', 'TEXT'],
            }
          })
        });

        const d = await safeJson(r, `/api/song Lyria ${model}`);

        if (!r.ok) {
          const msg = d.error?.message || `HTTP ${r.status}`;
          console.warn(`[/api/song] Lyria ${model} HTTP error:`, msg);
          throw new Error(msg);
        }

        /* Parse parts: Lyria returns TEXT (lyrics) + AUDIO (music) */
        for (const c of (d.candidates || []))
          for (const p of (c.content?.parts || [])) {
            if (p.text)             lyricsText  = p.text;
            if (p.inlineData?.data) audioResult = p.inlineData;
          }

        if (!audioResult) {
          const reason = d.candidates?.[0]?.finishReason || 'UNKNOWN';
          console.warn(`[/api/song] Lyria ${model} no audio. finishReason: ${reason}`);
          throw new Error(`No audio from Lyria ${model} (${reason})`);
        }

        usedModel = model;
        console.log(`[/api/song] âœ… Lyria success: ${model} | mimeType: ${audioResult.mimeType}`);
        break;

      } catch (err) {
        console.warn(`[/api/song] Lyria ${model} failed:`, err.message);
        audioResult = null;
      }
    }

    /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
       Step 3: Lyria failed â†’ generate lyrics then TTS
    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    if (!audioResult) {
      console.warn('[/api/song] All Lyria models failed â†’ TTS fallback');

      /* Generate structured lyrics via Gemini Flash */
      const lyricsPrompt = [
        `You are a professional songwriter. Write a complete, original ${style} song about: "${prompt}".`,
        `Vocalist: ${voiceHint}. Genre: ${style}.`,
        `Language: use the same language as the theme (supports Khmer áž—áž¶ážŸáž¶ážáŸ’áž˜áŸ‚ážš, English, and others).`,
        `Structure: Title (prefix "Title: "), [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Pre-Chorus], [Chorus], [Bridge], [Final Chorus], [Outro].`,
        `Make it a full-length song (enough lyrics for 2â€“3 minutes of music).`,
        `Write only the song â€” no explanations or commentary.`,
      ].join('\n');

      try {
        const lr = await fetch(`${GEMINI}/gemini-2.5-flash:generateContent?key=${key}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: lyricsPrompt }] }] })
        });
        const ld = await safeJson(lr, '/api/song lyrics-fallback');
        if (lr.ok) {
          lyricsText = ld.candidates?.[0]?.content?.parts?.[0]?.text || '';
          console.log(`[/api/song] Lyrics generated (${lyricsText.length} chars)`);
        }
      } catch (le) {
        console.warn('[/api/song] Lyrics generation failed:', le.message);
      }

      if (lyricsText) {
        const cleanLyrics = lyricsText.replace(/^Title:.*$/im, '').trim();
        const ttsResult   = await tryTts(key, cleanLyrics, ttsVoice);
        if (ttsResult) {
          audioResult = { data: ttsResult.data, mimeType: ttsResult.mimeType };
          usedModel   = ttsResult.model;
          console.log(`[/api/song] TTS fallback success: ${usedModel}`);
        }
      }
    }

    if (!audioResult) console.warn('[/api/song] All audio methods failed â€” lyrics only');

    /* Extract title */
    const titleMatch = lyricsText.match(/^Title:\s*(.+)$/im);
    const songTitle  = titleMatch ? titleMatch[1].trim() : `${style} Song`;
    const isLyria    = usedModel.includes('lyria');

    res.json({
      audio:       audioResult ? audioResult.data : null,
      mimeType:    audioResult ? (audioResult.mimeType || 'audio/mp3') : 'audio/mp3',
      title:       songTitle,
      lyrics:      lyricsText,
      lyricsOnly:  !audioResult,
      audioSource: usedModel
        ? (isLyria ? `Lyria (${usedModel})` : `TTS (${usedModel})`)
        : null,
      ttsMessage: !audioResult
        ? 'Audio generation is temporarily unavailable. Your lyrics are ready â€” please try again in a few minutes.'
        : null
    });

  } catch (e) {
    console.error('[/api/song] exception:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* â”€â”€ SPA fallback â”€â”€ */
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`JeeThy Labs â†’ port ${PORT}`));
