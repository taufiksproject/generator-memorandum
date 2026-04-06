require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const app = express();
const PORT = process.env.PORT || 3005;
const DATA_DIR = path.join(__dirname, 'data');
const REKAP_FILE = path.join(DATA_DIR, 'rekap.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

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
    const { documentText, documentName, pesertaContext } = req.body;
    if (!documentText) return res.status(400).json({ error: 'No document text' });

    let systemPrompt = AI_SYSTEM_PROMPT;
    if (pesertaContext) {
      systemPrompt += '\n\nData peserta PMK yang sudah ada di sistem:\n' + pesertaContext;
    }

    const response = await getAIClient().messages.create({
      model: getAIModel(),
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Analisis dokumen memorandum berikut dari Satuan Kerja.
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

    res.json({ analysis: response.content[0].text, usage: response.usage });
  } catch (e) {
    console.error('AI analyze error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/generate-memo — Generate memo narrative with AI
app.post('/api/ai/generate-memo', async (req, res) => {
  try {
    const { type, pesertaData, config, satkerMemoText } = req.body;
    if (!pesertaData) return res.status(400).json({ error: 'No peserta data' });

    const memoType = type === 'M02' ? 'M02 (Rekap & Analisis)' : 'M01 (Rekomendasi)';

    let prompt = `Buatkan narasi untuk Memorandum ${memoType} DSDM Bank Indonesia dengan data berikut:

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
      system: AI_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    });

    res.json({ narrative: response.content[0].text, usage: response.usage });
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

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`PMK App running on http://localhost:${PORT}`));
