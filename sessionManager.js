/**
 * DANA Business Session Manager
 * - Load / save sesi ke .DANA_SESI_JANGAN_DIHAPUS.json
 * - Auto-refresh access token
 * - Bangun header request ke API DANA Business
 *
 * ponytail: endpoint DANA Business non-resmi bisa berubah; override via DANA_API_BASE
 *           atau update path di constants di bawah.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SESSION_FILE = path.join(__dirname, '.DANA_SESI_JANGAN_DIHAPUS.json');
const DEFAULT_API_BASE = process.env.DANA_API_BASE || 'https://api.saas.dana.id';
const REFRESH_PATH = process.env.DANA_REFRESH_PATH || '/v1/oauth/token/refresh';
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000; // refresh 5 menit sebelum exp

const DEFAULT_UA =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function loadSession() {
    try {
        if (!fs.existsSync(SESSION_FILE)) return null;
        const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (!data || (!data.access_token && !data.cookie)) return null;
        return data;
    } catch (err) {
        console.error('[DANA-SESSION] Gagal load sesi:', err.message);
        return null;
    }
}

function saveSession(session) {
    const payload = {
        ...session,
        updated_at: new Date().toISOString()
    };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    return payload;
}

function isExpired(session) {
    if (!session) return true;
    if (!session.expires_at) return false; // unknown → treat as still valid, let 401 handle
    const exp = new Date(session.expires_at).getTime();
    return Date.now() >= exp - TOKEN_EXPIRY_SKEW_MS;
}

function buildHeaders(session, userAgent) {
    if (!session) return null;

    const headers = {
        'User-Agent': userAgent || session.user_agent || DEFAULT_UA,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Country-Code': 'ID',
        'X-Locale': 'id_ID',
        'X-Client-Id': session.client_id || 'dana-business-web'
    };

    if (session.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
    }
    if (session.cookie) {
        headers.Cookie = session.cookie;
    }
    if (session.merchant_id) {
        headers['X-Merchant-Id'] = session.merchant_id;
    }
    if (session.device_id) {
        headers['X-Device-Id'] = session.device_id;
    }

    return headers;
}

async function getValidHeaders(userAgent) {
    let session = loadSession();
    if (!session) return null;

    if (isExpired(session) && session.refresh_token) {
        try {
            session = await refreshSession();
        } catch (err) {
            console.error('[DANA-SESSION] Auto-refresh gagal:', err.message);
        }
    }

    return buildHeaders(session, userAgent);
}

async function refreshSession() {
    const session = loadSession();
    if (!session || !session.refresh_token) {
        throw new Error('Tidak ada refresh_token. Jalankan `node login.js` ulang.');
    }

    const base = process.env.DANA_API_BASE || DEFAULT_API_BASE;
    const url = `${base.replace(/\/$/, '')}${REFRESH_PATH}`;

    try {
        const res = await axios.post(
            url,
            {
                grantType: 'REFRESH_TOKEN',
                refreshToken: session.refresh_token
            },
            {
                headers: {
                    'User-Agent': session.user_agent || DEFAULT_UA,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    ...(session.access_token
                        ? { Authorization: `Bearer ${session.access_token}` }
                        : {}),
                    ...(session.cookie ? { Cookie: session.cookie } : {})
                },
                timeout: 15000,
                validateStatus: () => true
            }
        );

        if (res.status >= 400) {
            // Fallback: beberapa deployment DANA hanya pakai cookie jangka panjang
            if (session.cookie || session.access_token) {
                console.warn(
                    '[DANA-SESSION] Refresh endpoint menolak (HTTP ' +
                        res.status +
                        '). Memakai token/cookie yang ada.'
                );
                return session;
            }
            throw new Error(
                `Refresh gagal HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`
            );
        }

        const body = res.data?.data || res.data || {};
        const access =
            body.accessToken || body.access_token || body.token || session.access_token;
        const refresh =
            body.refreshToken || body.refresh_token || session.refresh_token;
        const expiresIn = body.expiresIn || body.expires_in || 6 * 60 * 60;
        const cookieFromSet = parseSetCookie(res.headers['set-cookie']);

        const updated = saveSession({
            ...session,
            access_token: access,
            refresh_token: refresh,
            cookie: cookieFromSet || session.cookie,
            expires_at: new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
        });

        console.log('[DANA-SESSION] Token berhasil di-refresh.');
        return updated;
    } catch (err) {
        if (err.response) {
            throw new Error(
                `Refresh gagal HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}`
            );
        }
        throw err;
    }
}

function parseSetCookie(setCookie) {
    if (!setCookie) return null;
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    const pairs = arr.map((c) => c.split(';')[0].trim()).filter(Boolean);
    return pairs.length ? pairs.join('; ') : null;
}

/**
 * Verifikasi sesi dengan hit endpoint ringan (transactions size=1).
 * Return merchant name / status jika OK.
 */
async function verifySession(userAgent) {
    const headers = await getValidHeaders(userAgent);
    if (!headers) {
        return { ok: false, message: 'Sesi belum ada. Jalankan `node login.js`.' };
    }

    const base = process.env.DANA_API_BASE || DEFAULT_API_BASE;
    const merchantId =
        process.env.DANA_MERCHANT_ID || loadSession()?.merchant_id || '';
    const txPath =
        process.env.DANA_TX_PATH || '/v1/merchant/transactions';

    try {
        const now = new Date();
        const from = new Date(now.getTime() - 3600 * 1000).toISOString();
        const res = await axios.get(`${base.replace(/\/$/, '')}${txPath}`, {
            headers,
            params: {
                merchantId,
                pageSize: 1,
                startTime: from,
                endTime: now.toISOString(),
                status: 'SUCCESS,SETTLED'
            },
            timeout: 8000,
            validateStatus: () => true
        });

        if (res.status === 401 || res.status === 403) {
            return { ok: false, message: `Sesi invalid (HTTP ${res.status})` };
        }
        if (res.status >= 400) {
            // Beberapa endpoint beda path — sesi token masih bisa valid
            return {
                ok: true,
                message: `Token terpasang (probe HTTP ${res.status}). Cek DANA_TX_PATH jika mutasi kosong.`,
                merchant: loadSession()?.merchant_name || merchantId || null
            };
        }

        const merchantName =
            res.data?.merchantName ||
            res.data?.data?.merchantName ||
            loadSession()?.merchant_name ||
            merchantId ||
            'DANA Merchant';

        return { ok: true, message: 'Token dan Sesi DANA Merchant Aktif', merchant: merchantName };
    } catch (err) {
        return { ok: false, message: err.message };
    }
}

module.exports = {
    SESSION_FILE,
    DEFAULT_API_BASE,
    loadSession,
    saveSession,
    isExpired,
    buildHeaders,
    getValidHeaders,
    refreshSession,
    verifySession
};
