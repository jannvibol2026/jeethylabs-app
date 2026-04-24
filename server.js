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

/* ── ENV ── */
const DATABASE_URL  = process.env.DATABASE_URL;
const JWT_SECRET    = process.env.JWT_SECRET    || 'jeethylabs_secret_2026';
const SESSION_SECRET= process.env.SESSION_SECRET|| JWT_SECRET;
const SMTP_USER     = process.env.SMTP_USER     || '';
const SMTP_PASS     = process.env.SMTP_PASS     || '';
const FROM_EMAIL    = process.env.FROM_EMAIL    || SMTP_USER;
const GEMINI_KEY    = process.env.GEMINI_API_KEY|| '';   // ← Railway env var
const PORT          = process.env.PORT          || 8080;

/* ── CORS: allow all origins + Authorization header ── */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

/* ── SESSION: cookie-based, 30-day persistent ── */
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000   // 30 days
  }
}));

app.use(express.static(path.join(__dirname)));

console.log('=== JeeThy Labs Starting ===');
console.log('SMTP_USER:',  SMTP_USER  || 'MISSING');
console.log('SMTP_PASS:',  SMTP_PASS  ? 'SET' : 'MISSING');
console.log('GEMINI_KEY:', GEMINI_KEY ? 'SET ✅' : '❌ MISSING — add GEMINI_API_KEY in Railway');

/* ── SMTP ── */
const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com', port: 587, secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});
transporter.verify(err => err
  ? console.error('SMTP Error:', err.message)
  : console.log('Brevo SMTP Ready ✅'));

/* ── DB ── */
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.connect()
  .then(c => { console.log('DB Connected ✅'); c.release(); initDb(); })
  .catch(e => console.error('DB Error:', e.message));

/* ── DB MIGRATION: ensure all required columns exist ── */
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
  console.log('DB schema ready ✅');
}

/* ── HELPERS ── */
const otpStore = {};
const genOTP   = () => Math.floor(100000 + Math.random() * 900000).toString();

async function sendEmail(to, subject, html) {
  const info = await transporter.sendMail({ from: `"JeeThy Labs" <${FROM_EMAIL}>`, to, subject, html });
  console.log('[email] sent to', to, '| id:', info.messageId);
  return info;
}

/* ── AUTH MIDDLEWARE ── */
/* Accepts JWT from:
   1. Authorization: Bearer <token>  header  (API calls)
   2. req.session.token               cookie  (browser sessions)
*/
function auth(req, res, next) {
  const hdr   = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : (req.session && req.session.token) || null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

/* ════════════════════════════════════════════
   AUTH ROUTES
   ════════════════════════════════════════════ */

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  smtp:   !!SMTP_USER && !!SMTP_PASS,
  gemini: !!GEMINI_KEY
}));

/* /api/key  — return owner Gemini API key for frontend use */
app.get('/api/key', (req, res) => {
  if (!GEMINI_KEY) return res.status(503).json({ error: 'API key not configured', key: '' });
  res.json({ key: GEMINI_KEY });
});

/* /api/send-otp */
app.post('/api/send-otp', async (req, res) => {
  const { email, name, password } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const otp = genOTP();
  otpStore[email] = { otp, name: name||'', password: password||'', expires: Date.now() + 10*60*1000 };
  console.log('[otp] →', email, '| code:', otp);
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

/* /api/verify-otp  → creates account + returns token */
app.post('/api/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const rec = otpStore[email];
  if (!rec)                         return res.status(400).json({ error: 'No OTP found. Request a new one.' });
  if (Date.now() > rec.expires)     { delete otpStore[email]; return res.status(400).json({ error: 'OTP expired.' }); }
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
    req.session.token = token;   // persist in httpOnly cookie
    res.json({ success:true, token, user:{ id:u.id, name:u.name, email:u.email, plan:u.plan||'free', avatar_url:u.avatar_url||null, created_at:u.created_at } });
  } catch (e) {
    console.error('[verify-otp]', e.message);
    res.status(500).json({ error: 'Registration failed: ' + e.message });
  }
});

/* /api/login */
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
    req.session.token = token;   // persist in httpOnly cookie
    res.json({ success:true, token, user:{ id:u.id, name:u.name, email:u.email, plan:u.plan||'free', avatar_url:u.avatar_url||null, created_at:u.created_at } });
  } catch (e) {
    res.status(500).json({ error: 'Login failed: ' + e.message });
  }
});

/* /api/me  — restore session from stored token */
app.get('/api/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,user_id,name,email,avatar_url,plan,status,created_at,last_active FROM users WHERE id=$1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* /api/forgot-password */
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

/* /api/reset-password */
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

/* /api/profile  GET / POST */
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

/* /api/avatar  — dedicated avatar upload */
app.post('/api/avatar', auth, async (req, res) => {
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ error: 'No avatar data' });
  try {
    await pool.query('UPDATE users SET avatar_url=$1,last_active=$2 WHERE id=$3', [avatar, new Date(), req.user.id]);
    res.json({ success:true, avatar_url: avatar });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* /api/upload-avatar  — alias used by frontend (accepts avatar_url field) */
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

/* ════════════════════════════════════════════
   GEMINI PROXY ROUTES
   Uses  GEMINI_API_KEY  from Railway env — never exposed to client
   ════════════════════════════════════════════ */

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

/* helper: get API key — server key only (no client key) */
function geminiKey() {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY is not set in Railway environment variables.');
  return GEMINI_KEY;
}

/* /api/chat */
app.post('/api/chat', async (req, res) => {
  try {
    const key = geminiKey();
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

/* ── Shared retry helper: exponential backoff ── */
async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 1000, label = 'op' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const isOverload = /overload|high demand|quota|rate.?limit|503|429/i.test(err.message || '');
      if (!isOverload || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[${label}] attempt ${attempt} failed (${err.message}) — retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/* /api/image
   Uses Imagen 3 (:predict endpoint) — proven reliable.
   Falls back to gemini-2.0-flash-preview-image-generation (:generateContent) if Imagen fails.
*/
const IMAGEN_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

app.post('/api/image', async (req, res) => {
  try {
    const key = geminiKey();
    const { prompt, aspectRatio = '1:1', style = '' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const styleHint  = style && style.toLowerCase() !== 'none' ? `, style: ${style}` : '';
    const fullPrompt = `${prompt}${styleHint}`;
    console.log('[/api/image] prompt:', fullPrompt.slice(0, 120), '| aspectRatio:', aspectRatio);

    /* ── Primary: Imagen 3 via :predict ── */
    const img = await withRetry(async (attempt) => {
      if (attempt > 1) console.log(`[/api/image] Imagen3 retry attempt ${attempt}`);

      const body = JSON.stringify({
        instances:  [{ prompt: fullPrompt }],
        parameters: {
          sampleCount:      1,
          aspectRatio:      aspectRatio,
          personGeneration: 'allow_adult'
        }
      });

      const r = await fetch(
        `${IMAGEN_BASE}/imagen-3.0-generate-002:predict?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
      );
      const d = await r.json();

      if (!r.ok) {
        const msg = d.error?.message || `Imagen API error (HTTP ${r.status})`;
        console.error('[/api/image] Imagen3 error:', JSON.stringify(d.error || d));
        throw new Error(msg);
      }

      const predictions = d.predictions || [];
      console.log('[/api/image] Imagen3 predictions:', predictions.length);

      if (predictions.length && predictions[0].bytesBase64Encoded) {
        const pred = predictions[0];
        return { data: pred.bytesBase64Encoded, mimeType: pred.mimeType || 'image/png' };
      }

      console.error('[/api/image] Imagen3 returned no predictions:', JSON.stringify(d));
      throw new Error('No image returned by Imagen 3. Try a more descriptive prompt.');
    }, { maxAttempts: 3, baseDelayMs: 1500, label: '/api/image Imagen3' });

    console.log('[/api/image] success — mimeType:', img.mimeType, '| bytes:', img.data?.length);
    res.json({ data: img.data, mimeType: img.mimeType || 'image/png' });
  } catch (e) {
    console.error('[/api/image] Imagen3 failed, trying flash fallback:', e.message);

    /* ── Fallback: gemini-2.0-flash-preview-image-generation ── */
    try {
      const key = geminiKey();
      const { prompt, aspectRatio = '1:1', style = '' } = req.body;
      const styleHint  = style && style.toLowerCase() !== 'none' ? `, style: ${style}` : '';
      const fullPrompt = `${prompt}${styleHint}`;

      const fallbackImg = await withRetry(async (attempt) => {
        if (attempt > 1) console.log(`[/api/image] flash fallback retry ${attempt}`);

        const body = JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: {
            responseModalities: ['IMAGE', 'TEXT'],
            imageGenerationConfig: { aspectRatio }
          }
        });

        const r = await fetch(
          `${GEMINI}/gemini-2.0-flash-preview-image-generation:generateContent?key=${key}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
        );
        const d = await r.json();

        if (!r.ok) {
          const msg = d.error?.message || `Flash image API error (HTTP ${r.status})`;
          console.error('[/api/image] flash fallback error:', JSON.stringify(d.error || d));
          throw new Error(msg);
        }

        for (const c of (d.candidates || [])) {
          for (const p of (c.content?.parts || [])) {
            if (p.inlineData?.data) {
              console.log('[/api/image] flash fallback success');
              return p.inlineData;
            }
          }
        }

        const reason = d.candidates?.[0]?.finishReason || 'UNKNOWN';
        if (reason === 'IMAGE_SAFETY')
          throw new Error('Image blocked by safety filters. Please try a different prompt.');
        throw new Error('No image returned by fallback model. Try a more descriptive prompt.');
      }, { maxAttempts: 2, baseDelayMs: 1500, label: '/api/image flash-fallback' });

      console.log('[/api/image] fallback success — mimeType:', fallbackImg.mimeType);
      res.json({ data: fallbackImg.data, mimeType: fallbackImg.mimeType || 'image/png' });
    } catch (fallbackErr) {
      console.error('[/api/image] all models failed:', fallbackErr.message);
      res.status(500).json({ error: fallbackErr.message });
    }
  }
});

/* /api/song
   Strategy:
   1. Use gemini-2.5-flash to generate full song lyrics + metadata.
   2. PRIMARY: Try Lyria (lyria-realtime-exp) — Google's dedicated music generation model.
   3. FALLBACK: Try TTS models (gemini-2.5-flash-preview-tts → gemini-2.5-pro-preview-tts).
   4. If all audio models fail, return lyrics-only so the frontend can still display them.
*/

/* Lyria music generation — Google's dedicated AI music model */
async function tryLyria(key, musicPrompt) {
  const LYRIA_MODELS = [
    'lyria-realtime-exp',
  ];

  for (const model of LYRIA_MODELS) {
    try {
      const result = await withRetry(async (attempt) => {
        if (attempt > 1) console.log(`[/api/song] Lyria ${model} retry attempt ${attempt}`);
        console.log(`[/api/song] Trying Lyria model: ${model} | attempt: ${attempt}`);

        const r = await fetch(`${GEMINI}/${model}:generateContent?key=${key}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: musicPrompt }] }],
            generationConfig: { responseModalities: ['AUDIO'] }
          })
        });
        const d = await r.json();

        if (!r.ok) {
          const msg = d.error?.message || `Lyria HTTP ${r.status}`;
          console.warn(`[/api/song] Lyria model ${model} failed (HTTP ${r.status}):`, msg);
          throw new Error(msg);
        }

        for (const c of (d.candidates || [])) {
          for (const p of (c.content?.parts || [])) {
            if (p.inlineData?.data) {
              console.log(`[/api/song] Lyria success with ${model} | mimeType: ${p.inlineData.mimeType}`);
              return { data: p.inlineData.data, mimeType: p.inlineData.mimeType || 'audio/mp3', model };
            }
          }
        }

        const reason = d.candidates?.[0]?.finishReason;
        console.warn(`[/api/song] Lyria model ${model} returned no audio. finishReason:`, reason,
          '| response keys:', JSON.stringify(Object.keys(d)));
        throw new Error(`No audio data from Lyria ${model} (finishReason: ${reason || 'UNKNOWN'})`);
      }, { maxAttempts: 3, baseDelayMs: 1500, label: `/api/song Lyria ${model}` });

      if (result) return result;
    } catch (err) {
      console.warn(`[/api/song] Lyria model ${model} exhausted retries:`, err.message);
    }
  }
  return null;
}

/* TTS fallback models to try in order */
const TTS_MODELS = [
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
];

/* Try each TTS model with exponential backoff retries per model */
async function tryTts(key, ttsText, voiceName) {
  for (const model of TTS_MODELS) {
    try {
      const result = await withRetry(async (attempt) => {
        if (attempt > 1) console.log(`[/api/song] TTS ${model} retry attempt ${attempt}`);
        console.log(`[/api/song] Trying TTS model: ${model} | voice: ${voiceName} | attempt: ${attempt}`);

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
        const d = await r.json();

        if (!r.ok) {
          const msg = d.error?.message || `TTS HTTP ${r.status}`;
          console.warn(`[/api/song] TTS model ${model} failed (HTTP ${r.status}):`, msg);
          throw new Error(msg);
        }

        for (const c of (d.candidates || [])) {
          for (const p of (c.content?.parts || [])) {
            if (p.inlineData?.data) {
              console.log(`[/api/song] TTS success with ${model} | mimeType: ${p.inlineData.mimeType}`);
              return { data: p.inlineData.data, mimeType: p.inlineData.mimeType || 'audio/wav', model };
            }
          }
        }

        const reason = d.candidates?.[0]?.finishReason;
        console.warn(`[/api/song] TTS model ${model} returned no audio. finishReason:`, reason,
          '| parts:', JSON.stringify(d.candidates?.[0]?.content?.parts?.map(p => Object.keys(p))));
        throw new Error(`No audio data from ${model} (finishReason: ${reason || 'UNKNOWN'})`);
      }, { maxAttempts: 3, baseDelayMs: 1000, label: `/api/song TTS ${model}` });

      if (result) return result;
    } catch (err) {
      console.warn(`[/api/song] TTS model ${model} exhausted retries:`, err.message);
      /* Continue to next model */
    }
  }
  return null;
}

app.post('/api/song', async (req, res) => {
  try {
    const key = geminiKey();
    const { prompt, style='Pop', voice='Female' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const isFemaleVoice = !voice.toLowerCase().includes('male') || voice.toLowerCase().includes('female');
    const voiceLabel    = isFemaleVoice ? 'Female' : 'Male';
    const ttsVoiceName  = isFemaleVoice ? 'Aoede' : 'Charon';

    console.log(`[/api/song] prompt: "${prompt.slice(0,80)}" | style: ${style} | voice: ${voiceLabel}`);

    /* ── Step 1: Generate song lyrics via Gemini Flash ── */
    const lyricsPrompt =
      `You are a professional songwriter. Write a complete, original ${style} song about: "${prompt}".\nInclude:\n- A creative song title (prefix with "Title: ")\n- Verse 1 (label as [Verse 1])\n- Pre-Chorus or Bridge (label as [Pre-Chorus] or [Bridge])\n- Chorus (label as [Chorus])\n- Verse 2 (label as [Verse 2])\n- Final Chorus (label as [Chorus])\n- Outro (label as [Outro])\nVocalist style: ${voiceLabel}. Genre: ${style}.\nWrite only the song — no explanations or commentary.`;

    const lyricsRes = await fetch(`${GEMINI}/gemini-2.5-flash:generateContent?key=${key}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents:[{ parts:[{ text: lyricsPrompt }] }] })
    });
    const lyricsData = await lyricsRes.json();
    if (!lyricsRes.ok) {
      console.error('[/api/song] Lyrics generation failed:', lyricsData.error?.message);
      return res.status(lyricsRes.status).json({ error: lyricsData.error?.message || 'Lyrics generation failed' });
    }

    const lyricsText = lyricsData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!lyricsText) return res.status(500).json({ error: 'No lyrics generated. Please try again.' });

    console.log(`[/api/song] Lyrics generated (${lyricsText.length} chars)`);

    /* Extract title */
    const titleMatch = lyricsText.match(/^Title:\s*(.+)$/im);
    const songTitle  = titleMatch ? titleMatch[1].trim() : `${style} Song`;

    /* ── Step 2: Generate audio — try Lyria first, then TTS fallback ── */
    const cleanLyrics = lyricsText.replace(/^Title:.*$/im, '').trim();

    /* Build a rich music prompt for Lyria */
    const lyriaPrompt =
      `Generate a ${style} song with ${voiceLabel.toLowerCase()} vocals.\n` +
      `Lyrics:\n${cleanLyrics}`;

    console.log(`[/api/song] Attempting Lyria music generation...`);
    let audioResult = await tryLyria(key, lyriaPrompt);
    let audioSource = audioResult ? `Lyria (${audioResult.model})` : null;

    /* Fallback to TTS if Lyria is unavailable */
    if (!audioResult) {
      console.log(`[/api/song] Lyria unavailable — falling back to TTS...`);
      audioResult = await tryTts(key, cleanLyrics, ttsVoiceName);
      audioSource = audioResult ? `TTS (${audioResult.model})` : null;
    }

    if (!audioResult) {
      console.warn('[/api/song] All audio models exhausted — returning lyrics only');
    } else {
      console.log(`[/api/song] Audio generated via ${audioSource}`);
    }

    res.json({
      audio:       audioResult ? audioResult.data : null,
      mimeType:    audioResult ? audioResult.mimeType : 'audio/wav',
      title:       songTitle,
      lyrics:      lyricsText,
      lyricsOnly:  !audioResult,
      audioSource: audioSource,
      ttsMessage:  !audioResult
        ? 'Audio generation is temporarily unavailable due to high demand. Your lyrics are ready — try again in a few minutes for audio.'
        : null
    });
  } catch (e) {
    console.error('[/api/song] exception:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── SPA fallback ── */
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`JeeThy Labs → port ${PORT}`));
