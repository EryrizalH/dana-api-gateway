# DANA Gateway SDK

Client ESM JavaScript dengan deklarasi TypeScript untuk gateway dalam repository
ini. Paket ini belum diterbitkan ke npm dan bukan SDK API resmi DANA.
Tidak ada dependency runtime. Gunakan Node 22.13+ atau runtime server dengan
`fetch`, `AbortController`, `Request`, dan Web Crypto.

## Instalasi

Dari proyek konsumen:

```sh
npm install /path/ke/dana-api-gateway/sdk/javascript
```

Untuk distribusi internal, jalankan `npm pack` di folder ini lalu instal file
`.tgz` yang dihasilkan. Jangan menjalankan `npm install dana-gateway-sdk` dari
registry dengan asumsi itu paket ini.

```js
import { DanaGatewayClient, GatewayError } from 'dana-gateway-sdk';

const gateway = new DanaGatewayClient({
    baseUrl: process.env.DANA_GATEWAY_URL,
    apiKey: process.env.DANA_GATEWAY_API_KEY,
    timeoutMs: 20000,
});

const qr = await gateway.createQris({
    amount: 25000,
    referenceId: 'ORDER-123',
});
// Simpan qris_id, trx_id, amount, reference_id, expires_at sebelum menampilkan QR.
console.log(qr.qris_url);

const payment = await gateway.checkPayment(qr.trx_id);
console.log(payment.status); // PENDING | PAID | EXPIRED
```

API key digunakan di backend. Untuk polling frontend buat client tanpa `apiKey`
dan panggil `getStatus(id)` atau `getQris(id)`; akses tersebut bersifat publik.

## Metode

| Metode | Hasil |
| --- | --- |
| `health()` | `{status: 'OK', service, timestamp}` |
| `createQris({amount, referenceId?, qrisStatic?})` | Data QR baru, URL kasir, kode QR dan expiry |
| `getStatus(qrisIdAtauTrxId)` | Status publik, `paid`, `paid_at`, `expires_at` |
| `getQris(qrisIdAtauTrxId)` | Detail publik termasuk `qris_code` |
| `checkPayment(qrisIdAtauTrxId)` | Status terautentikasi; tanpa `expires_at` |
| `notifyPayment({amount?, text?})` | Envelope dengan `matched` dan `data.callback` bila cocok |
| `parsePaymentCallback(request, secret)` | Payload callback tervalidasi; tidak menyimpan/deduplikasi event |

Semua metode client menerima argumen terakhir `{signal?: AbortSignal}`. Default
timeout 20 detik, mencakup pembacaan response. Sesuaikan bila reverse proxy memakai
timeout lebih pendek. Gateway dapat menunggu sekitar 15,2 detik untuk callback
notifikasi. Inject `fetch` lewat constructor untuk test/adaptor runtime.

Input SDK memakai camelCase; hasil mempertahankan snake_case gateway. `getStatus`
menghapus `success`; metode create/check/detail membuka `data`. Notifikasi
mempertahankan envelope agar `matched:false` tidak dianggap pembayaran berhasil.

SDK menolak nominal yang bukan **number integer positif dan safe**. SDK tidak
memverifikasi isi template QRIS, makna teks notifikasi, atau settlement provider.
`notifyPayment` hanya untuk bridge Android yang sudah memfilter notifikasi
pembayaran masuk sukses; pemanggilan metode ini dapat melunasi transaksi.

## Error dan retry

`GatewayError` memiliki `code`; `status` tersedia untuk `HTTP_ERROR` dan sebagian
`INVALID_RESPONSE`, sehingga field tersebut opsional. Kode:
`HTTP_ERROR`, `INVALID_RESPONSE`, `NETWORK_ERROR`, `TIMEOUT`, `ABORTED`.
Pesan tidak menyertakan API key, payload, URL request, atau error body server.
Error validasi input berupa `TypeError`. HTTP 404 status adalah error; transaksi
expired yang ditemukan tetap sukses dengan `status:'EXPIRED'`.

Tidak ada retry otomatis. Create dan notifikasi belum idempoten. Timeout atau
koneksi putus tidak membuktikan request gagal diproses. Jangan otomatis create
ulang atau kirim ulang notifikasi. Rekonsiliasi memakai ID yang telah tersimpan;
jika respons create hilang sebelum ID diterima, gateway belum menyediakan lookup
reference yang unik untuk memastikan hasilnya.

## Callback

```js
import { parsePaymentCallback, CallbackValidationError } from 'dana-gateway-sdk';

// request adalah Web Request, misalnya dalam handler server berbasis fetch.
async function handleCallback(request, secret, applyPayment) {
    let event;
    try {
        event = await parsePaymentCallback(request, secret);
    } catch (error) {
        if (error instanceof CallbackValidationError) {
            return new Response(error.message, { status: error.status });
        }
        throw error;
    }
    // applyPayment harus melakukan validasi order dan perubahan atomik/idempoten
    // di penyimpanan persisten konsumen. Error storage harus menghasilkan 5xx.
    await applyPayment(event);
    return new Response(null, { status: 204 });
}
```

Helper memeriksa `x-webhook-secret`, method POST, JSON, pasangan event/status,
ID/reference, nominal dan timestamp. Ini shared secret, tanpa signature HMAC,
event ID, perlindungan replay, atau jaminan settlement. Konsumen harus mencocokkan
reference **dan** kedua ID serta amount dengan transaksi lokal. Deduplikasi
persisten dapat memakai `(trx_id,event)` dengan namespace gateway bila lebih
dari satu gateway. Balas 2xx setelah commit persisten, dan jangan mengubah order
PAID menjadi EXPIRED karena event terlambat.

Panduan endpoint, payload, rekonsiliasi, PHP/Python, serta batas audit:
[docs/integration.md](../../docs/integration.md) pada checkout gateway. Tarball
SDK hanya membawa README ini, source client, deklarasi tipe, dan lisensi.
