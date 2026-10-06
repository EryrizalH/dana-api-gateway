# Peta proyek dan kontrak

Snapshot source: 6 Oktober 2026, baseline `e041052`. Periksa source lagi untuk
perubahan berikutnya. Tidak ada panggilan ke layanan produksi dalam kajian ini.

## Stack dan tanggung jawab file

| File | Tanggung jawab |
| --- | --- |
| `server.js` | Express CommonJS, middleware, generator TLV/CRC, parsing notifikasi, callback, halaman kasir inline, timer expiry |
| `db.js` | `node:sqlite.DatabaseSync`, schema/migrasi saat import, WAL, matching nominal FIFO, statistik |
| `views.js` | HTML login dan dashboard; tanpa bundler atau framework frontend |
| `selfcheck.js` | Fixture SQLite sementara dan mock fetch untuk generator/reference/callback/expiry |
| `Dockerfile` | `node:22-alpine`, `npm ci --only=production`, port 3000 |
| `docker-compose.yml` | Service tunggal, `.env`, volume `./data:/app/data`, restart always |
| `setup.sh` | Helper setup lokal; pesan Node 18 sudah tidak cocok dengan `node:sqlite` |

Dependency production: Express 4, cors, dotenv. Dependency development: nodemon.
Node 22.13 adalah minimum tanpa flag untuk SQLite yang dipakai entrypoint saat
ini. Verifikasi runtime dengan `node -e "require('node:sqlite')"`.
Sumber: [Node SQLite](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html).

Alur: konsumen membuat QRIS → SQLite `PENDING` → notifikasi Android mencocokkan
nominal/FIFO → SQLite `PAID` → callback konsumen. Jalur expiry mengubah pending
menjadi `EXPIRED` dan mencoba callback bila `reference_id` tersedia.
Gateway ini bukan implementasi API pembayaran resmi DANA dan tidak memverifikasi
settlement langsung kepada provider; sinyal pembayaran berasal dari notifikasi HP.

## Kontrak HTTP yang perlu dipertahankan

| Endpoint | Auth | Bentuk hasil / perilaku |
| --- | --- | --- |
| `GET /health`, `/api/health` | Publik | `status: "OK"`, service, timestamp |
| `/create-qris` | API key | POST/GET terdokumentasi, implementasi `app.all`; amount positif, template env/request, reference opsional; hasil di `data` |
| `/api/notifications`, `/webhook/dana` | API key | `app.all`; JSON/urlencoded/query; amount atau teks; hasil `matched`, data, callback bila cocok |
| `GET /api/qr-status/:id` | Publik | Menerima qris_id atau trx_id; field status di tingkat atas; unknown 404 `NOT_FOUND` |
| `/check-payment` | API key | `app.all`; qris_id/trx_id di query/body; hasil di `data` |
| `GET /api/qr/:id` | Publik | Detail termasuk qris_code; hasil di `data` |
| `GET /qr/:id` | Publik | HTML kasir, polling 3 detik; `format=raw` redirect ke QRServer, expired raw 410 |
| `/login`, `/dashboard`, `/logout` | Cookie admin | Login POST, dashboard GET; session dalam `Set` memory proses |

API key diterima melalui `x-api-key`, `api_key`, atau `apikey`. Gunakan header pada
integrasi baru. Status API: `PENDING`, `PAID`, `EXPIRED`. Generator mengubah tag 01
ke `12`, menyisipkan/mengganti tag 54, dan menghitung CRC16 CCITT-FALSE pada tag 63.
Request create saat ini memakai `parseInt`; jangan mengasumsikan validasi integer
ketat. `reference_id` di-trim, kosong menjadi null, dan tidak unik pada database.

## Callback konsumen

Konfigurasi: `PAYMENT_WEBHOOK_URL`, `PAYMENT_WEBHOOK_SECRET`. Request POST JSON
dengan header `x-webhook-secret`. Bukan header `x-api-key` milik inbound gateway.

Field bersama: `event`, `reference_id`, `qris_id`, `trx_id`, `amount`, `status`.
Paid: event `payment.paid`, status `paid`, `paid_at`, `payment_details`.
Expired: event `payment.expired`, status `expired`, `expired_at`.

`sendPaymentWebhook()` melewati transaksi tanpa reference (`skipped`), mengembalikan
`not_configured` bila URL/secret kosong, dan menganggap HTTP 2xx sebagai `delivered`.
HTTP 400/404/422 langsung `rejected`; hasil lainnya/error retry maksimal 3 kali,
timeout 5 detik tiap attempt, jeda 100 ms. Callback gagal tidak membatalkan PAID.
Paid tidak punya antrean retry durable setelah pemanggilan itu selesai.

`processExpiredWebhooks()` memakai guard in-memory per ID. Source saat ini menandai
`expiry_webhook_sent=1` untuk `delivered`, `skipped`, `rejected`, dan `failed`.
`not_configured` tetap belum ditandai. Flag bermakna dispatch selesai/dihentikan,
bukan bukti delivery. `selfcheck.js` menguji penghentian retry HTTP 404.
Timer berjalan tiap 60 detik; startup CLI dan beberapa route GET memicu dispatcher.

## Data dan konfigurasi

`transactions`: ID internal, qris_id/trx_id unik, amount, qris_code, status,
created_at/expires_at, paid_at/payment_details, reference_id, expiry_webhook_sent.
`notifications`: amount, raw_text, matched, trx_id, received_at.
Migrasi `reference_id` dan flag expiry memakai PRAGMA + ALTER TABLE saat import.
Import `db.js` membuka DB dan menulis schema; bukan cara inspeksi read-only.

Precedence lokasi DB: `DATABASE_PATH` → `DATA_DIR/database.sqlite` → direktori
`data/` di checkout bila ada → root checkout. File WAL/SHM perlu diperhitungkan
pada backup. Docker Compose menetapkan `DATA_DIR=/app/data` pada volume persisten.

Environment lain: `PORT`, `API_KEY`, `QRIS_STATIC`, `ADMIN_USERNAME`,
`ADMIN_PASSWORD`. Untuk test gunakan semua nilai sintetis; jangan salin `.env`.

## Temuan yang memengaruhi pekerjaan selanjutnya

- Notifikasi tidak memiliki ID deduplikasi; duplikat dengan nominal sama bisa
  melunasi pending berikutnya. Reference tidak mencegah create berulang.
- GET status/checkout dapat menulis expiry dan memicu callback; dashboard juga
  memperbarui expiry melalui pembacaan statistik/transaksi.
- Raw query URL dicetak pada auth gagal. API key lewat query berpotensi muncul
  pada log; diagnosis harus menyaring kredensial dan data notifikasi nyata.
- Cookie/session admin hanya di memory, tidak memiliki expiry server-side, dan
  cookie login belum menambahkan Secure. Jangan menganggap beberapa replica
  berbagi session atau dispatcher guard.
- QR image memakai `api.qrserver.com`; font UI memakai Google Fonts. HTTP smoke
  lokal tidak mengambil aset tersebut atau memverifikasi gambar bisa dipindai.
- Belum ada `.dockerignore`; `COPY . .` bisa memasukkan `.env`/data/node_modules
  lokal ke image jika konteks build tidak disaring. Periksa sebelum build/deploy.
- Belum ada CI, lint, typecheck, atau bundler. Docker/Dokploy ada pada dokumentasi;
  koneksi atau deployment aktif Dokploy belum diverifikasi.

## Bukti verifikasi setup

Pada 6 Oktober 2026, `npm run verify` lulus memakai Node 26.10.0. Helper juga
lulus dari working directory di luar repo pada salinan sementara yang diinstal
dengan `npm ci --ignore-scripts --no-audit --no-fund` dari lockfile. Metadata skill,
tautan lokal, scaffold, dan whitespace diperiksa. Uji ini mencakup state dan HTTP
lokal; image Docker, pemindaian QRIS, Android, serta konsumen/produksi belum diuji.
