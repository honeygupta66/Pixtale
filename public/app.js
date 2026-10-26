if (window.location.protocol === 'file:') {
  window.location.href = 'http://localhost:3000';
}

const $ = s => document.querySelector(s);
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

let localLegacyItems = ls('vc_items', []);
let items = [];
let user = null;

// Supabase client instance (initialized via /api/config)
let sb = null;

// ── Navigation: Dashboard, Create, Sentiment, History, Settings ──
const NAV = [
  ['dashboard', 'Dashboard', '▦'],
  ['create', 'Create', '✦'],
  ['sentiment', 'Sentiment', '◈'],
  ['history', 'History', '◷'],
  ['settings', 'Settings', '⚙']
];

const STYLES = [
  ['Normal', 'Balanced and natural'],
  ['Creative', 'Unique and engaging'],
  ['Short', 'Short and catchy'],
  ['Professional', 'Formal and polished']
];

const TYPES = [
  ['Story', 'Creative stories'],
  ['Blog Post', 'Detailed articles'],
  ['Social Media', 'Posts & captions'],
  ['Product Description', 'Marketing content']
];

// Per-tab and per-feature output isolation
const cur = {
  img: null, thumb: null,
  style: 'Normal', type: 'Story',
  capOut: '', capErr: '',
  txtOut: '', txtErr: '',
  txtPrompt: '', txtTone: 'Adventurous', txtLen: 'Medium',
  busy: false,
  filter: 'All',           // History type filter: 'All' | 'Favorites' | 'Captions' | 'Text' | 'Sentiment'
  moodFilter: 'All',       // History mood filter: 'All' | 'Positive' | 'Neutral' | 'Negative'
  authMode: 'in',          // 'in' | 'up'
  authErr: '',
  authBusy: false,
  createTab: 'caption',    // 'caption' | 'text'
  itemsLoading: false,
  importBusy: false,
  // Sentiment page state
  sentText: '',
  sentLexicon: null,
  sentLlm: null,
  sentErr: '',
  sentBusy: false,
  // Image Mood state
  moodImg: null,
  moodThumb: null,
  moodResult: null,
  moodErr: '',
  moodBusy: false,
  // AI Extras (Phase 7)
  variants: [],
  variantsBusy: false,
  variantsErr: '',
  hashtags: [],
  hashtagsBusy: false,
  hashtagsErr: '',
  translatedText: '',
  translatedLang: '',
  translateBusy: false,
  translateErr: ''
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = t => {
  const ms = typeof t === 'number' ? t : new Date(t).getTime();
  const m = (Date.now() - ms) / 6e4 | 0;
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? (m / 60 | 0) + ' hours ago' : (m / 1440 | 0) + ' days ago';
};
const read = f => new Promise(r => { const a = new FileReader(); a.onload = () => r(a.result); a.readAsDataURL(f); });
const shrink = (src, max) => new Promise(r => { const i = new Image(); i.onload = () => { const k = Math.min(1, max / Math.max(i.width, i.height)), c = document.createElement('canvas'); c.width = i.width * k; c.height = i.height * k; c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); r(c.toDataURL('image/jpeg', .85)); }; i.src = src; });

// ── Supabase Initialization & Auth ──
async function initSupabase() {
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase) {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: {
          persistSession: sessionStorage.getItem('vc_no_persist') !== '1'
        }
      });

      // Listen for session changes
      sb.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
          user = session.user;
          await fetchItems();
        } else {
          user = null;
          items = [];
        }
        render();
      });

      // Initial session check
      const { data: { session } } = await sb.auth.getSession();
      if (session?.user) {
        user = session.user;
        await fetchItems();
        render();
      }
    } else {
      // Demo session fallback when Supabase keys are not yet configured in .env
      const stored = localStorage.getItem('vc_demo_user') || sessionStorage.getItem('vc_demo_user');
      if (stored) {
        try {
          user = JSON.parse(stored);
          await fetchItems();
          render();
        } catch {}
      }
    }
  } catch (err) {
    console.warn('Supabase initialization notice:', err.message);
  }
}

async function getAuthHeader() {
  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.access_token) {
      return { 'Authorization': `Bearer ${session.access_token}` };
    }
  } else if (user) {
    return { 'Authorization': 'Bearer demo-token' };
  }
  return {};
}

async function api(path, body = null, method = 'POST') {
  const authHeaders = await getAuthHeader();
  const headers = { 'Content-Type': 'application/json', ...authHeaders };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const r = await fetch(path, opts);
  if (r.status === 401) {
    // Session expired or unauthenticated
    if (user) {
      user = null;
      if (sb) await sb.auth.signOut();
      cur.authErr = 'Session expired. Please log in again.';
      location.hash = '';
      render();
    }
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || 'Please log in to continue.');
  }

  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}

// ── Data operations with /api/items ──
async function fetchItems() {
  if (!user) return;
  cur.itemsLoading = true;
  render();
  try {
    const res = await api('/api/items', null, 'GET');
    items = res.items || [];
  } catch (err) {
    console.warn('Failed to load items:', err.message);
  }
  cur.itemsLoading = false;
  render();
}

async function toggleFav(id) {
  const i = items.find(x => x.id === id);
  if (!i) return;
  const newFav = !i.fav;
  i.fav = newFav;
  render();
  try {
    await api(`/api/items/${id}`, { fav: newFav }, 'PATCH');
  } catch (err) {
    i.fav = !newFav;
    render();
    alert('Failed to update favorite: ' + err.message);
  }
}

async function del(id) {
  const old = [...items];
  items = items.filter(x => x.id !== id);
  render();
  try {
    await api(`/api/items/${id}`, null, 'DELETE');
  } catch (err) {
    items = old;
    render();
    alert('Failed to delete item: ' + err.message);
  }
}

async function importLegacyHistory() {
  if (!localLegacyItems.length) return;
  cur.importBusy = true; render();
  try {
    for (const item of localLegacyItems) {
      const kind = ['caption', 'text', 'sentiment'].includes(item.kind) ? item.kind : 'text';
      await api('/api/items', {
        kind,
        text: item.text || '',
        thumb: item.img || null,
        mood: item.mood || null,
        fav: Boolean(item.fav)
      });
    }
    localStorage.removeItem('vc_items');
    localLegacyItems = [];
    await fetchItems();
  } catch (err) {
    alert('Failed to import items: ' + err.message);
  }
  cur.importBusy = false; render();
}

function dismissLegacyHistory() {
  localStorage.removeItem('vc_items');
  localLegacyItems = [];
  render();
}

async function pick(inp, goto) {
  const f = inp.files[0]; if (!f) return;
  const s = await read(f);
  cur.img = await shrink(s, 1024);
  cur.thumb = await shrink(s, 240);
  cur.capOut = ''; cur.capErr = ''; cur.txtOut = ''; cur.txtErr = '';
  goto ? location.hash = goto : render();
}

async function pickMood(inp) {
  const f = inp.files[0]; if (!f) return;
  const s = await read(f);
  cur.moodImg = await shrink(s, 1024);
  cur.moodThumb = await shrink(s, 240);
  cur.moodResult = null;
  cur.moodErr = '';
  render();
}

async function gen(kind) {
  cur.busy = true;
  if (kind === 'caption') cur.capErr = ''; else cur.txtErr = '';
  render();
  try {
    if (kind === 'caption') {
      const res = await api('/api/caption', { image: cur.img, style: cur.style, prompt: $('#cp')?.value || '' });
      cur.capOut = res.text;
      const saved = await api('/api/items', { kind: 'caption', text: cur.capOut, thumb: cur.thumb, mood: null, fav: false });
      items.unshift(saved);
    } else {
      cur.txtPrompt = $('#tp')?.value || cur.txtPrompt || '';
      cur.txtTone = $('#tone')?.value || cur.txtTone || 'Adventurous';
      cur.txtLen = $('#len')?.value || cur.txtLen || 'Medium';
      const res = await api('/api/text', { type: cur.type, prompt: cur.txtPrompt, tone: cur.txtTone, length: cur.txtLen, image: cur.img });
      cur.txtOut = res.text;
      const saved = await api('/api/items', { kind: 'text', text: cur.txtOut, thumb: null, mood: cur.txtTone, fav: false });
      items.unshift(saved);
    }
  } catch (e) {
    if (kind === 'caption') cur.capErr = e.message; else cur.txtErr = e.message;
  }
  cur.busy = false; render();
}

async function genVariants() {
  if (!cur.img) {
    cur.variantsErr = 'Please upload an image first.';
    render(); return;
  }
  cur.variantsBusy = true;
  cur.variantsErr = '';
  render();
  try {
    const res = await api('/api/caption-variants', {
      image: cur.img,
      style: cur.style,
      prompt: $('#cp')?.value || ''
    });
    cur.variants = res.variants || [];
  } catch (err) {
    cur.variantsErr = err.message;
  }
  cur.variantsBusy = false;
  render();
}

async function pickVariant(idx) {
  const chosen = cur.variants[idx];
  if (!chosen) return;
  cur.capOut = chosen;
  cur.variants = [];
  render();
  try {
    const saved = await api('/api/items', {
      kind: 'caption',
      text: chosen,
      thumb: cur.thumb,
      mood: null,
      fav: false
    });
    items.unshift(saved);
  } catch (err) {
    console.warn('Failed to save picked variant:', err.message);
  }
  render();
}

async function fetchHashtags(text) {
  cur.hashtagsBusy = true;
  cur.hashtagsErr = '';
  render();
  try {
    const res = await api('/api/hashtags', { text });
    cur.hashtags = res.hashtags || [];
  } catch (err) {
    cur.hashtagsErr = err.message;
    alert('Hashtags error: ' + err.message);
  }
  cur.hashtagsBusy = false;
  render();
}

async function translateResult(text, targetLang) {
  cur.translateBusy = true;
  cur.translateErr = '';
  cur.translatedLang = targetLang;
  render();
  try {
    const res = await api('/api/translate', { text, targetLang });
    cur.translatedText = res.translatedText;
  } catch (err) {
    cur.translateErr = err.message;
    alert('Translation error: ' + err.message);
  }
  cur.translateBusy = false;
  render();
}

function turnIntoStory() {
  cur.txtPrompt = cur.capOut;
  cur.createTab = 'text';
  render();
  setTimeout(() => { const t = $('#tp'); if (t) { t.value = cur.txtPrompt; t.focus(); } }, 0);
}

function sendToSentiment(text) {
  cur.sentText = text;
  cur.sentLexicon = null;
  cur.sentLlm = null;
  cur.sentErr = '';
  location.hash = 'sentiment';
  render();
  setTimeout(() => { const el = $('#st'); if (el) { el.value = text; el.focus(); } }, 0);
}

async function analyzeTextSentiment() {
  const t = $('#st')?.value ?? cur.sentText ?? '';
  cur.sentText = t;
  if (!t.trim()) {
    cur.sentErr = 'Please enter or paste text to analyze (1 to 2000 characters).';
    render(); return;
  }
  if (t.trim().length > 2000) {
    cur.sentErr = 'Text cannot exceed 2000 characters.';
    render(); return;
  }
  cur.sentBusy = true; cur.sentErr = ''; render();
  try {
    const data = await api('/api/sentiment', { text: t.trim() });
    cur.sentLexicon = data.lexicon;
    cur.sentLlm = data.llm;
    const mood = data.llm?.label || data.lexicon?.label || 'neutral';
    const saved = await api('/api/items', {
      kind: 'sentiment',
      text: t.trim(),
      thumb: null,
      mood: mood,
      fav: false
    });
    items.unshift(saved);
  } catch (e) {
    cur.sentErr = e.message;
  }
  cur.sentBusy = false; render();
}

async function analyzeImageMood() {
  const targetImg = cur.moodImg || cur.img;
  if (!targetImg) {
    cur.moodErr = 'Please upload an image first to analyze its mood.';
    render(); return;
  }
  cur.moodBusy = true; cur.moodErr = ''; render();
  try {
    const res = await api('/api/image-mood', { image: targetImg });
    cur.moodResult = res;
    const saved = await api('/api/items', {
      kind: 'sentiment',
      text: `Image Mood: ${res.mood} (${res.energy} energy) · Tone: ${res.suggestedTone}`,
      thumb: cur.moodThumb || cur.thumb,
      mood: res.suggestedTone,
      fav: false
    });
    items.unshift(saved);
  } catch (e) {
    cur.moodErr = e.message;
  }
  cur.moodBusy = false; render();
}

function useMoodToneInCreate(tone) {
  cur.txtTone = tone;
  cur.createTab = 'text';
  if (cur.moodImg && !cur.img) {
    cur.img = cur.moodImg;
    cur.thumb = cur.moodThumb;
  }
  location.hash = 'create';
  render();
}

const copy = t => navigator.clipboard.writeText(t);
const setCur = (k, v) => { cur[k] = v; render(); };

function TabOut(out, err, kind) {
  if (err) return `<div class="err">${esc(err)}</div>`;
  if (!out) return '';
  const safe = out.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  const firstItem = items[0];
  const itemId = firstItem?.id;
  const isPub = Boolean(firstItem?.is_public);
  return `<div class="out">${esc(out)}</div>
    <div class="row" style="margin-top:10px;flex-wrap:wrap">
      <button class="ghost" onclick="copy('${safe}')">Copy</button>
      ${itemId ? `<button class="ghost" onclick="toggleFav('${itemId}')">${firstItem?.fav ? '♥ Saved' : '♡ Save'}</button>` : ''}
      ${kind === 'caption' ? `<button class="ghost" onclick="turnIntoStory()">📝 Turn into Story</button>` : ''}
      <button class="ghost" onclick="sendToSentiment('${safe}')">◈ Analyze Sentiment</button>
      <button class="ghost" ${cur.hashtagsBusy ? 'disabled' : ''} onclick="fetchHashtags('${safe}')">${cur.hashtagsBusy ? 'Finding tags…' : '🏷️ Hashtags'}</button>
      ${itemId ? `<button class="ghost" onclick="toggleShare('${itemId}')">${isPub ? '🔒 Make Private' : '🔗 Share Link'}</button>` : ''}
    </div>

    <!-- Translation Dropdown -->
    <div class="row" style="margin-top:10px;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="mut" style="font-size:12.5px">Translate:</span>
      <select style="width:auto;padding:5px 10px;font-size:12px;border-radius:8px" onchange="if(this.value) translateResult('${safe}', this.value)">
        <option value="" selected disabled>Select language…</option>
        <option value="Hindi">Hindi</option>
        <option value="English">English</option>
        <option value="Spanish">Spanish</option>
        <option value="French">French</option>
      </select>
      ${cur.translateBusy ? `<span class="mut" style="font-size:12px">Translating to ${esc(cur.translatedLang)}…</span>` : ''}
    </div>

    <!-- Suggested Hashtags Result Box -->
    ${cur.hashtags && cur.hashtags.length ? `
      <div style="margin-top:12px;background:var(--soft);border-radius:10px;padding:12px">
        <div class="row sp" style="margin-bottom:6px">
          <b style="font-size:12.5px">Suggested Hashtags:</b>
          <button class="ghost sm" onclick="copy('${cur.hashtags.join(' ')}');alert('Hashtags copied!')">Copy All</button>
        </div>
        <div>
          ${cur.hashtags.map(t => `<span class="chip" style="cursor:pointer" onclick="copy('${t}');alert('Copied tag: ${t}')" title="Click to copy">${esc(t)}</span>`).join('')}
        </div>
      </div>
    ` : ''}

    <!-- Translation Result Box -->
    ${cur.translatedText ? `
      <div style="margin-top:12px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px">
        <div class="row sp" style="margin-bottom:6px">
          <b style="font-size:13px">Translation (${esc(cur.translatedLang)}):</b>
          <button class="ghost sm" onclick="copy('${cur.translatedText.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');alert('Translation copied!')">Copy</button>
        </div>
        <p style="margin:0;font-size:14px;line-height:1.5">${esc(cur.translatedText)}</p>
      </div>
    ` : ''}`;
}

async function toggleShare(id) {
  const item = items.find(x => String(x.id) === String(id));
  if (!item) return;
  const newPublic = !item.is_public;
  item.is_public = newPublic;
  render();
  try {
    await api(`/api/items/${id}`, { is_public: newPublic }, 'PATCH');
    if (newPublic) {
      const url = `${window.location.origin}/s/${id}`;
      await navigator.clipboard.writeText(url);
      alert(`Public link copied to clipboard!\n\n${url}\n\nAnyone with this link can view this creation.`);
    } else {
      alert('Content is now private. The public share link has been disabled.');
    }
  } catch (err) {
    item.is_public = !newPublic;
    render();
    alert('Failed to update share status: ' + err.message);
  }
}

function MoodBadge(label) {
  const l = (label || 'neutral').toLowerCase();
  const cls = l === 'positive' ? 'badge-pos' : (l === 'negative' ? 'badge-neg' : 'badge-neu');
  return `<span class="${cls}">${esc(l)}</span>`;
}

function RenderScoreMeter(score) {
  const num = typeof score === 'number' ? score : 0;
  const pct = Math.max(0, Math.min(100, Math.round(((num + 1) / 2) * 100)));
  const display = (num > 0 ? '+' : '') + num.toFixed(2);
  return `
    <div style="margin-top:4px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
        <span class="mut" style="font-size:12px">Score:</span>
        <b style="font-size:13px">${display}</b>
      </div>
      <div class="score-track">
        <div class="score-marker" style="left:${pct}%" title="Score: ${display}"></div>
      </div>
      <div class="score-labels">
        <span>-1.0 (Neg)</span>
        <span>0.0 (Neu)</span>
        <span>+1.0 (Pos)</span>
      </div>
    </div>
  `;
}

function RenderMoodChart(pos, neu, neg) {
  const total = pos + neu + neg;
  if (total === 0) {
    return `
      <div style="display:flex;align-items:center;justify-content:center;flex-direction:column;min-height:140px;text-align:center;padding:12px">
        <div style="font-size:28px;color:var(--mut);margin-bottom:6px">◔</div>
        <p class="mut" style="font-size:13px;margin:0">No mood data recorded yet.<br>Analyze sentiment in Create or Sentiment tab to view breakdown.</p>
      </div>
    `;
  }

  const pPos = Math.round((pos / total) * 100);
  const pNeu = Math.round((neu / total) * 100);
  const pNeg = Math.max(0, 100 - pPos - pNeu);

  const C = 213.6;
  const dashPos = (pos / total) * C;
  const dashNeu = (neu / total) * C;
  const dashNeg = (neg / total) * C;

  const offsetPos = 0;
  const offsetNeu = -dashPos;
  const offsetNeg = -(dashPos + dashNeu);

  return `
    <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;padding:8px 0">
      <div style="position:relative;width:110px;height:110px;flex:none;margin:0 auto">
        <svg viewBox="0 0 100 100" width="110" height="110" style="transform:rotate(-90deg)">
          <circle cx="50" cy="50" r="34" fill="none" stroke="#f0e6d9" stroke-width="14" />
          ${pos > 0 ? `<circle cx="50" cy="50" r="34" fill="none" stroke="#2e7d32" stroke-width="14" stroke-dasharray="${dashPos} ${C}" stroke-dashoffset="${offsetPos}" />` : ''}
          ${neu > 0 ? `<circle cx="50" cy="50" r="34" fill="none" stroke="#8b7767" stroke-width="14" stroke-dasharray="${dashNeu} ${C}" stroke-dashoffset="${offsetNeu}" />` : ''}
          ${neg > 0 ? `<circle cx="50" cy="50" r="34" fill="none" stroke="#c62828" stroke-width="14" stroke-dasharray="${dashNeg} ${C}" stroke-dashoffset="${offsetNeg}" />` : ''}
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
          <b style="font-size:17px;line-height:1">${total}</b>
          <span class="mut" style="font-size:10px">Total</span>
        </div>
      </div>
      <div style="flex:1;min-width:130px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px">
          <span style="display:flex;align-items:center;gap:6px"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#2e7d32"></i> Positive</span>
          <b>${pos} <span class="mut" style="font-weight:400;font-size:11.5px">(${pPos}%)</span></b>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px">
          <span style="display:flex;align-items:center;gap:6px"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#8b7767"></i> Neutral</span>
          <b>${neu} <span class="mut" style="font-weight:400;font-size:11.5px">(${pNeu}%)</span></b>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px">
          <span style="display:flex;align-items:center;gap:6px"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#c62828"></i> Negative</span>
          <b>${neg} <span class="mut" style="font-weight:400;font-size:11.5px">(${pNeg}%)</span></b>
        </div>
      </div>
    </div>
  `;
}

const Thumb = i => {
  if (i.thumb || i.img) return `<img src="${i.thumb || i.img}" alt="">`;
  if (i.kind === 'sentiment') return `<div class="av" style="border-radius:8px;width:54px;height:54px;background:#eef2ff;color:#4338ca">◈</div>`;
  return `<div class="av" style="border-radius:8px;width:54px;height:54px">✎</div>`;
};

const getUserName = () => user?.user_metadata?.full_name || user?.name || (user?.email ? user.email.split('@')[0] : 'Creator');
const getUserEmail = () => user?.email || '';
const getUserInitial = () => (getUserName()[0] || 'U').toUpperCase();

const Top = (title, sub) => `
  <div class="top">
    <div>
      <h1>${title}</h1>
      <div class="mut">${sub}</div>
    </div>
    <div class="user">
      <div class="av">${esc(getUserInitial())}</div>
      <div>
        ${esc(getUserName())}
        <div class="mut" style="font-size:11px">${esc(getUserEmail())}</div>
      </div>
    </div>
  </div>`;

function Grid(list, empty = 'Nothing here yet.') {
  return list.length
    ? `<div class="grid g5">${list.map(i => `<div class="card" style="padding:8px">${(i.thumb || i.img) ? `<img class="thumb" src="${i.thumb || i.img}" alt="">` : `<div class="thumb av" style="border-radius:10px;font-size:28px">✎</div>`}<p style="font-size:12px;margin:8px 4px 0">${esc(i.text.slice(0, 60))}</p><button class="fav" onclick="toggleFav('${i.id}')">${i.fav ? '♥' : '♡'}</button></div>`).join('')}</div>`
    : `<p class="mut">${empty}</p>`;
}

function LegacyImportBanner() {
  if (!localLegacyItems || localLegacyItems.length === 0) return '';
  return `
    <div class="card" style="margin-bottom:16px;background:#fff8ee;border:1px solid #ebd9c3;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;padding:14px 20px">
      <div>
        <b style="color:var(--pri)">Import Local History</b>
        <div class="mut" style="font-size:12.5px">You have ${localLegacyItems.length} generation(s) saved on this browser. Import them into your cloud account?</div>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn sm" onclick="importLegacyHistory()">${cur.importBusy ? 'Importing…' : 'Import My History'}</button>
        <button class="ghost sm" onclick="dismissLegacyHistory()">Dismiss</button>
      </div>
    </div>
  `;
}

// ── SVG icon bank ──
const IC = {
  user: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="3"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>`,
  eye:  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  img:  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="M4 18l5-5 4 4 3-3 4 4"/></svg>`,
  doc:  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M9 12h6M9 16h6"/></svg>`,
  spk:  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>`,
  cam:  `<svg viewBox="0 0 72 56" width="%s"><rect x="0" y="8" width="72" height="48" rx="12" fill="#9c6b49"/><rect x="18" y="0" width="22" height="14" rx="5" fill="#9c6b49"/><circle cx="36" cy="32" r="14" fill="#fff"/><circle cx="36" cy="32" r="8" fill="#9c6b49"/><circle cx="36" cy="32" r="5" fill="#fff"/></svg>`
};

// ── Auth page (HARD RULE: visual design untouched) ──
function Auth() {
  const up = cur.authMode === 'up';
  const inp = (id, ic, ph, type = 'text') => `<div class="fld"><span>${IC[ic]}</span><input ${id ? `id="${id}"` : ''} type="${type}" placeholder="${ph}"></div>`;
  const brand = w => `<div class="brand">${IC.cam.replace('%s', w)}<div class="bn">Pix<b>tale</b></div></div>`;
  return `<div class="auth2"><section class="hero2">
    <div class="h-logo">${brand(76)}<p>Turn Your Images into<br>Meaningful Stories</p></div>
    <div class="h-script">See Images.<br>Create Stories<br>with AI.</div>
    <ul class="h-feat"><li>${IC.img}Generate creative captions</li><li>${IC.doc}Create text content with AI</li><li>${IC.spk}Turn images into meaningful stories</li></ul>
    <div class="h-dots"><b></b><b></b><b></b></div></section>
  <section class="form2"><div class="acard2">
    ${brand(72)}
    <h2>${up ? 'Create Your Account' : 'Welcome Back'}</h2>
    <p class="sub">${up ? 'Join thousands of creators using AI.' : 'Sign in to continue to your creative studio.'}</p>
    ${up ? inp('an', 'user', 'Full Name') : ''}${inp('ae', 'user', 'you@example.com', 'email')}
    <div class="fld"><span>${IC.lock}</span><input id="ap" type="password" placeholder="${up ? 'Create a password' : 'Enter your password'}"><button class="eye" aria-label="Show password" onclick="const p=$('#ap');p.type=p.type==='password'?'text':'password'">${IC.eye}</button></div>
    ${up ? inp('ap2', 'lock', 'Confirm password', 'password') : ''}
    ${up ? '<label class="chk"><input id="arm" type="checkbox"> I agree to the <a href="#" onclick="return false">Terms and Privacy Policy</a></label>' : '<div class="chk row sp"><label><input id="arm" type="checkbox" checked> Remember me</label><a href="#" onclick="return false">Forgot password?</a></div>'}
    ${cur.authErr ? `<div class="err" style="text-align:left;font-size:13px">${esc(cur.authErr)}</div>` : ''}
    <button class="signbtn" ${cur.authBusy ? 'disabled' : ''} onclick="signIn()">${cur.authBusy ? (up ? 'Creating Account…' : 'Signing In…') : (up ? 'Create Account' : 'Sign In')} →</button>
    <div class="or"><span>or continue with</span></div>
    <div class="socs"><button onclick="oauthSignIn('google')"><b class="gl">G</b>Google</button><button onclick="oauthSignIn('github')"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 .5a11.5 11.5 0 00-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 015.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0012 .5z"/></svg> GitHub</button></div>
    <p class="sub">${up ? 'Already have an account?' : "Don't have an account?"} <a href="#" onclick="cur.authErr='';cur.authMode='${up ? 'in' : 'up'}';render();return false">${up ? 'Sign In' : 'Sign Up'}</a></p>
  </div></section></div>`;
}

// ── Auth Handler (Supabase integration) ──
async function signIn() {
  const up = cur.authMode === 'up';
  const email = $('#ae')?.value?.trim() || '';
  const password = $('#ap')?.value || '';
  cur.authErr = '';

  if (!email) {
    cur.authErr = 'Please enter your email address.';
    render(); return;
  }
  if (!password) {
    cur.authErr = 'Please enter your password.';
    render(); return;
  }

  if (up) {
    const name = $('#an')?.value?.trim() || '';
    const confirm = $('#ap2')?.value || '';
    if (password !== confirm) {
      cur.authErr = 'Passwords do not match.';
      render(); return;
    }
    if (password.length < 6) {
      cur.authErr = 'Password must be at least 6 characters.';
      render(); return;
    }

    cur.authBusy = true; render();
    try {
      if (!sb) {
        user = {
          id: '00000000-0000-0000-0000-000000000001',
          email,
          user_metadata: { full_name: name || email.split('@')[0] }
        };
        localStorage.setItem('vc_demo_user', JSON.stringify(user));
        cur.authErr = '';
        await fetchItems();
        location.hash = 'dashboard';
      } else {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { data: { full_name: name || email.split('@')[0] } }
        });
        if (error) throw error;
        if (data?.user) {
          user = data.user;
          cur.authErr = '';
          await fetchItems();
          location.hash = 'dashboard';
        }
      }
    } catch (err) {
      cur.authErr = err.message || 'Failed to create account.';
    }
    cur.authBusy = false; render();
  } else {
    cur.authBusy = true; render();
    try {
      const remember = $('#arm')?.checked ?? true;
      if (!remember) {
        sessionStorage.setItem('vc_no_persist', '1');
      } else {
        sessionStorage.removeItem('vc_no_persist');
      }

      if (!sb) {
        // Demo sign in: accept guptahoney0124@gmail.com / Honey Gupta or any email and password >= 6
        if (email.toLowerCase() === 'guptahoney0124@gmail.com') {
          if (password !== 'Honey Gupta') {
            throw new Error('Incorrect password. Please enter the valid password.');
          }
        } else if (password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }

        user = {
          id: '00000000-0000-0000-0000-000000000001',
          email: email.toLowerCase() === 'guptahoney0124@gmail.com' ? 'guptahoney0124@gmail.com' : email,
          user_metadata: { full_name: email.toLowerCase() === 'guptahoney0124@gmail.com' ? 'Honey Gupta' : (email.split('@')[0]) }
        };
        if (remember) {
          localStorage.setItem('vc_demo_user', JSON.stringify(user));
        } else {
          sessionStorage.setItem('vc_demo_user', JSON.stringify(user));
        }
        cur.authErr = '';
        await fetchItems();
        location.hash = 'dashboard';
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data?.user) {
          user = data.user;
          cur.authErr = '';
          await fetchItems();
          location.hash = 'dashboard';
        }
      }
    } catch (err) {
      cur.authErr = err.message || 'Invalid email or password.';
    }
    cur.authBusy = false; render();
  }
}

async function oauthSignIn(provider) {
  if (!sb) {
    cur.authErr = 'OAuth is available when Supabase credentials are configured in .env. Please sign in with email/password.';
    render(); return;
  }
  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
  } catch (err) {
    cur.authErr = `${provider} sign-in notice: ${err.message}`;
    render();
  }
}

async function signOut() {
  user = null;
  items = [];
  localStorage.removeItem('vc_demo_user');
  sessionStorage.removeItem('vc_demo_user');
  if (sb) await sb.auth.signOut();
  location.hash = '';
  render();
}

// ── Page views ──
const V = {
  dashboard() {
    const caps = items.filter(i => i.kind === 'caption').length;
    const txts = items.filter(i => i.kind === 'text').length;
    const sents = items.filter(i => i.kind === 'sentiment').length;
    const total = items.length;

    const posCount = items.filter(i => (i.mood || '').toLowerCase() === 'positive').length;
    const neuCount = items.filter(i => (i.mood || '').toLowerCase() === 'neutral').length;
    const negCount = items.filter(i => (i.mood || '').toLowerCase() === 'negative').length;

    const r = items[0];

    return Top(`Hi ${esc(getUserName())} 👋`, 'Turn your images into meaningful stories.') + `
    ${LegacyImportBanner()}
    <div class="grid g4">
      <div class="card stat"><span class="mut">Captions Generated</span><b>${caps}</b></div>
      <div class="card stat"><span class="mut">Stories &amp; Texts</span><b>${txts}</b></div>
      <div class="card stat"><span class="mut">Sentiment Analyses</span><b>${sents}</b></div>
      <div class="card stat"><span class="mut">Total Generations</span><b>${total}</b></div>
    </div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card">
        <h2 style="font-size:18px">Upload an Image</h2>
        <p class="mut" style="margin-bottom:12px">Upload an image to generate captions, create text, or analyze mood.</p>
        <label class="drop" style="display:block;min-height:160px;padding:24px">
          <b>Drag &amp; drop an image here</b><br>
          <span class="mut">or click to browse · JPG, PNG, WEBP</span>
          <input type="file" accept="image/*" hidden onchange="pick(this,'create')">
        </label>
      </div>
      <div class="card">
        <div class="row sp" style="margin-bottom:4px">
          <h2 style="font-size:18px">Mood Breakdown</h2>
          <a href="#history" style="color:var(--pri);text-decoration:none;font-weight:600;font-size:13px">View History →</a>
        </div>
        <p class="mut" style="margin-top:0;font-size:12.5px">Aggregated mood evaluations across all your generations.</p>
        ${RenderMoodChart(posCount, neuCount, negCount)}
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="row sp" style="margin-bottom:8px">
        <h2 style="font-size:18px">Latest Generation</h2>
        ${r ? `<a href="#history" style="color:var(--pri);text-decoration:none;font-weight:600;font-size:13px">View All</a>` : ''}
      </div>
      ${cur.itemsLoading ? `<p class="mut" style="padding:10px 0">Loading latest items…</p>` : r ? `
        <div class="item" style="border-bottom:0;padding:10px 0">
          ${Thumb(r)}
          <div style="flex:1">
            <p style="font-size:14px;margin-bottom:4px">${esc(r.text.slice(0, 180))}</p>
            <div class="row" style="gap:8px">
              <span class="tag">${r.kind === 'caption' ? 'Caption' : (r.kind === 'text' ? 'Text' : 'Sentiment')}</span>
              ${r.mood ? MoodBadge(r.mood) : ''}
              <span class="mut" style="font-size:12px">${ago(r.created_at || r.t)}</span>
            </div>
          </div>
        </div>
      ` : '<p class="mut" style="margin:8px 0 0">Nothing yet. Go to Create or Sentiment to get started.</p>'}
    </div>
    <h2 style="font-size:18px;margin:24px 0 12px">Recent Generations</h2>
    ${cur.itemsLoading ? `<div class="card" style="padding:30px;text-align:center"><p class="mut">Loading recent generations…</p></div>` : Grid(items.slice(0, 5))}`;
  },

  create() {
    const tab = cur.createTab;
    return Top('Create', 'Upload an image and generate captions or creative text — all in one place.') + `
    <div class="grid g2" style="align-items:start">
      <!-- LEFT: image upload -->
      <div class="card" style="display:flex;flex-direction:column;gap:14px">
        <b style="font-size:15px">Image</b>
        <label class="drop" style="display:block">
          ${cur.img
            ? `<img src="${cur.img}" alt="" style="max-width:100%;max-height:320px;border-radius:10px;display:block;margin:0 auto">`
            : `<b>Click or drag to upload</b><br><span class="mut">JPG, PNG, WEBP · max 8 MB</span>`}
          <input type="file" accept="image/*" hidden onchange="pick(this)">
        </label>
        ${cur.img ? `<button class="ghost" style="width:100%" onclick="cur.img=null;cur.thumb=null;cur.capOut='';cur.txtOut='';cur.capErr='';cur.txtErr='';render()">✕ Remove Image</button>` : ''}
      </div>

      <!-- RIGHT: Caption / Text tabs -->
      <div class="card">
        <div class="tabs" style="margin-bottom:16px">
          <button class="ghost ${tab === 'caption' ? 'on' : ''}" onclick="cur.createTab='caption';render()">Caption</button>
          <button class="ghost ${tab === 'text' ? 'on' : ''}" onclick="cur.createTab='text';render()">Text</button>
        </div>

        ${tab === 'caption' ? `
          <b>Caption Style</b>
          <div class="opts" style="margin-top:8px">${STYLES.map(s => `<div class="opt ${cur.style === s[0] ? 'on' : ''}" onclick="setCur('style','${s[0]}')"><b>${s[0]}</b>${s[1]}</div>`).join('')}</div>
          <label>Custom Prompt <span class="mut" style="font-weight:400">(Optional)</span></label>
          <textarea id="cp" rows="3" maxlength="300" placeholder="e.g. make it funny, poetic, surreal…"></textarea>
          <div class="row" style="margin-top:12px;gap:10px">
            <button class="btn" style="flex:1" ${cur.busy ? 'disabled' : ''} onclick="${cur.img ? "gen('caption')" : "cur.capErr='Please upload an image first.';render()"}">${cur.busy ? 'Generating…' : '✦ Generate Caption'}</button>
            <button class="ghost" style="flex:1" ${cur.variantsBusy ? 'disabled' : ''} onclick="${cur.img ? "genVariants()" : "cur.capErr='Please upload an image first.';render()"}">${cur.variantsBusy ? 'Generating 3 Options…' : '✦ Generate 3 Variants'}</button>
          </div>
          ${cur.variantsErr ? `<div class="err">${esc(cur.variantsErr)}</div>` : ''}

          <!-- 3 Variants Selection Box -->
          ${cur.variants && cur.variants.length ? `
            <div style="margin-top:16px;background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:14px">
              <div class="row sp" style="margin-bottom:8px">
                <b style="font-size:13.5px">Pick one of the 3 variants to save:</b>
                <button class="ghost sm" onclick="cur.variants=[];render()">Clear</button>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px">
                ${cur.variants.map((v, idx) => `
                  <div class="card" style="padding:12px 14px;background:#fff;display:flex;justify-content:space-between;align-items:center;gap:12px">
                    <span style="font-size:13.5px;line-height:1.45;flex:1">${esc(v)}</span>
                    <button class="btn sm" style="width:auto;flex:none" onclick="pickVariant(${idx})">Choose &amp; Save</button>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${TabOut(cur.capOut, cur.capErr, 'caption')}
        ` : `
          <b>What do you want to generate?</b>
          <div class="opts" style="margin-top:8px">${TYPES.map(t => `<div class="opt ${cur.type === t[0] ? 'on' : ''}" onclick="cur.type='${t[0]}';render()"><b>${t[0]}</b>${t[1]}</div>`).join('')}</div>
          <label>Your Prompt</label>
          <textarea id="tp" rows="4" maxlength="500" placeholder="Describe your idea, or let the image inspire the story…">${esc(cur.txtPrompt || '')}</textarea>
          <div class="grid g2" style="margin-top:4px">
            <div><label>Tone</label><select id="tone">${['Adventurous', 'Friendly', 'Professional', 'Funny', 'Dramatic'].map(o => `<option${cur.txtTone === o ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
            <div><label>Length</label><select id="len"><option${cur.txtLen === 'Short' ? ' selected' : ''}>Short</option><option${!cur.txtLen || cur.txtLen === 'Medium' ? ' selected' : ''}>Medium</option><option${cur.txtLen === 'Long' ? ' selected' : ''}>Long</option></select></div>
          </div>
          <button class="btn" style="margin-top:14px" ${cur.busy ? 'disabled' : ''} onclick="cur.txtPrompt=$('#tp')?.value;cur.txtTone=$('#tone')?.value;cur.txtLen=$('#len')?.value;gen('text')">${cur.busy ? 'Generating…' : '✦ Generate Text'}</button>
          ${TabOut(cur.txtOut, cur.txtErr, 'text')}
        `}
      </div>
    </div>`;
  },

  sentiment() {
    const lex = cur.sentLexicon;
    const llm = cur.sentLlm;
    const agree = (lex && llm) ? (lex.label.toLowerCase() === llm.label.toLowerCase()) : null;

    return Top('Sentiment Analysis', 'Analyze emotional tone, compare lexicon vs. AI models, and explore image moods.') + `
    <div class="grid g2" style="align-items:start">
      <!-- LEFT: Text Sentiment -->
      <div class="card">
        <h2 style="font-size:18px;margin-bottom:6px">Text Sentiment</h2>
        <p class="mut" style="margin-bottom:12px;font-size:13px">Evaluate sentiment using both traditional rule-based lexicon and Gemini AI.</p>
        <label style="margin-top:0">Enter or Paste Text</label>
        <textarea id="st" rows="4" maxlength="2000" placeholder="Write or paste any caption, story, or review to evaluate its sentiment…">${esc(cur.sentText || '')}</textarea>
        <button class="btn" style="margin-top:12px" ${cur.sentBusy ? 'disabled' : ''} onclick="analyzeTextSentiment()">${cur.sentBusy ? 'Analyzing Sentiment…' : '◈ Analyze Sentiment'}</button>
        ${cur.sentErr ? `<div class="err">${esc(cur.sentErr)}</div>` : ''}

        ${(lex && llm) ? `
          <div class="side-comp">
            <!-- Lexicon Method -->
            <div class="method-card">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <b style="font-size:13px">Lexicon Method (VADER)</b>
                ${MoodBadge(lex.label)}
              </div>
              ${RenderScoreMeter(lex.score)}
              <div class="mut" style="font-size:11.5px;margin-top:6px;line-height:1.4">Rule-based scoring based on word valence and polarity.</div>
            </div>

            <!-- Gemini LLM Method -->
            <div class="method-card">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <b style="font-size:13px">Gemini (LLM)</b>
                ${MoodBadge(llm.label)}
              </div>
              ${RenderScoreMeter(llm.score)}
              ${llm.emotions && llm.emotions.length ? `<div style="margin-top:6px">${llm.emotions.map(e => `<span class="chip">${esc(e)}</span>`).join('')}</div>` : ''}
              ${llm.reason ? `<p class="mut" style="font-size:12px;margin:6px 0 0;line-height:1.4">"${esc(llm.reason)}"</p>` : ''}
            </div>
          </div>

          ${agree ? `
            <div class="agree-box" style="border-left:4px solid #2e7d32;display:flex;align-items:center;gap:10px">
              <span style="font-size:18px;color:#2e7d32">✓</span>
              <div><b>Both methods agree:</b> Both Lexicon and Gemini identified the tone as <b style="text-transform:capitalize;color:#2e7d32">${esc(llm.label)}</b>.</div>
            </div>
          ` : `
            <div class="agree-box" style="border-left:4px solid var(--org);display:flex;align-items:center;gap:10px">
              <span style="font-size:18px;color:var(--org)">⚡</span>
              <div><b>Methods differ:</b> Lexicon scored <b>${esc(lex.label)}</b> (${lex.score > 0 ? '+' : ''}${lex.score}), while Gemini evaluated <b>${esc(llm.label)}</b> (${llm.score > 0 ? '+' : ''}${llm.score}).</div>
            </div>
          `}
        ` : ''}
      </div>

      <!-- RIGHT: Image Mood -->
      <div class="card" style="display:flex;flex-direction:column;gap:12px">
        <h2 style="font-size:18px;margin-bottom:0">Image Mood</h2>
        <p class="mut" style="margin:0;font-size:13px">Upload an image to detect its atmosphere, energy, and suggested writing tone.</p>
        <label class="drop" style="display:block;min-height:160px;padding:24px">
          ${(cur.moodImg || cur.img)
            ? `<img src="${cur.moodImg || cur.img}" alt="" style="max-width:100%;max-height:220px;border-radius:10px;display:block;margin:0 auto">`
            : `<b>Click or drag to upload an image</b><br><span class="mut">JPG, PNG, WEBP · max 8 MB</span>`}
          <input type="file" accept="image/*" hidden onchange="pickMood(this)">
        </label>
        ${(cur.moodImg || cur.img) ? `<button class="ghost btn sm" style="width:100%" onclick="cur.moodImg=null;cur.moodThumb=null;cur.moodResult=null;cur.moodErr='';render()">✕ Remove Image</button>` : ''}
        <button class="btn" ${cur.moodBusy ? 'disabled' : ''} onclick="analyzeImageMood()">${cur.moodBusy ? 'Analyzing Mood…' : '✦ Analyze Image Mood'}</button>
        ${cur.moodErr ? `<div class="err">${esc(cur.moodErr)}</div>` : ''}

        ${cur.moodResult ? `
          <div class="method-card" style="margin-top:4px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <b style="font-size:15px">${esc(cur.moodResult.mood)}</b>
              <span class="chip" style="background:#fff3e6;color:var(--org);font-weight:600">${esc(cur.moodResult.energy.toUpperCase())} ENERGY</span>
            </div>
            <div style="margin-top:6px">
              <span class="chip" style="background:#eef2ff;color:#4338ca;font-weight:600">Suggested Tone: ${esc(cur.moodResult.suggestedTone)}</span>
            </div>
            <p class="mut" style="font-size:13px;line-height:1.5;margin:6px 0 12px">"${esc(cur.moodResult.reason)}"</p>
            <button class="btn sm" onclick="useMoodToneInCreate('${esc(cur.moodResult.suggestedTone)}')">Use this tone in Create →</button>
          </div>
        ` : ''}
      </div>
    </div>`;
  },

  history() {
    const f = cur.filter || 'All';
    const mf = cur.moodFilter || 'All';

    const list = items.filter(i => {
      if (f === 'Favorites' && !i.fav) return false;
      if (f === 'Captions' && i.kind !== 'caption') return false;
      if (f === 'Text' && i.kind !== 'text') return false;
      if (f === 'Sentiment' && i.kind !== 'sentiment') return false;

      if (mf !== 'All') {
        const itemMood = (i.mood || '').toLowerCase();
        if (itemMood !== mf.toLowerCase()) return false;
      }
      return true;
    });

    return Top('History', 'View and manage all your cloud-synced generations and analyses.') + `
    ${LegacyImportBanner()}
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">
      <div class="tabs" style="margin-bottom:0">
        ${['All', 'Favorites', 'Captions', 'Text', 'Sentiment'].map(t => `<button class="ghost ${f === t ? 'on' : ''}" onclick="cur.filter='${t}';render()">${t}</button>`).join('')}
      </div>
      <div class="row" style="gap:6px">
        <span class="mut" style="font-size:13px">Mood:</span>
        ${['All', 'Positive', 'Neutral', 'Negative'].map(m => `<button class="ghost sm ${mf === m ? 'on' : ''}" style="padding:4px 10px;font-size:12px" onclick="cur.moodFilter='${m}';render()">${m}</button>`).join('')}
      </div>
    </div>
    <div class="card" style="padding:0">
      ${cur.itemsLoading ? `<p class="mut" style="padding:30px;text-align:center">Loading your history from cloud…</p>` : list.map(i => `
        <div class="item">
          ${Thumb(i)}
          <div style="flex:1">
            <p>${esc(i.text.slice(0, 160))}</p>
            <div class="row" style="gap:8px;margin-top:4px;flex-wrap:wrap">
              <span class="tag">${i.kind === 'caption' ? 'Caption' : (i.kind === 'text' ? 'Text' : 'Sentiment')}</span>
              ${i.mood ? MoodBadge(i.mood) : ''}
              ${i.is_public ? `<span class="tag" style="background:#e0f2fe;color:#0369a1">Public</span>` : ''}
              <span class="mut" style="font-size:12px">${ago(i.created_at || i.t)}</span>
            </div>
          </div>
          <div class="row" style="gap:6px;flex-wrap:wrap">
            <button class="fav" onclick="toggleFav('${i.id}')" title="${i.fav ? 'Unsave' : 'Save'}">${i.fav ? '♥' : '♡'}</button>
            <button class="ghost sm" onclick="toggleShare('${i.id}')">${i.is_public ? '🔒 Private' : '🔗 Share'}</button>
            ${i.is_public ? `<button class="ghost sm" onclick="navigator.clipboard.writeText('${window.location.origin}/s/${i.id}');alert('Public link copied to clipboard!')">📋 Link</button>` : ''}
            <button class="ghost sm" onclick="del('${i.id}')">Delete</button>
          </div>
        </div>
      `).join('') || '<p class="mut" style="padding:28px;text-align:center">No generations found matching your filters.</p>'}
    </div>`;
  },

  settings() {
    const fullName = getUserName();
    const email = getUserEmail();

    return Top('Settings', 'Manage your profile and account settings.') + `
    <div class="grid g2" style="grid-template-columns:1.2fr 1fr;gap:20px">
      <div class="card">
        <h2 style="font-size:18px;margin-bottom:14px">Profile Information</h2>
        <label style="margin-top:0">Full Name</label>
        <input id="sn" class="in" value="${esc(fullName)}" readonly style="background:#fcf9f5">
        <label>Email Address</label>
        <input id="se" class="in" value="${esc(email)}" readonly style="background:#fcf9f5">
        <label>Bio</label>
        <textarea id="sb" rows="4" maxlength="200" placeholder="Tell us a bit about yourself…">${esc(user?.user_metadata?.bio || '')}</textarea>
        <div style="display:flex;gap:12px;margin-top:18px">
          <button class="btn" style="flex:1" onclick="alert('Profile details synced from your Supabase account.')">Save Changes</button>
          <button class="ghost" onclick="signOut()">Sign Out</button>
        </div>
      </div>
      <div class="card">
        <h2 style="font-size:18px;margin-bottom:14px">Account Overview</h2>
        <div style="display:flex;align-items:center;gap:14px;padding:16px;background:var(--soft);border-radius:12px;margin-bottom:16px">
          <div class="av" style="width:48px;height:48px;font-size:20px">${esc(getUserInitial())}</div>
          <div><b style="font-size:16px;display:block">${esc(fullName)}</b><span class="mut" style="font-size:13px">${esc(email)}</span></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:0">
          <div style="display:flex;justify-content:space-between;padding:12px;border-bottom:1px solid var(--line)"><span class="mut">Current Plan</span><b style="color:var(--pri)">Free Plan</b></div>
          <div style="display:flex;justify-content:space-between;padding:12px;border-bottom:1px solid var(--line)"><span class="mut">Total Generations</span><b>${items.length}</b></div>
          <div style="display:flex;justify-content:space-between;padding:12px"><span class="mut">Account Status</span><span style="color:#2e7d32;font-weight:600">● Active</span></div>
        </div>
      </div>
    </div>`;
  }
};

function render() {
  if (!user) { $('#root').innerHTML = Auth(); return; }

  // Redirect old links #caption and #text to #create with appropriate tab
  const rawHash = location.hash.slice(1);
  if (rawHash === 'caption') {
    cur.createTab = 'caption';
    location.replace('#create');
    return;
  }
  if (rawHash === 'text') {
    cur.createTab = 'text';
    location.replace('#create');
    return;
  }

  const page = (rawHash in V) ? rawHash : 'dashboard';
  $('#root').innerHTML = `<div class="app"><aside class="side">
    <div class="logo" style="padding:6px 12px 16px"><i>◉</i><span>Pix<b>tale</b></span></div>
    ${NAV.map(n => `<a href="#${n[0]}" class="${n[0] === page ? 'on' : ''}"><span>${n[2]}</span>${n[1]}</a>`).join('')}
  </aside><main>${V[page]()}</main></div>`;
}

addEventListener('hashchange', render);
render();
initSupabase();
