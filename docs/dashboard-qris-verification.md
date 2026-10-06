# Verifikasi QRIS dashboard

Tanggal: 6 Oktober 2026. Node 26.10.0, SQLite sementara, session/kredensial
sintetis, dan callback loopback. Tidak ada deployment, pembayaran nyata,
perubahan secret/data produksi, pemindaian bank/e-wallet, atau build container.

## Hasil implementasi

Dashboard menerima nominal integer positif melalui session admin dan CSRF yang
terikat session. POST berhasil memakai redirect 303 ke hasil dashboard; refresh
dan tab tidak mengulang create. Pembuatan memakai template server dan fungsi
transaksi bersama API publik. Pembayaran manual menyimpan reference null dan
tidak mengirim callback konsumen. Kontrak API publik dan matching nominal/FIFO
dipertahankan.

Polling tidak bertumpuk, timeout 8 detik, lalu mencoba lagi setelah 3 detik.
Countdown tidak menetapkan status terminal. Status server PAID/EXPIRED menghentikan
polling, menyembunyikan QR, dan memuat ulang statistik, tab, serta tabel tanpa
me-reload form. URL ringkasan tetap benar ketika halaman berasal dari POST gagal.

## Bukti pengujian

| Pemeriksaan | Hasil |
| --- | --- |
| `npm run verify` | PASS: syntax, 11 tes JavaScript dashboard, selfcheck, HTTP/SQLite smoke |
| `npm run test:sdk` | PASS: 11 tes SDK dan contoh integrasi, tanpa skip |
| `git diff --check` | PASS: tidak ada kesalahan whitespace |
| Auth dan CSRF | PASS: API key saja tidak memberi akses; token kosong, salah, dan session lain ditolak |
| Nominal dan gagal create | PASS: desimal, eksponen, nol, negatif, separator, infinity, unsafe integer ditolak; kegagalan tidak insert |
| Manual create | PASS: PENDING, nominal sesuai, expiry 300000 ms, template server, reference null |
| Manual paid/expired | PASS: tidak ada callback konsumen, termasuk konfigurasi callback mock aktif |
| Refresh/tab | PASS: jumlah transaksi fixture tetap satu setelah refresh dan kelima tab |
| Timer/status | PASS: clock melewati deadline tetap meminta status; PAID server menang; EXPIRED harus dikonfirmasi server |
| Jaringan lambat/gagal | PASS: tidak ada request bertumpuk; error terlihat; polling pulih; kegagalan ringkasan tidak mengubah PAID |
| POST gagal dengan QR pending | PASS: browser tetap di URL POST, kemudian PAID dan ringkasan diperbarui tanpa error |
| Clipboard | PASS: clipboard browser berisi tautan; fallback seleksi manual diuji dengan mock penolakan |
| Konfigurasi/gambar | PASS: form disabled saat template kosong; satu pesan error pada HTTP; gambar diblokir sementara menghasilkan feedback |

Klik browser tercatat: login berhasil; submit kosong dan eksponen gagal validasi;
input nominal + Tab memfokuskan tombol dengan outline; Enter membuat QR;
Salin tautan berhasil; Semua/Paid/Pending/Expired/Notifikasi dan Refresh
mempertahankan ID; Logout kembali ke login. Tautan Buka pembayaran/Buka QR
menunjuk `/qr/:id`; tujuan kasir PAID dibuka langsung dan juga diperiksa HTTP.
Pembukaan popup melalui in-app browser tidak digunakan sebagai bukti tab baru.

Browser menunjukkan pending menjadi PAID setelah notifikasi fixture, serta
pending menjadi EXPIRED setelah deadline SQLite fixture dimajukan. Statistik,
tabel, dan jumlah pada tab notifikasi mengikuti status terbaru. Network blocking
sementara untuk gambar/status dilepas kembali; viewport override juga di-reset.
Tidak ada exception JavaScript aplikasi pada pemeriksaan log browser.

Layar 320, 390, 768, dan desktop 1280 diperiksa. Lebar dokumen tidak melebihi
viewport; tabel panjang memiliki scroll sendiri; tombol baru minimal 44 px.
Warna teks dashboard yang terlihat diperiksa dari computed styles dan memenuhi
ambang kontras 4.5:1 untuk teks biasa, 3:1 untuk teks besar.

Screenshot memakai data fixture, bukan pembayaran nyata:

- [Desktop](/home/eryrizal/.codex/visualizations/2026/10/06/01a111d9-0532-7313-9d7f-7d88400eceab/dashboard-qris-desktop.jpg)
- [Mobile](/home/eryrizal/.codex/visualizations/2026/10/06/01a111d9-0532-7313-9d7f-7d88400eceab/dashboard-qris-mobile.jpg)

## Design read dan alasan

Dashboard operasional untuk admin gateway, mengikuti tema gelap dan aksen biru
yang sudah ada. ENERGY 1 / RHYTHM 2 / MOTION 1.

- Warna: aksen biru untuk create; hijau/kuning/merah mempunyai arti status.
- Layout: form dan hasil bersebelahan saat cukup lebar, bertumpuk untuk mobile.
- Tipografi: Plus Jakarta Sans mengikuti aplikasi; nominal besar membantu kasir.
- Spacing: panel berjarak dari statistik agar pembuatan pembayaran menjadi fokus.
- Container: batas panel memisahkan input/hasil dari monitoring, tanpa dekorasi.
- QR: satu-satunya gambar baru adalah hasil pembayaran yang memang diminta.
- Motion: fokus/hover dan feedback loading, tanpa animasi dekoratif.

## Delivery Gate antislop

Gate berlaku pada penambahan fitur dan bagian dashboard yang diubah; bukan audit
keamanan/identitas seluruh gateway. Bukti perilaku popup dibatasi seperti di atas.

| Item | Status dan bukti |
| --- | --- |
| R-02 | PASS: copy baru tidak memakai em dash |
| R-03 | PASS: empat ukuran layar, overflow halaman tidak ada, target tombol 44 px |
| R-17 | PASS: angka berasal dari query SQLite, termasuk data fixture yang dilabeli dalam laporan |
| R-18 | PASS: tidak ada testimonial |
| R-23 | PASS: mempertahankan brand; panel/QR diminta eksplisit oleh rencana pengguna |
| R-24 | PASS: tab, refresh, checkout, dan logout memiliki tujuan yang tersedia |
| R-25 | PASS: computed contrast memenuhi ambang AA pada teks dashboard |
| R-26 | PASS: form, copy, filter, refresh, logout diuji; href checkout dan halaman tujuan diperiksa |
| R-27 | PASS: empty, loading, invalid form, config error, image error, polling error tersedia |
| R-28 | PASS: tidak ada FAQ |
| R-32 | PASS: label input, Tab/Enter, outline fokus, live status, tabel scroll fokusable |
| R-33 | PASS: fitur ditulis langsung melalui perubahan source, tanpa script pengganti CSS/source |
| R-34 | PASS: menggunakan tema aplikasi; tidak menambahkan toggle tema |
| R-35 | PASS: app lokal dijalankan, interaksi dan tujuan tercatat, screenshot serta log diperiksa |
| R-36 | PASS: tidak ada klaim keamanan, settlement, performa, atau produksi |
| R-37 | PASS: arah mengikuti dashboard dan pilihan antislop pengguna; dials dinyatakan |
| R-38 | PASS: status/nominal riil dari database; contoh pengujian dinyatakan sebagai fixture |
| R-01 | PASS: tidak ada gradient/glow baru; biru memberi prioritas tombol create |
| R-04 | PASS: tidak menambahkan icon set atau glyph dekoratif |
| R-06 | PASS: font aplikasi untuk konsistensi; ukuran nominal untuk keterbacaan pembayaran |
| R-07 | PASS: tidak ada pola background |
| R-08 | PASS: CTA baru memakai label aksi tanpa panah dekoratif |
| R-09 | PASS: badge menyatakan status transaksi nyata |
| R-10 | PASS: tidak ada backdrop blur |
| R-12 | PASS: panel tidak diberi shadow baru |
| R-13 | PASS: tidak ada glow |
| R-14 | PASS: form/QR punya komposisi khusus; kartu statistik seragam untuk perbandingan metrik |
| R-19 | PASS: hanya feedback/fokus/hover, sesuai MOTION 1 |
| R-22 | PASS: tidak ada ilustrasi |
| Liveliness: dials | PASS: ENERGY 1 / RHYTHM 2 / MOTION 1 dinyatakan |
| Liveliness: consistency | PASS: panel form/QR berbeda dari statistik dan tabel, gerak terbatas |
| Liveliness: focal point | PASS: nominal input dan tombol Buat QRIS pada panel utama |
| Liveliness: whitespace | PASS: jarak panel/statistik dan pemisah form/hasil tampak pada screenshot |
| Liveliness: accent | PASS: biru untuk create; warna lain menyatakan status |
| Liveliness: identity | PASS: QR, nominal rupiah, TRX, dan countdown mengikuti tugas kasir gateway |
| Liveliness: design read | PASS: arah dinyatakan sebelum penulisan UI |
| C-1 | PASS: warna/layout/font/spacing/container/QR mempunyai alasan tertulis |
| C-2 | PASS: kontrol baru memiliki submit, copy, atau href checkout yang berfungsi |
| C-3 | PASS: panel melayani pembuatan QRIS, tanpa bagian pengisi |
| C-4 | PASS: input/error/loading/status, mobile, jaringan, serta keyboard diperiksa |
| C-5 | PASS: tidak ada klaim/statistik/testimonial buatan |
| R-05 | PASS: form + QR + monitoring mengikuti kebutuhan gateway |
| R-11 | PASS: panel 14 px, kontrol 8 px, badge sesuai status |
| R-15 | PASS: Buat QRIS, Salin tautan, Buka pembayaran adalah aksi spesifik |
| R-16 | PASS: tidak ada buzzword pemasaran |
| R-20 | PASS: komposisi dibangun di sekitar QR, nominal, dan status gateway |
| R-21 | PASS: tema gelap mengikuti dashboard yang disetujui pengguna |
| R-29 | PASS: netral + biru, dengan hijau/kuning/merah untuk status pembayaran |
| R-30 | PASS: mengikuti aplikasi ini, tanpa meniru produk lain |
| R-31 | PASS: alasan keputusan utama dicatat di bagian Design read |
