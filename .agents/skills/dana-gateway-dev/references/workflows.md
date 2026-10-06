# Workflow Codex untuk gateway

## Pemakaian

Skill proyek berada di `.agents/skills/dana-gateway-dev/`, sehingga hanya relevan
ketika Codex bekerja di checkout ini. Bisa dipilih melalui `$dana-gateway-dev` atau
otomatis dari request yang sesuai. `AGENTS.md` memberi konteks proyek pada chat
baru. Bila selector belum memperlihatkan skill, buka chat/session baru.
Lokasi dan aktivasi mengikuti [dokumentasi skill Codex](https://learn.chatgpt.com/docs/build-skills)
dan [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

Contoh prompt:

- `Gunakan $dana-gateway-dev untuk memperbaiki parsing notifikasi urlencoded dan verifikasi lokal.`
- `Gunakan $dana-gateway-dev untuk menelusuri callback expired yang gagal, mulai dari source dan fixture lokal.`
- `Gunakan $dana-gateway-dev untuk menyiapkan perubahan Docker/Dokploy yang dapat direview.`

Ini prosedur kerja dan helper lokal, bukan automation terjadwal atau deployment CI.

## Perubahan source

Periksa diff pengguna dan baca file yang terkait. Generator/parsing/callback ada
di `server.js`; matching/migrasi ada di `db.js`; dashboard ada di `views.js`.
Tentukan bentuk respons atau state yang berubah, termasuk pengaruh pada konsumen.
Sesuaikan README bila kontrak yang didokumentasikan berubah.

Jalankan dari root:

```sh
npm run verify
git diff --check
```

Helper memakai Node aktif, syntax check, selfcheck lama, lalu HTTP test untuk
create/status, lookup kedua ID, autentikasi API/admin, matching FIFO, notifikasi
JSON/urlencoded, callback paid/expired, dan state PAID ketika callback gagal.
SQLite, kredensial, template QRIS, dan payload semuanya fixture. Port dialokasikan
OS pada `127.0.0.1`; fetch menolak tujuan non-loopback dan tidak mengikuti redirect.
Working directory sementara mencegah dotenv membaca `.env` checkout.
Output tidak membuktikan scanner QRIS, Android, konsumen webhook nyata, atau produksi.

Untuk perubahan UI, lanjutkan dengan cek browser atas login, tab dashboard,
halaman kasir pending/paid/expired, layar mobile, dan polling yang relevan. Gunakan
browser tools yang tersedia atau pemeriksaan manual; HTTP test bukan visual QA.

## Diagnosis notifikasi atau callback

Telusuri create → reference → notifikasi → matching → status SQLite → callback.
Bandingkan auth inbound `x-api-key` dengan outbound `x-webhook-secret`. Periksa
apakah payload JSON mengandung petik/newline tidak ter-escape; urlencoded didukung
oleh middleware, sedangkan `express.text()` belum dipasang untuk raw text/plain.

Gunakan fixture lokal dengan nominal, reference, dan fetch mock. Untuk callback,
amati status `delivered`/`rejected`/`failed`/`not_configured` secara terpisah dari
`expiry_webhook_sent`. Uji respons konsumen yang relevan: 2xx, 400/404/422, 5xx,
network error atau timeout. Hindari replay ke konsumen nyata selama diagnosis
yang hanya meminta inspeksi. Jangan mengubah kebijakan retry tanpa scope perubahan.

Ketika pengguna meminta diagnosis produksi, mulai dengan health HTTP dan metadata
log yang sudah disaring. Status transaksi dan halaman kasir dapat mengirim callback;
jangan menggunakannya sebagai probe yang diasumsikan read-only. Catat host target
aktual; README menyebut `pay.eryrizal.biz.id`. Catatan lama tentang host lain tidak
menetapkan deployment aktif atau kegagalan DNS saat ini.

## Perubahan SQLite

Gunakan `DATABASE_PATH` pada temp dir sebelum import `server.js` atau `db.js`.
Untuk perubahan schema, buat fixture schema lama lalu import modul untuk menguji
migrasi, dan uji startup kedua tidak gagal. Pertahankan qris_id/trx_id unik serta
terminal PAID/EXPIRED kecuali perubahan status memang diminta.

Untuk inspeksi database yang sudah ada, buka file dengan `DatabaseSync` opsi
`readOnly: true` dalam script terpisah; jangan require `db.js`. Backup/replay/update
data produksi memerlukan scope yang memang diminta. Backup DB hidup harus konsisten
dengan WAL; menyalin file utama saja belum menjamin transaksi terakhir ikut tersimpan.

## Persiapan Docker/Dokploy

Pastikan verifikasi lokal selesai dan konteks Docker menyaring `.env`, SQLite,
WAL/SHM, serta node_modules lokal. Saat ini `.dockerignore` belum ada; siapkan
filter dalam perubahan deployment yang diminta sebelum menjalankan build.
`node:22-alpine` adalah tag bergerak; test Node host tidak membuktikan image itu.

Review volume `/app/data`, environment/secret melalui Dokploy, port 3000,
hostname/TLS/proxy, dan callback URL. `app.enable('trust proxy')` membuat URL QR
mengikuti forwarded protocol/host; verifikasi konfigurasi proxy aktual.
Sajikan perubahan yang konkret. Jalankan deploy hanya ketika pengguna memintanya.
Sesudah deploy yang diotorisasi, verifikasi health/startup terlebih dahulu, lalu
jalankan skenario transaksi hanya pada fixture/target yang diizinkan.

## Skill yang ditemukan

Katalog resmi `openai/skills` dan skill terpasang diperiksa pada 6 Oktober 2026.
Tidak ditemukan skill curated khusus DANA/QRIS/Dokploy, sehingga skill proyek ini
dibuat dari source lokal.

| Skill | Status saat setup | Kapan relevan |
| --- | --- | --- |
| `skill-creator` | Bawaan Codex | Merawat skill ini |
| `security-best-practices` | Sudah terpasang | Saat pengguna meminta review keamanan Express/JavaScript |
| `antislop-ui`, `antislop-human`, `antislop-layoutmobile` | Sudah tersedia | Saat perubahan login/dashboard/kasir memang membutuhkan workflow UI tersebut |
| `playwright`, `playwright-interactive` | Ada di curated, belum dipasang | Opsional bila dibutuhkan pengujian browser khusus; tool browser saat ini juga tersedia |
| `gh-fix-ci`, `gh-address-comments` | Ada di curated, belum dipasang | Bila pekerjaan berikutnya melibatkan CI/PR; belum ada CI proyek |

Skill Cloudflare/Wrangler yang terpasang tidak diperlukan untuk runtime gateway.
Gunakan pada repo konsumen hanya bila pekerjaan yang diminta memang menyentuh Worker.
Tidak ada plugin, MCP, automation, atau skill global tambahan yang diperlukan untuk
menjalankan helper verifikasi ini.
