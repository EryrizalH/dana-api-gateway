# QRIS Static to Dynamic Generator Gateway

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22.x+-339933?logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/SQLite-Native%20node%3Asqlite-blue" alt="SQLite" />
  <img src="https://img.shields.io/badge/QRIS-EMVCo-red" alt="QRIS" />
  <img src="https://img.shields.io/badge/Deploy-Dokploy-purple" alt="Dokploy" />
</p>

Layanan API Gateway ringan untuk mengubah string QRIS Statis menjadi **QRIS Dinamis (EMVCo)** dengan nominal spesifik, verifikasi pembayaran real-time via webhook notifikasi handphone (MacroDroid / Tasker), dan **Web UI Monitoring Dashboard** dengan database SQLite.

- **Production Domain**: `https://pay.eryrizal.biz.id`
- **Dashboard Admin**: `https://pay.eryrizal.biz.id/dashboard`

---

## ✨ Fitur Utama

- 🧾 **Konversi QRIS Dinamis (EMVCo)**: Mengubah Point of Initiation (Tag 01: `11` -> `12`), menyisipkan nominal transaksi (Tag 54), dan menghitung ulang checksum CRC16 (Tag 63).
- 📊 **Web UI Dashboard Admin (`/dashboard`)**: Monitoring visual lengkap dengan login session:
  - Total QRIS Digenerate
  - Total Pembayaran Berhasil (PAID)
  - Total Menunggu Pembayaran (PENDING)
  - Total Kedaluwarsa (EXPIRED)
  - Log Notifikasi HP Masuk (Cocok vs Tidak Cocok)
- 🗄️ **Database SQLite (Zero External Dependencies)**: Menggunakan driver native bawaan Node.js (`node:sqlite`) yang cepat, stabil, dan tersimpan di volume persisten `/app/data`.
- 📱 **Webhook Notifikasi Handphone**: Menerima push notification DANA dari HP via MacroDroid / Tasker. Otomatis mengekstrak nominal Rp via regex dan mencocokkan transaksi pending (FIFO).
- 🟢 **Halaman Kasir Real-time (`/qr/:id`)**: Auto-polling status setiap 3 detik yang otomatis berubah menjadi hijau "Lunas / Pembayaran Berhasil" seketika notifikasi masuk dari HP.
- 🔒 **Proteksi Keamanan**: Endpoint API dilindungi `API_KEY` dan Web UI dilindungi kredensial admin `.env`.

---

## 🛠️ Konfigurasi Lingkungan (`.env`)

```env
PORT=3000
DATA_DIR=/app/data
API_KEY=aksjdhakshgdchasgvhdsaasdhaskdasd
QRIS_STATIC=00020101021126570011ID.DANA.WWW011893600915303513061002090351306100303UMI51440014ID.CO.QRIS.WWW0215ID10265959083300303UMI5204899953033605802ID5909Ery-store6011Kota Bekasi6105171246304EEAA
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

---

## 🖥️ Web UI Dashboard Admin

Buka browser dan akses:
- **URL**: `https://pay.eryrizal.biz.id/dashboard` (atau `http://localhost:3000/dashboard` untuk lokal)
- **Default Username**: `admin`
- **Default Password**: `admin123`

Fitur Dashboard:
- Ringkasan statistik jumlah & nominal transaksi (Total, Lunas, Pending, Expired).
- Tab Filter: `Semua Transaksi`, `Berhasil (PAID)`, `Pending`, `Expired`, dan `Log Notifikasi HP`.
- Tombol Refresh cepat dan link langsung membuka halaman checkout kasir `/qr/:id`.

---

## 📱 Panduan Setup Notifikasi Otomatis di MacroDroid (Android)

Untuk mendeteksi pembayaran masuk secara real-time, gunakan aplikasi **MacroDroid** (tersedia gratis di Play Store) untuk mem-forward notifikasi dari aplikasi DANA ke server.

### Langkah-langkah Pembuatan Macro:

#### 1. Buat Trigger (Pemicu)
1. Buka aplikasi **MacroDroid** -> Pilih **Add Macro** (Tambah Makro).
2. Di bagian **Triggers** (warna merah), tap tombol **`+`**.
3. Pilih **Device Events** (Peristiwa Perangkat) -> **Notification** (Notifikasi) -> **Notification Received** (Notifikasi Diterima).
4. Pilih **Select Application(s)** -> Cari dan centang aplikasi **DANA** -> Tap **OK**.
5. Pada pilihan *Text Content*, pilih **Any Content** (Semua Konten) -> Tap **OK**.

#### 2. Buat Action (Tindakan Kirim Webhook)
1. Di bagian **Actions** (warna biru), tap tombol **`+`**.
2. Pilih **Connectivity** (Konektivitas) -> **HTTP Request** (Permintaan HTTP).
3. Konfigurasikan form HTTP Request sebagai berikut:
   - **Request Method**: `POST`
   - **URL**:
     ```
     https://pay.eryrizal.biz.id/api/notifications?api_key=aksjdhakshgdchasgvhdsaasdhaskdasd
     ```
     *(Ganti API Key sesuai dengan konfigurasi Anda)*.
   - **Content-Type**: `application/json`
   - **Request Body (Text)**:
     ```json
     {
       "text": "[not_title] [not_body]"
     }
     ```
     *(MacroDroid akan otomatis mengganti `[not_title]` dan `[not_body]` dengan judul dan isi pesan notifikasi DANA yang masuk)*.
4. Tap **OK** / Simpan Action.

#### 3. Simpan dan Aktifkan Makro
1. Beri nama makro di bagian atas, contoh: `Forward Notifikasi DANA`.
2. Tap tombol centang / simpan di pojok kanan bawah.

> [!IMPORTANT]
> **Izin Penting Android**:
> - Pastikan MacroDroid telah diberikan izin **Akses Notifikasi** (*Settings -> Notifications -> Device & app notifications -> MacroDroid -> Allow*).
> - Nonaktifkan **Optimasi Baterai** (*Don't optimize / Unrestricted*) untuk MacroDroid agar sistem Android tidak mematikan background service saat layar HP terkunci/mati.

---

## 📖 API Documentation

Base URL Production: **`https://pay.eryrizal.biz.id`**

### 1. Generate QRIS Dinamis
Mengubah QRIS statis menjadi dinamis dengan nominal custom dan checksum CRC16 baru:
- **Endpoint**: `POST /create-qris` (atau `GET /create-qris?amount=...`)
- **Headers**:
  - `x-api-key`: `aksjdhakshgdchasgvhdsaasdhaskdasd`
  - `Content-Type`: `application/json`
## Request Body (JSON):
```json
{
  "amount": 25000,
  "reference_id": "ORD-20260923-1234",
  "qris_static": "000201010211..." // Opsional: jika ingin override template .env
}
```
`reference_id` bersifat opsional untuk integrasi lama. Storefront mengisinya dengan ID order (`ORD-*`) atau topup kredit (`TOPUP-*`), dan nilai kosong disimpan sebagai `null`.
 
 - **Response**:
```json
{
  "success": true,
  "data": {
    "qris_id": "xsvfewtk",
    "trx_id": "TRX-SFNRJ4LO",
    "reference_id": "ORD-20260923-1234",
    "qris_url": "https://pay.eryrizal.biz.id/qr/xsvfewtk",
    "qris_code": "000201010212...540525000...6304XXXX",
    "amount": 25000,
    "status": "PENDING",
    "expires_at": "2026-09-23T15:25:31.548Z",
    "expires_in": "5 menit"
  }
}
```

---

### 2. Webhook Notifikasi Pembayaran
Endpoint yang dipanggil oleh handphone/MacroDroid untuk verifikasi pelunasan:
- **Endpoint**: `POST /api/notifications` (atau `POST /webhook/dana`)
- **Autentikasi**: Header `x-api-key: <API_KEY>` atau query `?api_key=<API_KEY>`
- **Content-Type**: `application/json`

#### Opsi A: Teks Notifikasi Mentah (Regex Auto-Parse)
```json
{
  "text": "Kamu telah menerima pembayaran sebesar Rp 25.000 dari Doni"
}
```

#### Opsi B: Format JSON Terstruktur
```json
{
  "amount": 25000
}
```

- **Response Berhasil Cocok (Lunas)**:
```json
{
  "success": true,
  "matched": true,
  "message": "Pembayaran berhasil dicocokkan dan diverifikasi LUNAS",
  "data": {
    "qris_id": "xsvfewtk",
    "trx_id": "TRX-SFNRJ4LO",
    "amount": 25000,
    "status": "PAID",
    "paid_at": "2026-09-23T15:27:28.478Z"
  }
}
```

### Callback Pembayaran ke Worker
Jika `PAYMENT_WEBHOOK_URL` dan `PAYMENT_WEBHOOK_SECRET` tersedia, transaksi yang memiliki `reference_id` mengirim callback terautentikasi ke Worker/Storefront saat berubah menjadi `PAID` atau `EXPIRED`.

Atur konfigurasi deployment gateway melalui environment atau secret store:
```env
PAYMENT_WEBHOOK_URL=https://your-worker.example.com/api/webhooks/qris
PAYMENT_WEBHOOK_SECRET=your_qris_webhook_secret_here
```

Request callback saat lunas (`payment.paid`):
```json
{
  "event": "payment.paid",
  "reference_id": "ORD-20260923-1234",
  "qris_id": "xsvfewtk",
  "trx_id": "TRX-SFNRJ4LO",
  "amount": 25000,
  "status": "paid",
  "paid_at": "2026-09-23T15:27:28.478Z",
  "payment_details": {
    "text": "Kamu telah menerima pembayaran sebesar Rp 25.000"
  }
}
```

Request callback saat kedaluwarsa (`payment.expired`):
```json
{
  "event": "payment.expired",
  "reference_id": "ORD-20260923-1234",
  "qris_id": "xsvfewtk",
  "trx_id": "TRX-SFNRJ4LO",
  "amount": 25000,
  "status": "expired",
  "expired_at": "2026-09-23T15:32:28.478Z"
}
```

Header callback adalah `Content-Type: application/json` dan `x-webhook-secret`. Gateway memakai timeout 5 detik, maksimal tiga percobaan, dan hanya status HTTP 2xx dianggap terkirim. Kegagalan callback tidak membatalkan status transaksi di gateway; callback untuk status expired dikirim otomatis saat pengecekan status, saat background timer berjalan, atau saat gateway dimulai ulang.

Alur notifikasi DANA melalui MacroDroid tetap memakai `/api/notifications` dengan `x-api-key`, sehingga callback Worker tidak menggantikan integrasi MacroDroid.

---

### 3. Tampilan Halaman Pembayaran Kasir
- **URL**: `GET /qr/:id`
  - Contoh: `https://pay.eryrizal.biz.id/qr/xsvfewtk`
- Menampilkan kartu QR interaktif dengan timer 5 menit dan tombol salin string.
- Memiliki fitur auto-polling setiap 3 detik yang otomatis berubah menjadi hijau **🟢 Pembayaran Berhasil / Lunas** seketika notifikasi DANA masuk.
- Raw image redirect (untuk langsung embed gambar): `GET /qr/:id?format=raw`

---

### 4. Cek Status Pembayaran (API Integration)
Untuk bot Telegram, website toko online, atau sistem backend Anda:
- **Endpoint**: `GET /check-payment?trx_id=...` (atau `?qris_id=...`)
- **Headers**: `x-api-key: <API_KEY>`
- **Response**:
```json
{
  "success": true,
  "data": {
    "qris_id": "xsvfewtk",
    "trx_id": "TRX-SFNRJ4LO",
    "amount": 25000,
    "status": "PAID",
    "paid": true,
    "paid_at": "2026-09-23T15:27:28.478Z"
  }
}
```

---

### 5. Status Kasir Publik (Frontend Polling)
- **Endpoint**: `GET /api/qr-status/:id`
- Mengembalikan status terkini (`PENDING`, `PAID`, `EXPIRED`) tanpa perlu API key (aman untuk client-side browser kasir).
