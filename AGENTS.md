# DANA API Gateway

Gateway ini mengubah QRIS statis menjadi dinamis, menerima notifikasi pembayaran
DANA dari Android, dan mengirim callback ke aplikasi konsumen. Runtime gateway
adalah Node.js + Express + SQLite lokal; konsumen callback dapat memakai Worker.

## Konteks dan skill

- Untuk perubahan gateway, diagnosis pembayaran, atau verifikasi lokal, gunakan
  `.agents/skills/dana-gateway-dev/SKILL.md`.
- Baca `references/project-map.md` di skill tersebut ketika membutuhkan kontrak,
  schema, atau batas integrasi. Baca `references/workflows.md` sesuai pekerjaan.
- `server.js` memuat API, callback, dan halaman kasir; `db.js` memuat schema serta
  matching; `views.js` memuat login/dashboard; `selfcheck.js` adalah tes lama.

## Menjalankan dan memverifikasi

- Gunakan Node yang menyediakan `require('node:sqlite').DatabaseSync` tanpa flag;
  minimum untuk perintah saat ini adalah Node 22.13. `setup.sh` masih menyebut
  Node 18, sehingga pesannya bukan acuan kompatibilitas.
- Dependency dikunci oleh `package-lock.json`; gunakan `npm ci` bila perlu.
- `npm run verify` menjalankan syntax check, selfcheck, dan HTTP smoke test dengan
  SQLite sementara, kredensial sintetis, dan callback mock pada loopback.
- Tes tersebut boleh dijalankan tanpa konfirmasi tambahan. Untuk perubahan
  dokumentasi saja, periksa tautan dan `git diff --check`; tes penuh tidak wajib.
- Tidak ada perintah lint, typecheck, atau build frontend di proyek ini.

## Batas yang berpengaruh pada implementasi

- API status memakai `PENDING`/`PAID`/`EXPIRED`; status callback memakai huruf kecil.
  `reference_id` opsional dan bukan kunci idempotensi yang unik saat ini.
- Matching notifikasi memakai nominal + transaksi pending tertua yang belum
  expired. Jangan mengklaim ada deduplikasi notifikasi atau identifikasi pembayar.
- Pembacaan transaksi/dashboard dapat mengubah status expired. GET status,
  check-payment, dan halaman kasir juga dapat memicu callback; perlakukan
  diagnosis data produksi sebagai operasi yang berpotensi punya efek samping.
- `expiry_webhook_sent=1` saat ini juga berarti pengiriman dihentikan setelah
  rejection atau retry gagal; flag ini tidak membuktikan penerimaan HTTP 2xx.
- Pertahankan status pembayaran lokal ketika callback gagal. Perubahan kebijakan
  retry/idempotensi perlu mencakup tes dan dokumentasi kontrak terkait.
- Gunakan fixture untuk nominal/notifikasi/QRIS saat menguji. Jangan mencetak
  `.env`, API key, password, cookie session, atau secret callback. Utamakan header
  `x-api-key`; query autentikasi dapat muncul pada log kegagalan autentikasi.
- Deployment, perubahan secret, replay callback, dan perubahan data remote hanya
  dilakukan ketika termasuk instruksi pengguna. Persiapan lokal tetap berjalan.
- Bedakan hasil lokal, build container, dan verifikasi produksi pada laporan.
