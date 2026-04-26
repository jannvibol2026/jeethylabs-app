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
const DATABASE_URL   = process.env.DATABASE_URL;
const JWT_SECRET     = process.env.JWT_SECRET     || 'jeethylabs_secret_2026';
const SESSION_SECRET = process.env.SESSION_SECRET || JWT_SECRET;
const SMTP_USER      = process.env.SMTP_USER      || '';
const SMTP_PASS      = process.env.SMTP_PASS      || '';
const FROM_EMAIL     = process.env.FROM_EMAIL     || SMTP_USER;
const GEMINI_KEY     = process.env.GEMINI_API_KEY || '';
const PORT           = process.env.PORT           || 8080;

/* â”€â”€ Plan config â”€â”€ */
const PLAN_CONFIG = {
  free: {
    durationHint:    'under 1 minute (30-55 seconds)',
    durationSeconds: 55,
    structureHint:   'Intro -> Verse -> Chorus -> Outro (short/compact version)',
    customLyrics:    false,
  },
  pro: {
    durationHint:    '2 to 3 minutes',
    durationSeconds: 180,
    structureHint:   'Intro -> Verse 1 -> Pre-Chorus -> Chorus -> Verse 2 -> Pre-Chorus -> Chorus -> Bridge -> Final Chorus -> Outro',
    customLyrics:    true,
  },
  max: {
    durationHint:    '3 to 4 minutes (full-length)',
    durationSeconds: 240,
    structureHint:   'Intro -> Verse 1 -> Pre-Chorus -> Chorus -> Verse 2 -> Pre-Chorus -> Chorus -> Bridge -> Final Chorus -> Extended Outro',
    customLyrics:    true,
  },
};

/* â”€â”€ CORS â”€â”€ */
app.use(cors({ origin: true, credentials: true }));

/* â”€â”€ STRIPE WEBHOOK: raw body MUST come BEFORE express.json() â”€â”€ */
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
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
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

app.use(express.static(path.join(__dirname)));

console.log('=== JeeThy Labs Starting ===');
console.log('GEMINI_KEY:', GEMINI_KEY ? 'SET OK' : 'MISSING');
console.log('STRIPE_KEY:', process.env.STRIPE_SECRET_KEY ? 'SET OK' : 'NOT SET (Stripe disabled)');

/* â”€â”€ SMTP â”€â”€ */
const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com', port: 587, secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});
transporter.verify(err => err
  ? console.error('SMTP Error:', err.message)
  : console.log('Brevo SMTP Ready'));

/* â”€â”€ DB â”€â”€ */
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.connect()
  .then(c => { console.log('DB Connected'); c.release(); initDb(); })
  .catch(e => console.error('DB Error:', e.message));

async function initDb() {
  const migrations = [
    `CREATE TABLE IF NOT EXISTS users (
       id             SERIAL PRIMARY KEY,
       user_id        TEXT,
       name           TEXT,
       email          TEXT UNIQUE NOT NULL,
       password_hash  TEXT,
       email_verified BOOLEAN     DEFAULT false,
       avatar_url     TEXT,
       plan           VARCHAR(32) DEFAULT 'free',
       status         VARCHAR(32) DEFAULT 'active',
       country        VARCHAR(64),
       created_at     TIMESTAMPTZ DEFAULT NOW(),
       last_active    TIMESTAMPTZ DEFAULT NOW()
     )`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url      TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan            VARCHAR(32) DEFAULT 'free'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS status          VARCHAR(32) DEFAULT 'active'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS country         VARCHAR(64)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active     TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified  BOOLEAN     DEFAULT false`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id         TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_plan    VARCHAR(20)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT NOW()`,
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); }
    catch (e) { console.error('[initDb]', e.message); }
  }
  console.log('DB schema ready');
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
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : (req.session?.token) || null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

/* â”€â”€ Plan resolver â”€â”€ */
async function getUserPlan(userId) {
  try {
    const { rows } = await pool.query('SELECT plan, plan_expires_at FROM users WHERE id=$1', [userId]);
    if (!rows.length) return 'free';
    const u   = rows[0];
    const raw = (u.plan || 'free').toLowerCase().trim();
    if (raw !== 'free' && u.plan_expires_at && new Date(u.plan_expires_at) < new Date()) {
      await pool.query(`UPDATE users SET plan='free', plan_expires_at=NULL, updated_at=NOW() WHERE id=$1`, [userId]);
      return 'free';
    }
    return PLAN_CONFIG[raw] ? raw : 'free';
  } catch { return 'free'; }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   AUTH ROUTES
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

app.get('/api/health', (req, res) => res.json({
  status:  'ok',
  smtp:    !!SMTP_USER && !!SMTP_PASS,
  gemini:  !!GEMINI_KEY,
  stripe:  !!process.env.STRIPE_SECRET_KEY,
}));

app.get('/api/key', (req, res) => {
  if (!GEMINI_KEY) return res.status(503).json({ error: 'API key not configured', key: '' });
  res.json({ key: GEMINI_KEY });
});

app.post('/api/send-otp', async (req, res) => {
  const { email, name, password } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const otp = genOTP();
  otpStore[email] = { otp, name: name || '', password: password || '', expires: Date.now() + 10 * 60 * 1000 };
  try {
    await sendEmail(email, 'Your Verification Code - JeeThy Labs',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#7c3aed;">JeeThy Labs</h2>
        <p>Hi <strong>${name || 'there'}</strong>,</p>
        <p>Your verification code:</p>
        <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#7c3aed;text-align:center;padding:20px 0;">${otp}</div>
        <p style="color:#888;font-size:13px;">Expires in <strong>10 minutes</strong>.</p>
      </div>`);
    res.json({ success: true });
  } catch (e) {
    console.error('[otp]', e.message);
    res.status(500).json({ error: 'Failed to send code: ' + e.message });
  }
});

app.post('/api/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const rec = otpStore[email];
  if (!rec)                                  return res.status(400).json({ error: 'No OTP found. Request a new one.' });
  if (Date.now() > rec.expires)              { delete otpStore[email]; return res.status(400).json({ error: 'OTP expired.' }); }
  if (rec.otp !== String(otp || '').trim())  return res.status(400).json({ error: 'Invalid OTP.' });
  const rawPw = req.body.password || rec.password || '';
  if (!rawPw) return res.status(400).json({ error: 'Password missing.' });
  delete otpStore[email];
  try {
    const hash = await bcrypt.hash(rawPw, 10);
    const now  = new Date();
    const { rows } = await pool.query(
      `INSERT INTO users (name,email,password_hash,plan,status,email_verified,avatar_url,country,created_at,last_active,updated_at)
       VALUES ($1,$2,$3,'free','active',true,null,null,$4,$4,$4)
       ON CONFLICT (email) DO UPDATE SET name=$1,password_hash=$3,last_active=$4,updated_at=$4
       RETURNING id,user_id,name,email,plan,status,avatar_url,created_at`,
      [req.body.name || rec.name || 'User', email, hash, now]);
    const u     = rows[0];
    const token = jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '30d' });
    req.session.token = token;
    res.json({ success: true, token, user: { id: u.id, name: u.name, email: u.email, plan: u.plan || 'free', avatar_url: u.avatar_url || null, created_at: u.created_at } });
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
    if (!u.password_hash) return res.status(401).json({ error: 'Account has no password.' });
    if (!await bcrypt.compare(password || '', u.password_hash)) return res.status(401).json({ error: 'Wrong password.' });
    await pool.query('UPDATE users SET last_active=$1, updated_at=$1 WHERE id=$2', [new Date(), u.id]);
    const token = jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '30d' });
    req.session.token = token;
    res.json({ success: true, token, user: { id: u.id, name: u.name, email: u.email, plan: u.plan || 'free', avatar_url: u.avatar_url || null, created_at: u.created_at } });
  } catch (e) { res.status(500).json({ error: 'Login failed: ' + e.message }); }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,user_id,name,email,avatar_url,plan,status,created_at,last_active FROM users WHERE id=$1',
      [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  const { rows } = await pool.query('SELECT id FROM users WHERE email=$1', [email]).catch(() => ({ rows: [] }));
  if (!rows.length) return res.status(404).json({ error: 'Email not found.' });
  const otp = genOTP();
  otpStore[email] = { otp, expires: Date.now() + 10 * 60 * 1000, type: 'reset' };
  try {
    await sendEmail(email, 'Password Reset - JeeThy Labs',
      `<div style="font-family:Arial;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#7c3aed;">Reset Your Password</h2>
        <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#7c3aed;text-align:center;padding:20px 0;">${otp}</div>
        <p style="color:#888;font-size:13px;">Expires in <strong>10 minutes</strong>.</p>
      </div>`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const rec = otpStore[email];
  if (!rec || rec.otp !== String(otp || '').trim() || Date.now() > rec.expires) {
    delete otpStore[email];
    return res.status(400).json({ error: 'Invalid or expired code.' });
  }
  delete otpStore[email];
  try {
    await pool.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE email=$2',
      [await bcrypt.hash(newPassword || '', 10), email]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/profile', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,user_id,name,email,avatar_url,plan,status,country,created_at,last_active FROM users WHERE id=$1',
      [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/profile', auth, async (req, res) => {
  const { avatar_url, country, name } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE users SET avatar_url=COALESCE($1,avatar_url),country=COALESCE($2,country),
       name=COALESCE($3,name),last_active=$4,updated_at=$4
       WHERE id=$5 RETURNING id,name,email,avatar_url,plan,status,country,created_at`,
      [avatar_url || null, country || null, name || null, new Date(), req.user.id]);
    res.json({ success: true, user: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/avatar', auth, async (req, res) => {
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ error: 'No avatar data' });
  try {
    await pool.query('UPDATE users SET avatar_url=$1,last_active=$2,updated_at=$2 WHERE id=$3',
      [avatar, new Date(), req.user.id]);
    res.json({ success: true, avatar_url: avatar });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload-avatar', auth, async (req, res) => {
  const { avatar_url } = req.body;
  if (!avatar_url) return res.status(400).json({ error: 'No avatar data' });
  try {
    await pool.query('UPDATE users SET avatar_url=$1,last_active=$2,updated_at=$2 WHERE id=$3',
      [avatar_url, new Date(), req.user.id]);
    res.json({ success: true, avatar_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {});
  res.clearCookie('connect.sid');
  res.json({ success: true });
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   GEMINI PROXY ROUTES
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

function geminiKey() {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY is not set in Railway environment variables.');
  return GEMINI_KEY;
}

let _modelsCache = null, _modelsCacheTime = 0;
const MODELS_TTL = 10 * 60 * 1000;

async function fetchAvailableModels(key) {
  const now = Date.now();
  if (_modelsCache && (now - _modelsCacheTime) < MODELS_TTL) return _modelsCache;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`);
  if (!r.ok) { const t = await r.text(); throw new Error(`ListModels HTTP ${r.status}: ${t.slice(0,200)}`); }
  const data   = await r.json();
  const models = (data.models || []).map(m => ({
    name:             m.name?.replace('models/', '') || '',
    displayName:      m.displayName || '',
    supportedMethods: m.supportedGenerationMethods || [],
  }));
  _modelsCache = models; _modelsCacheTime = now;
  return models;
}

function classifyModels(models) {
  const gc = models.filter(m => m.supportedMethods.includes('generateContent'));
  const imageModels = gc.filter(m => /image.gen|imagen|flash.*image|image.*flash/i.test(m.name));
  const lyriaModels = gc.filter(m => /lyria/i.test(m.name) || /lyria/i.test(m.displayName));
  const ttsModels   = gc.filter(m => /tts|text.to.speech/i.test(m.name));
  const chatModels  = gc.filter(m =>
    !imageModels.includes(m) && !ttsModels.includes(m) && !lyriaModels.includes(m));
  return { imageModels, lyriaModels, ttsModels, chatModels };
}

app.get('/api/models', async (req, res) => {
  try {
    const key  = geminiKey();
    const all  = await fetchAvailableModels(key);
    const { imageModels, lyriaModels, ttsModels, chatModels } = classifyModels(all);
    res.json({
      all,
      imageModels: imageModels.map(m => m.name),
      lyriaModels: lyriaModels.map(m => m.name),
      ttsModels:   ttsModels.map(m => m.name),
      chatModels:  chatModels.map(m => m.name),
      recommended: {
        chat:  chatModels.find(m => /2\.5.flash/i.test(m.name))?.name || 'gemini-2.5-flash',
        image: imageModels[0]?.name || null,
        lyria: lyriaModels.find(m => /pro/i.test(m.name))?.name || lyriaModels[0]?.name || 'lyria-3-pro-preview',
        tts:   ttsModels.find(m => /flash/i.test(m.name))?.name  || ttsModels[0]?.name   || null,
      },
    });
  } catch (e) {
    res.json({
      all:[], imageModels:[], lyriaModels:[], ttsModels:[], chatModels:['gemini-2.5-flash'],
      recommended:{ chat:'gemini-2.5-flash', image:null, lyria:'lyria-3-pro-preview', tts:null },
      error: e.message,
    });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const key     = geminiKey();
    const history = req.body.history || req.body.contents || [];
    const system  = req.body.system  || 'You are JeeThy Assistant, a helpful AI by JeeThy Labs.\nAnswer in the same language the user uses.\nBe concise and clear.';
    const r = await fetch(`${GEMINI}/gemini-2.5-flash:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: history,
      }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: d.error?.message || 'Gemini error' });
    res.json({ reply: d.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* â”€â”€ Retry helper â”€â”€ */
async function withRetry(fn, { maxAttempts=3, baseDelayMs=1000, label='op' }={}) {
  let lastErr;
  for (let i=1; i<=maxAttempts; i++) {
    try { return await fn(i); }
    catch (err) {
      lastErr = err;
      const isRetryable = /overload|high demand|quota|rate.?limit|503|429/i.test(err.message||'');
      if (!isRetryable || i===maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, i-1);
      console.warn(`[${label}] retry ${i}/${maxAttempts} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/* â”€â”€ safeJson â”€â”€ */
async function safeJson(response, label) {
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await response.text();
    throw new Error(`[${label}] non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

/* â”€â”€ cleanLyricsText â”€â”€ */
function cleanLyricsText(raw) {
  if (!raw) return '';
  return raw
    .replace(/^\s*(mosic|bpm|duration_secs|good_crop|tempo|key|time_signature|mood|energy)\s*:.*$/gim, '')
    .replace(/\[\[AO\]\]/gi, '')
    .replace(/\[\[.*?\]\]/g, '')
    .replace(/^---+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   /api/image
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
app.post('/api/image', async (req, res) => {
  try {
    const key = geminiKey();
    const { prompt, style='' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const fullPrompt = style && style.toLowerCase() !== 'none'
      ? `${prompt}, style: ${style}` : prompt;

    let IMAGE_MODELS = ['gemini-2.0-flash-preview-image-generation', 'gemini-2.0-flash'];
    try {
      const m = classifyModels(await fetchAvailableModels(key));
      if (m.imageModels.length) IMAGE_MODELS = m.imageModels.map(x => x.name);
    } catch {}

    let lastErr = null;
    for (const model of IMAGE_MODELS) {
      try {
        const img = await withRetry(async () => {
          const r = await fetch(`${GEMINI}/${model}:generateContent?key=${key}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: fullPrompt }] }],
              generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
            }),
          });
          const d = await safeJson(r, `/api/image ${model}`);
          if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
          for (const c of (d.candidates||[])) for (const p of (c.content?.parts||[]))
            if (p.inlineData?.data) return p.inlineData;
          throw new Error(`No image from ${model}`);
        }, { maxAttempts:3, baseDelayMs:1500, label:`image/${model}` });
        return res.json({ data: img.data, mimeType: img.mimeType || 'image/png' });
      } catch (err) { lastErr = err; }
    }
    res.status(500).json({ error: lastErr?.message || 'Image generation failed.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   /api/song
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

const LYRIA_MODELS_FALLBACK = ['lyria-3-pro-preview','lyria-3-clip-preview'];
const TTS_MODELS_FALLBACK   = ['gemini-2.5-flash-preview-tts','gemini-2.5-pro-preview-tts'];

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
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            },
          }),
        });
        const d = await safeJson(r, `TTS/${model}`);
        if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
        for (const c of (d.candidates||[])) for (const p of (c.content?.parts||[]))
          if (p.inlineData?.data)
            return { data: p.inlineData.data, mimeType: p.inlineData.mimeType || 'audio/wav', model };
        throw new Error(`No TTS audio from ${model}`);
      }, { maxAttempts:3, baseDelayMs:1000, label:`TTS/${model}` });
      return result;
    } catch (err) { console.warn(`[TTS] ${model} failed:`, err.message); }
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
    const key     = geminiKey();
    const planKey = await getUserPlan(req.user.id);
    const planCfg = PLAN_CONFIG[planKey];
    const { prompt = '', style = 'Pop', voice = 'Female', customLyrics = '' } = req.body;

    if (!prompt && !customLyrics)
      return res.status(400).json({ error: 'Please provide a song description or custom lyrics.' });

    if (customLyrics && !planCfg.customLyrics)
      return res.status(403).json({
        error: `Custom lyrics require PRO or MAX plan. Your current plan is ${planKey.toUpperCase()}.`,
        upgradeRequired: true,
      });

    const isFemale  = voice.toLowerCase().includes('female') || !voice.toLowerCase().includes('male');
    const voiceHint = isFemale ? 'female vocalist' : 'male vocalist';
    const ttsVoice  = isFemale ? 'Aoede' : 'Charon';

    console.log(`[/api/song] user:${req.user.id} plan:${planKey} style:${style} voice:${voiceHint}`);

    let musicPrompt;
    if (customLyrics && planCfg.customLyrics) {
      musicPrompt = [
        `Create a complete original ${style} song approximately ${planCfg.durationHint} long.`,
        `Use EXACTLY the following lyrics - do not change any words:`,
        `---`,
        customLyrics.trim(),
        `---`,
        `Vocalist: ${voiceHint}. Genre: ${style}.`,
        `Structure: ${planCfg.structureHint}.`,
        `Audio: high-quality stereo, full band instrumentation, clear lead vocals, backing harmonies.`,
        `Target duration: ${planCfg.durationHint}.`,
      ].join('\n');
    } else {
      musicPrompt = [
        `Create a complete original ${style} song approximately ${planCfg.durationHint} long.`,
        `Theme: ${prompt}`,
        `Vocalist: ${voiceHint}. Genre: ${style}.`,
        `Song structure: ${planCfg.structureHint}.`,
        `Language: same as the theme (supports Khmer, English, and others).`,
        `Audio: high-quality stereo, full band instrumentation, clear lead vocals, backing harmonies.`,
        `Target duration: ${planCfg.durationHint}.`,
        planKey === 'free'
          ? 'Keep the song SHORT - under 1 minute, compact structure only.'
          : 'Generate the FULL song from start to finish. Do not cut short.',
      ].join('\n');
    }

    let lyriaModels = [...LYRIA_MODELS_FALLBACK];
    try {
      const m = classifyModels(await fetchAvailableModels(key));
      if (m.lyriaModels.length) {
        const sorted = [
          ...m.lyriaModels.filter(x => /pro/i.test(x.name)).map(x => x.name),
          ...m.lyriaModels.filter(x => !/pro/i.test(x.name)).map(x => x.name),
        ];
        lyriaModels = [...new Set([...sorted, ...LYRIA_MODELS_FALLBACK])];
      }
    } catch (me) { console.warn('[/api/song] model discovery failed:', me.message); }

    let audioResult = null, lyricsText = '', usedModel = '';

    for (const model of lyriaModels) {
      try {
        console.log(`[/api/song] trying Lyria: ${model}`);
        const r = await fetch(`${GEMINI}/${model}:generateContent?key=${key}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: musicPrompt }] }],
            generationConfig: { responseModalities: ['AUDIO', 'TEXT'] },
          }),
        });
        const d = await safeJson(r, `/api/song Lyria ${model}`);
        if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);

        for (const c of (d.candidates || []))
          for (const p of (c.content?.parts || [])) {
            if (p.text)             lyricsText  = p.text;
            if (p.inlineData?.data) audioResult = p.inlineData;
          }

        if (!audioResult) {
          const reason = d.candidates?.[0]?.finishReason || 'UNKNOWN';
          throw new Error(`Lyria returned no audio (finishReason: ${reason})`);
        }
        usedModel = model;
        console.log(`[/api/song] Lyria ok: ${model}`);
        break;
      } catch (err) {
        console.warn(`[/api/song] Lyria ${model} failed:`, err.message);
        audioResult = null;
      }
    }

    if (!audioResult) {
      console.warn('[/api/song] All Lyria failed -> TTS fallback');
      const lyricsSource = customLyrics?.trim() || '';

      if (!lyricsSource) {
        const lyricPrompt = [
          `Write a complete original ${style} song about: "${prompt}".`,
          `Vocalist: ${voiceHint}. Genre: ${style}.`,
          `Start with "Title: <song name>" on the first line.`,
          `Then write: ${planCfg.structureHint}.`,
          planKey === 'free'
            ? 'Keep it SHORT - under 1 minute worth of lyrics.'
            : `Full-length: ${planCfg.durationHint} worth of lyrics.`,
          'Write only the song - no commentary.',
        ].join('\n');
        try {
          const lr = await fetch(`${GEMINI}/gemini-2.5-flash:generateContent?key=${key}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: lyricPrompt }] }] }),
          });
          const ld = await safeJson(lr, 'lyrics-gen');
          if (lr.ok) lyricsText = ld.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } catch (le) { console.warn('[lyrics-gen]', le.message); }
      } else {
        lyricsText = lyricsSource;
      }

      if (lyricsText) {
        const cleanLyrics = lyricsText.replace(/^Title:.*$/im, '').trim();
        const ttsRes = await tryTts(key, cleanLyrics, ttsVoice);
        if (ttsRes) {
          audioResult = { data: ttsRes.data, mimeType: ttsRes.mimeType };
          usedModel   = ttsRes.model;
        }
      }
    }

    const cleanedLyrics = cleanLyricsText(lyricsText);
    const titleMatch    = cleanedLyrics.match(/^Title:\s*(.+)$/im);
    const songTitle     = titleMatch ? titleMatch[1].trim() : `${style} Song`;
    const isLyria       = usedModel.includes('lyria');

    return res.json({
      audio:       audioResult ? audioResult.data : null,
      mimeType:    audioResult ? (audioResult.mimeType || 'audio/mp3') : 'audio/mp3',
      title:       songTitle,
      lyrics:      cleanedLyrics,
      lyricsOnly:  !audioResult,
      audioSource: usedModel
        ? (isLyria ? `Lyria (${usedModel})` : `TTS (${usedModel})`)
        : null,
      plan:        planKey,
      ttsMessage:  !audioResult
        ? 'Audio generation temporarily unavailable. Your lyrics are ready - please try again shortly.'
        : null,
    });

  } catch (e) {
    console.error('[/api/song] exception:', e.message, e.stack);
    res.status(500).json({ error: e.message });
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   STRIPE PAYMENT ROUTES
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try { return require('stripe')(key); } catch { return null; }
}

const APP_URL = process.env.APP_URL || 'https://app.jeethylabs.site';

const STRIPE_PRICES = {
  pro: process.env.STRIPE_PRICE_PRO || '',
  max: process.env.STRIPE_PRICE_MAX || '',
};

app.get('/api/stripe/plans', (req, res) => {
  const key = process.env.STRIPE_SECRET_KEY || '';
  res.json({
    configured: !!key,
    testMode:   key.startsWith('sk_test'),
    plans: {
      pro: { name: 'PRO', price: '$9.99/mo',  priceId: STRIPE_PRICES.pro || 'NOT_SET' },
      max: { name: 'MAX', price: '$19.99/mo', priceId: STRIPE_PRICES.max || 'NOT_SET' },
    },
  });
});

app.post('/api/stripe/checkout', auth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured. Add STRIPE_SECRET_KEY to Railway ENV.' });
  const { plan } = req.body;
  if (!STRIPE_PRICES[plan] || !STRIPE_PRICES[plan].startsWith('price_'))
    return res.status(400).json({ error: `Invalid plan or STRIPE_PRICE_${plan?.toUpperCase()} not set.` });
  try {
    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: STRIPE_PRICES[plan], quantity: 1 }],
      success_url: `${APP_URL}/?upgraded=1&plan=${plan}`,
      cancel_url:  `${APP_URL}/?cancelled=1`,
      metadata:    { userId: String(req.user.id), plan },
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[stripe/checkout]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/stripe/webhook', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured.' });
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'STRIPE_WEBHOOK_SECRET not set.' });
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, sig, secret); }
  catch (e) {
    console.error('[stripe/webhook] signature error:', e.message);
    return res.status(400).json({ error: 'Webhook signature invalid: ' + e.message });
  }
  console.log('[stripe/webhook] event:', event.type);
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const { userId, plan } = event.data.object.metadata || {};
        if (userId && plan) {
          const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await pool.query(
            'UPDATE users SET plan=$1, plan_expires_at=$2, pending_plan=NULL, updated_at=NOW() WHERE id=$3',
            [plan, expires, Number(userId)]
          );
          console.log(`[stripe] user ${userId} upgraded to ${plan}`);
        }
        break;
      }
      case 'customer.subscription.deleted':
        console.warn('[stripe] subscription cancelled:', event.data.object.customer);
        break;
    }
  } catch (e) { console.error('[stripe/webhook] handler error:', e.message); }
  res.json({ received: true });
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   SUBSCRIBE / CHECKOUT ROUTES
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

/*
  POST /api/subscribe
  Body: { plan: 'free' | 'pro' | 'max' }

  - plan='free'      â†’ downgrade immediately, returns { success, plan, user }
  - plan='pro'|'max' â†’ if Stripe configured  â†’ create Checkout session â†’ { success, checkoutUrl, plan }
                        if Stripe NOT set    â†’ MANUAL/TEST mode â†’ update DB directly â†’ { success, plan, user, token }
*/
app.post('/api/subscribe', auth, async (req, res) => {
  try {
    const { plan } = req.body;
    const planKey  = (plan || '').toLowerCase();
    if (!['free','pro','max'].includes(planKey))
      return res.status(400).json({ error: 'Invalid plan. Choose: free, pro, max' });

    /* â”€â”€ Downgrade to free â”€â”€ */
    if (planKey === 'free') {
      await pool.query(
        `UPDATE users SET plan='free', plan_expires_at=NULL, pending_plan=NULL, updated_at=NOW() WHERE id=$1`,
        [req.user.id]
      );
      const { rows } = await pool.query(
        `SELECT id,name,email,plan,avatar_url,created_at FROM users WHERE id=$1`, [req.user.id]
      );
      return res.json({ success: true, plan: 'free', user: rows[0] || null });
    }

    /* â”€â”€ Upgrade: try Stripe first â”€â”€ */
    const stripe = getStripe();
    if (stripe && STRIPE_PRICES[planKey]?.startsWith('price_')) {
      try {
        const session = await stripe.checkout.sessions.create({
          mode:                 'subscription',
          payment_method_types: ['card'],
          line_items: [{ price: STRIPE_PRICES[planKey], quantity: 1 }],
          success_url: `${APP_URL}/?upgraded=1&plan=${planKey}`,
          cancel_url:  `${APP_URL}/?cancelled=1`,
          metadata:    { userId: String(req.user.id), plan: planKey },
        });
        await pool.query(
          `UPDATE users SET pending_plan=$1, updated_at=NOW() WHERE id=$2`,
          [planKey, req.user.id]
        );
        return res.json({ success: true, checkoutUrl: session.url, plan: planKey });
      } catch (stripeErr) {
        console.error('[subscribe] Stripe failed, falling back to manual:', stripeErr.message);
      }
    }

    /* â”€â”€ Manual / test mode â”€â”€ */
    console.log(`[subscribe] MANUAL mode: user ${req.user.id} -> ${planKey}`);
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await pool.query(
      `UPDATE users SET plan=$1, plan_expires_at=$2, pending_plan=NULL, updated_at=NOW() WHERE id=$3`,
      [planKey, expires, req.user.id]
    );
    const { rows } = await pool.query(
      `SELECT id,name,email,plan,avatar_url,created_at FROM users WHERE id=$1`, [req.user.id]
    );
    const newToken = jwt.sign({ id: req.user.id, email: req.user.email }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ success: true, plan: planKey, user: rows[0] || null, token: newToken });

  } catch (e) {
    console.error('[subscribe]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* POST /api/checkout/confirm â€” called by checkout.html after payment token received */
app.post('/api/checkout/confirm', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Missing token.' });
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); }
    catch (e) { return res.status(400).json({ error: 'Invalid or expired token.' }); }
    const { userId, plan } = payload;
    if (!userId || !plan) return res.status(400).json({ error: 'Token missing userId or plan.' });
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await pool.query(
      `UPDATE users SET plan=$1, pending_plan=NULL, plan_expires_at=$2, updated_at=NOW() WHERE id=$3`,
      [plan, expires, userId]
    );
    const { rows } = await pool.query(
      `SELECT id,name,email,plan,avatar_url,created_at FROM users WHERE id=$1`, [userId]
    );
    const newToken = jwt.sign({ id: userId, email: rows[0]?.email || '' }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ success: true, token: newToken, user: rows[0] || null });
  } catch (e) {
    console.error('[checkout/confirm]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* GET /api/plan â€” returns current plan + expiry + pending */
app.get('/api/plan', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT plan, plan_expires_at, pending_plan FROM users WHERE id=$1`, [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    const u = rows[0];
    if (u.plan !== 'free' && u.plan_expires_at && new Date(u.plan_expires_at) < new Date()) {
      await pool.query(
        `UPDATE users SET plan='free', plan_expires_at=NULL, updated_at=NOW() WHERE id=$1`, [req.user.id]
      );
      u.plan = 'free'; u.plan_expires_at = null;
    }
    return res.json({ plan: u.plan, expiresAt: u.plan_expires_at, pendingPlan: u.pending_plan });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* â”€â”€ SPA fallback â”€â”€ */
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`JeeThy Labs -> port ${PORT}`));
