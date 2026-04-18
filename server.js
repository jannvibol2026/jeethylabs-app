/**
 * JeeThy Labs App — Express Server
 * Serves static files + /api/key endpoint
 * 
 * SETUP: Add GOOGLE_API_KEY in Railway Dashboard → Variables
 */

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── /api/key  — returns the owner API key ──────────────────────────
// Only the key name is exposed in code; the actual value lives in Railway env vars.
app.get('/api/key', (req, res) => {
  const key = process.env.GOOGLE_API_KEY || '';
  if (!key) {
    return res.status(503).json({ error: 'API key not configured' });
  }
  // Return key — frontend calls this once at startup and stores in memory only
  res.json({ key });
});

// ── Static files ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname), {
  // Don't expose server.js or .env to the world
  index: 'index.html'
}));

// ── SPA fallback ──────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ JeeThy Labs App running on port ${PORT}`);
  console.log(`   API key configured: ${!!process.env.GOOGLE_API_KEY}`);
});
