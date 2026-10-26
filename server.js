import 'dotenv/config';
import express from 'express';
import vader from 'vader-sentiment';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';

const app = express();

// Initialize Supabase server client
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

// In-memory items store for demo mode when Supabase is not configured
const demoItems = [];

// Limit JSON body size to 10 MB
app.use(express.json({ limit: '10mb' }));

// Graceful error response for oversized payloads
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request payload too large. Images must be under 8 MB.' });
  }
  next(err);
});

app.use(express.static('public'));

// Rate limiting: 20 requests per minute per IP on /api/*
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute and try again.' }
});

app.use('/api', apiLimiter);

// Public health check route
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Public config route for frontend Supabase client (NEVER returns service role key)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

// HTML escaping helper to prevent XSS in server-rendered templates
const escapeHtml = str => String(str ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Public shared item viewer route (GET /s/:id) - requires no login
app.get('/s/:id', async (req, res) => {
  const notFoundHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Story Not Found - Pixtale</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@500;600&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#f5ede3;--card:#fffaf4;--line:#eadccb;--ink:#3a2a1e;--mut:#8b7767;--pri:#9c6b49;--r:14px}
    body{margin:0;font-family:Inter,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:36px;max-width:480px;width:100%;text-align:center;box-shadow:0 8px 24px rgba(90,60,30,0.06)}
    h1{font-family:'Playfair Display',serif;font-size:26px;margin:0 0 12px;color:var(--ink)}
    p{color:var(--mut);line-height:1.6;margin:0 0 24px;font-size:14.5px}
    .btn{background:var(--pri);color:#fff;border:0;border-radius:10px;padding:12px 20px;font-weight:600;text-decoration:none;display:inline-block;cursor:pointer}
    .btn:hover{background:#85583a}
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:44px;margin-bottom:12px">🔒</div>
    <h1>Content Not Available</h1>
    <p>This story or caption does not exist, or its creator has set it to private.</p>
    <a class="btn" href="/">Go to Pixtale Studio</a>
  </div>
</body>
</html>`;

  try {
    const { id } = req.params;
    let item = null;
    if (!supabase) {
      item = demoItems.find(i => String(i.id) === String(id) && i.is_public);
    } else {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('id', id)
        .eq('is_public', true)
        .single();
      if (!error) item = data;
    }

    if (!item) {
      return res.status(404).type('html').send(notFoundHtml);
    }

    const moodLower = (item.mood || '').toLowerCase();
    const moodBadgeClass = moodLower === 'positive' ? 'badge-pos' : (moodLower === 'negative' ? 'badge-neg' : 'badge-neu');
    const createdDate = item.created_at ? new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

    const shareHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Shared Story - Pixtale</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@500;600&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#f5ede3;--card:#fffaf4;--line:#eadccb;--ink:#3a2a1e;--mut:#8b7767;--pri:#9c6b49;--pri2:#85583a;--soft:#f6e9db;--r:14px}
    *{box-sizing:border-box}
    body{margin:0;font-family:Inter,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px}
    .nav{width:100%;max-width:640px;display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
    .logo{display:flex;align-items:center;gap:8px;font-weight:700;font-size:17px;text-decoration:none;color:var(--ink)}
    .logo i{font-style:normal;background:var(--pri);color:#fff;border-radius:8px;padding:5px 8px;font-size:13px}
    .logo b{color:var(--pri)}
    .card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:32px;max-width:640px;width:100%;box-shadow:0 8px 30px rgba(90,60,30,0.06)}
    .thumb{width:100%;max-height:360px;object-fit:cover;border-radius:10px;margin-bottom:20px;display:block}
    .content{font-size:16px;line-height:1.7;white-space:pre-wrap;margin:16px 0;color:var(--ink)}
    .meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:16px;margin-top:20px}
    .tag{background:#ece3ff;color:#6a4fc4;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;text-transform:capitalize}
    .badge{border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;text-transform:capitalize}
    .badge-pos{background:#e8f5e9;color:#2e7d32;border:1px solid #c8e6c9}
    .badge-neu{background:#f5f5f5;color:#616161;border:1px solid #e0e0e0}
    .badge-neg{background:#ffebee;color:#c62828;border:1px solid #ffcdd2}
    .cta{display:flex;justify-content:space-between;align-items:center;margin-top:28px;background:var(--soft);border-radius:12px;padding:16px 20px;gap:16px;flex-wrap:wrap}
    .btn{background:var(--pri);color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:600;text-decoration:none;cursor:pointer;font-size:14px;display:inline-block}
    .btn:hover{background:var(--pri2)}
  </style>
</head>
<body>
  <div class="nav">
    <a href="/" class="logo"><i>◉</i><span>Pix<b>tale</b></span></a>
    <a href="/" class="btn" style="padding:7px 14px;font-size:13px">Create with AI →</a>
  </div>
  <div class="card">
    ${item.thumb ? `<img class="thumb" src="${escapeHtml(item.thumb)}" alt="Creation thumbnail">` : ''}
    <div class="content">${escapeHtml(item.text)}</div>
    <div class="meta">
      <span class="tag">${escapeHtml(item.kind)}</span>
      ${item.mood ? `<span class="badge ${moodBadgeClass}">${escapeHtml(item.mood)}</span>` : ''}
      ${createdDate ? `<span style="color:var(--mut);font-size:12.5px;margin-left:auto">${escapeHtml(createdDate)}</span>` : ''}
    </div>
    <div class="cta">
      <div>
        <b style="font-size:14.5px;color:var(--ink);display:block">Made with Pixtale</b>
        <span style="font-size:12.5px;color:var(--mut)">Turn your images into meaningful stories with AI.</span>
      </div>
      <a class="btn" href="/">Try Pixtale Free</a>
    </div>
  </div>
</body>
</html>`;

    res.type('html').send(shareHtml);
  } catch (err) {
    res.status(404).type('html').send(notFoundHtml);
  }
});

// Authentication middleware for /api/* routes
async function requireUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication token is empty' });
  }
  if (!supabase) {
    if (token === 'demo-token' || token.startsWith('demo-token')) {
      req.user = {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'guptahoney0124@gmail.com',
        user_metadata: { full_name: 'Honey Gupta' }
      };
      return next();
    }
    return res.status(401).json({ error: 'Supabase credentials not configured in .env. Please set SUPABASE_URL and SUPABASE_ANON_KEY.' });
  }
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: error?.message || 'Invalid or expired session. Please log in again.' });
    }
    req.user = data.user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Authentication error: ' + err.message });
  }
}

// Protect all following /api/* routes
app.use('/api', requireUser);

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

async function gemini(parts, generationConfig = null) {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_key_here') {
    throw new Error('Missing GEMINI_API_KEY. Copy .env.example to .env and add your key.');
  }
  const payload = { contents: [{ parts }] };
  if (generationConfig) payload.generationConfig = generationConfig;

  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error('Failed to connect to AI service. Please check your internet connection.');
  }

  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d.error?.message || 'AI request failed';
    if (msg.includes('API_KEY_INVALID') || msg.toLowerCase().includes('api key not valid') || msg.includes('API key expired') || (r.status === 400 && msg.includes('API key'))) {
      throw new Error('Invalid GEMINI_API_KEY. Please verify your key in .env.');
    }
    throw new Error(msg);
  }
  return (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
}

const imagePart = (dataUrl) => {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  // Strictly enforce data:image/ with supported image mime types
  const match = /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('Invalid image format. Only JPEG, PNG, WEBP, and GIF images are supported.');
  }
  const [, mime, data] = match;
  // Estimate byte size from base64 length
  const sizeInBytes = (data.length * 3) / 4;
  if (sizeInBytes > 8 * 1024 * 1024) {
    throw new Error('Image exceeds 8 MB size limit.');
  }
  return { inline_data: { mime_type: mime.toLowerCase(), data } };
};

const STYLES = {
  Normal: 'balanced and natural, 1-2 sentences',
  Creative: 'unique, imaginative and engaging, 1-2 sentences',
  Short: 'short and catchy, under 12 words',
  Professional: 'formal and polished, 1-2 sentences'
};

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/caption', async (req, res) => {
  try {
    const { image, style = 'Normal', prompt = '' } = req.body;
    if (!image) return res.status(400).json({ error: 'Please upload an image first.' });
    let img;
    try {
      img = imagePart(image);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!img) return res.status(400).json({ error: 'Invalid image data. Please provide a valid JPG, PNG, or WEBP image.' });

    const text = `Write one caption for this image. Style: ${STYLES[style] || STYLES.Normal}. ${prompt ? 'Extra instructions: ' + prompt : ''} Return only the caption.`;
    res.json({ text: await gemini([img, { text }]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/caption-variants - Generate 3 caption options in one call
app.post('/api/caption-variants', async (req, res) => {
  try {
    const { image, style = 'Normal', prompt = '' } = req.body;
    if (!image) return res.status(400).json({ error: 'Please upload an image first.' });
    let img;
    try {
      img = imagePart(image);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!img) return res.status(400).json({ error: 'Invalid image data. Please provide a valid JPG, PNG, or WEBP image.' });

    const text = `Generate exactly 3 diverse, high-quality caption options for this image.
Style: ${STYLES[style] || STYLES.Normal}.
${prompt ? 'Extra user instructions: ' + prompt : ''}

Return your response in this exact JSON format:
{
  "variants": [
    "First creative caption variant",
    "Second creative caption variant",
    "Third creative caption variant"
  ]
}
Return only JSON.`;

    const raw = await gemini([img, { text }], { responseMimeType: 'application/json' });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI caption variants response as JSON.' });
    }
    const variants = Array.isArray(parsed.variants)
      ? parsed.variants.map(v => String(v).trim()).filter(Boolean).slice(0, 3)
      : [];
    if (variants.length === 0) {
      return res.status(500).json({ error: 'AI failed to generate variants. Please try again.' });
    }
    res.json({ variants });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/hashtags - Generate 8-10 relevant hashtags
app.post('/api/hashtags', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Please provide text to generate hashtags for.' });
    }
    if (text.trim().length > 2000) {
      return res.status(400).json({ error: 'Text cannot exceed 2000 characters.' });
    }

    const prompt = `Generate 8 to 10 relevant, popular, and trending social media hashtags for this caption/content:
"${text.trim()}"

Return your response in this exact JSON format:
{
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5", "#tag6", "#tag7", "#tag8"]
}
Ensure each item starts with "#" and contains no spaces. Return only JSON.`;

    const raw = await gemini([{ text: prompt }], { responseMimeType: 'application/json' });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Failed to parse hashtags response as JSON.' });
    }
    const hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map(t => {
          const s = String(t).trim();
          return s.startsWith('#') ? s : '#' + s;
        }).filter(t => t.length > 1).slice(0, 10)
      : [];
    res.json({ hashtags });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/translate - Translate any content to Hindi, English, Spanish, or French
app.post('/api/translate', async (req, res) => {
  try {
    const { text, targetLang } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Please provide text to translate.' });
    }
    if (text.trim().length > 2000) {
      return res.status(400).json({ error: 'Text cannot exceed 2000 characters.' });
    }
    const validLanguages = ['Hindi', 'English', 'Spanish', 'French'];
    if (!targetLang || !validLanguages.includes(targetLang)) {
      return res.status(400).json({ error: `Target language must be one of: ${validLanguages.join(', ')}` });
    }

    const prompt = `Translate the following text accurately into ${targetLang}. Preserve the original tone and nuances. Return only the translated text directly with no introductory phrases or quotes:\n\n${text.trim()}`;
    const translatedText = await gemini([{ text: prompt }]);
    res.json({ translatedText: translatedText.trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/text', async (req, res) => {
  try {
    const { type = 'Story', prompt = '', tone = 'Adventurous', length = 'Medium', image } = req.body;
    if (!prompt.trim() && !image) return res.status(400).json({ error: 'Write a prompt or add an image.' });
    const words = { Short: '60-100', Medium: '150-250', Long: '400-600' }[length] || '150-250';
    const parts = [];
    if (image) {
      let img;
      try {
        img = imagePart(image);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      if (img) parts.push(img);
    }
    parts.push({ text: `Write a ${type} (${tone} tone, about ${words} words). Topic/idea: ${prompt || 'Based on the image'}. Return only the finished text.` });
    res.json({ text: await gemini(parts) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sentiment', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Please provide text to analyze (1 to 2000 characters).' });
    }
    const trimmed = text.trim();
    if (trimmed.length > 2000) {
      return res.status(400).json({ error: 'Text cannot exceed 2000 characters.' });
    }

    // 1. Lexicon method (VADER)
    const SIA = vader.SentimentIntensityAnalyzer;
    const vRes = SIA.polarity_scores(trimmed);
    const vCompound = Math.round(vRes.compound * 100) / 100;
    const vLabel = getSentimentLabel(vCompound);
    const lexicon = { label: vLabel, score: vCompound };

    // 2. Gemini (LLM) method
    const prompt = `Analyze the sentiment of this text:
"${trimmed}"

Return your analysis in this exact JSON format:
{
  "label": "positive|neutral|negative",
  "score": <number between -1.0 and 1.0>,
  "emotions": ["emotion1", "emotion2", max 3],
  "reason": "one short sentence"
}`;

    const raw = await gemini([{ text: prompt }], { responseMimeType: 'application/json' });
    let llm;
    try {
      const parsed = JSON.parse(raw);
      const label = ['positive', 'neutral', 'negative'].includes(parsed.label?.toLowerCase())
        ? parsed.label.toLowerCase()
        : (parsed.score >= 0.05 ? 'positive' : (parsed.score <= -0.05 ? 'negative' : 'neutral'));
      const score = typeof parsed.score === 'number'
        ? Math.max(-1, Math.min(1, Math.round(parsed.score * 100) / 100))
        : 0;
      const emotions = Array.isArray(parsed.emotions) ? parsed.emotions.slice(0, 3).map(String) : [];
      const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim()
        : 'Analysis completed based on language tone.';
      llm = { label, score, emotions, reason };
    } catch {
      return res.status(500).json({ error: 'Failed to parse Gemini sentiment response as JSON.' });
    }

    res.json({ lexicon, llm });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/image-mood', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Please upload an image to analyze.' });
    let img;
    try {
      img = imagePart(image);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!img) return res.status(400).json({ error: 'Invalid image format. Please provide a valid JPG, PNG, or WEBP image.' });

    const prompt = `Analyze the visual mood, atmosphere, and energy of this image.
Return your response in this exact JSON format:
{
  "mood": "short descriptive mood word or phrase, e.g. Serene & Calm or Vibrant & Energetic",
  "energy": "low|medium|high",
  "suggestedTone": "Adventurous|Friendly|Professional|Funny|Dramatic",
  "reason": "one short sentence explaining why this tone fits the image"
}`;

    const raw = await gemini([img, { text: prompt }], { responseMimeType: 'application/json' });
    let result;
    try {
      const parsed = JSON.parse(raw);
      const allowedTones = ['Adventurous', 'Friendly', 'Professional', 'Funny', 'Dramatic'];
      const matchedTone = allowedTones.find(t => t.toLowerCase() === (parsed.suggestedTone || '').toLowerCase()) || 'Friendly';
      const energy = ['low', 'medium', 'high'].includes((parsed.energy || '').toLowerCase())
        ? parsed.energy.toLowerCase()
        : 'medium';
      result = {
        mood: String(parsed.mood || 'Warm & Expressive'),
        energy,
        suggestedTone: matchedTone,
        reason: String(parsed.reason || 'Visual elements and lighting reflect this mood.')
      };
    } catch {
      return res.status(500).json({ error: 'Failed to parse image mood analysis from AI.' });
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Item persistence routes (scoped to req.user.id) ──

// GET /api/items?kind=&mood=&fav=&q= - list, newest first
app.get('/api/items', async (req, res) => {
  try {
    const { kind, mood, fav, q } = req.query;

    if (!supabase) {
      let filtered = demoItems.filter(i => i.user_id === req.user.id);
      if (kind && kind !== 'All') filtered = filtered.filter(i => i.kind === kind.toLowerCase());
      if (mood && mood !== 'All') filtered = filtered.filter(i => (i.mood || '').toLowerCase() === mood.toLowerCase());
      if (fav === 'true' || fav === true) filtered = filtered.filter(i => i.fav);
      if (q && typeof q === 'string' && q.trim()) filtered = filtered.filter(i => i.text.toLowerCase().includes(q.trim().toLowerCase()));
      return res.json({ items: filtered });
    }

    let query = supabase
      .from('items')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (kind && kind !== 'All') {
      query = query.eq('kind', kind.toLowerCase());
    }
    if (mood && mood !== 'All') {
      query = query.ilike('mood', mood);
    }
    if (fav === 'true' || fav === true) {
      query = query.eq('fav', true);
    }
    if (q && typeof q === 'string' && q.trim()) {
      query = query.ilike('text', `%${q.trim()}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ items: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/items - create item
app.post('/api/items', async (req, res) => {
  try {
    const { kind, text, thumb, mood, fav = false, is_public = false } = req.body;
    if (!kind || !['caption', 'text', 'sentiment'].includes(kind)) {
      return res.status(400).json({ error: 'Kind must be caption, text, or sentiment.' });
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Text cannot be empty.' });
    }

    const newRow = {
      user_id: req.user.id,
      kind,
      text: text.trim(),
      thumb: thumb || null,
      mood: mood || null,
      fav: Boolean(fav),
      is_public: Boolean(is_public)
    };

    if (!supabase) {
      const item = {
        id: 'demo-' + Date.now(),
        ...newRow,
        created_at: new Date().toISOString()
      };
      demoItems.unshift(item);
      return res.status(201).json(item);
    }

    const { data, error } = await supabase
      .from('items')
      .insert([newRow])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/items/:id - toggle fav / is_public
app.patch('/api/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fav, is_public } = req.body;
    const updates = {};
    if (fav !== undefined) updates.fav = Boolean(fav);
    if (is_public !== undefined) updates.is_public = Boolean(is_public);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update provided.' });
    }

    if (!supabase) {
      const item = demoItems.find(i => String(i.id) === String(id) && i.user_id === req.user.id);
      if (!item) return res.status(404).json({ error: 'Item not found.' });
      if (fav !== undefined) item.fav = Boolean(fav);
      if (is_public !== undefined) item.is_public = Boolean(is_public);
      return res.json(item);
    }

    const { data, error } = await supabase
      .from('items')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Item not found.' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/items/:id - delete item
app.delete('/api/items/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!supabase) {
      const idx = demoItems.findIndex(i => String(i.id) === String(id) && i.user_id === req.user.id);
      if (idx !== -1) demoItems.splice(idx, 1);
      return res.json({ ok: true });
    }

    const { error } = await supabase
      .from('items')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export function getSentimentLabel(score) {
  if (score >= 0.05) return 'positive';
  if (score <= -0.05) return 'negative';
  return 'neutral';
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(process.env.PORT || 3000, () => console.log(`Pixtale running on http://localhost:${process.env.PORT || 3000}`));
}

export { app, imagePart, requireUser };

