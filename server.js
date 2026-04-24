'use strict';
const express    = require('express');
const { Pool }   = require('pg');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cors       = require('cors');
const path       = require('path');

const app = express();

/* ── CORS: allow all origins + Authorization header ── */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

/* ── ENV ── */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET   = process.env.JWT_SECRET   || 'jeethylabs_secret_2026';
const SMTP_USER    = process.env.SMTP_USER     || '';
const SMTP_PASS    = process.env.SMTP_PASS     || '';
const FROM_EMAIL   = process.env.FROM_EMAIL    || SMTP_USER;
const GEMINI_KEY   = process.env.GEMINI_API_KEY|| '';   // ← Railway env var
const PORT         = process.env.PORT          || 8080;

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
  .then(c => { console.log('DB Connected ✅'); c.release(); })
  .catch(e => console.error('DB Error:', e.message));

/* ── HELPERS ── */
const otpStore = {};
const genOTP   = () => Math.floor(100000 + Math.random() * 900000).toString();

async function sendEmail(to, subject, html) {
  const info = await transporter.sendMail({ from: `"JeeThy Labs" <${FROM_EMAIL}>`, to, subject, html });
  console.log('[email] sent to', to, '| id:', info.messageId);
  return info;
}

/* ── AUTH MIDDLEWARE ── */
/* Reads JWT from  Authorization: Bearer <token>  header */
function auth(req, res, next) {
  const hdr   = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
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
    const token = jwt.sign({ id:u.id, email:u.email }, JWT_SECRET, { expiresIn:'7d' });
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
    const token = jwt.sign({ id:u.id, email:u.email }, JWT_SECRET, { expiresIn:'7d' });
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

app.post('/api/logout', (req, res) => res.json({ success:true }));

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

/* /api/image */
app.post('/api/image', async (req, res) => {
  try {
    const key = geminiKey();
    const { prompt, aspectRatio = '1:1' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const r = await fetch(`${GEMINI}/gemini-2.0-flash-preview-image-generation:generateContent?key=${key}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        contents:[{ parts:[{ text: prompt }] }],
        generationConfig:{ responseModalities:['IMAGE','TEXT'], imageConfig:{ aspectRatio } }
      })
    });
    const d = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: d.error?.message || 'Gemini error' });
    let img = null;
    for (const c of (d.candidates||[])) for (const p of (c.content?.parts||[])) if (p.inlineData?.data) { img=p.inlineData; break; }
    if (!img) return res.status(500).json({ error: 'No image returned. Try a different prompt.' });
    res.json({ data: img.data, mimeType: img.mimeType||'image/png' });
  } catch (e) {
    console.error('[/api/image]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* /api/song */
app.post('/api/song', async (req, res) => {
  try {
    const key = geminiKey();
    const { prompt, style='Pop', voice='Female' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const vName = voice.toLowerCase().includes('female') ? 'Aoede' : 'Charon';
    const txt   = `Create a full ${style} song about: ${prompt}. ${vName==='Aoede'?'Female':'Male'} vocalist, full arrangement, verses, chorus, bridge.`;
    const r = await fetch(`${GEMINI}/gemini-2.5-pro-preview-tts:generateContent?key=${key}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        contents:[{ parts:[{ text: txt }] }],
        generationConfig:{ responseModalities:['AUDIO'], speechConfig:{ voiceConfig:{ prebuiltVoiceConfig:{ voiceName: vName } } } }
      })
    });
    const d = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: d.error?.message || 'Gemini error' });
    let audio=null, mime='audio/mp3', lyrics='';
    for (const c of (d.candidates||[])) for (const p of (c.content?.parts||[])) {
      if (p.inlineData?.data && !audio) { audio=p.inlineData.data; mime=p.inlineData.mimeType||'audio/mp3'; }
      if (p.text) lyrics += p.text;
    }
    if (!audio) return res.status(500).json({ error: 'No audio returned. Please try again.' });
    const tm = lyrics.match(/(?:title|song name)[:\s]+([^\n]+)/i);
    res.json({ audio, mimeType: mime, title: tm?tm[1].trim():`${style} Song`, lyrics });
  } catch (e) {
    console.error('[/api/song]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── SPA fallback ── */
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`JeeThy Labs → port ${PORT}`));
