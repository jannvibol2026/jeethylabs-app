const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname)));

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET   = process.env.JWT_SECRET || 'secret123';
const SMTP_USER    = process.env.SMTP_USER || '';
const SMTP_PASS    = process.env.SMTP_PASS || '';
const FROM_EMAIL   = process.env.FROM_EMAIL || SMTP_USER;
const PORT         = process.env.PORT || 8080;

console.log('=== JeeThy Labs Starting ===');
console.log('SMTP_USER:', SMTP_USER || 'MISSING');
console.log('SMTP_PASS:', SMTP_PASS ? 'set' : 'MISSING');
console.log('FROM_EMAIL:', FROM_EMAIL || 'MISSING');

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

transporter.verify((err) => {
  if (err) console.error('SMTP Error:', err.message);
  else console.log('Brevo SMTP Ready');
});

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.connect()
  .then(c => { console.log('DB Connected'); c.release(); })
  .catch(e => console.error('DB Error:', e.message));

const otpStore = {};

function genOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmail(to, subject, html) {
  const info = await transporter.sendMail({
    from: `"JeeThy Labs" <${FROM_EMAIL}>`,
    to, subject, html,
  });
  console.log('[sendEmail] messageId:', info.messageId);
  return info;
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    smtp_user: SMTP_USER || 'MISSING',
    smtp_ready: !!SMTP_USER && !!SMTP_PASS,
    from_email: FROM_EMAIL || 'MISSING',
  });
});

app.get('/api/key', (req, res) => {
  res.json({ key: process.env.GOOGLE_API_KEY || '' });
});

app.post('/api/send-otp', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const otp = genOTP();
  const password_hash = req.body.password_hash || req.body.password || '';

  otpStore[email] = {
    otp,
    name: name || '',
    password_hash,
    expires: Date.now() + 10 * 60 * 1000,
  };

  console.log('[send-otp] Sending to:', email, '| OTP:', otp);

  try {
    await sendEmail(
      email,
      'Your Verification Code - JeeThy Labs',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#7c3aed;">JeeThy Labs</h2>
        <p>Hi <strong>${name || 'there'}</strong>,</p>
        <p>Your verification code is:</p>
        <div style="font-size:42px;font-weight:bold;letter-spacing:10px;color:#7c3aed;padding:20px 0;text-align:center;">${otp}</div>
        <p style="color:#888;font-size:14px;">This code expires in <strong>10 minutes</strong>.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
        <p style="color:#aaa;font-size:12px;">If you did not request this, please ignore this email.</p>
      </div>`
    );
    console.log('[send-otp] Sent to:', email);
    res.json({ success: true });
  } catch (e) {
    console.error('[send-otp] Error:', e.message);
    res.status(500).json({ error: 'Failed to send code: ' + e.message });
  }
});

app.post('/api/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const rawPassword = req.body.password_hash || req.body.password || '';
  const record = otpStore[email];

  if (!record) return res.status(400).json({ error: 'No OTP found. Request a new one.' });
  if (Date.now() > record.expires) {
    delete otpStore[email];
    return res.status(400).json({ error: 'OTP expired.' });
  }
  if (record.otp !== String(otp).trim()) {
    return res.status(400).json({ error: 'Invalid OTP.' });
  }

  const passwordToHash = rawPassword || record.password_hash || '';
  if (!passwordToHash) {
    return res.status(400).json({ error: 'Password missing. Please sign up again.' });
  }

  delete otpStore[email];

  try {
    const hash = await bcrypt.hash(passwordToHash, 10);
    const uname = req.body.name || record.name || 'User';
    const now = new Date();

    const result = await pool.query(
      `INSERT INTO users
         (name, email, password_hash, plan, status, email_verified, avatar_url, country, created_at, last_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (email) DO UPDATE
         SET name=$1, password_hash=$3, last_active=$10
       RETURNING id, user_id, name, email, plan, status, avatar_url, country, email_verified, created_at, last_active`,
      [uname, email, hash, 'free', 'active', true, null, null, now, now]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        plan: user.plan || 'free',
        status: user.status || 'active',
        avatar_url: user.avatar_url || null,
        created_at: user.created_at,
      },
    });
  } catch (e) {
    console.error('[verify-otp]', e.message);
    res.status(500).json({ error: 'Registration failed: ' + e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { email } = req.body;
  const rawPassword = req.body.password || req.body.password_hash || '';

  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Email not found.' });

    const user = result.rows[0];
    const storedHash = user.password_hash || user.password || '';

    if (!storedHash) {
      return res.status(401).json({ error: 'Account has no password set. Please sign up again.' });
    }

    const match = await bcrypt.compare(rawPassword, storedHash);
    if (!match) return res.status(401).json({ error: 'Wrong password.' });

    await pool.query('UPDATE users SET last_active=$1 WHERE id=$2', [new Date(), user.id]);

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        plan: user.plan || 'free',
        status: user.status || 'active',
        avatar_url: user.avatar_url || null,
        created_at: user.created_at,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Login failed: ' + e.message });
  }
});

app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (!result.rows.length) return res.status(404).json({ error: 'Email not found.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const otp = genOTP();
  otpStore[email] = { otp, expires: Date.now() + 10 * 60 * 1000, type: 'reset' };

  try {
    await sendEmail(
      email,
      'Password Reset Code - JeeThy Labs',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#7c3aed;">Reset Your Password</h2>
        <p>Your reset code:</p>
        <div style="font-size:42px;font-weight:bold;letter-spacing:10px;color:#7c3aed;padding:20px 0;text-align:center;">${otp}</div>
        <p style="color:#888;font-size:14px;">Expires in <strong>10 minutes</strong>.</p>
      </div>`
    );
    res.json({ success: true });
  } catch (e) {
    console.error('[forgot-password]', e.message);
    res.status(500).json({ error: 'Failed to send reset code: ' + e.message });
  }
});

app.post('/api/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const record = otpStore[email];

  if (!record || record.otp !== String(otp).trim()) {
    return res.status(400).json({ error: 'Invalid or expired OTP.' });
  }
  if (Date.now() > record.expires) {
    delete otpStore[email];
    return res.status(400).json({ error: 'OTP expired.' });
  }

  delete otpStore[email];

  try {
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash=$1 WHERE email=$2', [hash, email]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, user_id, name, email, avatar_url, plan, status, country, email_verified, created_at, last_active FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/profile', authMiddleware, async (req, res) => {
  const { avatar_url, country, name } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users
       SET avatar_url=COALESCE($1, avatar_url),
           country=COALESCE($2, country),
           name=COALESCE($3, name),
           last_active=$4
       WHERE id=$5
       RETURNING id, user_id, name, email, avatar_url, plan, status, country, email_verified, created_at, last_active`,
      [avatar_url || null, country || null, name || null, new Date(), req.user.id]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/logout', (req, res) => {
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ══════════════════════════════════════════════════════════════
//  server-routes-fix.js
//  Add these routes to your Express server.js (Railway)
//  Place BEFORE  app.listen()
//
//  Required env var:  GEMINI_API_KEY=AIza...
//  Required npm pkg:  node-fetch (or native fetch Node 18+)
// ══════════════════════════════════════════════════════════════

/*
  HOW TO USE:
  1. Open your server.js on Railway
  2. Find your existing routes (login, signup, etc.)
  3. Paste the three route blocks below alongside them
  4. Make sure  GEMINI_API_KEY  is set in Railway environment variables
  5. Deploy
*/

// ── helper ────────────────────────────────────────────────────
function getKey(req) {
  // If client sends their own pro key, use it; else use server env key
  return (req.body && req.body.customKey) || process.env.GEMINI_API_KEY || '';
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const CHAT_MODEL  = 'gemini-2.5-flash';
const IMAGE_MODEL = 'gemini-2.0-flash-preview-image-generation';
const TTS_MODEL   = 'gemini-2.5-pro-preview-tts';

// ── /api/chat ─────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const key     = getKey(req);
    if (!key) return res.status(503).json({ error: 'API key not configured on server.' });

    const history = req.body.history || [];
    const url     = `${GEMINI_BASE}/${CHAT_MODEL}:generateContent?key=${key}`;

    const geminiRes = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: `You are JeeThy Assistant, a helpful AI created by JeeThy Labs.\nAnswer in the same language the user writes in.\nBe concise but thorough. Format clearly with paragraphs and bullet points when needed.` }]
        },
        contents: history
      })
    });

    if (!geminiRes.ok) {
      const errData = await geminiRes.json().catch(() => ({}));
      return res.status(geminiRes.status).json({ error: errData.error?.message || `Gemini error ${geminiRes.status}` });
    }

    const data  = await geminiRes.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
    return res.json({ reply });
  } catch (err) {
    console.error('[/api/chat]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── /api/image ────────────────────────────────────────────────
app.post('/api/image', async (req, res) => {
  try {
    const key = getKey(req);
    if (!key) return res.status(503).json({ error: 'API key not configured on server.' });

    const { prompt, aspectRatio = '1:1' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const url = `${GEMINI_BASE}/${IMAGE_MODEL}:generateContent?key=${key}`;

    const geminiRes = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          imageConfig: { aspectRatio }
        }
      })
    });

    if (!geminiRes.ok) {
      const errData = await geminiRes.json().catch(() => ({}));
      return res.status(geminiRes.status).json({ error: errData.error?.message || `Gemini error ${geminiRes.status}` });
    }

    const data = await geminiRes.json();
    let imgData = null;
    for (const c of (data.candidates || [])) {
      for (const p of (c.content?.parts || [])) {
        if (p.inlineData?.data) { imgData = p.inlineData; break; }
      }
      if (imgData) break;
    }

    if (!imgData) return res.status(500).json({ error: 'No image generated. Try a different prompt.' });
    return res.json({ data: imgData.data, mimeType: imgData.mimeType || 'image/png' });
  } catch (err) {
    console.error('[/api/image]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── /api/song ─────────────────────────────────────────────────
app.post('/api/song', async (req, res) => {
  try {
    const key = getKey(req);
    if (!key) return res.status(503).json({ error: 'API key not configured on server.' });

    const { prompt, style = 'Pop', voice = 'Female', isKhmer = false } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const voiceHint  = voice.toLowerCase().includes('female') ? 'female vocalist' : 'male vocalist';
    const langHint   = isKhmer ? 'Lyrics must be in Khmer language (ភាសាខ្មែរ).' : '';
    const songPrompt = `Create a full ${style} song about: ${prompt}. ${voiceHint}, ${style} genre with full instrumental arrangement, verses, chorus and bridge. ${langHint}`.trim();

    // Try TTS model first (Gemini 2.5 Pro TTS)
    const url = `${GEMINI_BASE}/${TTS_MODEL}:generateContent?key=${key}`;

    const geminiRes = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: songPrompt }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voice.toLowerCase().includes('female') ? 'Aoede' : 'Charon'
              }
            }
          }
        }
      })
    });

    if (!geminiRes.ok) {
      const errData = await geminiRes.json().catch(() => ({}));
      return res.status(geminiRes.status).json({ error: errData.error?.message || `Gemini error ${geminiRes.status}` });
    }

    const data = await geminiRes.json();
    let audioB64 = null, audioMime = 'audio/mp3', lyricsText = '';

    for (const c of (data.candidates || [])) {
      for (const p of (c.content?.parts || [])) {
        if (p.inlineData?.data && !audioB64) {
          audioB64  = p.inlineData.data;
          audioMime = p.inlineData.mimeType || 'audio/mp3';
        }
        if (p.text) lyricsText += p.text;
      }
    }

    if (!audioB64) return res.status(500).json({ error: 'No audio generated. Please try again.' });

    const titleMatch = lyricsText.match(/(?:title|song name)[:\s]+([^\n]+)/i);
    const title      = titleMatch ? titleMatch[1].trim() : `${style} Song`;

    return res.json({ audio: audioB64, mimeType: audioMime, title, lyrics: lyricsText });
  } catch (err) {
    console.error('[/api/song]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// END OF ROUTES — paste above  app.listen(...)
// ══════════════════════════════════════════════════════════════


app.listen(PORT, () => console.log('JeeThy Labs running on port ' + PORT));
