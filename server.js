const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const sessionManager = require('./sessionManager');

const PORT = process.env.PORT || 3000;
const MAX_LOGS = 100;
const CLAIMED_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const QRIS_EXPIRY_MS = 5 * 60 * 1000;
const DANA_API_BASE = (process.env.DANA_API_BASE || sessionManager.DEFAULT_API_BASE).replace(
    /\/$/,
    ''
);
const DANA_TX_PATH = process.env.DANA_TX_PATH || '/v1/merchant/transactions';
const DANA_TRANSACTIONS_URL = `${DANA_API_BASE}${DANA_TX_PATH}`;

// claimedTransactions: Map<txId, { qrisId, claimedAt }>
const claimedTransactions = new Map();
const activityLogs = [];
const qrisStore = new Map();

function logActivity(type, message, details = null) {
    const timestamp = new Date().toISOString();
    const logObj = { id: Date.now(), timestamp, type, message, details };
    activityLogs.unshift(logObj);
    if (activityLogs.length > MAX_LOGS) activityLogs.pop();
    console.log(`[${timestamp}] [${type}] ${message}`);
}

function cleanExpiredTransactions() {
    const now = Date.now();
    for (const [txId, claim] of claimedTransactions.entries()) {
        const claimedAt = typeof claim === 'object' ? claim.claimedAt : claim;
        if (now - claimedAt > CLAIMED_CLEANUP_INTERVAL_MS) {
            claimedTransactions.delete(txId);
        }
    }
}
async function autoRefreshSessionPeriodically() {
    try {
        const session = sessionManager.loadSession();
        if (session && session.refresh_token) {
            if (sessionManager.isExpired(session)) {
                logActivity('INFO', 'Auto Refresh: Token mendekati kedaluwarsa, memperbarui sesi...');
                await sessionManager.refreshSession();
            }
        }
    } catch (err) {
        logActivity('ERROR', `Gagal auto refresh session: ${err.message}`);
    }
}

function startBackgroundJobs() {
    setInterval(cleanExpiredTransactions, 60 * 60 * 1000);
    setInterval(autoRefreshSessionPeriodically, 6 * 60 * 60 * 1000);
}

// CRC16 EMVCo
function calculateCRC16(payload) {
    let crc = 0xffff;
    for (let i = 0; i < payload.length; i++) {
        crc ^= payload.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ 0x1021) & 0xffff;
            } else {
                crc = (crc << 1) & 0xffff;
            }
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

function generateDynamicQRIS(staticTemplate, amount) {
    if (!staticTemplate) return null;
    let payload = staticTemplate.trim();

    const idx63 = payload.indexOf('6304');
    if (idx63 !== -1) payload = payload.substring(0, idx63);

    const tags = [];
    let i = 0;
    try {
        while (i < payload.length) {
            const tag = payload.substring(i, i + 2);
            const length = parseInt(payload.substring(i + 2, i + 4), 10);
            if (isNaN(length)) break;
            const val = payload.substring(i + 4, i + 4 + length);
            tags.push({ tag, val });
            i += 4 + length;
        }
    } catch {
        return null;
    }

    const amountStr = parseInt(amount, 10).toString();
    const newTags = [];
    let hasTag54 = false;

    for (const item of tags) {
        if (item.tag === '01') {
            newTags.push({ tag: '01', val: '12' });
        } else if (item.tag === '54') {
            newTags.push({ tag: '54', val: amountStr });
            hasTag54 = true;
        } else if (item.tag === '58' && !hasTag54) {
            newTags.push({ tag: '54', val: amountStr });
            hasTag54 = true;
            newTags.push(item);
        } else {
            newTags.push(item);
        }
    }
    if (!hasTag54) newTags.push({ tag: '54', val: amountStr });

    let result = '';
    for (const item of newTags) {
        result += `${item.tag}${item.val.length.toString().padStart(2, '0')}${item.val}`;
    }
    result += '6304';
    return result + calculateCRC16(result);
}

const apiKeyAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key || req.query.apikey;
    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res
            .status(401)
            .json({ success: false, message: 'Autentikasi Gagal: API Key tidak valid' });
    }
    next();
};

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('DANA Business Partner API Gateway Berjalan');
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'DANA Business Partner API Gateway', timestamp: new Date() });
});

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Layanan API DANA Berfungsi Normal',
        timestamp: new Date()
    });
});

// Cek Status Sesi Token
app.get('/token-status', apiKeyAuth, async (req, res) => {
    const result = await sessionManager.verifySession(req.headers['user-agent']);
    if (!result.ok) {
        return res.json({
            success: false,
            data: {
                token_status: 'invalid',
                message: result.message || 'Sesi belum dikonfigurasi. Jalankan `node login.js`.'
            }
        });
    }
    res.json({
        success: true,
        data: {
            token_status: 'valid',
            message: result.message || 'Token dan Sesi DANA Merchant Aktif',
            merchant: result.merchant || null
        }
    });
});

// Buat QRIS Dinamis
app.all('/create-qris', apiKeyAuth, (req, res) => {
    const amount = req.body?.amount || req.query?.amount;
    if (!amount || isNaN(amount) || amount <= 0) {
        return res
            .status(400)
            .json({ success: false, message: 'Nominal pembayaran tidak valid (gunakan ?amount=...)' });
    }

    const staticTemplate = process.env.QRIS_STATIC;
    if (!staticTemplate) {
        return res
            .status(500)
            .json({ success: false, message: 'QRIS_STATIC belum dikonfigurasi di .env' });
    }

    const dynamicCode = generateDynamicQRIS(staticTemplate, amount);
    if (!dynamicCode) {
        return res.status(500).json({ success: false, message: 'Gagal generate QRIS dinamis' });
    }

    const qrisId = Math.random().toString(36).substring(2, 10);
    const trxId = 'TRX-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const expiresAt = new Date(Date.now() + QRIS_EXPIRY_MS);
    const createdAt = new Date();

    qrisStore.set(qrisId, {
        data: dynamicCode,
        amount: parseInt(amount, 10),
        trxId,
        expiresAt,
        createdAt,
        status: 'PENDING'
    });

    const publicUrl = `${req.protocol}://${req.get('host')}/qr/${qrisId}`;
    logActivity('INFO', `QRIS Dinamis dibuat | TRX-ID: ${trxId} | Nominal: Rp ${amount}`);

    res.json({
        success: true,
        data: {
            qris_id: qrisId,
            trx_id: trxId,
            qris_url: publicUrl,
            qris_code: dynamicCode,
            amount: parseInt(amount, 10),
            expires_at: expiresAt.toISOString(),
            expires_in: '5 menit'
        }
    });
});

// Halaman HTML QRIS Interaktif
app.get('/qr/:id', (req, res) => {
    const qris = qrisStore.get(req.params.id);
    if (!qris) {
        return res.status(404).send('<h3>Gambar QRIS tidak ditemukan atau telah dihapus</h3>');
    }

    if (req.query.format === 'raw' || req.query.raw === '1') {
        if (Date.now() > qris.expiresAt.getTime()) {
            qrisStore.delete(req.params.id);
            return res.status(410).send('QRIS Kedaluwarsa');
        }
        const qrServerUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qris.data)}`;
        return res.redirect(302, qrServerUrl);
    }

    const formattedAmount = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(qris.amount);
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qris.data)}`;
    const expiresTimestamp = qris.expiresAt.getTime();

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pembayaran QRIS - ${formattedAmount}</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
        body { background: #0b1220; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
        .card { background: #111827; border: 1px solid #1f2937; border-radius: 20px; width: 100%; max-width: 420px; padding: 28px 24px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); text-align: center; }
        .badge-qris { display: inline-flex; align-items: center; gap: 6px; background: rgba(0, 133, 202, 0.15); color: #38bdf8; font-weight: 600; font-size: 13px; padding: 6px 14px; border-radius: 20px; border: 1px solid rgba(56, 189, 248, 0.3); margin-bottom: 16px; }
        .amount-title { font-size: 14px; color: #94a3b8; margin-bottom: 4px; }
        .amount-value { font-size: 28px; font-weight: 700; color: #38bdf8; letter-spacing: -0.5px; margin-bottom: 20px; }
        .qr-wrapper { background: #ffffff; padding: 16px; border-radius: 16px; display: inline-block; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); margin-bottom: 20px; }
        .qr-wrapper img { display: block; width: 240px; height: 240px; border-radius: 8px; }
        .timer-box { font-size: 14px; color: #cbd5e1; background: #0b1220; padding: 10px 16px; border-radius: 12px; border: 1px solid #1f2937; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
        .timer-val { font-weight: 700; color: #f59e0b; font-family: monospace; font-size: 16px; }
        .status-badge { display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; font-size: 14px; padding: 12px; border-radius: 12px; margin-bottom: 20px; }
        .status-pending { background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }
        .status-paid { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
        .status-expired { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
        .btn-check { width: 100%; background: #0284c7; color: #fff; border: none; font-weight: 600; font-size: 15px; padding: 14px; border-radius: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .btn-check:hover { background: #0369a1; }
        .btn-check:disabled { background: #475569; cursor: not-allowed; opacity: 0.7; }
        .toggle-box { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 13px; color: #94a3b8; margin-top: 16px; }
        .toggle-box input[type="checkbox"] { width: 16px; height: 16px; accent-color: #0284c7; cursor: pointer; }
        .spinner { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; display: none; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .success-box { display: none; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 12px; padding: 16px; text-align: left; font-size: 13px; color: #cbd5e1; margin-top: 16px; }
        .success-box strong { color: #4ade80; display: block; font-size: 15px; margin-bottom: 6px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="badge-qris">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            DANA / QRIS Dinamis
        </div>
        <div class="amount-title">Total Pembayaran</div>
        <div class="amount-value">${formattedAmount}</div>
        <div class="qr-wrapper"><img src="${qrImageUrl}" alt="QRIS Code"></div>
        <div class="timer-box">
            <span>Batas Waktu Pembayaran</span>
            <span class="timer-val" id="timer-text">05:00</span>
        </div>
        <div class="status-badge status-pending" id="status-badge">
            <span id="status-icon">🟡</span>
            <span id="status-text">Menunggu Pembayaran</span>
        </div>
        <button class="btn-check" id="btn-check" onclick="checkStatusManual()">
            <span class="spinner" id="btn-spinner"></span>
            <span id="btn-label">🔄 Cek Status Pembayaran</span>
        </button>
        <div class="toggle-box">
            <input type="checkbox" id="chk-auto" onchange="handleAutoPollChange(this)">
            <label for="chk-auto">Cek otomatis setiap 8 detik (Opsional)</label>
        </div>
        <div class="success-box" id="success-details">
            <strong>✅ Pembayaran Berhasil!</strong>
            <p>Order ID: <span id="tx-order"></span></p>
            <p>Sumber: <span id="tx-issuer"></span></p>
            <p>Waktu: <span id="tx-time"></span></p>
        </div>
    </div>
    <script>
        const qrisId = "${req.params.id}";
        const expiresTimestamp = ${expiresTimestamp};
        let isChecking = false, isPaid = false, isExpired = false, pollTimer = null;

        function updateCountdown() {
            if (isPaid) return;
            const diff = expiresTimestamp - Date.now();
            if (diff <= 0) {
                isExpired = true;
                document.getElementById('timer-text').innerText = "00:00";
                document.getElementById('status-badge').className = "status-badge status-expired";
                document.getElementById('status-icon').innerText = "🔴";
                document.getElementById('status-text').innerText = "QRIS Kedaluwarsa";
                document.getElementById('btn-check').disabled = true;
                document.getElementById('chk-auto').disabled = true;
                clearInterval(countdownInterval);
                stopAutoPoll();
                return;
            }
            const m = Math.floor(diff / 60000), s = Math.floor((diff % 60000) / 1000);
            document.getElementById('timer-text').innerText = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
        }
        const countdownInterval = setInterval(updateCountdown, 1000);
        updateCountdown();

        async function checkStatusManual() {
            if (isChecking || isPaid || isExpired) return;
            isChecking = true;
            const btn = document.getElementById('btn-check');
            const spinner = document.getElementById('btn-spinner');
            const label = document.getElementById('btn-label');
            btn.disabled = true; spinner.style.display = 'inline-block'; label.innerText = 'Memeriksa...';
            try {
                const res = await fetch('/api/qr-status/' + qrisId);
                const data = await res.json();
                if (data.success && data.paid) onPaymentSuccess(data.transaction);
                else if (data.status === 'EXPIRED') { isExpired = true; updateCountdown(); }
                else {
                    document.getElementById('status-text').innerText = "Belum Dibayar (Dicoba lagi...)";
                    setTimeout(() => { if (!isPaid && !isExpired) document.getElementById('status-text').innerText = "Menunggu Pembayaran"; }, 2000);
                }
            } catch (e) { console.error(e); }
            finally {
                isChecking = false;
                if (!isPaid && !isExpired) btn.disabled = false;
                spinner.style.display = 'none'; label.innerText = '🔄 Cek Status Pembayaran';
            }
        }

        function onPaymentSuccess(tx) {
            isPaid = true; stopAutoPoll(); clearInterval(countdownInterval);
            document.getElementById('status-badge').className = "status-badge status-paid";
            document.getElementById('status-icon').innerText = "🟢";
            document.getElementById('status-text').innerText = "Pembayaran Berhasil / Lunas";
            document.getElementById('btn-check').style.display = 'none';
            if (tx) {
                document.getElementById('tx-order').innerText = tx.order_id || tx.transaction_id || '-';
                document.getElementById('tx-issuer').innerText = tx.payer_issuer || 'DANA / Bank';
                document.getElementById('tx-time').innerText = tx.transaction_time ? new Date(tx.transaction_time).toLocaleString('id-ID') : '-';
                document.getElementById('success-details').style.display = 'block';
            }
        }

        function startAutoPoll() {
            stopAutoPoll();
            pollTimer = setInterval(() => { if (!isChecking && !isPaid && !isExpired) checkStatusManual(); }, 8000);
        }
        function stopAutoPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
        function handleAutoPollChange(chk) { chk.checked ? startAutoPoll() : stopAutoPoll(); }
        if (document.getElementById('chk-auto').checked) startAutoPoll();
    </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

function normalizeTransactions(rawList) {
    return (rawList || []).map((tx) => {
        const amount = parseInt(
            tx.gross_amount ||
                tx.real_gross_amount ||
                tx.amount?.value ||
                tx.amount ||
                tx.totalAmount ||
                tx.payAmount ||
                0,
            10
        );
        return {
            amount,
            status: String(
                tx.transaction_status || tx.status || tx.txnStatus || 'success'
            ).toLowerCase(),
            time: tx.transaction_time || tx.settlement_time || tx.createdAt || tx.finishTime,
            issuer:
                tx.qris_provider_aspi_issuer ||
                tx.issuer ||
                tx.payerSource ||
                tx.customerName ||
                'DANA / Bank',
            order_id: tx.order_id || tx.orderId || tx.acquirementId || tx.merchantOrderId,
            transaction_id: tx.id || tx.transactionId || tx.acquirementId || tx.order_id
        };
    });
}

function extractRawTransactions(data) {
    return (
        data?.transactions ||
        data?.data?.transactions ||
        data?.data?.list ||
        data?.data?.records ||
        data?.list ||
        data?.records ||
        (Array.isArray(data?.data) ? data.data : null) ||
        (Array.isArray(data) ? data : []) ||
        []
    );
}

async function fetchDanaTransactions(activeHeaders, params) {
    return axios.get(DANA_TRANSACTIONS_URL, {
        headers: activeHeaders,
        params,
        timeout: 10000,
        validateStatus: () => true
    });
}

// Riwayat Mutasi
app.get('/transactions', apiKeyAuth, async (req, res) => {
    let headers = await sessionManager.getValidHeaders(req.headers['user-agent']);
    if (!headers) {
        return res
            .status(400)
            .json({ success: false, error: 'Sesi DANA belum ada. Jalankan `node login.js`.' });
    }

    try {
        const merchantId =
            req.headers['x-dana-merchant-id'] ||
            process.env.DANA_MERCHANT_ID ||
            sessionManager.loadSession()?.merchant_id ||
            '';
        const now = new Date();
        const startTimeISO = req.query.startTime
            ? new Date(parseInt(req.query.startTime, 10) * 1000).toISOString()
            : new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString();
        const endTimeISO = req.query.endTime
            ? new Date(parseInt(req.query.endTime, 10) * 1000).toISOString()
            : now.toISOString();

        const params = {
            merchantId,
            merchant_id: merchantId,
            pageSize: parseInt(req.query.pageSize || '20', 10),
            size: parseInt(req.query.pageSize || '20', 10),
            startTime: startTimeISO,
            endTime: endTimeISO,
            start_time: startTimeISO,
            end_time: endTimeISO,
            status: 'SUCCESS,SETTLED,CAPTURE'
        };

        let response = await fetchDanaTransactions(headers, params);
        if (response.status === 401) {
            logActivity('WARNING', 'Sesi expired (401). Auto-refresh...');
            const refreshed = await sessionManager.refreshSession();
            if (refreshed) {
                headers = await sessionManager.getValidHeaders(req.headers['user-agent']);
                response = await fetchDanaTransactions(headers, params);
            }
        }

        if (response.status >= 400) {
            return res.status(502).json({
                success: false,
                error: `DANA API HTTP ${response.status}`,
                detail: response.data,
                hint: 'Sesuaikan DANA_TX_PATH / DANA_API_BASE di .env jika path mutasi berbeda.'
            });
        }

        const formatted = normalizeTransactions(extractRawTransactions(response.data));
        res.json({
            success: true,
            total_amount: String(formatted.reduce((t, tx) => t + tx.amount, 0)),
            data: { transactions: formatted }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/transactions/all', apiKeyAuth, async (req, res) => {
    const now = new Date();
    req.query.startTime = String(
        Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000)
    );
    req.query.pageSize = '100';
    return app._router.handle({ ...req, url: '/transactions', method: 'GET' }, res);
});

async function verifyPayment(amount, startTime, merchantIdOverride, userAgent, qrisId) {
    let headers = await sessionManager.getValidHeaders(userAgent);
    if (!headers) throw new Error('Sesi DANA belum ada. Jalankan `node login.js`.');

    const merchantId =
        merchantIdOverride ||
        process.env.DANA_MERCHANT_ID ||
        sessionManager.loadSession()?.merchant_id ||
        '';
    const now = new Date();
    const startTimeISO = startTime
        ? new Date(startTime).toISOString()
        : new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const endTimeISO = now.toISOString();

    const params = {
        merchantId,
        merchant_id: merchantId,
        pageSize: 20,
        size: 20,
        startTime: startTimeISO,
        endTime: endTimeISO,
        start_time: startTimeISO,
        end_time: endTimeISO,
        status: 'SUCCESS,SETTLED,CAPTURE'
    };

    let response = await fetchDanaTransactions(headers, params);
    if (response.status === 401) {
        logActivity('WARNING', 'Sesi expired (401) di verifyPayment. Auto-refresh...');
        const refreshed = await sessionManager.refreshSession();
        if (refreshed) {
            headers = await sessionManager.getValidHeaders(userAgent);
            response = await fetchDanaTransactions(headers, params);
        } else {
            throw new Error('Sesi DANA expired dan refresh gagal. Login ulang.');
        }
    }
    if (response.status >= 400) {
        throw new Error(`DANA API HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 200)}`);
    }

    const rawTransactions = extractRawTransactions(response.data);
    const targetAmount = parseInt(amount, 10);
    const filterStartTimeMs = startTime ? new Date(startTime).getTime() : 0;

    for (const tx of rawTransactions) {
        const txAmount = parseInt(
            tx.gross_amount ||
                tx.real_gross_amount ||
                tx.amount?.value ||
                tx.amount ||
                tx.totalAmount ||
                tx.payAmount ||
                0,
            10
        );
        const txTimestamp = new Date(
            tx.transaction_time || tx.created_at || tx.createdAt || tx.settlement_time || tx.finishTime || 0
        ).getTime();
        const txId =
            tx.id ||
            tx.transactionId ||
            tx.order_id ||
            tx.orderId ||
            tx.acquirementId ||
            tx.wallstreet_transaction_id;

        if (txAmount === targetAmount && txTimestamp >= filterStartTimeMs) {
            const existingClaim = claimedTransactions.get(txId);
            if (!existingClaim) {
                claimedTransactions.set(txId, { qrisId, claimedAt: Date.now() });
                logActivity('INFO', `TRX ${txId} diklaim oleh QRIS ${qrisId || 'manual-check'}`);
                return {
                    transaction_id: txId,
                    order_id: tx.order_id || tx.orderId || tx.acquirementId,
                    amount: txAmount,
                    payer_issuer:
                        tx.qris_provider_aspi_issuer ||
                        tx.issuer ||
                        tx.payerSource ||
                        'DANA / Bank',
                    payment_type: tx.payment_type || tx.transaction_source || tx.payMethod || 'QRIS',
                    transaction_time:
                        tx.transaction_time || tx.settlement_time || tx.createdAt || tx.finishTime
                };
            } else if (qrisId && existingClaim.qrisId === qrisId) {
                return {
                    transaction_id: txId,
                    order_id: tx.order_id || tx.orderId || tx.acquirementId,
                    amount: txAmount,
                    payer_issuer:
                        tx.qris_provider_aspi_issuer ||
                        tx.issuer ||
                        tx.payerSource ||
                        'DANA / Bank',
                    payment_type: tx.payment_type || tx.transaction_source || tx.payMethod || 'QRIS',
                    transaction_time:
                        tx.transaction_time || tx.settlement_time || tx.createdAt || tx.finishTime
                };
            } else {
                logActivity(
                    'INFO',
                    `TRX ${txId} sudah diklaim oleh QRIS ${existingClaim.qrisId || 'lain'}, skip untuk QRIS ${qrisId}`
                );
            }
        }
    }
    return null;
}

app.get('/api/qr-status/:id', async (req, res) => {
    const qrisId = req.params.id;
    const qris = qrisStore.get(qrisId);
    if (!qris) {
        return res.json({ success: false, status: 'NOT_FOUND', message: 'QRIS tidak ditemukan' });
    }
    if (qris.status === 'PAID') {
        return res.json({ success: true, paid: true, status: 'PAID', transaction: qris.transaction });
    }
    if (Date.now() > qris.expiresAt.getTime()) {
        qrisStore.delete(qrisId);
        return res.json({
            success: false,
            paid: false,
            status: 'EXPIRED',
            message: 'QRIS sudah kedaluwarsa'
        });
    }

    try {
        const matched = await verifyPayment(
            qris.amount,
            qris.createdAt,
            null,
            req.headers['user-agent'],
            qris.trxId || qrisId
        );
        if (matched) {
            qris.status = 'PAID';
            qris.transaction = matched;
            qrisStore.set(qrisId, qris);
            logActivity(
                'SUCCESS',
                `Pembayaran QRIS ID ${qrisId} terverifikasi lunas untuk nominal Rp ${qris.amount}`
            );
            return res.json({ success: true, paid: true, status: 'PAID', transaction: matched });
        }
        return res.json({
            success: true,
            paid: false,
            status: 'PENDING',
            message: 'Belum ada pembayaran masuk'
        });
    } catch (err) {
        return res.json({ success: false, paid: false, status: 'PENDING', message: err.message });
    }
});

app.all('/check-payment', apiKeyAuth, async (req, res) => {
    const amount = req.body?.amount || req.query?.amount;
    const startTime =
        req.body?.startTime || req.query?.startTime || req.query?.start_time;
    const scopeId = req.body?.trx_id || req.query?.trx_id || null;

    if (!amount || isNaN(amount)) {
        return res.status(400).json({ success: false, message: 'Nominal pembayaran tidak valid' });
    }

    try {
        const merchantId = req.headers['x-dana-merchant-id'] || null;
        const matchedTransaction = await verifyPayment(
            amount,
            startTime,
            merchantId,
            req.headers['user-agent'],
            scopeId
        );

        if (matchedTransaction) {
            logActivity(
                'SUCCESS',
                `Pembayaran terverifikasi lunas untuk nominal Rp ${parseInt(amount, 10)}`,
                matchedTransaction
            );
            return res.json({ success: true, paid: true, transaction: matchedTransaction });
        }
        return res.json({
            success: true,
            paid: false,
            message: 'Pembayaran belum ditemukan atau sudah pernah diklaim'
        });
    } catch (err) {
        const errorDetail = err.response
            ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
            : err.message;
        logActivity('ERROR', `Gagal periksa pembayaran: ${errorDetail}`);
        return res.status(500).json({
            success: false,
            message: 'Gagal mengambil data transaksi dari API DANA',
            error: errorDetail
        });
    }
});

app.get('/api/logs', apiKeyAuth, (req, res) => {
    res.json({ success: true, logs: activityLogs });
});

if (require.main === module) {
    startBackgroundJobs();
    app.listen(PORT, async () => {
        logActivity('SYSTEM', `DANA Business Partner Gateway berjalan pada port ${PORT}`);
        const session = sessionManager.loadSession();
        if (session) {
            logActivity(
                'INFO',
                `Sesi terdeteksi (merchant: ${session.merchant_name || session.merchant_id || 'n/a'})`
            );
            try {
                const v = await sessionManager.verifySession();
                if (v.ok) {
                    logActivity('INFO', `[DANA-SESSION] Verification: ${v.message}`);
                } else {
                    logActivity('WARNING', `[DANA-SESSION] ${v.message}`);
                }
            } catch (e) {
                logActivity('WARNING', `Verifikasi sesi skip: ${e.message}`);
            }
        } else {
            logActivity('WARNING', 'Belum ada sesi. Jalankan `node login.js` sebelum cek mutasi.');
        }
    });
}

module.exports = { app, generateDynamicQRIS, calculateCRC16, verifyPayment };
