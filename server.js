const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── ENV ───────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET   = process.env.JWT_SECRET || 'jeethy_secret_2026';
const SMTP_USER    = process.env.SMTP_USER || '';   // Brevo login: a8c959001@smtp-brevo.com
const SMTP_PASS    = process.env.SMTP_PASS || '';   // Brevo SMTP key
const FROM_EMAIL   = process.env.FROM_EMAIL || '';  // Your sender email
const PORT         = process.env.PORT || 8080;

console.log('=== JeeThy Labs Starting ===');
console.log('SMTP_USER:', SMTP_USER || '❌ MISSING');
console.log('SMTP_PASS:', SMTP_PASS ? '✅ set' : '❌ MISSING');
console.log('FROM_EMAIL:', FROM_EMAIL || '❌ MISSING');

// ── BREVO SMTP ────────────────────────────
const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

transporter.verify((err) => {
  if (err) console.error('❌ SMTP Error:', err.message);
  else console.log('✅ Brevo SMTP Ready');
});

// ── DB ────────────────────────────────────
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
pool.connect()
  .then(c => { console.log('DB Connected'); c.release(); })
  .catch(e => console.error('❌ DB Error:', e.message));

// ── OTP STORE (in-memory) ─────────────────
const otpStore = {};
function genOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── SEND EMAIL ────────────────────────────
async function sendEmail(to, subject, html) {
  const info = await transporter.sendMail({
    from: `"JeeThy Labs" <${FROM_EMAIL}>`,
    to,
    subject,
    html,
  });
  console.log('[sendEmail] ✅ messageId:', info.messageId);
  return info;
}

// ── COOKIE HELPER ─────────────────────────
function setAuthCookie(res, token) {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// ── AUTH MIDDLEWARE ───────────────────────
function authMiddleware(req, res, next) {
  let token = req.cookies?.auth_token;
  if (!token) {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) token = header.split(' ')[1];
  }
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// ════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    smtp_host: 'smtp-relay.brevo.com',
    smtp_user: SMTP_USER || 'MISSING',
    smtp_ready: !!SMTP_USER && !!SMTP_PASS,
    from_email: FROM_EMAIL || 'MISSING',
  });
});

// Google API Key
app.get('/api/key', (req, res) => {
  res.json({ key: process.env.GOOGLE_API_KEY || '' });
});

// ── CHECK SESSION ─────────────────────────
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, plan, created_at FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── LOGOUT ────────────────────────────────
app.post('/api/logout', (req, res) => {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
  });
  res.json({ success: true });
});

// ── SEND OTP ──────────────────────────────
app.post('/api/send-otp', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  if (!SMTP_USER || !SMTP_PASS) {
    console.error('[send-otp] ❌ Brevo SMTP credentials missing!');
    return res.status(500).json({ error: 'Email service not configured. Contact admin.' });
  }

  // Check existing email
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) {
      return res.status(400).json({ error: 'Email already registered. Please login.' });
    }
  } catch (e) {
    console.error('[send-otp] DB check error:', e.message);
  }

  const otp = genOTP();
  otpStore[email] = { otp, name, expires: Date.now() + 10 * 60 * 1000 };
  console.log('[send-otp] OTP for', email, ':', otp);

  try {
    await sendEmail(
      email,
      '🔐 Your JeeThy Labs Verification Code',
      `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#0f172a;border-radius:16px;border:1px solid rgba(124,58,237,0.3);">
        <div style="text-align:center;margin-bottom:24px;">
          <span style="font-size:28px;font-weight:900;color:#a855f7;">JeeThy Labs</span>
        </div>
        <p style="color:#e2e8f0;font-size:16px;">Hi <strong style="color:#a855f7;">${name || 'there'}</strong>,</p>
        <p style="color:#94a3b8;">Your verification code is:</p>
        <div style="text-align:center;padding:24px;margin:20px 0;background:rgba(124,58,237,0.1);border-radius:12px;border:1px solid rgba(124,58,237,0.3);">
          <span style="font-size:48px;font-weight:900;letter-spacing:12px;color:#a855f7;">${otp}</span>
        </div>
        <p style="color:#64748b;font-size:13px;">⏰ Code expires in <strong>10 minutes</strong>.</p>
        <p style="color:#475569;font-size:12px;margin-top:20px;border-top:1px solid rgba(255,255,255,0.05);padding-top:16px;">
          If you did not sign up for JeeThy Labs, please ignore this email.
        </p>
      </div>
      `
    );
    console.log('[send-otp] ✅ Sent to:', email);
    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (e) {
    console.error('[send-otp] ❌ Send failed:', e.message);
    res.status(500).json({ error: 'Failed to send code: ' + e.message });
  }
});

// ── VERIFY OTP + REGISTER ─────────────────
app.post('/api/verify-otp', async (req, res) => {
  const { email, otp, name, password } = req.body;

  if (!email || !otp || !password) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const record = otpStore[email];
  if (!record) return res.status(400).json({ error: 'No OTP found. Please request a new code.' });
  if (Date.now() > record.expires) {
    delete otpStore[email];
    return res.status(400).json({ error: 'Code expired. Please request a new one.' });
  }
  if (record.otp !== String(otp).trim()) {
    return res.status(400).json({ error: 'Incorrect code. Please try again.' });
  }
  delete otpStore[email];

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password, plan)
       VALUES ($1,$2,$3,'free')
       ON CONFLICT (email) DO UPDATE SET name=$1, password=$3
       RETURNING id, name, email, plan, created_at`,
      [name || record.name || 'User', email, hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    setAuthCookie(res, token);
    console.log('[verify-otp] ✅ Registered:', email);
    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan, created_at: user.created_at }
    });
  } catch (e) {
    console.error('[verify-otp] ❌', e.message);
    res.status(500).json({ error: 'Registration failed: ' + e.message });
  }
});

// ── LOGIN ─────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  try {
    const result = await pool.query(
      'SELECT id, name, email, password, plan, created_at FROM users WHERE email=$1',
      [email]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Email not found.' });
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Wrong password.' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    setAuthCookie(res, token);
    console.log('[login] ✅ Login:', email);
    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan || 'free', created_at: user.created_at }
    });
  } catch (e) {
    console.error('[login] ❌', e.message);
    res.status(500).json({ error: 'Login failed: ' + e.message });
  }
});

// ── FORGOT PASSWORD ───────────────────────
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required.' });

  try {
    const result = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (!result.rows.length) return res.status(404).json({ error: 'Email not found.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const otp = genOTP();
  otpStore[email] = { otp, expires: Date.now() + 10 * 60 * 1000, type: 'reset' };

  try {
    await sendEmail(email, '🔑 Password Reset - JeeThy Labs', `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#0f172a;border-radius:16px;">
        <h2 style="color:#a855f7;">Reset Your Password</h2>
        <p style="color:#94a3b8;">Your reset code:</p>
        <div style="text-align:center;padding:24px;background:rgba(124,58,237,0.1);border-radius:12px;margin:16px 0;">
          <span style="font-size:48px;font-weight:900;letter-spacing:12px;color:#a855f7;">${otp}</span>
        </div>
        <p style="color:#64748b;font-size:13px;">Expires in <strong>10 minutes</strong>.</p>
      </div>
    `);
    res.json({ success: true });
  } catch (e) {
    console.error('[forgot-password] ❌', e.message);
    res.status(500).json({ error: 'Failed to send reset code: ' + e.message });
  }
});

// ── RESET PASSWORD ────────────────────────
app.post('/api/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const record = otpStore[email];
  if (!record || record.otp !== String(otp).trim()) {
    return res.status(400).json({ error: 'Invalid or expired code.' });
  }
  if (Date.now() > record.expires) {
    delete otpStore[email];
    return res.status(400).json({ error: 'Code expired.' });
  }
  delete otpStore[email];
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password=$1 WHERE email=$2', [hash, email]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET PROFILE ───────────────────────────
app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, plan, created_at FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── FALLBACK ──────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`JeeThy Labs running on port ${PORT}`));
