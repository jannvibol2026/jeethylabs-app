const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ── ENV ───────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET   = process.env.JWT_SECRET || 'secret123';
const RESEND_KEY   = process.env.SMTP_PASS || '';
const FROM_EMAIL   = process.env.FROM_EMAIL || 'noreply@contact.jeethylabs.site';
const PORT         = process.env.PORT || 8080;

console.log('=== JeeThy Labs Starting ===');
console.log('RESEND KEY:', RESEND_KEY ? RESEND_KEY.substring(0,8)+'...' : '❌ MISSING');
console.log('FROM_EMAIL:', FROM_EMAIL);

// ── DB ────────────────────────────────────
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
pool.connect()
  .then(c => { console.log('✅ DB Connected'); c.release(); })
  .catch(e => console.error('❌ DB Error:', e.message));

// ── OTP STORE ─────────────────────────────
const otpStore = {};
function genOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── SEND EMAIL via curl (bypasses Node.js TLS/network issues) ──
function sendEmailCurl(to, subject, html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: `JeeThy Labs <${FROM_EMAIL}>`,
      to: [to],
      subject: subject,
      html: html,
    });

    const args = [
      '-s', '-w', '%{http_code}',
      '-X', 'POST',
      'https://api.resend.com/emails',
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${RESEND_KEY}`,
      '-d', body,
      '--max-time', '20',
      '--connect-timeout', '10',
    ];

    execFile('curl', args, { timeout: 25000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[curl] error:', err.message);
        return reject(new Error('curl failed: ' + err.message));
      }
      // stdout = response body + http_code at end
      const httpCode = stdout.slice(-3);
      const respBody = stdout.slice(0, -3);
      console.log('[curl] HTTP', httpCode, '|', respBody.substring(0, 100));
      if (httpCode === '200' || httpCode === '201') {
        resolve(true);
      } else {
        reject(new Error('Resend API error ' + httpCode + ': ' + respBody));
      }
    });
  });
}

// ── ROUTES ───────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', resend: RESEND_KEY ? 'configured' : 'missing' });
});

app.get('/api/key', (req, res) => {
  res.json({ key: process.env.GOOGLE_API_KEY || '' });
});

// Send OTP
app.post('/api/send-otp', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const otp = genOTP();
  otpStore[email] = { otp, expires: Date.now() + 10 * 60 * 1000 };
  console.log('[send-otp] Sending to:', email, '| OTP:', otp);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px;">
      <h2 style="color:#7c3aed;">JeeThy Labs</h2>
      <p>Hi ${name || 'there'},</p>
      <p>Your verification code is:</p>
      <div style="font-size:40px;font-weight:bold;letter-spacing:8px;color:#7c3aed;padding:16px 0;">${otp}</div>
      <p style="color:#888;">This code expires in 10 minutes.</p>
    </div>
  `;

  try {
    await sendEmailCurl(email, 'Your Verification Code', html);
    console.log('[send-otp] ✅ Sent to:', email);
    res.json({ success: true });
  } catch (e) {
    console.error('[send-otp] ❌', e.message);
    res.status(500).json({ error: 'Failed to send code: ' + e.message });
  }
});

// Verify OTP + Register
app.post('/api/verify-otp', async (req, res) => {
  const { email, otp, name, password } = req.body;
  const record = otpStore[email];
  if (!record) return res.status(400).json({ error: 'No OTP found. Request a new one.' });
  if (Date.now() > record.expires) {
    delete otpStore[email];
    return res.status(400).json({ error: 'OTP expired.' });
  }
  if (record.otp !== otp) return res.status(400).json({ error: 'Invalid OTP.' });
  delete otpStore[email];

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1,$2,$3) ON CONFLICT (email) DO UPDATE SET name=$1, password=$3 RETURNING id, name, email',
      [name, email, hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    console.error('[verify-otp]', e.message);
    res.status(500).json({ error: 'Registration failed: ' + e.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Email not found.' });
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Wrong password.' });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    res.status(500).json({ error: 'Login failed: ' + e.message });
  }
});

// Forgot password - send OTP
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

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px;">
      <h2 style="color:#7c3aed;">Reset Your Password</h2>
      <p>Your reset code:</p>
      <div style="font-size:40px;font-weight:bold;letter-spacing:8px;color:#7c3aed;padding:16px 0;">${otp}</div>
      <p style="color:#888;">Expires in 10 minutes.</p>
    </div>
  `;

  try {
    await sendEmailCurl(email, 'Password Reset Code', html);
    res.json({ success: true });
  } catch (e) {
    console.error('[forgot-password]', e.message);
    res.status(500).json({ error: 'Failed to send reset code: ' + e.message });
  }
});

// Reset password
app.post('/api/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const record = otpStore[email];
  if (!record || record.otp !== otp) return res.status(400).json({ error: 'Invalid or expired OTP.' });
  if (Date.now() > record.expires) { delete otpStore[email]; return res.status(400).json({ error: 'OTP expired.' }); }
  delete otpStore[email];
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password=$1 WHERE email=$2', [hash, email]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Auth middleware
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

// Get profile
app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, created_at FROM users WHERE id=$1', [req.user.id]);
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`✅ JeeThy Labs running on port ${PORT}`));
