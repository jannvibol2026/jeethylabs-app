'use strict';

const express      = require('express');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool }     = require('pg');
const path         = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET    = process.env.JWT_SECRET    || 'changeme';
const OWNER_API_KEY = process.env.OWNER_API_KEY || '';
const DATABASE_URL  = process.env.DATABASE_URL  || '';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
  if (err) console.error('DB Error:', err.message);
  else { console.log('DB Connected'); release(); }
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

app.get('/api/key', (req, res) => res.json({ key: OWNER_API_KEY }));

app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const exists = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]);
    if (exists.rows.length > 0)
      return res.status(409).json({ error: 'Email already registered.' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      "INSERT INTO users (name,email,password_hash,plan,status,email_verified,created_at,last_active) VALUES ($1,$2,$3,'free','active',false,NOW(),NOW()) RETURNING id,name,email,plan",
      [name.trim(), email.toLowerCase(), hash]
    );
    const u = r.rows[0];
    const token = jwt.sign({ id:u.id, name:u.name, email:u.email, plan:u.plan }, JWT_SECRET, { expiresIn:'7d' });
    res.cookie('jt_token', token, { httpOnly:true, sameSite:'lax', maxAge:604800000 });
    res.json({ user: { id:u.id, name:u.name, email:u.email, plan:u.plan } });
  } catch(e) {
    console.error('[signup]', e.message);
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

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
  } catch(e) {
    console.error('[login]', e.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

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
  } catch(e) {
    res.status(401).json({ error: 'Session expired. Please login again.' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('jt_token');
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

app.listen(PORT, () => console.log('JeeThy Labs running on port ' + PORT));
