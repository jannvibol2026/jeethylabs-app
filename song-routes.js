/* ═══════════════════════════════════════════════════════════════
   routes/song.js  —  JeeThy Labs
   Full /api/song + /api/song/plan-info
   Supports: Lyria 3 Pro, TTS fallback, customLyrics, PRO/MAX plan
   ═══════════════════════════════════════════════════════════════

   INSTALL DEPENDENCIES (if not already):
     npm install @google/generative-ai node-fetch

   REQUIRED ENV VARS in .env:
     GEMINI_API_KEY=AIza...
     JWT_SECRET=your_jwt_secret

   HOW TO USE IN server.js / app.js:
     const songRoutes = require('./routes/song');
     app.use('/api', songRoutes);
   ═══════════════════════════════════════════════════════════════ */

"use strict";

const express = require("express");
const router  = express.Router();
const jwt     = require("jsonwebtoken");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const JWT_SECRET     = process.env.JWT_SECRET     || "secret";

/* ── Plan config ─────────────────────────────────────────── */
const SONG_PLANS = {
  free: { maxDuration: 55,  customLyrics: false, durationHint: "under 1 minute" },
  pro:  { maxDuration: 180, customLyrics: true,  durationHint: "2 – 3 minutes"  },
  max:  { maxDuration: 240, customLyrics: true,  durationHint: "3 – 4 minutes (full song)" },
};

/* ── Auth middleware ──────────────────────────────────────── */
function authenticateToken(req, res, next) {
  // 1. Bearer token from Authorization header
  const authHeader = req.headers["authorization"] || req.headers["Authorization"] || "";
  const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  // 2. Fallback: jl_token from cookie (httpOnly session)
  const cookieToken = req.cookies?.jl_token || null;

  const token = headerToken || cookieToken;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated. Please log in." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;   // { id, email, plan, name, ... }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

/* ── Optional auth (for /api/song that accepts both authed + cookie) ── */
function optionalAuth(req, res, next) {
  const authHeader  = req.headers["authorization"] || "";
  const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken = req.cookies?.jl_token || null;
  const token = headerToken || cookieToken;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch (e) { req.user = null; }
  }
  next();
}

/* ═══════════════════════════════════════════════════════════
   GET /api/song/plan-info
   Returns plan limits for the current user
   ═══════════════════════════════════════════════════════════ */
router.get("/song/plan-info", authenticateToken, (req, res) => {
  const plan   = (req.user?.plan || "free").toLowerCase();
  const config = SONG_PLANS[plan] || SONG_PLANS.free;

  return res.json({
    plan:         plan,
    durationHint: config.durationHint,
    customLyrics: config.customLyrics,
  });
});

/* ═══════════════════════════════════════════════════════════
   POST /api/song
   Generate song with Lyria 3 Pro → TTS fallback → lyrics-only
   Body: { prompt, style, voice, customLyrics? }
   ═══════════════════════════════════════════════════════════ */
router.post("/song", optionalAuth, async (req, res) => {
  const user   = req.user;
  const plan   = (user?.plan || "free").toLowerCase();
  const config = SONG_PLANS[plan] || SONG_PLANS.free;

  /* ── Require login ── */
  if (!user) {
    return res.status(401).json({ error: "Please log in to generate songs." });
  }

  const { prompt, style = "Pop", voice = "Female", customLyrics } = req.body;

  /* ── Validate customLyrics plan check ── */
  if (customLyrics && !config.customLyrics) {
    return res.status(403).json({
      error: "Custom lyrics are available on PRO and MAX plans only.",
      upgradeRequired: true,
    });
  }

  if (!prompt && !customLyrics) {
    return res.status(400).json({ error: "Please provide a song description or custom lyrics." });
  }

  /* ── Build generation prompt ── */
  const voiceHint    = voice.toLowerCase().includes("female") ? "female vocalist" : "male vocalist";
  const durationHint = config.durationHint;
  const songPrompt   = customLyrics
    ? `Create a ${style} song with ${voiceHint}. Use these exact lyrics:\n\n${customLyrics}`
    : `Create a complete ${style} song with ${voiceHint} voice. Theme: ${prompt}. Target duration: ${durationHint}. Include verse, chorus, bridge. Write full lyrics and generate the music.`;

  /* ── Step 1: Try Lyria 3 Pro ── */
  try {
    const result = await generateWithLyria(songPrompt, style, voice, config.maxDuration, GEMINI_API_KEY);
    return res.json(result);
  } catch (lyriaErr) {
    console.warn("[song] Lyria failed:", lyriaErr.message, "→ trying TTS fallback");
  }

  /* ── Step 2: Generate lyrics with Gemini, then TTS ── */
  try {
    const lyricsText = await generateLyricsWithGemini(songPrompt, GEMINI_API_KEY);
    const ttsResult  = await generateTTS(lyricsText, voice, GEMINI_API_KEY);

    if (ttsResult.audio) {
      return res.json({
        title:       extractTitle(lyricsText) || `${style} Song`,
        audio:       ttsResult.audio,
        mimeType:    ttsResult.mimeType || "audio/wav",
        lyrics:      lyricsText,
        audioSource: "TTS",
        ttsMessage:  "Generated with TTS (Lyria temporarily unavailable).",
      });
    }

    /* ── Step 3: Lyrics only ── */
    return res.json({
      title:      extractTitle(lyricsText) || `${style} Song`,
      audio:      null,
      lyrics:     lyricsText,
      lyricsOnly: true,
      audioSource: null,
      ttsMessage: "Audio generation temporarily unavailable. Your lyrics are ready below.",
    });

  } catch (fallbackErr) {
    console.error("[song] All methods failed:", fallbackErr.message);
    return res.status(500).json({ error: "Song generation failed. Please try again shortly." });
  }
});

/* ═══════════════════════════════════════════════════════════
   Lyria 3 Pro — music generation
   ═══════════════════════════════════════════════════════════ */
async function generateWithLyria(prompt, style, voice, maxDurationSecs, apiKey) {
  if (!apiKey) throw new Error("No API key configured.");

  // Lyria 3 uses the Gemini multimodal API with music generation capability
  const LYRIA_MODEL = "lyria-realtime-exp"; // update if your model name differs

  const body = {
    model: `models/${LYRIA_MODEL}`,
    contents: [{
      role: "user",
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice.toLowerCase().includes("female") ? "Aoede" : "Charon"
          }
        }
      }
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${LYRIA_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetchWithTimeout(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  }, 60000); // 60s timeout for Lyria

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Lyria HTTP ${res.status}`);
  }

  const data  = await res.json();
  const part  = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  const lyric = data?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || null;

  if (!part?.inlineData?.data) {
    throw new Error("Lyria returned no audio data.");
  }

  return {
    title:       extractTitle(lyric) || `${style} Song`,
    audio:       part.inlineData.data,
    mimeType:    part.inlineData.mimeType || "audio/wav",
    lyrics:      lyric,
    audioSource: "Lyria",
  };
}

/* ═══════════════════════════════════════════════════════════
   Gemini lyrics generation
   ═══════════════════════════════════════════════════════════ */
async function generateLyricsWithGemini(prompt, apiKey) {
  const LYRICS_MODEL = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${LYRICS_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      role: "user",
      parts: [{ text: `You are a professional songwriter. ${prompt}\n\nWrite complete song lyrics with [Verse 1], [Chorus], [Verse 2], [Bridge], [Outro] sections. Include the song title on the first line as "Title: <name>".` }]
    }]
  };

  const res  = await fetchWithTimeout(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  }, 30000);

  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `Gemini HTTP ${res.status}`); }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no lyrics.");
  return text;
}

/* ═══════════════════════════════════════════════════════════
   TTS (Text-to-Speech) audio generation
   ═══════════════════════════════════════════════════════════ */
async function generateTTS(text, voice, apiKey) {
  const TTS_MODEL = "gemini-2.5-flash-preview-tts";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${apiKey}`;

  // Truncate to avoid token limits (TTS works best with <1000 chars)
  const ttsText = text.length > 1200 ? text.slice(0, 1200) + "..." : text;

  const body = {
    contents: [{ role: "user", parts: [{ text: ttsText }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice.toLowerCase().includes("female") ? "Aoede" : "Charon"
          }
        }
      }
    }
  };

  const res = await fetchWithTimeout(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  }, 45000);

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error?.message || `TTS HTTP ${res.status}`);
  }

  const data = await res.json();
  const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

  if (!part?.inlineData?.data) return { audio: null };

  return {
    audio:    part.inlineData.data,
    mimeType: part.inlineData.mimeType || "audio/wav",
  };
}

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */
function extractTitle(lyrics) {
  if (!lyrics) return null;
  const match = lyrics.match(/^Title:\s*(.+)$/im);
  return match ? match[1].trim() : null;
}

function fetchWithTimeout(url, opts, ms) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

module.exports = router;
