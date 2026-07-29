/**
 * DANA Business — CLI Login OTP (1x setup)
 *
 * Flow:
 *  1. Input nomor HP merchant DANA Business
 *  2. Request OTP (SMS/WA)
 *  3. Input kode OTP
 *  4. Simpan sesi ke .DANA_SESI_JANGAN_DIHAPUS.json
 *
 * Alternatif (jika OTP endpoint berubah):
 *  node login.js --import
 *  → paste access_token / refresh_token / cookie manual
 */

const readline = require('readline');
const axios = require('axios');
const crypto = require('crypto');
const sessionManager = require('./sessionManager');
require('dotenv').config();

const API_BASE = (process.env.DANA_API_BASE || sessionManager.DEFAULT_API_BASE).replace(/\/$/, '');
const OTP_REQUEST_PATH = process.env.DANA_OTP_REQUEST_PATH || '/v1/oauth/otp/send';
const OTP_VERIFY_PATH = process.env.DANA_OTP_VERIFY_PATH || '/v1/oauth/otp/verify';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, (a) => resolve(String(a).trim())));

function normalizePhone(raw) {
    let p = raw.replace(/[\s\-]/g, '');
    if (p.startsWith('+62')) p = '0' + p.slice(3);
    if (p.startsWith('62') && p.length > 10) p = '0' + p.slice(2);
    if (!/^08\d{8,12}$/.test(p)) {
        throw new Error('Format nomor HP tidak valid. Contoh: 081234567890');
    }
    return p;
}

function toMsisdn62(phone08) {
    return '62' + phone08.slice(1);
}

function deviceId() {
    return crypto.randomBytes(16).toString('hex');
}

async function requestOtp(phone, device) {
    const url = `${API_BASE}${OTP_REQUEST_PATH}`;
    const body = {
        phoneNumber: toMsisdn62(phone),
        phone: phone,
        channel: 'SMS',
        deviceId: device,
        clientId: process.env.DANA_CLIENT_ID || 'dana-business-web'
    };

    const res = await axios.post(url, body, {
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent':
                'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
            'X-Country-Code': 'ID'
        },
        timeout: 20000,
        validateStatus: () => true
    });

    if (res.status >= 400) {
        throw new Error(
            `Request OTP gagal HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}\n` +
                `Cek DANA_API_BASE / DANA_OTP_REQUEST_PATH, atau pakai: node login.js --import`
        );
    }

    const data = res.data?.data || res.data || {};
    return {
        otp_token: data.otpToken || data.otp_token || data.requestId || data.request_id || null,
        raw: data
    };
}

async function verifyOtp(phone, otp, otpToken, device) {
    const url = `${API_BASE}${OTP_VERIFY_PATH}`;
    const body = {
        phoneNumber: toMsisdn62(phone),
        phone: phone,
        otp: otp,
        otpToken: otpToken,
        otp_token: otpToken,
        deviceId: device,
        clientId: process.env.DANA_CLIENT_ID || 'dana-business-web'
    };

    const res = await axios.post(url, body, {
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent':
                'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
            'X-Country-Code': 'ID'
        },
        timeout: 20000,
        validateStatus: () => true
    });

    if (res.status >= 400) {
        throw new Error(
            `Verifikasi OTP gagal HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`
        );
    }

    const data = res.data?.data || res.data || {};
    const setCookie = res.headers['set-cookie'];
    const cookie = Array.isArray(setCookie)
        ? setCookie.map((c) => c.split(';')[0]).join('; ')
        : null;

    return {
        access_token: data.accessToken || data.access_token || data.token || null,
        refresh_token: data.refreshToken || data.refresh_token || null,
        merchant_id:
            data.merchantId ||
            data.merchant_id ||
            data.shopId ||
            process.env.DANA_MERCHANT_ID ||
            null,
        merchant_name: data.merchantName || data.merchant_name || data.shopName || null,
        expires_in: data.expiresIn || data.expires_in || 6 * 60 * 60,
        cookie: cookie || data.cookie || null,
        raw: data
    };
}

async function importManual() {
    console.log('\n=== Import Sesi Manual DANA Business ===');
    console.log('Ambil token/cookie dari browser DevTools (business.dana.id) atau app.\n');

    const access = await ask('access_token (boleh kosong jika pakai cookie): ');
    const refresh = await ask('refresh_token (opsional): ');
    const cookie = await ask('cookie header (opsional): ');
    const merchantId =
        (await ask(`merchant_id [${process.env.DANA_MERCHANT_ID || ''}]: `)) ||
        process.env.DANA_MERCHANT_ID ||
        '';
    const merchantName = await ask('merchant_name (opsional): ');
    const phone = await ask('phone_number (opsional, 08...): ');

    if (!access && !cookie) {
        throw new Error('Minimal isi access_token ATAU cookie.');
    }

    const expiresHours = 24;
    const session = sessionManager.saveSession({
        access_token: access || null,
        refresh_token: refresh || null,
        cookie: cookie || null,
        merchant_id: merchantId || null,
        merchant_name: merchantName || null,
        phone_number: phone || null,
        device_id: deviceId(),
        expires_at: new Date(Date.now() + expiresHours * 3600 * 1000).toISOString(),
        login_method: 'manual_import'
    });

    console.log('\n[OK] Sesi disimpan ke', sessionManager.SESSION_FILE);
    console.log(JSON.stringify({ merchant_id: session.merchant_id, expires_at: session.expires_at }, null, 2));
}

async function loginOtp() {
    console.log('\n==========================================================');
    console.log('   DANA Business Merchant Gateway — Login OTP Terminal');
    console.log('==========================================================\n');
    console.log(`API Base : ${API_BASE}`);
    console.log(`OTP Send : ${OTP_REQUEST_PATH}`);
    console.log(`OTP Verify: ${OTP_VERIFY_PATH}\n`);

    const phoneRaw = await ask('Nomor HP DANA Business (contoh 081234567890): ');
    const phone = normalizePhone(phoneRaw);
    const device = deviceId();

    console.log('\n[INFO] Mengirim OTP...');
    const otpReq = await requestOtp(phone, device);
    console.log('[OK] OTP dikirim. Cek SMS/WA.');
    if (otpReq.otp_token) console.log('[INFO] otp_token diterima.');

    const otp = await ask('Masukkan kode OTP: ');
    if (!/^\d{4,8}$/.test(otp)) {
        throw new Error('OTP harus 4–8 digit angka.');
    }

    console.log('\n[INFO] Memverifikasi OTP...');
    const verified = await verifyOtp(phone, otp, otpReq.otp_token, device);

    if (!verified.access_token && !verified.cookie) {
        console.error('[WARN] Respons tidak berisi access_token/cookie yang dikenali.');
        console.error('Raw keys:', Object.keys(verified.raw || {}));
        console.error('Coba mode import: node login.js --import');
        throw new Error('Login gagal: token tidak ditemukan di respons.');
    }

    const session = sessionManager.saveSession({
        access_token: verified.access_token,
        refresh_token: verified.refresh_token,
        cookie: verified.cookie,
        merchant_id: verified.merchant_id,
        merchant_name: verified.merchant_name,
        phone_number: phone,
        device_id: device,
        expires_at: new Date(Date.now() + Number(verified.expires_in) * 1000).toISOString(),
        login_method: 'otp',
        otp_meta: { requested_at: new Date().toISOString() }
    });

    console.log('\n[OK] Login berhasil!');
    console.log('File sesi :', sessionManager.SESSION_FILE);
    console.log('Merchant  :', session.merchant_name || session.merchant_id || '-');
    console.log('Expires   :', session.expires_at);
    console.log('\nJalankan server: npm start\n');
}

async function main() {
    try {
        const args = process.argv.slice(2);
        if (args.includes('--import') || args.includes('-i')) {
            await importManual();
        } else if (args.includes('--verify')) {
            const result = await sessionManager.verifySession();
            console.log(result);
        } else {
            await loginOtp();
        }
    } catch (err) {
        console.error('\n[ERROR]', err.message);
        process.exitCode = 1;
    } finally {
        rl.close();
    }
}

main();
