'use strict';
const express    = require('express');
const cookieParser = require('cookie-parser');
const session    = require('express-session');
const { Pool }   = require('pg');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cors       = require('cors');
const path       = require('path');

const app = express();

/* - ENV - */
const DATABASE_URL   = process.env.DATABASE_URL;
const JWT_SECRET     = process.env.JWT_SECRET     || 'jeethylabs_secret_2026';
const SESSION_SECRET = process.env.SESSION_SECRET || JWT_SECRET;
const SMTP_USER      = process.env.SMTP_USER      || '';
const SMTP_PASS      = process.env.SMTP_PASS      || '';
const FROM_EMAIL     = process.env.FROM_EMAIL     || SMTP_USER;
const GEMINI_KEY     = process.env.GEMINI_API_KEY || '';
const PORT           = process.env.PORT           || 8080;

/* - Plan config - */
const PLAN_CONFIG = {
  free: {
    durationHint:    'under 1 minute (target: ~55 seconds). CRITICAL: must end before 60 seconds.',
    durationSeconds: 55,
    structureHint:   'Short Instrumental Intro (8s) -> Verse (20s) -> Chorus (18s) -> Short Outro (9s) — total: ~55s',
    customLyrics:    false,
    chatMsgDay:      20,
    imgDay:          5,
    songDay:         3,
    imgResolution:   '720x720',
    audioQuality:    'standard',
  },
  pro: {
    durationHint:    'between 2 minutes 50 seconds and 3 minutes 05 seconds (target: 3 minutes). CRITICAL: must be at least 2:50.',
    durationSeconds: 180,
    structureHint:   'Instrumental Intro (20s) -> Verse 1 (30s) -> Pre-Chorus (10s) -> Chorus (25s) -> Break (20s) -> Verse 2 (25s) -> Chorus (25s) -> Final Chorus (20s) -> Outro (15s) — total: ~2:50-3:05',
    customLyrics:    true,
    chatMsgDay:      100,
    imgDay:          25,
    songDay:         15,
    imgResolution:   '1024x1024',
    audioQuality:    'high',
  },
  proplus: {
    durationHint:    'between 3 minutes and 3 minutes 25 seconds (target: 3:15). CRITICAL: must be at least 3:00.',
    durationSeconds: 200,
    structureHint:   'Extended Intro (25s) -> Verse 1 (30s) -> Pre-Chorus (12s) -> Chorus (25s) -> Break (22s) -> Verse 2 (28s) -> Pre-Chorus (12s) -> Chorus (25s) -> Bridge (15s) -> Final Chorus (25s) -> Outro (25s) — total: ~3:00-3:25',
    customLyrics:    true,
    chatMsgDay:      -1,
    imgDay:          150,
    songDay:         100,
    imgResolution:   '2048x2048',
    audioQuality:    'best',
  },
  max: {
    durationHint:    'between 4 minutes 25 seconds and 5 minutes 25 seconds (target: ~5 min full song). CRITICAL: must be at least 4:00.',
    durationSeconds: 300,
    structureHint:   'Extended Intro (35s) -> Verse 1 (35s) -> Pre-Chorus (15s) -> Chorus (30s) -> Break (30s) -> Verse 2 (30s) -> Pre-Chorus (15s) -> Chorus (30s) -> Bridge (20s) -> Solo (25s) -> Final Chorus (30s) -> Extended Outro (40s) — total: ~4:25-5:25',
    customLyrics:    true,
    chatMsgDay:      -1,
    imgDay:          -1,
    songDay:         -1,
    imgResolution:   '3840x2160',
    audioQuality:    'best_lyria_pro',
  },
};

/* - CORS - */
app.use(cors({ origin: true, credentials: true }));

/* - STRIPE WEBHOOK: raw body MUST come BEFORE express.json() - */
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

/* - SESSION - */
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
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    }
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
    }
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8');
    }
  }
}));

console.log('=== JeeThy Labs Starting ===');
console.log('GEMINI_KEY:', GEMINI_KEY ? 'SET OK' : 'MISSING');
console.log('STRIPE_KEY:', process.env.STRIPE_SECRET_KEY ? 'SET OK' : 'NOT SET (Stripe disabled)');

/* - SMTP - */
const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com', port: 587, secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});
transporter.verify(err => err
  ? console.error('SMTP Error:', err.message)
  : console.log('Brevo SMTP Ready'));

/* - DB - */
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

/* - HELPERS - */
const otpStore = {};
const genOTP   = () => Math.floor(100000 + Math.random() * 900000).toString();

async function sendEmail(to, subject, html) {
  const info = await transporter.sendMail({ from: `"JeeThy Labs" <${FROM_EMAIL}>`, to, subject, html });
  console.log('[email] sent to', to, '| id:', info.messageId);
  return info;
}

/* - AUTH MIDDLEWARE - */
function auth(req, res, next) {
  const hdr   = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7)
              : (req.session?.token)
              || (req.cookies?.jl_token)
              || null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

/* - Plan resolver - */
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
    return (PLAN_CONFIG[raw] || raw === 'proplus') ? raw : 'free';
  } catch { return 'free'; }
}

/* -
   AUTH ROUTES
   - */

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

/* -
   FIX #1: /api/verify-otp
   Root cause: passing `now` (Date object) as $4 caused
   PostgreSQL to see inconsistent types across multiple
   uses of the same parameter.
   Fix: use NOW() server-side for all timestamp columns,
        and pass each value as a separate typed parameter.
   - */
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
    const hash     = await bcrypt.hash(rawPw, 10);
    const userName = req.body.name || rec.name || 'User';
    /* FIX: use NOW() for all timestamps - no JS Date passed as parameter */
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, plan, status, email_verified,
                          avatar_url, country, created_at, last_active, updated_at)
       VALUES ($1, $2, $3, 'free', 'active', true, null, null, NOW(), NOW(), NOW())
       ON CONFLICT (email) DO UPDATE
         SET name          = EXCLUDED.name,
             password_hash = EXCLUDED.password_hash,
             last_active   = NOW(),
             updated_at    = NOW()
       RETURNING id, user_id, name, email, plan, status, avatar_url, created_at`,
      [userName, email, hash]
    );
    const u     = rows[0];
    const token = jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '30d' });
    req.session.token = token;
    res.cookie('jl_token', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    res.json({
      success: true,
      token,
      user: {
        id:         u.id,
        name:       u.name,
        email:      u.email,
        plan:       u.plan || 'free',
        avatar_url: u.avatar_url || null,
        created_at: u.created_at,
      },
    });
  } catch (e) {
    console.error('[verify-otp]', e.message);
    res.status(500).json({ error: 'Registration failed: ' + e.message });
  }
});

/* -
   FIX #2: /api/login
   Root cause: `new Date()` passed as $1 then reused as $2
   (different column types TIMESTAMPTZ vs id INTEGER) caused
   "inconsistent types deduced for parameter $1".
   Fix: split into two separate typed parameters $1=timestamp
        and $2=integer, which is what the query already does -
        but also wrap in try/catch properly.
   - */
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, password_hash, plan, avatar_url, created_at FROM users WHERE email = $1',
      [email]                    /* $1 = TEXT - no type ambiguity */
    );
    if (!rows.length) return res.status(401).json({ error: 'Email not found.' });
    const u = rows[0];
    if (!u.password_hash) return res.status(401).json({ error: 'Account has no password.' });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Wrong password.' });
    /* FIX: use NOW() server-side; pass user id as its own parameter */
    await pool.query(
      'UPDATE users SET last_active = NOW(), updated_at = NOW() WHERE id = $1',
      [u.id]                     /* $1 = INTEGER only - no ambiguity */
    );
    const token = jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '30d' });
    req.session.token = token;
    res.cookie('jl_token', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    res.json({
      success: true,
      token,
      user: {
        id:         u.id,
        name:       u.name,
        email:      u.email,
        plan:       u.plan || 'free',
        avatar_url: u.avatar_url || null,
        created_at: u.created_at,
      },
    });
  } catch (e) {
    console.error('[login]', e.message);
    res.status(500).json({ error: 'Login failed: ' + e.message });
  }
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
      `UPDATE users SET
         avatar_url  = COALESCE($1, avatar_url),
         country     = COALESCE($2, country),
         name        = COALESCE($3, name),
         last_active = NOW(),
         updated_at  = NOW()
       WHERE id = $4
       RETURNING id, name, email, avatar_url, plan, status, country, created_at`,
      [avatar_url || null, country || null, name || null, req.user.id]);
    res.json({ success: true, user: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/avatar', auth, async (req, res) => {
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ error: 'No avatar data' });
  try {
    await pool.query(
      'UPDATE users SET avatar_url=$1, last_active=NOW(), updated_at=NOW() WHERE id=$2',
      [avatar, req.user.id]);
    res.json({ success: true, avatar_url: avatar });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload-avatar', auth, async (req, res) => {
  const { avatar_url } = req.body;
  if (!avatar_url) return res.status(400).json({ error: 'No avatar data' });
  try {
    await pool.query(
      'UPDATE users SET avatar_url=$1, last_active=NOW(), updated_at=NOW() WHERE id=$2',
      [avatar_url, req.user.id]);
    res.json({ success: true, avatar_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {});
  res.clearCookie('connect.sid');
  res.json({ success: true });
});

/* -
   GEMINI PROXY ROUTES
   - */

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

/* - Retry helper - */
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

/* - safeJson - */
async function safeJson(response, label) {
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await response.text();
    throw new Error(`[${label}] non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

/* - cleanLyricsText - */
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

/* -
   /api/image
   - */
app.post('/api/image', async (req, res) => {
  try {
    const key = geminiKey();
    // ✅ Replace with
    const { prompt, style='', aspectRatio='1:1', referenceImageBase64, referenceImageMime, extraRefImages=[] } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    // Map and validate aspect ratio
    const VALID_RATIOS = { '1:1':'1:1', '9:16':'9:16', '16:9':'16:9' };
    const mappedRatio  = VALID_RATIOS[aspectRatio] || '1:1';

    // Add orientation hint to prompt so even non-Imagen models try to respect ratio
    const orientHint =
      mappedRatio === '9:16' ? ', portrait orientation, vertical composition, tall image' :
      mappedRatio === '16:9' ? ', landscape orientation, wide composition, horizontal image' : '';

    // ✅ Replace with
const _basePrompt = style && style.toLowerCase() !== 'none'
  ? `${prompt}, style: ${style}${orientHint}`
  : `${prompt}${orientHint}`;
const fullPrompt = negativePrompt
  ? `${_basePrompt}. Avoid the following: ${negativePrompt}`
  : _basePrompt;

    let IMAGE_MODELS = ['imagen-3.0-generate-002', 'imagen-3.0-generate-001', 'gemini-2.0-flash-preview-image-generation', 'gemini-2.0-flash'];
    try {
      const m = classifyModels(await fetchAvailableModels(key));
      if (m.imageModels.length) IMAGE_MODELS = m.imageModels.map(x => x.name);
    } catch {}

    let lastErr = null;
    for (const model of IMAGE_MODELS) {
      try {
        const img = await withRetry(async () => {
          // Imagen models support native aspectRatio param; flash models use prompt hint only
        
        const genConfig = { responseModalities: ['IMAGE', 'TEXT'] };
          // ✅ ក្រោយ (ត្រឹមត្រូវ — Imagen only):
         if (/imagen/i.test(model)) genConfig.aspectRatio = mappedRatio;

          const r = await fetch(`${GEMINI}/${model}:generateContent?key=${key}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  ...(referenceImageBase64 ? [{ inlineData: { mimeType: referenceImageMime || 'image/jpeg', data: referenceImageBase64 } }] : []),
                  ...(extraRefImages.length > 0 ? extraRefImages.map(r => ({ inlineData: { mimeType: r.mime || 'image/jpeg', data: r.base64 } })) : []),
                  { text: referenceImageBase64
                      ? 'Using the uploaded image as a visual reference (keep the same person/face/body), ' + fullPrompt
                      : fullPrompt }
                ]
              }],
              generationConfig: genConfig,
            }),
          });
          const d = await safeJson(r, `/api/image ${model}`);
          if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
          for (const c of (d.candidates||[])) for (const p of (c.content?.parts||[]))
            if (p.inlineData?.data) return p.inlineData;
          throw new Error(`No image from ${model}`);
        }, { maxAttempts:3, baseDelayMs:1500, label:`image/${model}` });
        return res.json({ data: img.data, mimeType: img.mimeType || 'image/png', aspectRatio: mappedRatio });
      } catch (err) { lastErr = err; }
    }
    res.status(500).json({ error: lastErr?.message || 'Image generation failed.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* -
   /api/song
   - */

const LYRIA_MODELS_FALLBACK = ['lyria-3-pro-preview'];
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


// ════ Khmer Instrument Prompt Builder for Lyria ════
const KHMER_INSTRUMENT_DESCRIPTIONS = {
  'khloy':        'Khloy (Cambodian bamboo vertical flute): breathy airy melodic flute with gentle vibrato and warm mid-range pitch of Southeast Asian bamboo flutes.',
  'roneat ek':    'Roneat Ek (Cambodian bamboo xylophone): bright crisp resonant xylophone tones with fast melodic runs and percussive mallet strike of Khmer classical music.',
  'roneat thung': 'Roneat Thung (Cambodian low-pitched bamboo xylophone): deep mellow bass-range woody xylophone providing harmonic depth in Khmer ensemble music.',
  'chapei':       'Chapei (Cambodian long-neck lute): deep resonant plucked string with distinctive buzz and warm bass undertone, earthy and raw.',
  'tro':          'Tro (Cambodian spike fiddle): haunting lyrical bowed string sound similar to erhu but with deeper Cambodian timbre and expressive singing vibrato.',
  'kse diev':     'Kse Diev (Cambodian monochord zither): singular droning plucked string with subtle buzz and ancient meditative resonance.',
  'sadiev':       'Kse Diev (Cambodian monochord zither): singular droning plucked string with subtle buzz and ancient meditative resonance.',
  'kong vong':    'Kong Vong Thom (Cambodian gong circle): deep warm sustained bronze gong tones arranged melodically with long resonant decay.',
  'skor':         'Skor (Cambodian barrel drum): deep resonant hand drum rhythm with warm low-pitched attack and natural reverb, central to Cambodian percussion.',
  'pin':          'Pin (Cambodian harp): ethereal flowing plucked harp with bright silvery tone and gentle glissandos, ancient and celestial.',
};

function buildInstrumentPrompt(instrument) {
  if (!instrument) return [];
  const lines = ['Featured instrument(s): ' + instrument + '.'];
  const lower = instrument.toLowerCase();
  const khmerDesc = [];
  for (const [key, desc] of Object.entries(KHMER_INSTRUMENT_DESCRIPTIONS)) {
    if (lower.includes(key)) khmerDesc.push(desc);
  }
  if (khmerDesc.length > 0) {
    lines.push('');
    lines.push('IMPORTANT - CAMBODIAN TRADITIONAL INSTRUMENTS REQUIRED:');
    lines.push('The following Cambodian Khmer instruments MUST be clearly audible and prominent in the generated audio:');
    khmerDesc.forEach((d, i) => lines.push('- ' + d));
    lines.push('');
    lines.push('Sound design requirements:');
    lines.push('- These instruments must be the PRIMARY melodic or rhythmic voice in the arrangement.');
    lines.push('- Preserve the authentic acoustic timbres of each Cambodian instrument.');
    lines.push('- The overall music texture must sound Southeast Asian and Cambodian.');
    lines.push('- Do NOT replace these with generic Western instrument equivalents.');
    lines.push('- Start the song intro with one of these Khmer instruments clearly audible in the first 0:00-0:20.');
    lines.push('- Bring another selected Khmer instrument forward in the chorus or bridge.');
    lines.push('- Keep Khmer percussion or melody present throughout, not only as background texture.');
  }
  return lines;
}


/* ── WAV audio concatenation for MAX plan dual-segment songs ── */
function concatWavBuffers(buf1, buf2, maxSeconds) {
  try {
    const b1 = Buffer.from(buf1, 'base64');
    const b2 = Buffer.from(buf2, 'base64');
    const hdr    = b1.slice(0, 44);
    const pcm1   = b1.slice(44);
    const pcm2   = b2.length > 44 ? b2.slice(44) : b2;
    let   pcmAll = Buffer.concat([pcm1, pcm2]);

    /* ── Trim to maxSeconds if provided ── */
    if (maxSeconds && maxSeconds > 0) {
      // Read sample rate + bit depth + channels from WAV header
      const sampleRate  = hdr.readUInt32LE(24); // bytes 24-27
      const numChannels = hdr.readUInt16LE(22); // bytes 22-23
      const bitsPerSamp = hdr.readUInt16LE(34); // bytes 34-35
      const bytesPerSec = sampleRate * numChannels * (bitsPerSamp / 8);
      const maxBytes    = Math.floor(bytesPerSec * maxSeconds);
      if (pcmAll.length > maxBytes) {
        console.log('[concatWav] trimming from ' + (pcmAll.length/bytesPerSec).toFixed(1) + 's to ' + maxSeconds + 's');
        pcmAll = pcmAll.slice(0, maxBytes);
      }
    }

    const out = Buffer.concat([hdr, pcmAll]);
    out.writeUInt32LE(pcmAll.length,      40);
    out.writeUInt32LE(pcmAll.length + 36,  4);
    return out.toString('base64');
  } catch (e) {
    console.warn('[concatWav]', e.message);
    return buf1;
  }
}

/* Trim a single WAV buffer to maxSeconds */
/* Trim audio buffer (WAV or raw L16 PCM) to maxSeconds.
   Lyria returns audio/L16;rate=24000 = raw 16-bit PCM, no WAV header.
   We detect format by checking for RIFF magic bytes. */
function trimAudioBuffer(buf64, maxSeconds, mimeType) {
  try {
    const buf  = Buffer.from(buf64, 'base64');
    const mime = (mimeType || '').toLowerCase();

    /* ── WAV format: has "RIFF" magic at bytes 0-3 ── */
    if (buf.length > 44 && buf.slice(0,4).toString('ascii') === 'RIFF') {
      const hdr         = buf.slice(0, 44);
      let   pcm         = buf.slice(44);
      const sampleRate  = hdr.readUInt32LE(24);
      const numChannels = hdr.readUInt16LE(22);
      const bitsPerSamp = hdr.readUInt16LE(34);
      const bytesPerSec = sampleRate * numChannels * (bitsPerSamp / 8);
      const maxBytes    = Math.floor(bytesPerSec * maxSeconds);
      if (pcm.length > maxBytes) {
        console.log('[trimAudio/WAV] ' + (pcm.length/bytesPerSec).toFixed(1) + 's → ' + maxSeconds + 's');
        pcm = pcm.slice(0, maxBytes);
        const out = Buffer.concat([hdr, pcm]);
        out.writeUInt32LE(pcm.length,      40);
        out.writeUInt32LE(pcm.length + 36,  4);
        return out.toString('base64');
      }
      return buf64;
    }

    /* ── Raw L16 PCM (Lyria default): no header ── */
    /* Extract sample rate from mimeType e.g. "audio/l16;rate=24000" */
    const rateMatch  = mime.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000; /* Lyria default: 24000 */
    const numChannels = mime.includes('channels=2') ? 2 : 1;       /* Lyria default: mono */
    const bytesPerSec = sampleRate * numChannels * 2;               /* 16-bit = 2 bytes/sample */
    const maxBytes    = Math.floor(bytesPerSec * maxSeconds);
    if (buf.length > maxBytes) {
      console.log('[trimAudio/L16] ' + (buf.length/bytesPerSec).toFixed(1) + 's → ' + maxSeconds + 's (rate:' + sampleRate + ')');
      return buf.slice(0, maxBytes).toString('base64');
    }
    return buf64;
  } catch (e) {
    console.warn('[trimAudio]', e.message);
    return buf64;
  }
}
/* Alias for backwards compat */
const trimWavBuffer = (b, s) => trimAudioBuffer(b, s, 'audio/wav');

app.post('/api/song', auth, async (req, res) => {
  try {
    const key     = geminiKey();
    const planKey = await getUserPlan(req.user.id);
    const planCfg = PLAN_CONFIG[planKey];
    const { prompt = '', style = 'Pop', voice = 'Female', customLyrics = '', instrument = '', tempo = '', mood = '' } = req.body;

    if (!prompt && !customLyrics)
      return res.status(400).json({ error: 'Please provide a song description or custom lyrics.' });

    // customLyrics via prompt textarea — no plan gate needed
    const isFemale  = voice.toLowerCase().includes('female') || !voice.toLowerCase().includes('male');
    const voiceHint = isFemale ? 'female vocalist' : 'male vocalist';
    const ttsVoice  = isFemale ? 'Aoede' : 'Charon';

    console.log(`[/api/song] user:${req.user.id} plan:${planKey} style:${style} voice:${voiceHint}`);

    let musicPrompt;
    if (customLyrics && planCfg.customLyrics) {
      musicPrompt = [
        `[DURATION REQUIREMENT: Generate audio that is ${planCfg.durationHint}. This is a strict requirement.]`,
        `[TIMING GUIDE: Use explicit structure timestamps so the total runtime lands inside the required duration window.]`,
        (planKey === 'proplus') ? `[ENFORCEMENT: Generate between 3 minutes and 3 minutes 25 seconds. Target 3:15. Use extended structure with bridge section.]` :
        planKey === 'max' ? `[ENFORCEMENT: Generate between 4 minutes 25 seconds and 5 minutes 25 seconds. Target 5:00. Use full song structure with solo section and extended outro.]` : '',
        `Use EXACTLY the following lyrics - do not change any words:`,
        `---`,
        customLyrics.trim(),
        `---`,
        `Vocalist: ${voiceHint}. Genre: ${style}.`,
        `Structure: ${planCfg.structureHint}.`,
        `Audio: high-quality stereo, full band instrumentation, clear lead vocals, backing harmonies.`,
        ...buildInstrumentPrompt(instrument),
        ...(tempo      ? ['Tempo: '+tempo+'.']                    : []),
        ...(mood       ? ['Mood/Feel: '+mood+'.']                 : []),
        `Target duration: ${planCfg.durationHint}.`,
        planKey === 'pro' ? '[TIMESTAMPS] [0:00-0:20 Instrumental Intro] [0:20-0:50 Verse 1] [0:50-1:00 Pre-Chorus] [1:00-1:25 Chorus] [1:25-1:45 Instrumental Break] [1:45-2:10 Verse 2] [2:10-2:35 Chorus] [2:35-2:55 Final Chorus] [2:55-3:05 Instrumental Outro]' : '',
        planKey === 'proplus' ? '[TIMESTAMPS] [0:00-0:25 Extended Intro] [0:25-0:55 Verse 1] [0:55-1:07 Pre-Chorus] [1:07-1:32 Chorus] [1:32-1:54 Break] [1:54-2:22 Verse 2] [2:22-2:34 Pre-Chorus] [2:34-2:59 Chorus] [2:59-3:14 Bridge] [3:14-3:39 Final Chorus+Outro]' : '',
        planKey === 'max' ? '[TIMESTAMPS] [0:00-0:35 Extended Intro] [0:35-1:10 Verse 1] [1:10-1:25 Pre-Chorus] [1:25-1:55 Chorus] [1:55-2:25 Break] [2:25-2:55 Verse 2] [2:55-3:10 Pre-Chorus] [3:10-3:40 Chorus] [3:40-4:00 Bridge] [4:00-4:25 Solo] [4:25-4:55 Final Chorus] [4:55-5:25 Extended Outro]' : '',
      ].join('\n');
    } else {
      musicPrompt = [
        `[DURATION REQUIREMENT: Generate audio that is ${planCfg.durationHint}. This is a strict requirement.]`,
        `[TIMING GUIDE: Use explicit structure timestamps so the total runtime lands inside the required duration window.]`,
        `Theme/Story: ${prompt}`,
        `Vocalist: ${voiceHint}. Genre: ${style}.`,
        `Song structure: ${planCfg.structureHint}.`,
        ``,
        `RHYMING RULES — YOU MUST FOLLOW STRICTLY:`,
        `- Every 2 or 4 lines MUST end-rhyme using AABB or ABAB pattern.`,
        `- If Khmer (ភាសាខ្មែរ): use beautiful Khmer end-rhyme (ជួនពាក្យ) that sounds natural when sung.`,
        `  Khmer rhyme examples:`,
        `    ស្រុកស្រែស្នេហ៍ខ្ញុំ / ក្រមុំតូចធំ  (ខ្ញុំ rhymes with ធំ)`,
        `    នាំគ្នាទៅវត្ត / ម្តាយអើយកុំឃាត់  (វត្ត rhymes with ឃាត់)`,
        `  Every line must have a natural Khmer end-sound that rhymes with the paired line.`,
        `- If English: clear end-rhyme per couplet; internal rhyme is welcome bonus.`,
        `- NEVER write 2+ consecutive lines with zero rhyme. Every pair must rhyme.`,
        `- If Rap/Hip-hop style: use rapid rhyme flow, multi-syllable rhymes per line.`,
        `- If Remix style: modern beat structure, catchy hook that repeats with rhyme.`,
        ``,
        `Language: auto-detect from theme (Khmer / English / mixed). Match the theme language exactly.`,
        `Audio: high-quality stereo, full band instrumentation, clear lead vocals, backing harmonies.`,
        ...buildInstrumentPrompt(instrument),
        ...(tempo      ? ['Tempo: '+tempo+'.']                    : []),
        ...(mood       ? ['Mood/Feel: '+mood+'.']                 : []),
        `Target duration: ${planCfg.durationHint}.`,
        planKey === 'pro' ? '[TIMESTAMPS] [0:00-0:20 Instrumental Intro] [0:20-0:50 Verse 1] [0:50-1:00 Pre-Chorus] [1:00-1:25 Chorus] [1:25-1:45 Instrumental Break] [1:45-2:10 Verse 2] [2:10-2:35 Chorus] [2:35-2:55 Final Chorus] [2:55-3:05 Instrumental Outro]' : '',
        planKey === 'proplus' ? '[TIMESTAMPS] [0:00-0:25 Extended Intro] [0:25-0:55 Verse 1] [0:55-1:07 Pre-Chorus] [1:07-1:32 Chorus] [1:32-1:54 Break] [1:54-2:22 Verse 2] [2:22-2:34 Pre-Chorus] [2:34-2:59 Chorus] [2:59-3:14 Bridge] [3:14-3:39 Final Chorus+Outro]' : '',
        planKey === 'max' ? '[TIMESTAMPS] [0:00-0:35 Extended Intro] [0:35-1:10 Verse 1] [1:10-1:25 Pre-Chorus] [1:25-1:55 Chorus] [1:55-2:25 Break] [2:25-2:55 Verse 2] [2:55-3:10 Pre-Chorus] [3:10-3:40 Chorus] [3:40-4:00 Bridge] [4:00-4:25 Solo] [4:25-4:55 Final Chorus] [4:55-5:25 Extended Outro]' : '',
        planKey === 'free'
          ? '[TIMESTAMPS] [0:00-0:08 Short Instrumental Intro] [0:08-0:28 Verse] [0:28-0:46 Chorus] [0:46-0:55 Outro] — MUST end before 60 seconds'
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
        lyriaModels = [...new Set([...sorted.filter(x => /lyria-3-pro-preview/i.test(x)), ...LYRIA_MODELS_FALLBACK])];
      }
    } catch (me) { console.warn('[/api/song] model discovery failed:', me.message); }

    let audioResult = null, lyricsText = '', usedModel = '';

    /* helper: single Lyria call */
    async function _lyriaCall(mdl, prompt) {
      const _r = await fetch(`${GEMINI}/${mdl}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['AUDIO', 'TEXT'], temperature: 1.0 },
        }),
      });
      const _d = await safeJson(_r, 'Lyria ' + mdl);
      if (!_r.ok) throw new Error(_d.error?.message || ('HTTP ' + _r.status));
      let _txt = '', _audio = null;
      for (const _c of (_d.candidates || []))
        for (const _p of (_c.content?.parts || [])) {
          if (_p.text)              _txt   = _p.text;
          if (_p.inlineData?.data)  _audio = _p.inlineData;
        }
      if (!_audio) throw new Error('No audio (' + (_d.candidates?.[0]?.finishReason || 'UNKNOWN') + ')');
      return { txt: _txt, audio: _audio };
    }

    for (const model of lyriaModels) {
      try {
        console.log('[/api/song] trying Lyria: ' + model + ' plan:' + planKey);

        /* Single Lyria call for all plans — MAX uses extended instrumental structure via prompt */
          const _res_single = await _lyriaCall(model, musicPrompt);
          lyricsText  = _res_single.txt;
          /* Apply hard trim per plan */
          const _planMime2   = _res_single.audio.mimeType || 'audio/l16;rate=24000';
          const _planTrimSec = planKey === 'free' ? 60 : planKey === 'pro' ? 185 : planKey === 'proplus' ? 210 : 315;
          audioResult = { data: trimAudioBuffer(_res_single.audio.data, _planTrimSec, _planMime2), mimeType: _planMime2 };

        

        usedModel = model;
        console.log('[/api/song] Lyria done: ' + model);
        break;
      } catch (err) {
        console.warn('[/api/song] Lyria ' + model + ' failed:', err.message);
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

/* -
   STRIPE PAYMENT ROUTES
   - */

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try { return require('stripe')(key); } catch { return null; }
}

const APP_URL = process.env.APP_URL || 'https://app.jeethylabs.site';

const STRIPE_PRICES = {
  pro:     process.env.STRIPE_PRICE_PRO     || '',
  proplus: process.env.STRIPE_PRICE_PROPLUS || '',
  max:     process.env.STRIPE_PRICE_MAX     || '',
};

app.get('/api/stripe/plans', (req, res) => {
  const key = process.env.STRIPE_SECRET_KEY || '';
  res.json({
    configured: !!key,
    testMode:   key.startsWith('sk_test'),
    plans: {
      pro:     { name: 'PRO',  price: '$5.99/mo',  priceId: STRIPE_PRICES.pro     || 'NOT_SET' },
      proplus: { name: 'PRO+', price: '$24.99/mo', priceId: STRIPE_PRICES.proplus || 'NOT_SET' },
      max:     { name: 'MAX',  price: 'TBA',        priceId: STRIPE_PRICES.max     || 'NOT_SET' },
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

/* -
   SUBSCRIBE / CHECKOUT ROUTES
   - */

app.post('/api/subscribe', auth, async (req, res) => {
  try {
    const { plan } = req.body;
    const planKey  = (plan || '').toLowerCase();
    if (!['free','pro','proplus','max'].includes(planKey))
      return res.status(400).json({ error: 'Invalid plan. Choose: free, pro, max' });

    /* - Downgrade to free - */
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

    /* - Upgrade: try Stripe first - */
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

    /* - Manual / test mode - */
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

/* - SPA fallback - */
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`JeeThy Labs -> port ${PORT}`));
