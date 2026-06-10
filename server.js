require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const {
  DATABASE_URL,
  SESSION_SECRET,
  JWT_SECRET,
  EMAIL_USER,
  EMAIL_PASS,
  GEMINI_API_KEY,
  STRIPE_SECRET_KEY,
  APP_URL,
  NODE_ENV
} = process.env;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS_TTL = 1000 * 60 * 10;

let modelsCache = null;
let modelsCacheTime = 0;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(cookieParser());

app.use(session({
  secret: SESSION_SECRET || 'jeethy-labs-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: NODE_ENV === 'production',
    httpOnly: true,
    sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use(express.static(path.join(__dirname)));

function geminiKey() {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is missing.');
  }
  return GEMINI_API_KEY;
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role || 'user'
    },
    JWT_SECRET || 'jeethy-jwt-secret',
    { expiresIn: '7d' }
  );
}

function auth(req, res, next) {
  const bearer = req.headers.authorization;
  const token =
    req.cookies?.token ||
    (bearer && bearer.startsWith('Bearer ') ? bearer.slice(7) : null);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET || 'jeethy-jwt-secret');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function formatDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

const VIDEO_DAILY_LIMITS = {
  free: 2,
  pro: 10,
  proplus: 20,
  max: 50
};

const videoUsageMap = new Map();

function getVideoUsageKey(userId, plan) {
  return `${formatDateKey()}::${userId}::${plan}`;
}

function getVideoUsageCount(userId, plan) {
  return videoUsageMap.get(getVideoUsageKey(userId, plan)) || 0;
}

function incrementVideoUsage(userId, plan) {
  const key = getVideoUsageKey(userId, plan);
  const current = videoUsageMap.get(key) || 0;
  const next = current + 1;
  videoUsageMap.set(key, next);
  return next;
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      full_name TEXT DEFAULT '',
      role TEXT DEFAULT 'user',
      plan TEXT DEFAULT 'free',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function sendOTP(email, code, purpose = 'verify') {
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.warn('Email credentials missing. OTP:', email, code);
    return;
  }

  const subject =
    purpose === 'reset'
      ? 'Reset your JeeThy Labs password'
      : 'Verify your JeeThy Labs account';

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;padding:24px;background:#0b0b14;color:#fff">
      <h2 style="margin:0 0 12px">JeeThy Labs</h2>
      <p style="margin:0 0 16px">Your OTP code is:</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:6px;margin:16px 0;color:#a855f7">${code}</div>
      <p style="margin-top:16px;color:#c9c9d8">This code will expire in 10 minutes.</p>
    </div>
  `;

  await transporter.sendMail({
    from: `"JeeThy Labs" <${EMAIL_USER}>`,
    to: email,
    subject,
    html
  });
}

function randomOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createOTP(email, purpose) {
  const code = randomOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await pool.query(
    `INSERT INTO otp_codes (email, code, purpose, expires_at) VALUES ($1,$2,$3,$4)`,
    [email, code, purpose, expiresAt]
  );

  await sendOTP(email, code, purpose);
  return code;
}

async function verifyOTP(email, code, purpose) {
  const { rows } = await pool.query(
    `SELECT * FROM otp_codes
     WHERE email = $1 AND code = $2 AND purpose = $3 AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [email, code, purpose]
  );

  if (!rows.length) return false;

  await pool.query(`DELETE FROM otp_codes WHERE email = $1 AND purpose = $2`, [email, purpose]);
  return true;
}

async function fetchAvailableModels(key) {
  const now = Date.now();
  if (modelsCache && now - modelsCacheTime < MODELS_TTL) return modelsCache;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(data?.error?.message || 'Unable to fetch models.');
  }

  modelsCache = data?.models || [];
  modelsCacheTime = now;
  return modelsCache;
}

function pickText(parts) {
  if (!Array.isArray(parts)) return '';
  return parts
    .map(p => p?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildSongPrompt({ prompt, style, vocalist }) {
  return [
    'Create an original song.',
    prompt ? `Song idea: ${prompt}` : '',
    style ? `Genre/style: ${style}` : '',
    vocalist ? `Vocal style: ${vocalist}` : '',
    'Return a strong lyrical and musical concept suitable for music generation.'
  ].filter(Boolean).join('\n');
}

async function callGeminiModel({ key, model, body }) {
  const r = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    const msg = data?.error?.message || `Model call failed for ${model}`;
    throw new Error(msg);
  }

  return data;
}

async function lyriaCall(modelName, promptText) {
  const key = geminiKey();
  const r = await fetch(`${GEMINI_BASE}/${modelName}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: promptText }]
        }
      ]
    })
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(data?.error?.message || 'Song generation failed.');
  }

  return data;
}

function extractSongResponse(data) {
  const candidates = data?.candidates || [];
  for (const c of candidates) {
    const txt = pickText(c?.content?.parts || []);
    if (txt) {
      return {
        text: txt,
        audioUrl: null
      };
    }
  }
  return {
    text: 'Song generated successfully.',
    audioUrl: null
  };
}

async function getUserPlan(userId) {
  const { rows } = await pool.query(`SELECT plan FROM users WHERE id = $1 LIMIT 1`, [userId]);
  return rows[0]?.plan || 'free';
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/key', (req, res) => {
  if (!GEMINI_API_KEY) return res.status(503).json({ error: 'API key not configured' });
  res.json({ key: GEMINI_API_KEY });
});

app.get('/api/models', async (req, res) => {
  try {
    const key = geminiKey();
    const models = await fetchAvailableModels(key);
    res.json({
      models: models.map(m => ({
        name: m.name,
        displayName: m.displayName,
        description: m.description
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/request-signup-otp', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const existing = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
    if (existing.rows.length) {
      return res.status(400).json({ error: 'Email already registered.' });
    }

    await createOTP(email, 'signup');
    res.json({ ok: true, message: 'OTP sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const otp = String(req.body.otp || '').trim();
    const fullName = String(req.body.fullName || '').trim();

    if (!email || !password || !otp) {
      return res.status(400).json({ error: 'Email, password and OTP are required.' });
    }

    const ok = await verifyOTP(email, otp, 'signup');
    if (!ok) {
      return res.status(400).json({ error: 'Invalid or expired OTP.' });
    }

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1,$2,$3)
       RETURNING id, email, full_name, role, plan`,
      [email, hash, fullName]
    );

    const user = rows[0];
    const token = signToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7
    });

    res.json({ ok: true, token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/request-reset-otp', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const existing = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Account not found.' });
    }

    await createOTP(email, 'reset');
    res.json({ ok: true, message: 'Reset OTP sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const otp = String(req.body.otp || '').trim();

    if (!email || !password || !otp) {
      return res.status(400).json({ error: 'Email, password and OTP are required.' });
    }

    const ok = await verifyOTP(email, otp, 'reset');
    if (!ok) {
      return res.status(400).json({ error: 'Invalid or expired OTP.' });
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE email = $2`, [hash, email]);

    res.json({ ok: true, message: 'Password reset successful.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const { rows } = await pool.query(
      `SELECT id, email, password_hash, full_name, role, plan FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!user.password_hash) {
      return res.status(401).json({
        error: 'This account was created without a password. Please use Forgot Password or Sign Up again.'
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = signToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7
    });

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        plan: user.plan
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, full_name, role, plan FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    res.json({ user: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', auth, async (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.post('/api/chat', auth, async (req, res) => {
  try {
    const key = geminiKey();
    const message = String(req.body?.message || '').trim();
    const systemPrompt = String(req.body?.systemPrompt || '').trim();

    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const prompt = [
      systemPrompt ? `System instruction:\n${systemPrompt}` : '',
      `User:\n${message}`
    ].filter(Boolean).join('\n\n');

    const data = await callGeminiModel({
      key,
      model: 'gemini-1.5-flash',
      body: {
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ]
      }
    });

    const reply =
      pickText(data?.candidates?.[0]?.content?.parts || []) ||
      'No response from model.';

    res.json({ ok: true, reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/image', auth, upload.single('image'), async (req, res) => {
  try {
    const key = geminiKey();
    const prompt = String(req.body?.prompt || '').trim();

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required.' });
    }

    const data = await callGeminiModel({
      key,
      model: 'gemini-1.5-flash',
      body: {
        contents: [
          {
            parts: [{ text: `Generate an image concept: ${prompt}` }]
          }
        ]
      }
    });

    const text =
      pickText(data?.candidates?.[0]?.content?.parts || []) ||
      'Image prompt processed successfully.';

    res.json({
      ok: true,
      message: text,
      imageUrl: null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/song', auth, async (req, res) => {
  try {
    const key = geminiKey();
    const planKey = await getUserPlan(req.user.id);
    const planCfg = {
      free: { label: 'Free' },
      pro: { label: 'Pro' },
      proplus: { label: 'Pro+' },
      max: { label: 'Max' }
    }[planKey] || { label: 'Free' };

    const {
      prompt = '',
      style = 'Pop',
      vocalist = 'Male'
    } = req.body || {};

    const songPrompt = buildSongPrompt({
      prompt: String(prompt || '').trim(),
      style: String(style || 'Pop').trim(),
      vocalist: String(vocalist || 'Male').trim()
    });

    const models = await fetchAvailableModels(key);
    const preferredModels = [
      'lyria-realtime-exp',
      'lyria-002',
      'gemini-1.5-pro',
      'gemini-1.5-flash'
    ];

    const availableNames = new Set(
      models.map(m => String(m.name || '').replace(/^models\//, ''))
    );

    let data = null;
    let usedModel = null;
    let lastError = null;

    for (const model of preferredModels) {
      if (!availableNames.has(model) && !model.startsWith('gemini-')) continue;
      try {
        if (model.startsWith('lyria')) {
          data = await lyriaCall(model, songPrompt);
        } else {
          data = await callGeminiModel({
            key,
            model,
            body: {
              contents: [
                {
                  parts: [{ text: songPrompt }]
                }
              ]
            }
          });
        }
        usedModel = model;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!data) {
      throw lastError || new Error('Song generation failed.');
    }

    const parsed = extractSongResponse(data);

    res.json({
      ok: true,
      message: 'Song generated successfully.',
      plan: planKey,
      planLabel: planCfg.label,
      model: usedModel,
      lyrics: parsed.text,
      audioUrl: parsed.audioUrl
    });
  } catch (err) {
    console.error('/api/song error:', err);
    res.status(500).json({ error: err.message || 'Song generation failed.' });
  }
});

app.post(
  '/api/video/generate',
  auth,
  videoUpload.fields([
    { name: 'startImage', maxCount: 1 },
    { name: 'endImage', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const prompt = String(req.body?.prompt || '').trim();
      const duration = String(req.body?.duration || '5s').trim();
      const plan = String(req.body?.plan || 'free').trim().toLowerCase();

      const startImage = req.files?.startImage?.[0] || null;
      const endImage = req.files?.endImage?.[0] || null;

      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
      }

      const limit = VIDEO_DAILY_LIMITS[plan] ?? VIDEO_DAILY_LIMITS.free;
      const userId = req.user?.id || req.user?.email || req.ip;
      const current = getVideoUsageCount(userId, plan);

      if (Number.isFinite(limit) && current >= limit) {
        return res.status(403).json({ error: 'Daily video limit reached for your plan.' });
      }

      const refsAllowed = ['pro', 'proplus', 'max'].includes(plan);
      if (!refsAllowed && (startImage || endImage)) {
        return res.status(403).json({ error: 'Reference images require Pro, Pro+, or Max.' });
      }

      // ── Real Veo 2 generation ──
      const key = geminiKey();
      const aspectRatio = String(req.body?.aspectRatio || '16:9').trim();
      const style = String(req.body?.style || 'Realistic').trim();

      const videoPrompt = [
        prompt,
        style !== 'Realistic' ? `Style: ${style}.` : '',
        `Duration: ${duration}.`,
        `Aspect ratio: ${aspectRatio}.`
      ].filter(Boolean).join(' ');

      const createRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: videoPrompt })
        }
      );

      const createData = await createRes.json();

      if (!createRes.ok) {
        return res.status(createRes.status).json({
          error: createData.error?.message || 'Video generation request failed.'
        });
      }

      const operationName = createData.name;
      if (!operationName) {
        return res.status(500).json({ error: 'No operation ID returned from video API.' });
      }

      let finalData = null;

      for (let i = 0; i < 60; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000));

        const pollRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${key}`
        );

        const pollData = await pollRes.json();

        if (!pollRes.ok) {
          return res.status(pollRes.status).json({
            error: pollData.error?.message || 'Video polling failed.'
          });
        }

        if (pollData.done) {
          finalData = pollData;
          break;
        }
      }

      if (!finalData || !finalData.done) {
        return res.status(504).json({
          error: 'Video generation timed out. Please try again.'
        });
      }

      const videoUri =
        finalData.response?.generatedVideos?.[0]?.video?.uri ||
        finalData.response?.videos?.[0]?.uri ||
        null;

      if (!videoUri) {
        return res.status(500).json({
          error: 'No video returned from generation API.'
        });
      }

      const usageCount = incrementVideoUsage(userId, plan);

      res.json({
        ok: true,
        message: 'Video generated successfully.',
        duration,
        aspectRatio,
        style,
        plan,
        planLabel: plan === 'proplus' ? 'Pro+' : plan.charAt(0).toUpperCase() + plan.slice(1),
        usageCount,
        videoUrl: videoUri,
        usedReferences: Boolean(startImage || endImage)
      });
    } catch (err) {
      console.error('/api/video/generate error:', err);
      res.status(500).json({ error: err.message || 'Video generation failed.' });
    }
  }
);

app.post('/api/create-checkout-session', auth, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured.' });
    }

    const plan = String(req.body?.plan || 'pro').trim();
    const priceMap = {
      pro: process.env.STRIPE_PRICE_PRO,
      proplus: process.env.STRIPE_PRICE_PROPLUS,
      max: process.env.STRIPE_PRICE_MAX
    };

    const price = priceMap[plan];
    if (!price) {
      return res.status(400).json({ error: 'Invalid plan.' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: `${APP_URL || 'http://localhost:3000'}?payment=success`,
      cancel_url: `${APP_URL || 'http://localhost:3000'}?payment=cancel`,
      client_reference_id: String(req.user.id),
      metadata: {
        userId: String(req.user.id),
        plan
      }
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  res.json({ received: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

ensureTables()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`JeeThy Labs server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Startup error:', err);
    process.exit(1);
  });
