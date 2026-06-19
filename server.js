'use strict';

require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const app = express();

/* =========================
   ENV
========================= */

const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASEURL;
const JWT_SECRET = process.env.JWT_SECRET || process.env.JWTSECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.SESSIONSECRET || JWT_SECRET;

const SMTP_USER = process.env.SMTP_USER || process.env.SMTPUSER;
const SMTP_PASS = process.env.SMTP_PASS || process.env.SMTPPASS;
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.FROMEMAIL || SMTP_USER;

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GEMINIAPIKEY ||
  process.env.OWNER_API_KEY ||
  '';

const APP_URL = process.env.APP_URL || process.env.APPURL || 'https://app.jeethy.site';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPESECRETKEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPEWEBHOOKSECRET || '';

const STRIPE_PRICE_PRO = process.env.STRIPE_PRICE_PRO || process.env.STRIPEPRICEPRO || '';
const STRIPE_PRICE_PROPLUS = process.env.STRIPE_PRICE_PROPLUS || process.env.STRIPEPRICEPROPLUS || '';
const STRIPE_PRICE_MAX = process.env.STRIPE_PRICE_MAX || process.env.STRIPEPRICEMAX || '';

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL / DATABASEURL');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET / JWTSECRET');
  process.exit(1);
}

/* =========================
   CONFIG
========================= */

const VIDEO_DAILY_LIMITS = {
  free: 1,
  pro: 3,
  proplus: 10,
  max: Infinity,
};

const PLAN_CONFIG = {
  free: {
    label: 'Free',
    durationHint: 'under 1 minute, target 55 seconds, must end before 60 seconds',
    durationSeconds: 55,
    structureHint: 'Short Instrumental Intro 8s - Verse 20s - Chorus 18s - Short Outro 9s',
    customLyrics: false,
    chatMsgDay: 20,
    imgDay: 5,
    songDay: 3,
    imgResolution: '720x720',
    audioQuality: 'standard',
  },
  pro: {
    label: 'Pro',
    durationHint: 'between 2 minutes 50 seconds and 3 minutes 05 seconds, target 3 minutes',
    durationSeconds: 180,
    structureHint: 'Instrumental Intro 20s - Verse 1 30s - Pre-Chorus 10s - Chorus 25s - Break 20s - Verse 2 25s - Chorus 25s - Final Chorus 20s - Outro 15s',
    customLyrics: true,
    chatMsgDay: 100,
    imgDay: 25,
    songDay: 15,
    imgResolution: '1024x1024',
    audioQuality: 'high',
  },
  proplus: {
    label: 'Pro+',
    durationHint: 'between 3 minutes and 3 minutes 25 seconds, target 3 minutes 15 seconds',
    durationSeconds: 200,
    structureHint: 'Extended Intro 25s - Verse 1 30s - Pre-Chorus 12s - Chorus 25s - Break 22s - Verse 2 28s - Pre-Chorus 12s - Chorus 25s - Bridge 15s - Final Chorus 25s - Outro 25s',
    customLyrics: true,
    chatMsgDay: -1,
    imgDay: 150,
    songDay: 100,
    imgResolution: '2048x2048',
    audioQuality: 'best',
  },
  max: {
    label: 'Max',
    durationHint: 'between 4 minutes 25 seconds and 5 minutes 25 seconds, target 5 minutes full song',
    durationSeconds: 300,
    structureHint: 'Extended Intro 35s - Verse 1 35s - Pre-Chorus 15s - Chorus 30s - Break 30s - Verse 2 30s - Pre-Chorus 15s - Chorus 30s - Bridge 20s - Solo 25s - Final Chorus 30s - Extended Outro 40s',
    customLyrics: true,
    chatMsgDay: -1,
    imgDay: -1,
    songDay: -1,
    imgResolution: '3840x2160',
    audioQuality: 'best-lyria-pro',
  },
};

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const STRIPE_PRICES = {
  pro: STRIPE_PRICE_PRO,
  proplus: STRIPE_PRICE_PROPLUS,
  max: STRIPE_PRICE_MAX,
};

/* =========================
   APP MIDDLEWARE
========================= */

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(cookieParser());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PROD,
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

/* =========================
   DB
========================= */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: IS_PROD ? { rejectUnauthorized: false } : false,
});

/* =========================
   MAIL
========================= */

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
});

/* =========================
   MEMORY STORES
   NOTE: good enough for now; move to DB/Redis later
========================= */

const otpStore = new Map();
const videoUsageStore = new Map();

/* =========================
   HELPERS
========================= */

function genOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function nowIsoDay() {
  return new Date().toISOString().slice(0, 10);
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

function setAuthCookie(res, token) {
  res.cookie('jl_token', token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookies(res) {
  res.clearCookie('jl_token');
  res.clearCookie('connect.sid');
}

function auth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const bearer = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  const token = bearer || req.session?.token || req.cookies?.jl_token || null;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function getStripe() {
  if (!STRIPE_SECRET_KEY) return null;
  try {
    return require('stripe')(STRIPE_SECRET_KEY);
  } catch {
    return null;
  }
}

async function sendEmail(to, subject, html) {
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP is not configured');
  }

  return transporter.sendMail({
    from: `"JeeThy Labs" <${FROM_EMAIL}>`,
    to,
    subject,
    html,
  });
}

async function initDb() {
  const migrations = [
    `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        userid TEXT,
        name TEXT,
        email TEXT UNIQUE NOT NULL,
        passwordhash TEXT,
        emailverified BOOLEAN DEFAULT false,
        avatarurl TEXT,
        plan VARCHAR(32) DEFAULT 'free',
        status VARCHAR(32) DEFAULT 'active',
        country VARCHAR(64),
        pendingplan VARCHAR(20),
        planexpiresat TIMESTAMPTZ,
        createdat TIMESTAMPTZ DEFAULT NOW(),
        lastactive TIMESTAMPTZ DEFAULT NOW(),
        updatedat TIMESTAMPTZ DEFAULT NOW()
      )
    `,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS userid TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS passwordhash TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS emailverified BOOLEAN DEFAULT false`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatarurl TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(32) DEFAULT 'free'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'active'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(64)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS pendingplan VARCHAR(20)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS planexpiresat TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS createdat TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS lastactive TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS updatedat TIMESTAMPTZ DEFAULT NOW()`,
  ];

  for (const sql of migrations) {
    await pool.query(sql);
  }
}

async function getUserPlan(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT plan, planexpiresat FROM users WHERE id = $1`,
      [userId]
    );

    if (!rows.length) return 'free';

    const row = rows[0];
    const raw = String(row.plan || 'free').toLowerCase().trim();

    if (raw !== 'free' && row.planexpiresat && new Date(row.planexpiresat) < new Date()) {
      await pool.query(
        `UPDATE users SET plan = 'free', planexpiresat = NULL, updatedat = NOW() WHERE id = $1`,
        [userId]
      );
      return 'free';
    }

    return PLAN_CONFIG[raw] ? raw : 'free';
  } catch {
    return 'free';
  }
}

function getVideoUsageKey(userId, plan) {
  return `${userId || 'guest'}:${plan || 'free'}:${nowIsoDay()}`;
}

function getVideoUsageCount(userId, plan) {
  return videoUsageStore.get(getVideoUsageKey(userId, plan)) || 0;
}

function incrementVideoUsage(userId, plan) {
  const key = getVideoUsageKey(userId, plan);
  const next = (videoUsageStore.get(key) || 0) + 1;
  videoUsageStore.set(key, next);
  return next;
}

async function withRetry(fn, maxAttempts = 3, baseDelayMs = 1200) {
  let lastErr;

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      const retryable = /503|429|quota|overload|high demand|rate.?limit/i.test(msg);
      if (!retryable || i === maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, i - 1);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastErr;
}

async function safeJson(response, label = 'request') {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`${label} non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

function geminiKey() {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  return GEMINI_API_KEY;
}

let modelsCache = null;
let modelsCacheTime = 0;
const MODELS_TTL = 10 * 60 * 1000;

async function fetchAvailableModels(key) {
  const now = Date.now();
  if (modelsCache && (now - modelsCacheTime) < MODELS_TTL) return modelsCache;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`ListModels HTTP ${r.status}: ${text.slice(0, 200)}`);
  }

  const data = await r.json();
  const models = (data.models || []).map(m => ({
    name: m.name?.replace(/^models\//, ''),
    displayName: m.displayName || '',
    supportedMethods: m.supportedGenerationMethods || [],
  }));

  modelsCache = models;
  modelsCacheTime = now;
  return models;
}

function classifyModels(models) {
  const gc = models.filter(m => Array.isArray(m.supportedMethods) && m.supportedMethods.includes('generateContent'));
  const imageModels = gc.filter(m => /imagen|image.*generation|flash.*image/i.test(m.name || '') || /image/i.test(m.displayName || ''));
  const lyriaModels = gc.filter(m => /lyria/i.test(m.name || '') || /lyria/i.test(m.displayName || ''));
  const ttsModels = gc.filter(m => /tts|text-to-speech|speech/i.test(m.name || '') || /tts/i.test(m.displayName || ''));
  const chatModels = gc.filter(m => !imageModels.includes(m) && !lyriaModels.includes(m) && !ttsModels.includes(m));
  return { imageModels, lyriaModels, ttsModels, chatModels };
}

function cleanLyricsText(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/music|bpm|duration|seconds?|tempo|key|time signature|mood|energy/gi, '')
    .replace(/^[-ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â\s]+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function trimAudioBuffer(buf64, maxSeconds, mimeType = 'audio/wav') {
  try {
    const buf = Buffer.from(buf64, 'base64');
    const mime = String(mimeType || '').toLowerCase();

    if (buf.length > 44 && buf.slice(0, 4).toString('ascii') === 'RIFF') {
      const hdr = buf.slice(0, 44);
      let pcm = buf.slice(44);

      const sampleRate = hdr.readUInt32LE(24);
      const numChannels = hdr.readUInt16LE(22);
      const bitsPerSample = hdr.readUInt16LE(34);

      const bytesPerSec = sampleRate * numChannels * (bitsPerSample / 8);
      const maxBytes = Math.floor(bytesPerSec * maxSeconds);

      if (pcm.length > maxBytes) {
        pcm = pcm.slice(0, maxBytes);
      }

      const out = Buffer.concat([hdr, pcm]);
      out.writeUInt32LE(pcm.length, 40);
      out.writeUInt32LE(pcm.length + 36, 4);
      return out.toString('base64');
    }

    const rateMatch = mime.match(/rate=(\d+)/i);
    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
    const numChannels = mime.includes('channels=2') ? 2 : 1;
    const bytesPerSec = sampleRate * numChannels * 2;
    const maxBytes = Math.floor(bytesPerSec * maxSeconds);

    if (buf.length > maxBytes) {
      return buf.slice(0, maxBytes).toString('base64');
    }

    return buf64;
  } catch {
    return buf64;
  }
}

const KHMER_INSTRUMENT_DESCRIPTIONS = {
  khloy: 'Khloy Cambodian bamboo vertical flute with airy breathy melodic tone and gentle vibrato.',
  'roneat ek': 'Roneat Ek Cambodian bamboo xylophone with bright crisp resonant melodic runs.',
  'roneat thung': 'Roneat Thung low-pitched bamboo xylophone with deep mellow woody bass color.',
  chapei: 'Chapei Cambodian long-neck lute with deep resonant plucked string timbre.',
  tro: 'Tro Cambodian bowed string with haunting lyrical expressive vibrato.',
  'kse diev': 'Kse Diev monochord zither with meditative droning plucked resonance.',
  'kong vong': 'Kong Vong gong circle with warm sustained bronze melodic gong tones.',
  skor: 'Skor Cambodian drum with warm resonant hand-played rhythmic attack.',
  pin: 'Pin Cambodian harp with bright flowing plucked glissando tone.',
};

function buildInstrumentPrompt(instrument) {
  if (!instrument) return '';
  const lines = [`Featured instruments: ${instrument}.`];
  const lower = instrument.toLowerCase();

  const hits = [];
  for (const [key, desc] of Object.entries(KHMER_INSTRUMENT_DESCRIPTIONS)) {
    if (lower.includes(key)) hits.push(desc);
  }

  if (hits.length) {
    lines.push('');
    lines.push('IMPORTANT - CAMBODIAN TRADITIONAL INSTRUMENTS REQUIRED');
    for (const desc of hits) lines.push(`- ${desc}`);
    lines.push('- These Khmer instruments must remain clearly audible in the arrangement.');
    lines.push('- Preserve authentic acoustic timbres; do not replace them with generic Western equivalents.');
    lines.push('- Bring one Khmer instrument into the intro and another into the chorus or bridge.');
  }

  return lines.join('\n');
}

function buildSongPrompt({ prompt, style, voice, customLyrics, instrument, tempo, mood, planKey }) {
  const planCfg = PLAN_CONFIG[planKey] || PLAN_CONFIG.free;
  const v = String(voice || 'Female').toLowerCase();

  const isDuet = v.includes('duet');
  const isChoir = v.includes('choir');
  const isFemale = !isDuet && !isChoir && !v.includes('male');

  const voiceHint = isDuet
    ? 'male and female duet vocalists, call-and-response singing, two distinct voices'
    : isChoir
      ? 'full choir ensemble with layered choral harmonies'
      : isFemale
        ? 'female vocalist'
        : 'male vocalist';

  if (customLyrics && planCfg.customLyrics) {
    return [
      `DURATION REQUIREMENT: Generate audio that is ${planCfg.durationHint}. This is a strict requirement.`,
      `TIMING GUIDE: ${planCfg.structureHint}.`,
      `Use EXACTLY the following lyrics. Do not change any words.`,
      `---`,
      customLyrics.trim(),
      `---`,
      `Vocalist: ${voiceHint}.`,
      `Genre: ${style || 'Pop'}.`,
      instrument ? buildInstrumentPrompt(instrument) : '',
      tempo ? `Tempo: ${tempo}.` : '',
      mood ? `Mood/Feel: ${mood}.` : '',
      `Audio quality: high-quality stereo, clear lead vocals, backing harmonies.`,
    ].filter(Boolean).join('\n');
  }

  return [
    `DURATION REQUIREMENT: Generate audio that is ${planCfg.durationHint}. This is a strict requirement.`,
    `TIMING GUIDE: ${planCfg.structureHint}.`,
    `Theme/Story: ${prompt}.`,
    `Vocalist: ${voiceHint}.`,
    `Genre: ${style || 'Pop'}.`,
    `Language: auto-detect from theme, match the language naturally.`,
    `RHYME RULES: every 2 or 4 lines must end-rhyme naturally using AABB or ABAB patterns.`,
    instrument ? buildInstrumentPrompt(instrument) : '',
    tempo ? `Tempo: ${tempo}.` : '',
    mood ? `Mood/Feel: ${mood}.` : '',
    `Audio quality: high-quality stereo, clear lead vocals, full arrangement.`,
  ].filter(Boolean).join('\n');
}

/* =========================
   DB / SMTP STARTUP LOGS
========================= */

pool.connect()
  .then(c => {
    console.log('DB connected');
    c.release();
  })
  .catch(e => {
    console.error('DB connection error:', e.message);
  });

if (SMTP_USER && SMTP_PASS) {
  transporter.verify()
    .then(() => console.log('SMTP ready'))
    .catch(err => console.error('SMTP error:', err.message));
} else {
  console.log('SMTP not configured');
}

console.log('JeeThy Labs starting...');
console.log('GEMINI_API_KEY:', GEMINI_API_KEY ? 'SET' : 'MISSING');
console.log('STRIPE:', STRIPE_SECRET_KEY ? 'SET' : 'NOT SET');

/* =========================
   ROUTES: HEALTH
========================= */

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    smtp: !!(SMTP_USER && SMTP_PASS),
    gemini: !!GEMINI_API_KEY,
    stripe: !!STRIPE_SECRET_KEY,
    env: NODE_ENV,
  });
});


/* =========================
   API KEY ROUTE
   Returns owner Gemini key to authenticated frontend
========================= */

app.get('/api/key', auth, (req, res) => {
  const key = process.env.GEMINI_API_KEY || process.env.GEMINIAPIKEY || process.env.OWNER_API_KEY || '';
  if (!key) return res.status(503).json({ error: 'API key not configured.' });
  res.json({ key });
});

/* =========================
   AUTH ROUTES
========================= */

app.post('/api/send-otp', async (req, res) => {
  try {
    const { email, name, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanEmail) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const otp = genOTP();
    otpStore.set(cleanEmail, {
      otp,
      name: String(name || '').trim(),
      password: String(password || ''),
      expires: Date.now() + 60 * 60 * 1000,
      type: 'signup',
    });

    await sendEmail(
      cleanEmail,
      'Your Verification Code - JeeThy Labs',
      `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#7c3aed;">JeeThy Labs</h2>
        <p>Your verification code:</p>
        <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#7c3aed;text-align:center;padding:20px 0;">${otp}</div>
        <p style="color:#888;font-size:13px;">Expires in <strong>10 minutes</strong>.</p>
      </div>
      `
    );

    res.json({ success: true });
  } catch (e) {
    console.error('send-otp:', e.message);
    res.status(500).json({ error: 'Failed to send verification code.' });
  }
});

app.post('/api/verify-otp', async (req, res) => {
  try {
    const { email, otp, name, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const rec = otpStore.get(cleanEmail);

    if (!rec) {
      return res.status(400).json({ error: 'No OTP found. Request a new one.' });
    }
    if (Date.now() > rec.expires) {
      otpStore.delete(cleanEmail);
      return res.status(400).json({ error: 'OTP expired.' });
    }
    if (String(rec.otp) !== String(otp || '').trim()) {
      return res.status(400).json({ error: 'Invalid OTP.' });
    }

    otpStore.delete(cleanEmail);

    const rawPw = String(password || rec.password || '');
    const userName = String(name || rec.name || 'User').trim();

    if (!rawPw) {
      return res.status(400).json({ error: 'Password missing.' });
    }

    const hash = await bcrypt.hash(rawPw, 10);
    const userIdString = crypto.randomUUID();

    const { rows } = await pool.query(
      `
      INSERT INTO users
        (userid, name, email, passwordhash, plan, status, emailverified, avatarurl, country, createdat, lastactive, updatedat)
      VALUES
        ($1, $2, $3, $4, 'free', 'active', true, NULL, NULL, NOW(), NOW(), NOW())
      ON CONFLICT (email)
      DO UPDATE SET
        name = EXCLUDED.name,
        passwordhash = EXCLUDED.passwordhash,
        emailverified = true,
        lastactive = NOW(),
        updatedat = NOW()
      RETURNING id, userid, name, email, plan, status, avatarurl, createdat
      `,
      [userIdString, userName, cleanEmail, hash]
    );

    const u = rows[0];
    const token = signToken({ id: u.id, email: u.email });

    req.session.token = token;
    setAuthCookie(res, token);

    res.json({
      success: true,
      token,
      user: {
        id: u.id,
        userid: u.userid,
        name: u.name,
        email: u.email,
        plan: u.plan || 'free',
        avatarurl: u.avatarurl || null,
        createdat: u.createdat,
      },
    });
  } catch (e) {
    console.error('verify-otp:', e.message);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const { rows } = await pool.query(
      `SELECT id, userid, name, email, passwordhash, plan, avatarurl, createdat FROM users WHERE email = $1`,
      [cleanEmail]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Email not found.' });
    }

    const u = rows[0];

    if (!u.passwordhash) {
      return res.status(401).json({ error: 'Account has no password.' });
    }

    const ok = await bcrypt.compare(password, u.passwordhash);
    if (!ok) {
      return res.status(401).json({ error: 'Wrong password.' });
    }

    await pool.query(
      `UPDATE users SET lastactive = NOW(), updatedat = NOW() WHERE id = $1`,
      [u.id]
    );

    const token = signToken({ id: u.id, email: u.email });
    req.session.token = token;
    setAuthCookie(res, token);

    res.json({
      success: true,
      token,
      user: {
        id: u.id,
        userid: u.userid,
        name: u.name,
        email: u.email,
        plan: u.plan || 'free',
        avatarurl: u.avatarurl || null,
        createdat: u.createdat,
      },
    });
  } catch (e) {
    console.error('login:', e.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, userid, name, email, avatarurl, plan, status, country, createdat, lastactive FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/forgot-password', async (req, res) => {
  try {
    const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
    if (!cleanEmail) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const { rows } = await pool.query(`SELECT id FROM users WHERE email = $1`, [cleanEmail]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Email not found.' });
    }

    const otp = genOTP();
    otpStore.set(cleanEmail, {
      otp,
      expires: Date.now() + 60 * 60 * 1000,
      type: 'reset',
    });

    await sendEmail(
      cleanEmail,
      'Password Reset - JeeThy Labs',
      `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#7c3aed;">Reset Your Password</h2>
        <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#7c3aed;text-align:center;padding:20px 0;">${otp}</div>
        <p style="color:#888;font-size:13px;">Expires in <strong>10 minutes</strong>.</p>
      </div>
      `
    );

    res.json({ success: true });
  } catch (e) {
    console.error('forgot-password:', e.message);
    res.status(500).json({ error: 'Failed to send reset code.' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    const rec = otpStore.get(cleanEmail);
    if (!rec || rec.type !== 'reset' || rec.otp !== otp || Date.now() > rec.expires) {
      otpStore.delete(cleanEmail);
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    otpStore.delete(cleanEmail);

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE users SET passwordhash = $1, updatedat = NOW() WHERE email = $2`,
      [hash, cleanEmail]
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/profile', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, userid, name, email, avatarurl, plan, status, country, createdat, lastactive FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/profile', auth, async (req, res) => {
  try {
    const avatarurl = req.body?.avatarurl ?? null;
    const country = req.body?.country ?? null;
    const name = req.body?.name ?? null;

    const { rows } = await pool.query(
      `
      UPDATE users
      SET avatarurl = COALESCE($1, avatarurl),
          country = COALESCE($2, country),
          name = COALESCE($3, name),
          lastactive = NOW(),
          updatedat = NOW()
      WHERE id = $4
      RETURNING id, name, email, avatarurl, plan, status, country, createdat
      `,
      [avatarurl, country, name, req.user.id]
    );

    res.json({ success: true, user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/avatar', auth, async (req, res) => {
  try {
    const avatar = req.body?.avatar;
    if (!avatar) return res.status(400).json({ error: 'No avatar data.' });

    await pool.query(
      `UPDATE users SET avatarurl = $1, lastactive = NOW(), updatedat = NOW() WHERE id = $2`,
      [avatar, req.user.id]
    );

    res.json({ success: true, avatarurl: avatar });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upload-avatar', auth, async (req, res) => {
  try {
    const avatarurl = req.body?.avatarurl;
    if (!avatarurl) return res.status(400).json({ error: 'No avatar data.' });

    await pool.query(
      `UPDATE users SET avatarurl = $1, lastactive = NOW(), updatedat = NOW() WHERE id = $2`,
      [avatarurl, req.user.id]
    );

    res.json({ success: true, avatarurl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {});
  clearAuthCookies(res);
  res.json({ success: true });
});

/* =========================
   MODELS
========================= */

app.get('/api/models', async (req, res) => {
  try {
    const key = geminiKey();
    const all = await fetchAvailableModels(key);
    const { imageModels, lyriaModels, ttsModels, chatModels } = classifyModels(all);

    res.json({
      all,
      imageModels: imageModels.map(m => m.name),
      lyriaModels: lyriaModels.map(m => m.name),
      ttsModels: ttsModels.map(m => m.name),
      chatModels: chatModels.map(m => m.name),
      recommended: {
        chat: chatModels.find(m => /2\.5.*flash/i.test(m.name))?.name || 'gemini-2.5-flash',
        image: imageModels[0]?.name || null,
        lyria: lyriaModels.find(m => /pro/i.test(m.name))?.name || lyriaModels[0]?.name || 'lyria-3-pro-preview',
        tts: ttsModels.find(m => /flash/i.test(m.name))?.name || ttsModels[0]?.name || null,
      },
    });
  } catch (e) {
    res.json({
      all: [],
      imageModels: [],
      lyriaModels: [],
      ttsModels: [],
      chatModels: ['gemini-2.5-flash'],
      recommended: {
        chat: 'gemini-2.5-flash',
        image: null,
        lyria: 'lyria-3-pro-preview',
        tts: null,
      },
      error: e.message,
    });
  }
});

/* =========================
   CHAT
========================= */

app.post('/api/chat', auth, async (req, res) => {
  try {
    const key = geminiKey();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const model = String(req.body?.model || 'gemini-2.5-flash');
    const system = String(
      req.body?.system ||
      'You are JeeThy Assistant, a helpful AI by JeeThy Labs. Reply in the same language the user uses. Be concise and clear.'
    );

    const chatModels = [model, 'gemini-2.5-flash', 'gemini-2.0-flash'];
    const tried = new Set();
    let lastErr = null;

    for (const m of chatModels) {
      if (tried.has(m)) continue;
      tried.add(m);

      try {
        const r = await fetch(`${GEMINI_BASE}/${m}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: system }],
            },
            contents: history,
          }),
        });

        const d = await safeJson(r, `chat ${m}`);

        if (!r.ok) {
          const msg = d?.error?.message || `HTTP ${r.status}`;
          const isRetryable = /503|429|quota|overload|high demand/i.test(msg);
          if (isRetryable && m !== chatModels[chatModels.length - 1]) {
            lastErr = msg;
            continue;
          }
          return res.status(r.status).json({ error: msg });
        }

        const reply = d?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
        return res.json({ reply, model: m });
      } catch (err) {
        lastErr = err.message;
      }
    }

    return res.status(503).json({
      error: lastErr || 'All chat models are unavailable. Please try again.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================
   IMAGE
========================= */

app.post('/api/image', auth, async (req, res) => {
  try {
    const key = geminiKey();

    const {
      prompt,
      style,
      aspectRatio = '1:1',
      quality = 720,
      referenceImageBase64,
      referenceImageMime,
      extraRefImages = [],
    } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const VALID_RATIOS = {
      '1:1': '1:1',
      '9:16': '9:16',
      '16:9': '16:9',
    };

    const mappedRatio = VALID_RATIOS[aspectRatio] || '1:1';

    const orientHint =
      mappedRatio === '9:16'
        ? ', portrait orientation, vertical composition, tall image'
        : mappedRatio === '16:9'
          ? ', landscape orientation, wide composition, horizontal image'
          : ', square composition, centered subject';

    const fullPrompt =
      style && String(style).toLowerCase() !== 'none'
        ? `${prompt}, style ${style}${orientHint}`
        : `${prompt}${orientHint}`;

    let imageModels = [
      'imagen-3.0-generate-002',
      'imagen-3.0-generate-001',
      'gemini-2.0-flash-preview-image-generation',
      'gemini-2.0-flash',
    ];

    try {
      const discovered = classifyModels(await fetchAvailableModels(key));
      if (discovered.imageModels.length) {
        imageModels = discovered.imageModels.map(x => x.name);
      }
    } catch {}

    let lastErr = null;

    for (const model of imageModels) {
      try {
        const img = await withRetry(async () => {
          const generationConfig = {
            responseModalities: ['IMAGE', 'TEXT'],
          };

          if (/imagen/i.test(model)) {
            generationConfig.outputOptions = {
              mimeType: 'image/jpeg',
              compressionQuality: Number(quality) >= 1280 ? 95 : 85,
            };
            generationConfig.aspectRatio = mappedRatio;
          }

          const parts = [];

          if (referenceImageBase64) {
            parts.push({
              inlineData: {
                mimeType: referenceImageMime || 'image/jpeg',
                data: referenceImageBase64,
              },
            });
          }

          if (Array.isArray(extraRefImages) && extraRefImages.length) {
            for (const ref of extraRefImages) {
              if (ref?.base64) {
                parts.push({
                  inlineData: {
                    mimeType: ref.mime || 'image/jpeg',
                    data: ref.base64,
                  },
                });
              }
            }
          }

          if (referenceImageBase64) {
            parts.push({
              text: 'Using the uploaded image as a visual reference, keep the same person/face/body identity when appropriate.',
            });
          }

          parts.push({ text: fullPrompt });

          const r = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig,
            }),
          });

          const d = await safeJson(r, `image ${model}`);

          if (!r.ok) {
            throw new Error(d?.error?.message || `HTTP ${r.status}`);
          }

          for (const c of d.candidates || []) {
            for (const p of c.content?.parts || []) {
              if (p.inlineData?.data) {
                return p.inlineData;
              }
            }
          }

          throw new Error('No image returned from model.');
        }, 3, 1500);

        return res.json({
          data: img.data,
          mimeType: img.mimeType || 'image/png',
          aspectRatio: mappedRatio,
          model,
        });
      } catch (err) {
        lastErr = err;
      }
    }

    res.status(500).json({ error: lastErr?.message || 'Image generation failed.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================
   SONG
========================= */

const LYRIA_MODELS_FALLBACK = ['lyria-3-pro-preview'];
const TTS_MODELS_FALLBACK = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'];

async function tryTts(key, text, voiceName = 'Aoede') {
  let ttsModels = [...TTS_MODELS_FALLBACK];

  try {
    const discovered = classifyModels(await fetchAvailableModels(key));
    if (discovered.ttsModels.length) {
      ttsModels = [...new Set([...discovered.ttsModels.map(x => x.name), ...ttsModels])];
    }
  } catch {}

  for (const model of ttsModels) {
    try {
      const result = await withRetry(async () => {
        const r = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          }),
        });

        const d = await safeJson(r, `tts ${model}`);

        if (!r.ok) {
          throw new Error(d?.error?.message || `HTTP ${r.status}`);
        }

        for (const c of d.candidates || []) {
          for (const p of c.content?.parts || []) {
            if (p.inlineData?.data) {
              return {
                data: p.inlineData.data,
                mimeType: p.inlineData.mimeType || 'audio/wav',
                model,
              };
            }
          }
        }

        throw new Error('No TTS audio returned.');
      });

      return result;
    } catch (err) {
      console.warn('TTS failed:', model, err.message);
    }
  }

  return null;
}

app.get('/api/song-plan-info', auth, async (req, res) => {
  const planKey = await getUserPlan(req.user.id);
  const planCfg = PLAN_CONFIG[planKey];
  res.json({
    plan: planKey,
    durationHint: planCfg.durationHint,
    customLyrics: planCfg.customLyrics,
  });
});

app.post('/api/song', auth, async (req, res) => {
  try {
    const key = geminiKey();
    const planKey = await getUserPlan(req.user.id);
    const planCfg = PLAN_CONFIG[planKey];

    const {
      prompt,
      style = 'Pop',
      voice = 'Female',
      customLyrics,
      instrument,
      tempo,
      mood,
    } = req.body || {};

    if (!prompt && !customLyrics) {
      return res.status(400).json({ error: 'Please provide a song description or custom lyrics.' });
    }

    const musicPrompt = buildSongPrompt({
      prompt,
      style,
      voice,
      customLyrics,
      instrument,
      tempo,
      mood,
      planKey,
    });

    let lyriaModels = [...LYRIA_MODELS_FALLBACK];

    try {
      const discovered = classifyModels(await fetchAvailableModels(key));
      if (discovered.lyriaModels.length) {
        const sorted = [
          ...discovered.lyriaModels.filter(x => /pro/i.test(x.name)).map(x => x.name),
          ...discovered.lyriaModels.filter(x => !/pro/i.test(x.name)).map(x => x.name),
        ];
        lyriaModels = [...new Set([...sorted, ...LYRIA_MODELS_FALLBACK])];
      }
    } catch {}

    let audioResult = null;
    let lyricsText = '';
    let usedModel = '';

    async function lyriaCall(modelName, promptText) {
      const r = await fetch(`${GEMINI_BASE}/${modelName}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            responseModalities: ['AUDIO', 'TEXT'],
            temperature: 1.0,
          },
        }),
      });

      const d = await safeJson(r, `lyria ${modelName}`);

      if (!r.ok) {
        throw new Error(d?.error?.message || `HTTP ${r.status}`);
      }

      let txt = '';
      let audio = null;

      for (const c of d.candidates || []) {
        for (const p of c.content?.parts || []) {
          if (p.text) txt = p.text;
          if (p.inlineData?.data) audio = p.inlineData;
        }
      }

      if (!audio) {
        throw new Error('No audio returned.');
      }

      return { txt, audio };
    }

    for (const [lyriaIdx, model] of lyriaModels.entries()) {
      if (lyriaIdx > 0) await new Promise(r => setTimeout(r, 1500 * lyriaIdx));
      try {
        const result = await lyriaCall(model, musicPrompt);
        lyricsText = result.txt || '';

        const mimeType = result.audio.mimeType || 'audio/L16;rate=24000';
        const trimSec =
          planKey === 'free' ? 60 :
          planKey === 'pro' ? 185 :
          planKey === 'proplus' ? 210 :
          315;

        audioResult = {
          data: trimAudioBuffer(result.audio.data, trimSec, mimeType),
          mimeType,
        };
        usedModel = model;
        break;
      } catch (err) {
        console.warn('Lyria failed:', model, err.message);
      }
    }

    if (!audioResult) {
      const lyricsSource = String(customLyrics || '').trim();
      if (!lyricsSource) {
        try {
          const lyricPrompt = [
            `Write a complete original ${style} song about: ${prompt}.`,
            `Structure: ${planCfg.structureHint}.`,
            planKey === 'free'
              ? 'Keep it short, under 1 minute worth of lyrics.'
              : `Write full-length lyrics for ${planCfg.durationHint}.`,
            `Write only the song. No commentary.`,
          ].join('\n');

          const lr = await fetch(`${GEMINI_BASE}/gemini-2.5-flash:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: lyricPrompt }] }],
            }),
          });

          const ld = await safeJson(lr, 'lyrics-gen');
          if (lr.ok) {
            lyricsText = ld?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          }
        } catch (e) {
          console.warn('lyrics-gen:', e.message);
        }
      } else {
        lyricsText = lyricsSource;
      }

      if (lyricsText) {
        const cleanLyrics = lyricsText.replace(/^Title\s*:\s*/im, '').trim();
        const ttsVoice = String(voice || '').toLowerCase().includes('male') ? 'Charon' : 'Aoede';
        const ttsRes = await tryTts(key, cleanLyrics, ttsVoice);
        if (ttsRes) {
          audioResult = {
            data: ttsRes.data,
            mimeType: ttsRes.mimeType,
          };
          usedModel = ttsRes.model;
        }
      }
    }

    const cleanedLyrics = cleanLyricsText(lyricsText);
    const titleMatch = cleanedLyrics.match(/^Title\s*:\s*(.+)$/im);
    const songTitle = titleMatch ? titleMatch[1].trim() : `${style} Song`;
    const isLyria = /lyria/i.test(usedModel);

    return res.json({
      audio: audioResult ? audioResult.data : null,
      mimeType: audioResult ? audioResult.mimeType : 'audio/mp3',
      title: songTitle,
      lyrics: cleanedLyrics,
      lyricsOnly: !audioResult,
      audioSource: usedModel ? (isLyria ? `Lyria ${usedModel}` : `TTS ${usedModel}`) : null,
      plan: planKey,
      ttsMessage: !audioResult
        ? 'Audio generation is temporarily unavailable. Your lyrics are ready. Please try again shortly.'
        : null,
    });
  } catch (e) {
    console.error('/api/song:', e.message, e.stack);
    res.status(500).json({ error: e.message });
  }
});

/* =========================
   STRIPE
========================= */

app.get('/api/stripe-plans', (req, res) => {
  res.json({
    configured: !!STRIPE_SECRET_KEY,
    testMode: STRIPE_SECRET_KEY ? STRIPE_SECRET_KEY.startsWith('sk_test') : false,
    plans: {
      pro: {
        name: 'PRO',
        price: '$5.99/mo',
        priceId: STRIPE_PRICES.pro || 'NOT_SET',
      },
      proplus: {
        name: 'PRO+',
        price: '$24.99/mo',
        priceId: STRIPE_PRICES.proplus || 'NOT_SET',
      },
      max: {
        name: 'MAX',
        price: 'TBA',
        priceId: STRIPE_PRICES.max || 'NOT_SET',
      },
    },
  });
});

app.post('/api/stripe-checkout', auth, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured.' });
    }

    const plan = String(req.body?.plan || '').toLowerCase();
    const priceId = STRIPE_PRICES[plan];

    if (!priceId || !priceId.startsWith('price_')) {
      return res.status(400).json({ error: 'Invalid plan or Stripe price is not configured.' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}?upgraded=1&plan=${plan}`,
      cancel_url: `${APP_URL}?cancelled=1`,
      metadata: {
        userId: String(req.user.id),
        plan,
      },
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error('stripe-checkout:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/stripe/webhook', async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe not configured.' });
    }
    if (!STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'STRIPE_WEBHOOK_SECRET not set.' });
    }

    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      console.error('stripe-webhook signature error:', e.message);
      return res.status(400).json({ error: `Webhook signature invalid: ${e.message}` });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session?.metadata?.userId;
        const plan = session?.metadata?.plan;

        if (userId && plan) {
          const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await pool.query(
            `UPDATE users SET plan = $1, planexpiresat = $2, pendingplan = NULL, updatedat = NOW() WHERE id = $3`,
            [plan, expires, Number(userId)]
          );
        }
        break;
      }

      case 'customer.subscription.deleted':
        console.warn('Stripe subscription cancelled:', event.data.object?.customer);
        break;

      default:
        break;
    }

    res.json({ received: true });
  } catch (e) {
    console.error('stripe-webhook handler error:', e.message);
    res.json({ received: true });
  }
});

app.post('/api/subscribe', auth, async (req, res) => {
  try {
    const planKey = String(req.body?.plan || '').toLowerCase();

    if (!['free', 'pro', 'proplus', 'max'].includes(planKey)) {
      return res.status(400).json({ error: 'Invalid plan. Choose free, pro, proplus, or max.' });
    }

    if (planKey === 'free') {
      await pool.query(
        `UPDATE users SET plan = 'free', planexpiresat = NULL, pendingplan = NULL, updatedat = NOW() WHERE id = $1`,
        [req.user.id]
      );

      const { rows } = await pool.query(
        `SELECT id, name, email, plan, avatarurl, createdat FROM users WHERE id = $1`,
        [req.user.id]
      );

      return res.json({ success: true, plan: 'free', user: rows[0] || null });
    }

    const stripe = getStripe();
    const priceId = STRIPE_PRICES[planKey];

    if (stripe && priceId?.startsWith('price_')) {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${APP_URL}?upgraded=1&plan=${planKey}`,
        cancel_url: `${APP_URL}?cancelled=1`,
        metadata: {
          userId: String(req.user.id),
          plan: planKey,
        },
      });

      await pool.query(
        `UPDATE users SET pendingplan = $1, updatedat = NOW() WHERE id = $2`,
        [planKey, req.user.id]
      );

      return res.json({
        success: true,
        checkoutUrl: session.url,
        plan: planKey,
      });
    }

    return res.status(503).json({
      error: 'Stripe is not configured for this paid plan yet.',
    });
  } catch (e) {
    console.error('subscribe:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/checkout-confirm', async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    if (!token) return res.status(400).json({ error: 'Missing token.' });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(400).json({ error: 'Invalid or expired token.' });
    }

    const { userId, plan } = payload;
    if (!userId || !plan) {
      return res.status(400).json({ error: 'Token missing userId or plan.' });
    }

    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE users SET plan = $1, pendingplan = NULL, planexpiresat = $2, updatedat = NOW() WHERE id = $3`,
      [plan, expires, userId]
    );

    const { rows } = await pool.query(
      `SELECT id, name, email, plan, avatarurl, createdat FROM users WHERE id = $1`,
      [userId]
    );

    const newToken = signToken({ id: userId, email: rows[0]?.email });

    res.json({
      success: true,
      token: newToken,
      user: rows[0] || null,
    });
  } catch (e) {
    console.error('checkout-confirm:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/plan', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT plan, planexpiresat, pendingplan FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const u = rows[0];

    if (u.plan !== 'free' && u.planexpiresat && new Date(u.planexpiresat) < new Date()) {
      await pool.query(
        `UPDATE users SET plan = 'free', planexpiresat = NULL, updatedat = NOW() WHERE id = $1`,
        [req.user.id]
      );
      u.plan = 'free';
      u.planexpiresat = null;
    }

    res.json({
      plan: u.plan,
      expiresAt: u.planexpiresat,
      pendingPlan: u.pendingplan,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================
   VEO VIDEO HELPERS
========================= */

const VIDEO_MODELS_FALLBACK = ['veo-3.0-generate-preview', 'veo-2.0-generate-001'];

// In-memory video proxy cache (token -> {uri, key, expires})
const _videoCache = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _videoCache.entries()) {
    if (v.expires < now) _videoCache.delete(k);
  }
}, 5 * 60 * 1000);

const VEO_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Async job store
const _videoJobs = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of _videoJobs.entries()) {
    if (job.expires < now) _videoJobs.delete(id);
  }
}, 5 * 60 * 1000);

async function checkVideoOperation(operationName, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${key}`);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Poll HTTP ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  if (data.done) {
    if (data.error) throw new Error(data.error.message || 'Veo operation error.');
    const samples = data?.response?.generateVideoResponse?.generatedSamples;
    if (!samples || !samples.length) throw new Error('No video samples returned from Veo.');
    const uri = samples[0]?.video?.uri;
    if (!uri) throw new Error('No video URI in Veo response.');
    return { done: true, uri };
  }
  return { done: false };
}

async function pollVideoOperation(operationName, key, maxWaitMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 8000));
    const result = await checkVideoOperation(operationName, key);
    if (result.done) return result.uri;
  }
  throw new Error('Video generation timed out. Please try again.');
}

async function generateVideoVeo(key, prompt, aspectRatio, durationSeconds, startImageBuf, startImageMime) {
  let lastErr = null;
  for (const model of VIDEO_MODELS_FALLBACK) {
    try {
      const durSec = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 8;
      const instance = { prompt: String(prompt || '').normalize('NFC') };
      if (startImageBuf) {
        instance.image = {
          bytesBase64Encoded: startImageBuf.toString('base64'),
          mimeType: startImageMime || 'image/jpeg',
        };
      }
      const parameters = {
        aspectRatio: aspectRatio || '16:9',
        sampleCount: 1,
        durationSeconds: durSec,
        enhancePrompt: true,
      };
      const r = await fetch(`${VEO_BASE}/models/${model}:predictLongRunning?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ instances: [instance], parameters }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
      const operationName = data?.name;
      if (!operationName) throw new Error('No operation name returned from Veo API.');
      console.log(`[generateVideoVeo] model=${model} op=${operationName}`);
      return operationName;
    } catch (err) {
      lastErr = err?.message || String(err);
      console.warn(`Veo [${model}] failed:`, lastErr);
    }
  }
  throw new Error(lastErr || 'All Veo models failed. Please try again.');
}

/* =========================
   VIDEO â€” Real Veo API
========================= */

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.post(
  '/api/video/generate',
  auth,
  videoUpload.fields([
    { name: 'startImage', maxCount: 1 },
    { name: 'endImage',   maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const key    = geminiKey();
      const prompt = String(req.body?.prompt || '').trim();
      const aspect = String(req.body?.aspect || req.body?.aspectRatio || '16:9').trim();
      const plan   = await getUserPlan(req.user.id);
      const userId = String(req.user?.id || req.user?.email || req.ip);
      const startImage = req.files?.startImage?.[0] || null;

      if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });

      // Daily quota check
      const limit   = VIDEO_DAILY_LIMITS[plan] ?? VIDEO_DAILY_LIMITS.free;
      const current = getVideoUsageCount(userId, plan);
      if (Number.isFinite(limit) && current >= limit)
        return res.status(403).json({ error: `Daily video limit reached (${current}/${limit}). Please upgrade.` });

      // Reference images: Pro+ only
      const refsAllowed = ['pro', 'proplus', 'max'].includes(plan);
      if (!refsAllowed && startImage)
        return res.status(403).json({ error: 'Reference images require Pro plan or above.' });

      // Aspect ratio
      const ASPECT_MAP = {
        '16:9': '16:9', '9:16': '9:16', '1:1': '1:1',
        '169':  '16:9', '916':  '9:16', '11':  '1:1',
      };
      const aspectRatio = ASPECT_MAP[aspect] || ASPECT_MAP[aspect.replace(':', '')] || '16:9';

      // Duration: 5, 8, 10 seconds only (Veo 3 supported)
      const durRaw = parseInt(String(req.body?.duration || '8').replace(/[^0-9]/g, ''), 10) || 8;
      const durationSeconds = [5, 8, 10].includes(durRaw) ? durRaw : 8;

      console.log(`[video/generate] user=${userId} plan=${plan} dur=${durationSeconds}s aspect=${aspectRatio} prompt="${prompt.slice(0,60)}"`);

      // Submit Veo job â€” returns operationName immediately (no blocking poll)
      const operationName = await generateVideoVeo(
        key, prompt, aspectRatio, durationSeconds,
        startImage?.buffer || null,
        startImage?.mimetype || null
      );

      // Store async job
      const jobId = crypto.randomBytes(16).toString('hex');
      _videoJobs.set(jobId, {
        operationName,
        key,
        userId,
        plan,
        duration: String(req.body?.duration || '8s'),
        usedReferences: Boolean(startImage),
        status: 'processing',
        videoToken: null,
        error: null,
        expires: Date.now() + 30 * 60 * 1000,
      });

      return res.json({ ok: true, jobId, message: 'Video job started.' });

    } catch (err) {
      console.error('[video/generate] error:', err.message);
      return res.status(500).json({ error: err?.message || 'Video generation failed.' });
    }
  }
);

/* Poll video job status */
app.get('/api/video/status/:jobId', auth, async (req, res) => {
  const job = _videoJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired. Please regenerate.' });
  if (job.status === 'done') {
    return res.json({ ok: true, status: 'done', videoUrl: `/api/video/stream/${job.videoToken}`,
      duration: job.duration, plan: job.plan, usedReferences: job.usedReferences });
  }
  if (job.status === 'error') {
    _videoJobs.delete(req.params.jobId);
    return res.json({ ok: false, status: 'error', error: job.error });
  }
  try {
    const result = await checkVideoOperation(job.operationName, job.key);
    if (result.done) {
      const videoToken = crypto.randomBytes(16).toString('hex');
      _videoCache.set(videoToken, { uri: result.uri, key: job.key, expires: Date.now() + 2 * 60 * 60 * 1000 });
      const usageCount = incrementVideoUsage(job.userId, job.plan);
      job.status = 'done'; job.videoToken = videoToken;
      return res.json({
        ok: true, status: 'done', videoUrl: `/api/video/stream/${videoToken}`,
        usageCount, duration: job.duration, plan: job.plan,
        planLabel: job.plan === 'proplus' ? 'Pro+' : job.plan.charAt(0).toUpperCase() + job.plan.slice(1),
        usedReferences: job.usedReferences, model: job.model,
        message: 'Video generated successfully.',
      });
    }
    return res.json({ ok: true, status: 'processing', message: 'Video is still generating...' });
  } catch (err) {
    job.status = 'error'; job.error = err.message;
    return res.json({ ok: false, status: 'error', error: err.message });
  }
});

/* =========================
   FALLBACK
========================= */


/* =========================
   VIDEO STREAM PROXY
========================= */
app.get('/api/video/stream/:token', async (req, res) => {
  const entry = _videoCache.get(req.params.token);
  if (!entry || entry.expires < Date.now()) {
    _videoCache.delete(req.params.token);
    return res.status(410).json({ error: 'Video link expired. Please regenerate.' });
  }
  try {
    const targetUrl = entry.uri.includes('?') ? entry.uri : `${entry.uri}?key=${entry.key}`;
    const isDownload = req.query.dl === '1';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    let videoRes;
    try {
      videoRes = await fetch(targetUrl, { signal: controller.signal });
    } finally { clearTimeout(timeout); }
    if (!videoRes.ok) return res.status(502).json({ error: `Veo fetch failed (${videoRes.status}).` });
    const buffer = Buffer.from(await videoRes.arrayBuffer());
    const total = buffer.length;
    if (total === 0) return res.status(502).json({ error: 'Empty video from Veo.' });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Authorization');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'private, max-age=7200');
    res.setHeader('Content-Disposition', isDownload ? 'attachment; filename="jeethy-video.mp4"' : 'inline; filename="jeethy-video.mp4"');
    const rangeHeader = req.headers['range'];
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      const safeEnd = Math.min(end, total - 1);
      res.setHeader('Content-Range', `bytes ${start}-${safeEnd}/${total}`);
      res.setHeader('Content-Length', safeEnd - start + 1);
      return res.status(206).end(buffer.slice(start, safeEnd + 1));
    }
    res.setHeader('Content-Length', total);
    return res.status(200).end(buffer);
  } catch (err) {
    console.error('[video/stream] error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Stream error.' });
  }
});

app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* =========================
   START
========================= */

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`JeeThy Labs - port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });
