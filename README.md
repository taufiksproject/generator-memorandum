# PMK Memo Generator
**Sistem Otomasi Memorandum M01 & M02 — Departemen Sumber Daya Manusia, Bank Indonesia**

---

## 📋 Deskripsi

Aplikasi web berbasis HTML/CSS/JavaScript untuk mengotomasi pembuatan **Memorandum M01 dan M02** rekomendasi Program Meningkatkan Kompetensi (PMK) Individu pegawai Kantor Perwakilan Bank Indonesia Dalam Negeri (KPwDN).

Aplikasi membaca data dari **Formulir Excel** dan **Memorandum Satuan Kerja**, lalu menghasilkan dokumen Word (`.docx`) siap-pakai sesuai format baku DSDM.

---

## 🗂️ Struktur Proyek

```
pmk-memo-generator/
├── PMK_Memo_Generator.html       # Aplikasi utama (single-file)
├── README.md                     # Dokumentasi ini
└── sample/
    ├── Lamp_M01_DSDM_Formulir_*.xlsx   # Contoh template Excel
    └── Memorandum_Satker.pdf           # Contoh memo input
```

---

## 🚀 Cara Menjalankan

### Metode 1 — Buka Langsung di Browser
```bash
# Cukup double-click file HTML, atau:
open PMK_Memo_Generator.html          # macOS
start PMK_Memo_Generator.html         # Windows
xdg-open PMK_Memo_Generator.html      # Linux
```

### Metode 2 — Live Server (VS Code)
1. Install ekstensi **Live Server** (`ritwickdey.liveserver`)
2. Klik kanan `PMK_Memo_Generator.html` → **Open with Live Server**
3. Aplikasi terbuka di `http://127.0.0.1:5500`

### Metode 3 — HTTP Server Lokal
```bash
# Python (built-in)
python -m http.server 8080

# Node.js (npx)
npx serve .

# Kemudian buka: http://localhost:8080/PMK_Memo_Generator.html
```

---

## 📥 Input yang Dibutuhkan

| File | Format | Keterangan |
|------|--------|-----------|
| Formulir PMK | `.xlsx` / `.xls` | `Lamp_M01_DSDM_Formulir_Standar_Pengajuan_PMK_Individu_*.xlsx` |
| Memorandum Satker | `.pdf` / `.docx` | Memo rekomendasi dari Satker/DR |

### Struktur Sheet Excel

#### Sheet: `Form Pengajuan PMKDN`
| Kolom | Nama Field | Keterangan |
|-------|-----------|-----------|
| B | Batch | Nomor batch pengajuan |
| C | No. | Nomor urut |
| D | KPwDN | Nama kantor perwakilan |
| F | NIP | Nomor Induk Pegawai |
| G | Nama Pegawai | Nama lengkap |
| J | Pangkat | Jabatan/pangkat pegawai |
| K | Judul PMK | Nama pelatihan/sertifikasi |
| L | Penyelenggara | Lembaga penyelenggara |
| Q | Lingkup PMK | DN / LN |
| R | Tanggal Mulai | Format dd/mm/yyyy |
| S | Tanggal Selesai | Format dd/mm/yyyy |
| W | Lembaga Sertifikasi | BNSP, LSP, dll |
| AB | Estimasi Biaya | Nominal biaya tuition |
| AH | Rekomendasi DR | Status rekomendasi akhir |

#### Sheet: `Form Pengajuan PMKLN`
Struktur serupa dengan PMKDN, tambahan kolom:
- Kemampuan Berbahasa Asing (kolom O)
- Mata Uang Biaya Tuition (kolom Z)

---

## 📤 Output yang Dihasilkan

### M01.docx — Memorandum Rekomendasi Utama
```
Kepada   : Departemen Regional
           u.p. Unit Manajemen Intern
Dari     : Departemen Sumber Daya Manusia
           c.q. Kelompok Pengelolaan Kinerja dan Kompetensi Pegawai
Perihal  : Pemberian Rekomendasi Keikutsertaan Pegawai DR pada PMK Individu

Lampiran 1 — Daftar Peserta PMKLN KPwDN   (tabel)
Lampiran 2 — Daftar Peserta PMKDN KPwDN   (tabel)
```

### M02.docx — Memorandum Rekap Ringkas
```
Rekap gabungan seluruh peserta (PMKLN + PMKDN) dengan:
- Status rekomendasi per pegawai
- Highlight peserta yang perlu tindak lanjut
- Statistik ringkas (total, breakdown LN/DN, jumlah disetujui)
```

---

## ⚙️ Konfigurasi Header Memo

Sebelum generate, isi field berikut di aplikasi:

| Field | Default | Keterangan |
|-------|---------|-----------|
| Nomor Urut Memo | `28` | Angka urut pada nomor surat |
| Tahun | `2026` | Tahun PMK |
| Bulan (teks) | `Maret` | Bulan penerbitan memo |
| Batch | `1` | Nomor batch pengajuan |
| Nama Penandatangan | `Nurbani Legisari` | Nama pejabat TTD |
| Jabatan Penandatangan | `Deputi Direktur` | Jabatan pejabat TTD |
| Nomor Ref. Satker | `No.28/22/DR-GSFP/M.01/B` | Nomor surat masuk dari Satker |
| Tanggal Ref. Satker | `3 Maret 2026` | Tanggal surat masuk |

---

## 🔗 Dependensi (CDN — tidak perlu install)

Semua library dimuat otomatis dari CDN saat aplikasi dibuka:

| Library | Versi | Fungsi |
|---------|-------|--------|
| [SheetJS (xlsx)](https://sheetjs.com) | 0.18.5 | Membaca file Excel |
| [docx.js](https://docx.js.org) | 7.8.2 | Generate file Word |
| [PDF.js](https://mozilla.github.io/pdf.js/) | 3.11.174 | Membaca file PDF |
| Google Fonts | — | Playfair Display, IBM Plex |

> **Catatan:** Membutuhkan koneksi internet saat pertama kali dibuka untuk memuat library CDN. Setelah di-cache browser, dapat digunakan offline.

---

## 🖥️ Kompatibilitas Browser

| Browser | Status |
|---------|--------|
| Chrome 90+ | ✅ Direkomendasikan |
| Edge 90+ | ✅ Supported |
| Firefox 88+ | ✅ Supported |
| Safari 14+ | ⚠️ Perlu test download |
| IE 11 | ❌ Tidak didukung |

---

## 🔧 Kustomisasi

### Mengubah Warna Tema
Edit CSS variables di bagian `:root` dalam file HTML:
```css
:root {
  --blue: #003087;   /* Biru Bank Indonesia */
  --red:  #c8102e;   /* Merah aksen */
  --gold: #b8860b;   /* Emas border */
  --paper: #f5f0e8;  /* Warna latar */
}
```

### Mengubah Kolom Excel yang Dibaca
Cari fungsi `parseSheet()` dan sesuaikan index kolom:
```javascript
const cols = {
  nip: 5,        // Kolom F (0-indexed)
  nama: 6,       // Kolom G
  pangkat: 9,    // Kolom J
  judul: 10,     // Kolom K
  // ... sesuaikan dengan struktur Excel Anda
};
```

### Mengubah Narasi Isi Memo
Cari fungsi `generateM01()` atau `generateM02()` dan edit paragraf teks sesuai kebutuhan.

---

## 📐 Alur Kerja Aplikasi

```
[Upload Excel]  ──►  parseSheet()  ──►  excelData{pmkdn, pmkln}
                                                    │
[Upload Memo PDF/DOCX]  ──────────────────────────►┤
                                                    │
                                              processData()
                                                    │
                                              ┌─────▼──────┐
                                              │  allRows[] │
                                              └─────┬──────┘
                                                    │
                              ┌─────────────────────┼──────────────────────┐
                              ▼                     ▼                      ▼
                        buildPreview()        generateM01()         generateM02()
                        (Tabel HTML)         (Word PMKLN+DN)     (Word Rekap)
                                                    │                      │
                                              M01_*.docx            M02_*.docx
```

---

## ❓ Troubleshooting

**Q: File Excel tidak terbaca / data kosong**
- Pastikan nama sheet persis: `Form Pengajuan PMKDN` dan `Form Pengajuan PMKLN`
- Header data harus dimulai di baris ke-6 (index 5)
- Jangan ubah struktur kolom template asli

**Q: Download tidak berjalan di Safari**
- Coba gunakan Chrome atau Edge
- Pastikan pop-up tidak diblokir browser

**Q: Aplikasi lambat saat memproses data besar**
- Normal untuk data >500 baris
- Jangan tutup tab browser saat proses berlangsung

**Q: Tampilan memo di Word tidak sesuai**
- Buka file `.docx` di Microsoft Word (bukan LibreOffice)
- Pastikan font `Arial` tersedia di komputer

---

## 📝 Changelog

| Versi | Tanggal | Perubahan |
|-------|---------|-----------|
| 1.0.0 | Maret 2026 | Rilis pertama — generate M01 & M02 dari Excel + PDF/DOCX |

---

## 👤 Kontak

**Departemen Sumber Daya Manusia**  
Kelompok Pengelolaan Kinerja dan Kompetensi Pegawai  
Bank Indonesia

---

*Aplikasi ini merupakan alat bantu internal. Pastikan dokumen output telah diverifikasi sebelum distribusi resmi.*
