# DANA Business Merchant Gateway

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18.x-339933?logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Auth-OTP%20Based-0085CA" alt="OTP Auth" />
  <img src="https://img.shields.io/badge/QRIS-EMVCo-red" alt="QRIS" />
  <img src="https://img.shields.io/badge/Deploy-VPS%20%7C%20cPanel%20%7C%20Pterodactyl-orange" alt="Deploy Options" />
</p>

API Gateway self-hosted berbasis Node.js untuk otomatisasi cek transaksi dan cetak QRIS dinamis dari akun **DANA Business / DANA Merchant** kamu.

> Mirror arsitektur [gopay-api-gateaway](../gopay-api-gateaway): endpoint, QRIS EMVCo, anti-klaim ganda, halaman checkout, auto-refresh sesi — diganti branding & backend DANA.

---

> [!CAUTION]
> 🚨 **PERSYARATAN DEPLOYMENT (VPS / cPanel / Pterodactyl)**
> Gateway ini **dapat di-deploy di VPS, cPanel, maupun Pterodactyl** dengan storage permanen 24/7.
> **DILARANG hosting serverless gratis** (Render Free, Vercel, Netlify) — container sleep menghapus file sesi (`.DANA_SESI_JANGAN_DIHAPUS.json`).

> [!WARNING]
> ⚠️ **DISCLAIMER PROYEK TIDAK RESMI:**
> Project ini **tidak berafiliasi** dengan PT Espay Debit Indonesia Koe / DANA. Gunakan dengan bijak. Polling agresif bisa memicu pembatasan akun. Risiko ditanggung pengguna. Data 100% di server Anda.

> [!NOTE]
> Endpoint internal DANA Business **bukan API publik resmi**. Path default bisa berubah.
> Override lewat `.env`: `DANA_API_BASE`, `DANA_TX_PATH`, `DANA_OTP_REQUEST_PATH`, `DANA_OTP_VERIFY_PATH`, `DANA_REFRESH_PATH`.
> Jika OTP gagal: `node login.js --import` (paste token/cookie dari browser).

---

## ✨ Fitur Utama

- 🔐 **Login OTP Terminal** — `node login.js` (SMS/WA) atau import token manual.
- 🔄 **Auto-Refresh Token** — refresh background tiap 6 jam. Login cukup 1×.
- 🧾 **QRIS Dinamis (EMVCo)** — nominal custom dari QRIS statis merchant (CRC16 lokal).
- 📱 **Halaman Checkout QRIS** — timer 5 menit, cek manual, auto-poll opsional 8s.
- ✅ **Cek Pembayaran Real-Time** — cocokkan nominal + waktu; `trx_id` anti klaim ganda.
- 📋 **Riwayat Mutasi** — daftar transaksi rentang waktu.
- 🌐 **GET & POST** — query URL atau JSON body.
- 🔒 **API Key + Public QR Status** — backend dilindungi `API_KEY`; frontend aman tanpa key.
- 🐳 **Docker, PM2 & Pterodactyl Ready**

---

## 💻 Persyaratan

- VPS / dedicated / cPanel Node.js ≥ 18 (cPanel: **wajib 18.x**)
- Akun **DANA Business** aktif + nomor HP
- QRIS statis merchant (string EMVCo dari app / cetak QR)

---

## 🛠️ Quick Start (Lokal)

```bash
cd dana-api-gateway
npm install
cp .env.example .env
# edit .env: API_KEY, QRIS_STATIC, DANA_MERCHANT_ID
node login.js          # OTP 1×  — atau: node login.js --import
npm start
```

Contoh `.env`:
```env
PORT=3000
API_KEY=RAHASIA_KAMU
QRIS_STATIC=00020101021126...
DANA_MERCHANT_ID=MERCHANT_ID_KAMU
# Opsional override:
# DANA_API_BASE=https://api.saas.dana.id
# DANA_TX_PATH=/v1/merchant/transactions
```

Sesi tersimpan di `.DANA_SESI_JANGAN_DIHAPUS.json` — **jangan dihapus**.

---

## 🚀 Deploy VPS (PM2)

```bash
npm install
cp .env.example .env && nano .env
node login.js
sudo npm install -g pm2
pm2 start server.js --name "dana-gateway"
pm2 save && pm2 startup
```

### Docker

```bash
docker compose up -d
docker compose logs -f
```

### Nginx (opsional)

```nginx
server {
    server_name dana.domainkamu.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 🌐 cPanel

1. Upload source → folder `dana-gateway`
2. **Setup Node.js App**: Node **18.x**, startup file **`server.js`**
3. Terminal cPanel: `bash setup.sh` (install + login OTP)
4. Restart app → cek `/health`

---

## 🦖 Pterodactyl

1. Login OTP di lokal → upload `.DANA_SESI_JANGAN_DIHAPUS.json`
2. Upload source + `.env`
3. Startup: `node server.js`
4. Console log: `[SERVER] DANA Business Partner Gateway berjalan...`

---

## 📡 API Reference

Auth (kecuali `/health`, `/qr/:id`, `/api/qr-status/:id`):

```text
Header : X-Api-Key: <API_KEY>
Query  : ?api_key=<API_KEY>
```

| Endpoint | Keterangan |
|---|---|
| `GET /health` | Health check |
| `GET /token-status` | Validasi sesi DANA |
| `GET\|POST /create-qris?amount=` | QRIS dinamis 5 menit + `trx_id` |
| `GET /qr/:id` | Halaman checkout HTML |
| `GET /api/qr-status/:id` | Status public (tanpa API key) |
| `GET\|POST /check-payment?amount=&trx_id=` | Cek lunas (S2S) |
| `GET /transactions` | Mutasi (`startTime`/`endTime` unix, `pageSize`) |
| `GET /api/logs` | Log gateway |

### Contoh create QRIS
```http
GET /create-qris?amount=25000&api_key=RAHASIA
```
```json
{
  "success": true,
  "data": {
    "qris_id": "abc123xyz",
    "trx_id": "TRX-A3F8K2M9",
    "qris_url": "http://host/qr/abc123xyz",
    "qris_code": "000201010212...",
    "amount": 25000,
    "expires_at": "...",
    "expires_in": "5 menit"
  }
}
```

### Contoh check payment
```http
GET /check-payment?amount=25000&trx_id=TRX-A3F8K2M9&api_key=RAHASIA
```

---

## 📁 Struktur

```
dana-api-gateway/
├── server.js                         # Express API + QRIS + verifikasi
├── login.js                          # CLI Login OTP / import token
├── sessionManager.js                 # Load/save/refresh sesi
├── setup.sh                          # Setup VPS/cPanel
├── selfcheck.js                      # Cek lokal CRC/QRIS (tanpa network)
├── .env.example
├── .DANA_SESI_JANGAN_DIHAPUS.json    # Sesi (generated)
├── Dockerfile
└── docker-compose.yml
```

---

## 🔧 Troubleshooting

| Gejala | Solusi |
|---|---|
| OTP request gagal | `node login.js --import` — paste token dari DevTools business.dana.id |
| Mutasi HTTP 404 | Set `DANA_TX_PATH` sesuai path real di network tab browser |
| Token invalid | `node login.js` ulang; pastikan file sesi tidak dihapus |
| QRIS generate error | Pastikan `QRIS_STATIC` string EMVCo utuh (tag 00…63) |

---

## ⚠️ Catatan Integrasi DANA

Gateway ini **mirror kontrak API** GoPay gateway (path + response shape) supaya store/bot yang sudah terintegrasi GoPay tinggal ganti base URL + env.

Adapter transaksi menormalisasi field DANA yang bervariasi (`amount` / `totalAmount` / `payAmount`, `orderId` / `acquirementId`, dll). Jika payload merchant Anda beda total, sesuaikan `normalizeTransactions` / `extractRawTransactions` di `server.js`.
