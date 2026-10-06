# Audit fungsional DANA API Gateway

Tanggal: **6 Oktober 2026**. Baseline Git `e041052`; runtime yang diperiksa adalah
`server.js`, `db.js`, dan `views.js` pada checkout lokal. README/package.json dan
instruksi skill sudah memiliki perubahan pengguna sebelum audit, dan dipertahankan.
Runtime gateway tidak diubah dalam pekerjaan ini.

**Alur normal berfungsi dalam uji lokal, tetapi terdapat 11 temuan: 6 P1, 4 P2,
dan 1 P3.** Beberapa merupakan batas kontrak yang sudah diketahui; semuanya
tetap berpengaruh pada integrasi. Kelulusan smoke test bukan bukti bahwa nominal,
duplikasi, delivery callback, atau checkout selalu benar pada input/race lain.

## Ruang lingkup dan bukti

Audit source dan dua subagent pembayaran/callback mencakup generator QR, parser
notifikasi, matching FIFO, expiry SQLite, callback/retry, lookup status, login
dan tab dashboard, serta script kasir. Subagent ketiga membuat kontrak OpenAPI
berdasarkan source yang sama. Pengujian menggunakan Node **26.10.0**, cwd/SQLite
sementara, kredensial sintetis, callback mock atau HTTP loopback, dan VM untuk
menjalankan JavaScript kasir aktual. Tidak membaca `.env` atau database nyata.

Perintah bukti yang dapat diulang:

```sh
npm run verify
npm run audit:functional
npm run test:sdk
```

[audit-payments.cjs](../scripts/audit-payments.cjs) menghasilkan 7 kelompok
`OBSERVED` dan 2 kontrol `VALIDATED`;
[audit-callbacks.cjs](../scripts/audit-callbacks.cjs) menghasilkan 6 `OBSERVED`.
Kelompok probe dan jumlah temuan tidak satu banding satu. Assertions script audit
membuktikan **perilaku cacat saat ini dapat direproduksi**. Exit 0 tidak berarti
gateway sudah diperbaiki; script akan perlu disesuaikan ketika behavior diperbaiki.

## Temuan

### F01 · P1 · Input teks notifikasi dapat mematikan server setelah PAID

Lokasi: [server.js](../server.js) baris 441–472;
[db.js](../db.js) baris 131–135.

Buat pending 25000, lalu POST JSON
`{"amount":25000,"text":{"unexpected":"object"}}`. Matching terlebih dahulu
mengubah transaksi menjadi PAID. Penyimpanan `rawText` berbentuk objek kemudian
melempar `TypeError: Provided value cannot be bound to SQLite parameter 2`.
Handler async Express 4 tidak menangkap rejection: child server exit **1**,
koneksi HTTP terputus, SQLite **PAID**, jumlah notifikasi **0**, callback belum
dikirim. Pelanggan bisa membayar tetapi aplikasi konsumen tidak menerima hasil.

Perbaikan yang diperlukan: validasi/normalisasi seluruh payload sebelum matching,
penanganan error async, dan atomicity pencatatan notifikasi/status. Tambahkan test
input objek/array serta failure penyimpanan. SDK menolak teks non-string, tetapi
route gateway tetap dapat menerima request dari bridge lain.

### F02 · P1 · Parser mengubah nominal dan dapat melunasi amount yang salah

Lokasi: [server.js](../server.js) baris 203–249, 379–420.

Extractor menghapus seluruh karakter non-digit. `amount:-15000` menjadi **15000**;
`"15000.00"` atau `"15.000,00"` menjadi **1500000**. Probe pending 1500000 dengan
teks `Anda menerima Rp 15.000,00` berakhir HTTP 200, matched true, PAID **1500000**.
Pending 15000 dengan `amount:-15000` juga PAID.

Create memiliki coercion berbeda: string `"1e4"` tersimpan/QR menjadi **1**;
`10000.99` menjadi **10000**. `"Infinity"` lolos guard awal lalu HTTP **500**
non-JSON karena constraint SQLite. Ini membuat nominal yang diminta berbeda
dari nominal yang dicatat, atau nominal notifikasi berbeda dari pembayaran asli.

Perbaikan: integer positif finite/safe yang konsisten untuk input terstruktur;
parser mata uang yang menentukan separator ribuan/desimal secara eksplisit dan
menolak format ambigu. SDK menggunakan profil integer ketat; parser gateway
belum diperbaiki.

### F03 · P1 · Pesan gagal, keluar, atau OTP dapat dianggap pembayaran masuk

Lokasi: [server.js](../server.js) baris 231–249, 467.

Pending 43210 ditandai PAID oleh `Pembayaran gagal Rp 43210`. Fungsi extractor
juga mengambil 15000 dari `DANA: Anda mengirim Rp 15000` dan `Kode OTP DANA 15000`.
Gateway memeriksa nominal, bukan makna sukses/incoming atau asal aplikasi.

Perbaikan: kontrak event dan filter bridge Android untuk aplikasi/jenis/hasil
pembayaran, penghapusan fallback angka bebas yang ambigu, serta validasi input
server. Settlement provider tidak terverifikasi oleh mekanisme notifikasi ini.

### F04 · P1 · Notifikasi duplikat dapat membayar order berikutnya

Lokasi: [db.js](../db.js) baris 55–62, 108–128;
[server.js](../server.js) baris 406, 467.

Dua create dengan reference dan nominal 22222 yang sama menghasilkan dua ID
berbeda. Dua notifikasi identik `Anda menerima Rp 22.222` membayar dua transaksi
berbeda. Matching nominal/FIFO tidak mengidentifikasi order yang benar-benar
dibayar; reference tidak memberikan idempotensi create.

Ini batas kontrak yang sudah diketahui. Perbaikan memerlukan identitas event
yang stabil dan deduplikasi, serta kebijakan idempotensi create yang disepakati.
Sambil menunggu, jangan retry create/notifikasi otomatis dan hindari pending
dengan nominal sama; langkah operasional tersebut tidak membuktikan identitas
pembayar. Deduplikasi callback konsumen tidak memperbaiki salah matching di gateway.

### F05 · P1 · Callback gagal dapat hilang setelah receiver pulih

Lokasi: [server.js](../server.js) baris 39–117, 467–472;
[db.js](../db.js) baris 72–86.

Receiver HTTP 503 menghasilkan tiga attempt lalu `failed`. Untuk PAID, SQLite
tetap PAID, tetapi status lookup/sweep setelah receiver 204 menghasilkan **nol
pengiriman baru**. PAID tidak memiliki antrean retry durable. Untuk EXPIRED,
`expiry_webhook_sent=1` ditulis walaupun failed; sweep berikutnya juga nol request.
Probe proses baru terpisah mengonfirmasi restart tidak memulihkan dua jalur ini.

Menjaga PAID adalah perilaku yang benar. Risiko delivery ini mengikuti kebijakan
yang sudah didokumentasikan; flag bukan bukti HTTP 2xx. Perbaikan memerlukan
outbox durable, status delivery terpisah, retry/backoff dan recovery restart.
Konsumen saat ini harus merekonsiliasi order memakai ID tersimpan.

### F06 · P1 · Sweep expiry bertumpuk mengirim callback dua kali

Lokasi: [server.js](../server.js) baris 102–117.

Dua sweep mengambil snapshot backlog A/B. Sweep pertama menunggu A; sweep kedua
menyelesaikan B; sweep pertama kemudian mengirim B dari snapshot lama. Mock
merekam `['concurrent-1','concurrent-2','concurrent-2']`, meskipun flag keduanya 1.
Guard memory hanya melindungi request yang sedang berlangsung, tidak memeriksa
ulang status dispatch setelah request lain selesai.

Perbaikan: claim/reread yang konsisten sebelum dispatch, idealnya terkait outbox
durable. Konsumen harus melakukan deduplikasi persisten dan fulfillment idempoten.
Selfcheck lama hanya memeriksa dua sweep berurutan sehingga tidak menemukan race ini.

### F07 · P2 · Generator menerima template rusak dan memotong nilai berisi 6304

Lokasi: [server.js](../server.js) baris 152–200, 396.

Template TLV sintetis berisi merchant ID `12630489012345` kehilangan sisa
merchant/currency/country/nama/kota setelah generator melakukan
`indexOf('6304')`. Nama merchant `TOKO 6304 BARU` berubah menjadi `TOKO ` dan tag
kota hilang. HTTP tetap 200/PENDING. Template `not-qris` atau spasi juga diterima
dan menghasilkan hanya tag 54/63.

Ini bukti kehilangan field/kerusakan struktur, bukan hasil scanner nyata.
Perbaikan: parse TLV berdasarkan batas tag, validasi panjang/input CRC/mandatory
fields, dan lepaskan hanya CRC top-level terakhir. Uji tag nested berisi `6304`
serta template malformed sebelum menyatakan QR dapat dipindai.

### F08 · P2 · Kasir dapat menampilkan EXPIRED walaupun gateway sudah PAID

Lokasi: [server.js](../server.js) baris 674–697.

VM menjalankan script HTML aktual dengan clock/timer fixture. Setelah deadline
lokal, kasir menampilkan `QRIS Kedaluwarsa`, membersihkan semua timer, dan
`checkPaymentStatus()` melakukan **nol fetch** meskipun mock gateway menjawab
PAID. Pembayaran menjelang batas waktu atau clock klien berbeda dapat tidak
terlihat sampai reload.

Perbaikan: countdown menjadi indikator, tetap lakukan pengecekan server untuk
transisi terminal, termasuk lookup terakhir saat deadline dan recovery jaringan.
HTTP smoke lama hanya memeriksa HTML, tidak menjalankan JavaScript ini.

### F09 · P2 · Kasir mengalami ReferenceError jika deadline sudah lewat

Lokasi: [server.js](../server.js) baris 685–693, 715.

Jika HTML dirender PENDING tetapi tiba setelah deadline atau clock klien lebih
maju, pemanggilan awal `updateCountdown()` mengakses `pollInterval` sebelum
deklarasinya. VM menghasilkan
`ReferenceError: Cannot access 'pollInterval' before initialization`.

Perbaikan: inisialisasi timer sebelum countdown dan uji clock maju/HTML tertunda.

### F10 · P2 · text/plain belum didukung meskipun komentar parser menyebutnya

Lokasi: [server.js](../server.js) baris 203–204, 280–281, 454.

POST `Content-Type:text/plain` berisi `Anda menerima Rp 33333` menghasilkan
HTTP 400 dan amount 0. Middleware hanya JSON dan urlencoded. Integrasi yang
mengandalkan raw text akan selalu gagal.

Gunakan JSON/urlencoded sesuai panduan saat ini. Jika raw text menjadi kontrak
baru, tambahkan middleware dan validasi yang teruji; jangan menganggap fungsi
extractor saja membuktikan dukungan HTTP.

### F11 · P3 · Cookie malformed membuat dashboard HTTP 500

Lokasi: [server.js](../server.js) baris 129–132.

Session admin fixture valid memberi dashboard HTTP 200. Menambahkan cookie
`unrelated=%` menghasilkan URIError/HTTP 500 dari `decodeURIComponent`, walaupun
session gateway benar. Cookie lain dapat menghalangi halaman admin.

Perbaikan: parser cookie toleran terhadap encoding rusak, mengabaikan cookie
yang tidak relevan, serta respons terkontrol untuk session invalid.

## Perilaku normal yang terbukti

| Alur | Bukti lokal |
| --- | --- |
| CRC/generator fixture standar | CRC check vector `123456789` → `29B1`; tag 01 dinamis dan amount benar untuk template normal |
| Create integer/reference | PENDING, amount sesuai, reference trim, expiry sekitar 300 detik |
| Auth | Tanpa API key 401; login salah 401; login benar/dashboard/logout sesuai |
| Lookup | qris_id/trx_id menunjuk transaksi yang sama; unknown 404; bentuk flat/data sesuai source |
| Matching normal | Pending tertua nominal sama menjadi PAID; expired tidak dicocokkan |
| Notifikasi | JSON/urlencoded normal diterima; tanpa nominal/malformed JSON 400; unmatched tetap 200 |
| Callback | 200/204 delivered; 400/404/422 rejected sekali; 401/429/500/network error failed tiga attempt |
| Status lokal | PAID tetap PAID saat callback gagal; pending lewat expiry menjadi EXPIRED |
| Konfigurasi expiry | not_configured tidak ditandai sent; bisa terkirim setelah URL/secret tersedia |
| Kasir/dashboard HTTP | Kasir HTML 200, raw 302 dan expired raw 410; semua tab dashboard 200 dengan session valid |
| SDK | Validasi input, header auth, normalisasi response, timeout/abort, error aman, callback parsing, serta HTTP/SQLite E2E |

## Hasil pekerjaan integrasi

Dibuat [SDK JS/TS](../sdk/javascript/README.md),
[panduan integrasi](integration.md), [OpenAPI](openapi.json), dan contoh
[Node](../examples/node-client.mjs)/[PHP](../examples/php-client.php)/[Python](../examples/python-client.py).
SDK sengaja tidak retry create/notifikasi otomatis, menolak input amount
non-integer/unsafe, dan tidak menaruh key di query/error. Panduan menjelaskan
binding order, validasi secret/ID/amount, deduplikasi persisten dan rekonsiliasi.
Fitur tersebut membantu konsumen, tetapi **tidak memperbaiki cacat server**.

Validasi hasil integrasi: **11 tes SDK/contoh lulus, tanpa skip**; mencakup
kontrak client, input/response yang salah, timeout/abort, helper callback,
HTTP gateway + SQLite nyata di loopback, dan pemanggilan contoh Node/PHP/Python
terhadap mock HTTP. Deklarasi dan contoh penggunaan TypeScript lulus pemeriksaan
strict. Tarball lokal berisi hanya lima file paket yang ditentukan dan berhasil
diinstal serta diimpor dari proyek konsumen sementara. OpenAPI 3.1.1, 22 schema,
50 referensi internal, contoh request/webhook, tautan dokumen lokal, dan
`git diff --check` tervalidasi. Runtime gateway tetap sama dengan baseline.

Urutan perbaikan yang disarankan: validasi/error/atomicity notifikasi dan nominal,
filter event/deduplikasi matching, outbox callback, validasi generator, lalu
timer kasir dan cookie parser. Kebijakan identitas pembayaran, idempotensi dan
retry perlu ditentukan sebelum mengubah kontrak runtime.

## Batas verifikasi

Tidak ada deployment, perubahan secret/data remote, replay callback nyata,
pembayaran aktual, pemindaian QRIS merchant, Android nyata, atau konsumen produksi.
Container tidak dibangun. Tes kasir menggunakan VM DOM/timer, bukan visual dan
interaksi browser. SDK diuji pada Node; runtime native Workers belum diuji.
Autentikasi/session admin belum diaudit sebagai review keamanan lengkap.
Status domain/produksi di README tidak dikonfirmasi oleh audit lokal ini.
