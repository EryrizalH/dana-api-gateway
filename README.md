# QRIS Static to Dynamic Generator Gateway

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22.x+-339933?logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/SQLite-Native%20node%3Asqlite-blue" alt="SQLite" />
  <img src="https://img.shields.io/badge/QRIS-EMVCo-red" alt="QRIS" />
</p>

Layanan API Gateway ringan untuk mengubah string QRIS Statis menjadi **QRIS Dinamis (EMVCo)** dengan nominal spesifik, verifikasi pembayaran real-time via notifikasi handphone (MacroDroid / Tasker), dan **Web UI Monitoring Dashboard** dengan database SQLite.

---

## ✨ Fitur Utama

- 🧾 **Konversi QRIS Dinamis (EMVCo)**: Mengubah Point of Initiation (Tag 01: `11` -> `12`), menyisipkan nominal transaksi (Tag 54), dan menghitung ulang checksum CRC16 (Tag 63).
- 📊 **Web UI Dashboard Admin (`/dashboard`)**: Monitoring visual lengkap dengan login session sederhana:
  - Total QRIS Digenerate
  - Total Pembayaran Berhasil (PAID)
  - Total Menunggu Pembayaran (PENDING)
  - Total Kedaluwarsa (EXPIRED)
  - Log Notifikasi HP Masuk (Cocok vs Tidak Cocok)
- 🗄️ **Database SQLite (Zero External Dependencies)**: Menggunakan driver native bawaan Node.js (`node:sqlite`) yang cepat, stabil, dan tanpa perlu install compiler/package npm tambahan.
- 📱 **Webhook Notifikasi Handphone**: Menerima push notification DANA dari HP (Tasker, MacroDroid, NotiSend, dsb). Otomatis mengekstrak nominal Rp via regex dan mencocokkan transaksi pending (FIFO).
- 🟢 **Halaman Kasir Real-time (`/qr/:id`)**: Auto-polling yang otomatis berubah menjadi hijau "Lunas / Pembayaran Berhasil" seketika notifikasi masuk dari HP.
- 🔒 **Proteksi Keamanan**: Endpoint API dilindungi `API_KEY` dan Web UI dilindungi kredensial admin `.env`.

---

## 🛠️ Quick Start

### 1. Instalasi
```bash
git clone <repo-url>
cd dana-api-gateway
npm install
```

### 2. Konfigurasi Lingkungan (`.env`)
Salin file `.env.example`:
```bash
cp .env.example .env
```
Sesuaikan isi `.env`:
```env
PORT=3000
API_KEY=rahasia_api_key_kamu
QRIS_STATIC=000201010211...
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

### 3. Jalankan Aplikasi
```bash
# Jalankan test verifikasi EMVCo CRC16
npm test

# Mode Development
npm run dev

# Mode Production
npm start
```

---

## 🖥️ Web UI Dashboard Admin

Buka browser dan akses:
- **URL**: `http://localhost:3000/dashboard` (akan diarahkan ke `/login` jika belum login)
- **Default Username**: `admin` (sesuai `ADMIN_USERNAME` di `.env`)
- **Default Password**: `admin123` (sesuai `ADMIN_PASSWORD` di `.env`)

Fitur Dashboard:
- Ringkasan statistik nominal & jumlah transaksi.
- Filter tab: `Semua Transaksi`, `Berhasil (PAID)`, `Pending`, `Expired`, dan `Log Notifikasi HP`.
- Tombol Refresh cepat dan link langsung ke halaman QR checkout kasir.

---

## 📖 API Documentation

### 1. Generate QRIS Dinamis
- **Endpoint**: `POST /create-qris` (atau `GET /create-qris?amount=...`)
- **Headers**:
  - `x-api-key`: `<API_KEY>`
  - `Content-Type`: `application/json`
- **Request Body (JSON)**:
```json
{
  "amount": 25000,
  "qris_static": "000201010211..." // (Opsional - fallback ke QRIS_STATIC .env)
}
```
- **Response**:
```json
{
  "success": true,
  "data": {
    "qris_id": "xsvfewtk",
    "trx_id": "TRX-SFNRJ4LO",
    "qris_url": "http://localhost:3000/qr/xsvfewtk",
    "qris_code": "000201010212...540525000...6304XXXX",
    "amount": 25000,
    "status": "PENDING",
    "expires_at": "2026-09-23T15:25:31.548Z",
    "expires_in": "5 menit"
  }
}
```

### 2. Webhook Notifikasi Pembayaran (Dari Handphone)
Forward notifikasi DANA yang masuk di HP (menggunakan MacroDroid, Tasker, dll) ke endpoint ini:
- **Endpoint**: `POST /api/notifications` (atau `POST /webhook/dana`)
- **Headers / Query**:
  - `x-api-key: <API_KEY>` (atau parameter query `?api_key=<API_KEY>`)
  - `Content-Type: application/json`

#### Opsi A: Teks Mentah Notifikasi (Regex Auto-Parse)
```json
{
  "text": "Kamu telah menerima pembayaran sebesar Rp 25.000 dari John Doe"
}
```

#### Opsi B: JSON Terstruktur
```json
{
  "amount": 25000
}
```

### 3. Tampilan Halaman Pembayaran / Kasir
- **URL**: `GET /qr/:id`
- Menampilkan halaman kasir interaktif dengan QR code, nominal, dan batas waktu.
- Halaman melakukan auto-polling status setiap 3 detik. Ketika notifikasi masuk dari HP, halaman langsung otomatis beralih menampilkan status **🟢 Pembayaran Berhasil / Lunas**.

### 4. Cek Status Pembayaran (API)
- **Endpoint**: `GET /check-payment?trx_id=...` (atau `?qris_id=...`)
- **Headers**: `x-api-key: <API_KEY>`
