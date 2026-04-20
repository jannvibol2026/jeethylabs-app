'use strict';

const express      = require('express');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool }     = require('pg');
const nodemailer   = require('nodemailer');
const crypto       = require('crypto');
const path         = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET    = process.env.JWT_SECRET    || 'changeme';
const OWNER_API_KEY = process.env.OWNER_API_KEY || '';
const DATABASE_URL  = process.env.DATABASE_URL  || '';
const SMTP_HOST     = process.env.SMTP_HOST     || 'smtp.gmail.com';
const SMTP_PORT     = parseInt(process.env.SMTP_PORT || '465');
const SMTP_USER     = process.env.SMTP_USER     || '';
const SMTP_PASS     = process.env.SMTP_PASS     || '';
const APP_NAME      = 'JeeThy Labs';
const APP_URL       = process.env.APP_URL || 'https://app.jeethylabs.site';

// ── DB ────────────────────────────────────
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
pool.connect((err, client, release) => {
  if (err) console.error('DB Error:', err.message);
  else { console.log('DB Connected'); release(); }
});

// ── EMAIL ─────────────────────────────────
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000
});

// ── OTP STORE (in-memory, 10 min TTL) ────
const otpStore = new Map();
// key = email, value = { otp, name, passwordHash, expiresAt }

function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

async function sendOtpEmail(email, name, otp) {
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#0f0e13;color:#e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#7c3aed,#06b6d4);padding:28px 32px;text-align:center;">
      <h1 style="margin:0;font-size:1.5rem;color:#fff;">${APP_NAME}</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Email Verification</p>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 16px;">Hi <strong>${name}</strong>,</p>
      <p style="margin:0 0 24px;color:#94a3b8;">Your verification code for ${APP_NAME} is:</p>
      <div style="background:#1e1b2e;border:2px solid #7c3aed;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px;">
        <span style="font-size:2.5rem;font-weight:900;letter-spacing:0.5em;color:#a78bfa;">${otp}</span>
      </div>
      <p style="color:#64748b;font-size:13px;margin:0;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
      <hr style="border:none;border-top:1px solid #1e293b;margin:24px 0;"/>
      <p style="color:#475569;font-size:12px;margin:0;">If you did not request this, please ignore this email.</p>
    </div>
  </div>`;
  const mailTimeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('SMTP timeout after 15s')), 15000)
  );
  await Promise.race([transporter.sendMail({
    from: `"${APP_NAME}" <noreply@contact.jeethylabs.site>`,
    to: email,
    subject: `${otp} — Your ${APP_NAME} Verification Code`,
    html
  }), mailTimeout]);
}

// ── MIDDLEWARE ────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

// ── ROUTES ────────────────────────────────
app.get('/api/key', (req, res) => res.json({ key: OWNER_API_KEY }));

// STEP 1: Send OTP
app.post('/api/send-otp', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password)
      return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email))
      return res.status(400).json({ error: 'Please enter a valid email address.' });

    const exists = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
    if (exists.rows.length > 0)
      return res.status(409).json({ error: 'Email already registered. Please login.' });

    const otp          = generateOtp();
    const passwordHash = await bcrypt.hash(password, 10);
    const expiresAt    = Date.now() + 10 * 60 * 1000; // 10 min

    otpStore.set(email.toLowerCase(), { otp, name: name.trim(), passwordHash, expiresAt });

    await sendOtpEmail(email, name.trim(), otp);
    res.json({ ok: true, message: 'Verification code sent.' });
  } catch (e) {
    console.error('[send-otp]', e.message);
    res.status(500).json({ error: 'Failed to send code. Check email settings.' });
  }
});

// STEP 2: Verify OTP + Create Account
app.post('/api/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp)
      return res.status(400).json({ error: 'Email and code are required.' });

    const record = otpStore.get(email.toLowerCase());
    if (!record)
      return res.status(400).json({ error: 'No pending verification. Please sign up again.' });
    if (Date.now() > record.expiresAt) {
      otpStore.delete(email.toLowerCase());
      return res.status(400).json({ error: 'Code expired. Please sign up again.' });
    }
    if (record.otp !== otp.trim())
      return res.status(400).json({ error: 'Incorrect code. Please try again.' });

    otpStore.delete(email.toLowerCase());

    const r = await pool.query(
      "INSERT INTO users (name,email,password_hash,plan,status,email_verified,created_at,last_active) VALUES ($1,$2,$3,'free','active',true,NOW(),NOW()) RETURNING id,name,email,plan",
      [record.name, email.toLowerCase(), record.passwordHash]
    );
    const u     = r.rows[0];
    const token = jwt.sign({ id:u.id, name:u.name, email:u.email, plan:u.plan }, JWT_SECRET, { expiresIn:'7d' });
    res.cookie('jt_token', token, { httpOnly:true, sameSite:'lax', maxAge:604800000 });
    res.json({ user: { id:u.id, name:u.name, email:u.email, plan:u.plan } });
  } catch (e) {
    console.error('[verify-otp]', e.message);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });
    const r = await pool.query('SELECT id,name,email,password_hash,plan,status FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
    if (r.rows.length === 0)
      return res.status(401).json({ error: 'Invalid email or password.' });
    const u = r.rows[0];
    if (u.status === 'suspended')
      return res.status(403).json({ error: 'Account suspended. Contact support@jeethylabs.site' });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });
    await pool.query('UPDATE users SET last_active=NOW() WHERE id=$1', [u.id]);
    const token = jwt.sign({ id:u.id, name:u.name, email:u.email, plan:u.plan }, JWT_SECRET, { expiresIn:'7d' });
    res.cookie('jt_token', token, { httpOnly:true, sameSite:'lax', maxAge:604800000 });
    res.json({ user: { id:u.id, name:u.name, email:u.email, plan:u.plan } });
  } catch (e) {
    console.error('[login]', e.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ME
app.get('/api/me', async (req, res) => {
  const token = req.cookies && req.cookies.jt_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    const r = await pool.query('SELECT id,name,email,plan,status,avatar_url FROM users WHERE id=$1 LIMIT 1', [p.id]);
    if (r.rows.length === 0) return res.status(401).json({ error: 'User not found.' });
    const u = r.rows[0];
    if (u.status === 'suspended') return res.status(403).json({ error: 'Account suspended.' });
    res.json({ user: { id:u.id, name:u.name, email:u.email, plan:u.plan, avatar_url:u.avatar_url } });
  } catch {
    res.status(401).json({ error: 'Session expired. Please login again.' });
  }
});

// LOGOUT
app.post('/api/logout', (req, res) => {
  res.clearCookie('jt_token');
  res.json({ ok: true });
});

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

app.listen(PORT, () => console.log('JeeThy Labs running on port ' + PORT));
