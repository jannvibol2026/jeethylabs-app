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
console.log('SMTP_USER:', SMTP_USER || '❌ MISSING');
console.log('SMTP_PASS:', SMTP_PASS ? '✅ set' : '❌ MISSING');
console.log('FROM_EMAIL:', FROM_EMAIL || '❌ MISSING');

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

transporter.verify((err) => {
  if (err) console.error('❌ SMTP Error:', err.message);
  else console.log('✅ Brevo SMTP Ready');
});

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
pool.connect()
  .then(c => { console.log('✅ DB Connected'); c.release(); })
  .catch(e => console.error('❌ DB Error:', e.message));

const otpStore = {};

function genOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmail(to, subject, html) {
  const info = await transporter.sendMail({
    from: `"JeeThy Labs" <${FROM_EMAIL}>`,
    to, subject, html,
  });
  console.log('[sendEmail] ✅ messageId:', info.messageId);
  return info;
}

/* ── Health ── */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    smtp_host: 'smtp-relay.brevo.com',
    smtp_user: SMTP_USER || 'MISSING',
    smtp_ready: !!SMTP_USER && !!SMTP_PASS,
    from
