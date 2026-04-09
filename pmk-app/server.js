require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const session = require('express-session');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3005;
const DATA_DIR = path.join(__dirname, 'data');
const REKAP_FILE = path.join(DATA_DIR, 'rekap.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ═══ SESSION ═══
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 } // 24h
}));

app.use(express.json({ limit: '50mb' }));

// ═══ AUTH: USER MANAGEMENT ═══
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {}
  // Default: admin user
  const defaults = [{ id: uuidv4(), email: 'taufikparse@gmail.com', name: 'Administrator', role: 'admin', active: true, createdAt: new Date().toISOString() }];
  fs.writeFileSync(USERS_FILE, JSON.stringify(defaults, null, 2));
  return defaults;
}
function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

// OTP store: { email: { code, expiresAt, attempts } }
const otpStore = {};

// Email transporter
function getMailTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER || process.env.MAIL_USER,
      pass: process.env.SMTP_PASS || process.env.MAIL_PASS
    }
  });
}

// ═══ AUTH ROUTES (public) ═══
// Serve login page
app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// POST /auth/request-otp — send OTP to email
app.post('/auth/request-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email wajib diisi' });
  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.active);
  if (!user) return res.status(403).json({ error: 'Email tidak terdaftar. Hubungi administrator.' });

  // Rate limit: max 1 OTP per 60s
  if (otpStore[email] && otpStore[email].expiresAt > Date.now() - 240000) {
    const wait = Math.ceil((otpStore[email].sentAt + 60000 - Date.now()) / 1000);
    if (wait > 0) return res.status(429).json({ error: `Tunggu ${wait} detik sebelum meminta OTP baru.` });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digit
  otpStore[email] = { code, expiresAt: Date.now() + 5 * 60 * 1000, sentAt: Date.now(), attempts: 0 };

  try {
    const transporter = getMailTransporter();
    await transporter.sendMail({
      from: `"PMK Suite" <${process.env.SMTP_USER || process.env.MAIL_USER}>`,
      to: email,
      subject: 'Kode OTP Login PMK Suite',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="display:inline-block;background:linear-gradient(135deg,#6366f1,#06b6d4);color:#fff;width:50px;height:50px;border-radius:14px;line-height:50px;font-size:18px;font-weight:800">BI</div>
          </div>
          <h2 style="text-align:center;color:#1e293b;margin-bottom:8px">Kode OTP Login</h2>
          <p style="text-align:center;color:#64748b;font-size:14px">PMK Suite — DSDM Bank Indonesia</p>
          <div style="text-align:center;margin:28px 0">
            <div style="display:inline-block;background:#fff;border:2px solid #e2e8f0;border-radius:12px;padding:16px 40px;font-size:32px;font-weight:800;letter-spacing:8px;color:#1e293b">${code}</div>
          </div>
          <p style="text-align:center;color:#94a3b8;font-size:13px">Kode berlaku selama <b>5 menit</b>. Jangan berikan kode ini kepada siapapun.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
          <p style="text-align:center;color:#cbd5e1;font-size:11px">Jika Anda tidak meminta kode ini, abaikan email ini.</p>
        </div>
      `
    });
    console.log(`OTP sent to ${email}: ${code}`);
    res.json({ ok: true, message: 'OTP terkirim ke email Anda.' });
  } catch (e) {
    console.error('Mail error:', e.message);
    // Fallback: log OTP to console if mail fails
    console.log(`[FALLBACK] OTP for ${email}: ${code}`);
    res.json({ ok: true, message: 'OTP terkirim. (Cek juga folder Spam)' });
  }
});

// POST /auth/verify-otp — verify OTP and create session
app.post('/auth/verify-otp', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email dan kode OTP wajib diisi' });

  const otp = otpStore[email];
  if (!otp) return res.status(400).json({ error: 'OTP belum diminta. Kirim ulang OTP.' });
  if (otp.attempts >= 5) { delete otpStore[email]; return res.status(429).json({ error: 'Terlalu banyak percobaan. Minta OTP baru.' }); }
  if (Date.now() > otp.expiresAt) { delete otpStore[email]; return res.status(400).json({ error: 'OTP sudah kedaluwarsa. Minta OTP baru.' }); }

  otp.attempts++;
  if (otp.code !== code.trim()) return res.status(400).json({ error: `Kode OTP salah. Sisa percobaan: ${5 - otp.attempts}` });

  // OTP valid — create session
  delete otpStore[email];
  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role };
  res.json({ ok: true, user: req.session.user });
});

// POST /auth/logout
app.post('/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// GET /auth/me — check current session
app.get('/auth/me', (req, res) => {
  if (req.session && req.session.user) return res.json({ authenticated: true, user: req.session.user });
  res.json({ authenticated: false });
});

// ═══ AUTH MIDDLEWARE ═══
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
}

// ═══ ADMIN: User CRUD ═══
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const users = loadUsers();
  res.json(users.map(u => ({ ...u })));
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { email, name, role } = req.body;
  if (!email) return res.status(400).json({ error: 'Email wajib diisi' });
  const users = loadUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'Email sudah terdaftar' });
  }
  const newUser = { id: uuidv4(), email: email.toLowerCase().trim(), name: name || '', role: role || 'user', active: true, createdAt: new Date().toISOString() };
  users.push(newUser);
  saveUsers(users);
  res.json({ ok: true, user: newUser });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  let users = loadUsers();
  const target = users.find(u => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.email === 'taufikparse@gmail.com') return res.status(400).json({ error: 'Tidak bisa menghapus admin default' });
  users = users.filter(u => u.id !== req.params.id);
  saveUsers(users);
  res.json({ ok: true });
});

app.put('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const users = loadUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.body.name !== undefined) user.name = req.body.name;
  if (req.body.role !== undefined) user.role = req.body.role;
  if (req.body.active !== undefined) user.active = req.body.active;
  saveUsers(users);
  res.json({ ok: true, user });
});

// ═══ PROTECT ALL /api ROUTES (except /auth) ═══
app.use('/api', requireAuth);

// ═══ SETTINGS ═══
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (e) {}
  return {};
}
function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

// GET /api/settings
app.get('/api/settings', (req, res) => {
  const s = loadSettings();
  const keySet = !!(process.env.ANTHROPIC_API_KEY || s.apiKey);
  const masked = keySet ? 'sk-ant-****' + ((s.apiKey || process.env.ANTHROPIC_API_KEY || '').slice(-4)) : '';
  res.json({ apiKeySet: keySet, apiKeyMasked: masked, model: s.model || 'claude-sonnet-4-20250514' });
});

// POST /api/settings — save apiKey and/or model
app.post('/api/settings', (req, res) => {
  try {
    const s = loadSettings();
    if (req.body.apiKey) {
      s.apiKey = req.body.apiKey;
      process.env.ANTHROPIC_API_KEY = req.body.apiKey;
      // Also write to .env file for persistence across restarts
      const envPath = path.join(__dirname, '.env');
      let envContent = '';
      if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('ANTHROPIC_API_KEY=')) {
        envContent = envContent.replace(/ANTHROPIC_API_KEY=.*/g, 'ANTHROPIC_API_KEY=' + req.body.apiKey);
      } else {
        envContent += '\nANTHROPIC_API_KEY=' + req.body.apiKey + '\n';
      }
      fs.writeFileSync(envPath, envContent);
    }
    if (req.body.model) s.model = req.body.model;
    saveSettings(s);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/ai/test — test API connection
app.get('/api/ai/test', async (req, res) => {
  try {
    const s = loadSettings();
    const key = process.env.ANTHROPIC_API_KEY || s.apiKey;
    if (!key) return res.json({ ok: false, error: 'API key belum dikonfigurasi' });
    const client = new Anthropic({ apiKey: key });
    const model = s.model || 'claude-sonnet-4-20250514';
    const response = await client.messages.create({
      model, max_tokens: 100,
      messages: [{ role: 'user', content: 'Balas singkat: "Koneksi berhasil! Saya Claude, siap membantu PMK Suite."' }]
    });
    res.json({ ok: true, model, reply: response.content[0].text });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ═══ CLAUDE AI INTEGRATION ═══
function getAIClient() {
  const s = loadSettings();
  const key = process.env.ANTHROPIC_API_KEY || s.apiKey;
  return new Anthropic({ apiKey: key });
}
function getAIModel() {
  const s = loadSettings();
  return s.model || 'claude-sonnet-4-20250514';
}

const AI_SYSTEM_PROMPT = `Kamu adalah asisten AI ahli di bidang analisis memorandum dan dokumen Sumber Daya Manusia Bank Indonesia, khususnya untuk Program Meningkatkan Kompetensi (PMK).

Keahlianmu:
- Menganalisis memorandum dari Satuan Kerja (Satker) Bank Indonesia
- Mengekstrak informasi peserta PMK: NIP, nama, pangkat, judul PMK, penyelenggara, lokasi, lingkup (LN/DN), tanggal, rekomendasi
- Menyusun narasi Memorandum M01 (Rekomendasi) dan M02 (Rekap/Analisis)
- Memahami struktur organisasi Bank Indonesia (KPwDN, Departemen, Satker)
- Memberikan analisis tren kompetensi dan rekomendasi pengembangan SDM

Panduan format Memorandum:
- M01 (Rekomendasi DSDM): Berisi rekomendasi persetujuan/penolakan PMK individu, lampiran daftar peserta
- M02 (Rekap Analisis): Berisi tujuan, latar belakang, analisis risiko, kesimpulan, tanda tangan 4 pihak

Selalu jawab dalam Bahasa Indonesia yang formal dan sesuai standar korespondensi Bank Indonesia.
Ketika mengekstrak data, gunakan format JSON terstruktur agar bisa langsung digunakan oleh sistem.`;

// POST /api/ai/chat — General AI chat with context
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { messages, context } = req.body;
    if (!messages || !messages.length) return res.status(400).json({ error: 'No messages' });

    let systemPrompt = AI_SYSTEM_PROMPT;
    if (context) {
      systemPrompt += '\n\nKonteks data peserta PMK saat ini:\n' + context;
    }

    const response = await getAIClient().messages.create({
      model: getAIModel(),
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    });

    res.json({ reply: response.content[0].text, usage: response.usage });
  } catch (e) {
    console.error('AI chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/analyze — Analyze uploaded memorandum document
app.post('/api/ai/analyze', async (req, res) => {
  try {
    const { documentText, documentName, pesertaContext, referenceContext } = req.body;
    if (!documentText) return res.status(400).json({ error: 'No document text' });

    let systemPrompt = AI_SYSTEM_PROMPT;
    if (pesertaContext) {
      systemPrompt += '\n\nData peserta PMK yang sudah ada di sistem:\n' + pesertaContext;
    }
    if (referenceContext) {
      systemPrompt += '\n\nDOKUMEN REFERENSI (benchmark & pendukung) yang harus dijadikan acuan gaya, format, dan konten:\n' + referenceContext;
    }

    const response = await getAIClient().messages.create({
      model: getAIModel(),
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Analisis dokumen memorandum berikut dari Satuan Kerja. Gunakan dokumen benchmark/referensi (jika ada) sebagai acuan format dan gaya penulisan.
Nama file: ${documentName || 'dokumen'}

ISI DOKUMEN:
${documentText}

Lakukan analisis berikut:
1. **Ringkasan**: Ringkasan singkat isi memorandum (2-3 kalimat)
2. **Ekstraksi Data Peserta**: Jika ada data peserta PMK, ekstrak ke format JSON array:
\`\`\`json
[{"nip":"...","nama":"...","pangkat":"...","judul":"...","penyelenggara":"...","lokasi":"...","lingkup":"LN/DN","tglMulai":"...","tglSelesai":"...","rekomendasi":"...","kpwdn":"..."}]
\`\`\`
3. **Temuan Penting**: Hal-hal yang perlu diperhatikan (catatan khusus, risiko, ketidaklengkapan data)
4. **Rekomendasi**: Saran tindak lanjut untuk DSDM

Jika tidak ada data peserta, cukup berikan ringkasan dan temuan penting saja.`
      }]
    });

    const analysisResult = response.content[0].text;

    // Auto-save to history
    const HISTORY_FILE = path.join(DATA_DIR, 'ai_history.json');
    let history = [];
    try { if (fs.existsSync(HISTORY_FILE)) history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (e) {}
    history.unshift({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      type: 'analyze',
      documentName: documentName || 'dokumen',
      analysis: analysisResult,
      usage: response.usage
    });
    if (history.length > 100) history = history.slice(0, 100); // keep last 100
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

    res.json({ analysis: analysisResult, usage: response.usage });
  } catch (e) {
    console.error('AI analyze error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ai/history — List analysis history
app.get('/api/ai/history', (req, res) => {
  try {
    const HISTORY_FILE = path.join(DATA_DIR, 'ai_history.json');
    if (!fs.existsSync(HISTORY_FILE)) return res.json([]);
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    res.json(history);
  } catch (e) { res.json([]); }
});

// GET /api/ai/history/:id — Get single history item
app.get('/api/ai/history/:id', (req, res) => {
  try {
    const HISTORY_FILE = path.join(DATA_DIR, 'ai_history.json');
    if (!fs.existsSync(HISTORY_FILE)) return res.status(404).json({ error: 'Not found' });
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    const item = history.find(h => String(h.id) === req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/ai/history/:id — Delete single history item
app.delete('/api/ai/history/:id', (req, res) => {
  try {
    const HISTORY_FILE = path.join(DATA_DIR, 'ai_history.json');
    if (!fs.existsSync(HISTORY_FILE)) return res.status(404).json({ error: 'Not found' });
    let history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    history = history.filter(h => String(h.id) !== req.params.id);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ DOCUMENT BATCH SESSIONS ═══
const DOC_BATCH_FILE = path.join(DATA_DIR, 'doc_batches.json');

// POST /api/ai/doc-batch — Save current document session
app.post('/api/ai/doc-batch', (req, res) => {
  try {
    const { label, documents } = req.body;
    if (!documents || !Object.keys(documents).length) return res.status(400).json({ error: 'No documents' });
    let batches = [];
    try { if (fs.existsSync(DOC_BATCH_FILE)) batches = JSON.parse(fs.readFileSync(DOC_BATCH_FILE, 'utf8')); } catch (e) {}
    batches.unshift({
      id: Date.now(),
      label: label || 'Batch ' + (batches.length + 1),
      timestamp: new Date().toISOString(),
      documents
    });
    if (batches.length > 50) batches = batches.slice(0, 50);
    fs.writeFileSync(DOC_BATCH_FILE, JSON.stringify(batches, null, 2));
    res.json({ ok: true, id: batches[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/ai/doc-batch — List all saved batches (metadata only)
app.get('/api/ai/doc-batch', (req, res) => {
  try {
    if (!fs.existsSync(DOC_BATCH_FILE)) return res.json([]);
    const batches = JSON.parse(fs.readFileSync(DOC_BATCH_FILE, 'utf8'));
    // Return metadata only (no full text) for listing
    res.json(batches.map(b => ({
      id: b.id, label: b.label, timestamp: b.timestamp,
      docCount: Object.values(b.documents).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : (arr ? 1 : 0)), 0),
      docTypes: Object.entries(b.documents).filter(([k, v]) => v && (Array.isArray(v) ? v.length : true)).map(([k]) => k)
    })));
  } catch (e) { res.json([]); }
});

// GET /api/ai/doc-batch/:id — Get full batch with document texts
app.get('/api/ai/doc-batch/:id', (req, res) => {
  try {
    if (!fs.existsSync(DOC_BATCH_FILE)) return res.status(404).json({ error: 'Not found' });
    const batches = JSON.parse(fs.readFileSync(DOC_BATCH_FILE, 'utf8'));
    const batch = batches.find(b => String(b.id) === req.params.id);
    if (!batch) return res.status(404).json({ error: 'Not found' });
    res.json(batch);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/ai/doc-batch/:id
app.delete('/api/ai/doc-batch/:id', (req, res) => {
  try {
    if (!fs.existsSync(DOC_BATCH_FILE)) return res.status(404).json({ error: 'Not found' });
    let batches = JSON.parse(fs.readFileSync(DOC_BATCH_FILE, 'utf8'));
    batches = batches.filter(b => String(b.id) !== req.params.id);
    fs.writeFileSync(DOC_BATCH_FILE, JSON.stringify(batches, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/ai/generate-memo — Generate memo narrative with AI
app.post('/api/ai/generate-memo', async (req, res) => {
  try {
    const { type, pesertaData, config, satkerMemoText, referenceContext } = req.body;

    const memoType = type === 'M02' ? 'M02 (Rekap & Analisis)' : 'M01 (Rekomendasi)';

    let systemWithRef = AI_SYSTEM_PROMPT;
    if (referenceContext) {
      systemWithRef += '\n\nDOKUMEN REFERENSI (benchmark & pendukung) — gunakan sebagai acuan gaya, format, dan struktur narasi:\n' + referenceContext;
    }

    let prompt = `Buatkan narasi untuk Memorandum ${memoType} DSDM Bank Indonesia. Ikuti gaya dan format dari dokumen benchmark/referensi yang tersedia.

Data berikut:

KONFIGURASI:
${JSON.stringify(config, null, 2)}

DATA PESERTA PMK:
${pesertaData}
`;
    if (satkerMemoText) {
      prompt += `\nMEMORANDUM SATKER (referensi):
${satkerMemoText}
`;
    }

    if (type === 'M02') {
      prompt += `\nBuatkan narasi M02 yang mencakup:
1. **Tujuan**: Tujuan memorandum ini dibuat
2. **Latar Belakang**: Konteks pengajuan PMK dari Satker
3. **Analisis Risiko**: Analisis risiko terkait pelaksanaan PMK (operasional, anggaran, kompetensi)
4. **Kesimpulan**: Kesimpulan dan rekomendasi final

Format output sebagai JSON:
\`\`\`json
{"tujuan":"...","latarBelakang":"...","analisisRisiko":"...","kesimpulan":"..."}
\`\`\``;
    } else {
      prompt += `\nBuatkan narasi M01 yang mencakup:
1. **Paragraf Pembuka**: Menjelaskan bahwa DSDM dapat merekomendasikan PMK untuk pegawai yang diajukan
2. **Persyaratan Operasional**: Syarat-syarat yang harus dipenuhi (5 poin)
3. **Evaluasi Pasca-PMK**: Kewajiban evaluasi setelah PMK selesai
4. **Monitoring**: Instruksi monitoring dan tindak lanjut

Format output sebagai JSON:
\`\`\`json
{"pembuka":"...","persyaratanOperasional":["...","...","...","...","..."],"evaluasi":"...","monitoring":"..."}
\`\`\``;
    }

    const response = await getAIClient().messages.create({
      model: getAIModel(),
      max_tokens: 4096,
      system: systemWithRef,
      messages: [{ role: 'user', content: prompt }]
    });

    const narrativeResult = response.content[0].text;

    // Auto-save to history
    const HISTORY_FILE = path.join(DATA_DIR, 'ai_history.json');
    let history = [];
    try { if (fs.existsSync(HISTORY_FILE)) history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (e) {}
    history.unshift({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      type: 'generate-' + (type || 'M01'),
      documentName: 'Generate ' + (type || 'M01'),
      analysis: narrativeResult,
      usage: response.usage
    });
    if (history.length > 100) history = history.slice(0, 100);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

    res.json({ narrative: narrativeResult, usage: response.usage });
  } catch (e) {
    console.error('AI generate-memo error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Load posisi pegawai CSV into memory as NIP->POSITION map
let posisiMap = {};
const POSISI_FILE = path.join(__dirname, 'data_posisi_pegawai_bi.csv');
try {
  if (fs.existsSync(POSISI_FILE)) {
    const lines = fs.readFileSync(POSISI_FILE, 'utf8').split('\n');
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(';');
      if (parts.length >= 3) {
        const nip = parts[0].trim();
        const position = parts[2].trim();
        if (nip && position) posisiMap[nip] = position;
      }
    }
    console.log(`Loaded ${Object.keys(posisiMap).length} posisi pegawai`);
  }
} catch (e) { console.error('Error loading posisi:', e.message); }

// GET posisi lookup — accepts ?nips=123,456,789 or returns all
app.get('/api/posisi', (req, res) => {
  const nips = req.query.nips;
  if (nips) {
    const result = {};
    nips.split(',').forEach(n => { const k = n.trim(); if (posisiMap[k]) result[k] = posisiMap[k]; });
    return res.json(result);
  }
  res.json(posisiMap);
});

// GET rekap data
app.get('/api/rekap', (req, res) => {
  try {
    if (!fs.existsSync(REKAP_FILE)) return res.json({ batches: [], updatedAt: null });
    const data = JSON.parse(fs.readFileSync(REKAP_FILE, 'utf8'));
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST save/update rekap — upsert by NIP+Judul
app.post('/api/rekap', (req, res) => {
  try {
    const { batchLabel, rows } = req.body;
    if (!rows || !rows.length) return res.status(400).json({ error: 'No rows' });

    let data = { batches: [], allRows: [], updatedAt: null };
    if (fs.existsSync(REKAP_FILE)) data = JSON.parse(fs.readFileSync(REKAP_FILE, 'utf8'));
    if (!data.allRows) data.allRows = [];

    // Upsert: match by NIP + Judul PMK
    let added = 0, updated = 0, unchanged = 0;
    for (const row of rows) {
      const key = `${(row.nip||'').trim()}|${(row.judul||'').trim()}`.toLowerCase();
      const existIdx = data.allRows.findIndex(r =>
        `${(r.nip||'').trim()}|${(r.judul||'').trim()}`.toLowerCase() === key
      );
      if (existIdx >= 0) {
        // Check if actually changed
        const old = data.allRows[existIdx];
        const changed = Object.keys(row).some(k => !k.startsWith('_') && String(row[k]||'') !== String(old[k]||''));
        if (changed) {
          data.allRows[existIdx] = { ...row, _savedAt: new Date().toISOString(), _batch: batchLabel };
          updated++;
        } else { unchanged++; }
      } else {
        data.allRows.push({ ...row, _savedAt: new Date().toISOString(), _batch: batchLabel });
        added++;
      }
    }

    // Track batch history
    if (!data.batches) data.batches = [];
    data.batches.push({ label: batchLabel, count: rows.length, added, updated, unchanged, savedAt: new Date().toISOString() });
    data.updatedAt = new Date().toISOString();

    fs.writeFileSync(REKAP_FILE, JSON.stringify(data, null, 2));
    res.json({ ok: true, total: data.allRows.length, added, updated, unchanged });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE clear rekap
app.delete('/api/rekap', (req, res) => {
  try {
    if (fs.existsSync(REKAP_FILE)) fs.unlinkSync(REKAP_FILE);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Batch history — save to external folder
const BATCH_DIR = path.join(__dirname, '..', 'riwayat_batch');
if (!fs.existsSync(BATCH_DIR)) fs.mkdirSync(BATCH_DIR, { recursive: true });

app.get('/api/batches', (req, res) => {
  try {
    const files = fs.readdirSync(BATCH_DIR).filter(f => f.endsWith('.json')).sort().reverse();
    const batches = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, f), 'utf8'));
      return { file: f, ...data.meta };
    });
    res.json(batches);
  } catch (e) { res.json([]); }
});

app.get('/api/batches/:file', (req, res) => {
  try {
    const fp = path.join(BATCH_DIR, req.params.file);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
    res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/batches', (req, res) => {
  try {
    const { meta, rows } = req.body;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const fname = `batch_${ts}.json`;
    fs.writeFileSync(path.join(BATCH_DIR, fname), JSON.stringify({ meta, rows }, null, 2));
    res.json({ ok: true, file: fname });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => {
  if (req.path === '/login' || req.path === '/login.html') return res.sendFile(path.join(__dirname, 'public', 'login.html'));
  if (!req.session || !req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.listen(PORT, () => console.log(`PMK App running on http://localhost:${PORT}`));
