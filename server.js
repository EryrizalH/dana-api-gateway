const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./db');
const { renderLoginPage, renderDashboardPage } = require('./views');

// ponytail: stripped external complexity; native node:sqlite for persistence + standard cookie auth
const PORT = process.env.PORT || 3000;
const QRIS_EXPIRY_MS = 5 * 60 * 1000; // 5 menit

// In-memory active web sessions (admin)
const activeSessions = new Set();

// ponytail: one-line cookie parser, no cookie-parser package needed
function getCookies(req) {
    return Object.fromEntries(
        (req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(c => c[0])
    );
}

// CRC16 EMVCo (CCITT-FALSE)
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

// Konversi QRIS Statis menjadi QRIS Dinamis (EMVCo Tag 01: 11 -> 12, Tag 54: Amount, Tag 63: CRC)
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
            newTags.push({ tag: '01', val: '12' }); // Dynamic
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

// ponytail: regex amount extractor handles structured amount or raw push notification text
// ponytail: tolerant amount extractor accepting query, json, urlencoded, and plain text
function extractAmountFromPayload(req) {
    if (!req) return null;
    const body = req.body || {};
    const query = req.query || {};

    // 1. Direct amount field in body or query
    const candidateAmount = body.amount ?? query.amount;
    if (candidateAmount !== undefined && candidateAmount !== null && candidateAmount !== '') {
        const cleaned = String(candidateAmount).replace(/[^0-9]/g, '');
        const val = parseInt(cleaned, 10);
        if (!isNaN(val) && val > 0) return val;
    }

    // 2. Aggregate all possible text sources
    let rawText = '';
    if (typeof body === 'string') {
        rawText = body;
    } else if (typeof body === 'object') {
        rawText = [
            body.text, body.message, body.content, body.body,
            body.notification, body.title, body.not_title, body.not_body
        ].filter(Boolean).join(' ');
    }
    if (!rawText) {
        rawText = [query.text, query.message, query.content, query.body, query.title].filter(Boolean).join(' ');
    }

    if (rawText) {
        const match =
            rawText.match(/(?:rp\.?|idr)\s*([\d\.,]+)/i) ||
            rawText.match(/(?:sebesar|nominal|terima|masuk|berhasil|dana)\s*([\d\.,]+)/i) ||
            rawText.match(/([\d\.,]+)\s*(?:rupiah)/i);

        if (match && match[1]) {
            const cleaned = match[1].replace(/[^0-9]/g, '');
            const val = parseInt(cleaned, 10);
            if (!isNaN(val) && val > 0) return val;
        }

        // Fallback: cari angka nominal >= 100
        const numMatch = rawText.match(/\b([1-9]\d{2,}(?:[\.,]\d{3})*|\d{3,})\b/);
        if (numMatch && numMatch[1]) {
            const cleaned = numMatch[1].replace(/[^0-9]/g, '');
            const val = parseInt(cleaned, 10);
            if (!isNaN(val) && val > 0) return val;
        }
    }

    return null;
}

// Middleware autentikasi API Key
const apiKeyAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key || req.query.apikey;
    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res
            .status(401)
            .json({ success: false, message: 'Autentikasi Gagal: API Key tidak valid' });
    }
    next();
};

// Middleware autentikasi Web UI Admin
const authWeb = (req, res, next) => {
    const cookies = getCookies(req);
    const token = cookies.gateway_session;
    if (token && activeSessions.has(token)) {
        return next();
    }
    res.redirect('/login');
};

const app = express();
app.enable('trust proxy');
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ponytail: catch malformed JSON from MacroDroid (e.g. unescaped quotes or newlines)
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            success: false,
            message: 'Format JSON dari MacroDroid tidak valid (biasanya karena ada tanda petik dua " atau enter di pesan notifikasi). Disarankan gunakan Content-Type: application/x-www-form-urlencoded dengan body text=[not_title] [not_body]',
            error: err.message
        });
    }
    next();
});

// Periodic update status kedaluwarsa di database
setInterval(() => {
    try {
        db.updateExpiredTransactions();
    } catch (e) {
        console.error('Error updating expired transactions:', e.message);
    }
}, 60 * 1000);

// Health Check
app.get('/', (req, res) => {
    res.send('QRIS Dynamic Gateway Berjalan. Akses Web UI: <a href="/dashboard">/dashboard</a>');
});

app.get(['/health', '/api/health'], (req, res) => {
    res.json({
        status: 'OK',
        service: 'QRIS Dynamic Gateway',
        timestamp: new Date().toISOString()
    });
});

// --- ADMIN WEB UI ROUTES ---

app.get('/login', (req, res) => {
    const cookies = getCookies(req);
    if (cookies.gateway_session && activeSessions.has(cookies.gateway_session)) {
        return res.redirect('/dashboard');
    }
    res.setHeader('Content-Type', 'text/html');
    res.send(renderLoginPage());
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

    if (username === adminUser && password === adminPass) {
        const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
        activeSessions.add(token);
        res.setHeader('Set-Cookie', `gateway_session=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`);
        return res.redirect('/dashboard');
    }

    res.setHeader('Content-Type', 'text/html');
    res.status(401).send(renderLoginPage('Username atau password tidak sesuai.'));
});

app.get('/logout', (req, res) => {
    const cookies = getCookies(req);
    if (cookies.gateway_session) {
        activeSessions.delete(cookies.gateway_session);
    }
    res.setHeader('Set-Cookie', 'gateway_session=; HttpOnly; Path=/; Max-Age=0');
    res.redirect('/login');
});

app.get('/dashboard', authWeb, (req, res) => {
    const tab = req.query.tab || 'all';
    const stats = db.getDashboardStats();

    let transactions = [];
    let notifications = [];

    if (tab === 'notifications') {
        notifications = db.getNotifications(100);
    } else {
        const statusMap = {
            all: 'ALL',
            paid: 'PAID',
            pending: 'PENDING',
            expired: 'EXPIRED'
        };
        const statusFilter = statusMap[tab] || 'ALL';
        transactions = db.getTransactions(statusFilter, 100);
    }

    res.setHeader('Content-Type', 'text/html');
    res.send(renderDashboardPage(stats, transactions, notifications, tab));
});

// --- API ROUTES ---

// Endpoint Generator QRIS Dinamis
app.all('/create-qris', apiKeyAuth, (req, res) => {
    const amount = req.body?.amount || req.query?.amount;
    if (!amount || isNaN(amount) || parseInt(amount, 10) <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Nominal pembayaran tidak valid (gunakan amount > 0)'
        });
    }

    const staticTemplate = req.body?.qris_static || req.query?.qris_static || process.env.QRIS_STATIC;
    if (!staticTemplate) {
        return res.status(500).json({
            success: false,
            message: 'QRIS Statis tidak ditemukan. Sediakan qris_static di request atau set QRIS_STATIC di .env'
        });
    }

    const dynamicCode = generateDynamicQRIS(staticTemplate, amount);
    if (!dynamicCode) {
        return res.status(500).json({
            success: false,
            message: 'Gagal men-generate QRIS dinamis dari template statis yang diberikan'
        });
    }

    const qrisId = Math.random().toString(36).substring(2, 10);
    const trxId = 'TRX-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const expiresAt = new Date(Date.now() + QRIS_EXPIRY_MS);
    const createdAt = new Date();

    // Simpan ke database SQLite
    db.insertTransaction({
        qris_id: qrisId,
        trx_id: trxId,
        amount: parseInt(amount, 10),
        qris_code: dynamicCode,
        status: 'PENDING',
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString()
    });

    const publicUrl = `${req.protocol}://${req.get('host')}/qr/${qrisId}`;
    console.log(`[${createdAt.toISOString()}] [QRIS] Created ID: ${qrisId} | TRX: ${trxId} | Rp ${amount}`);

    res.json({
        success: true,
        data: {
            qris_id: qrisId,
            trx_id: trxId,
            qris_url: publicUrl,
            qris_code: dynamicCode,
            amount: parseInt(amount, 10),
            status: 'PENDING',
            expires_at: expiresAt.toISOString(),
            expires_in: '5 menit'
        }
    });
});

// Endpoint Notifikasi Pembayaran dari Handphone (MacroDroid / Tasker / NotiSend dsb)
app.all(['/api/notifications', '/webhook/dana'], apiKeyAuth, (req, res) => {
    const amount = extractAmountFromPayload(req);
    const rawText =
        req.body?.text ||
        req.body?.message ||
        req.body?.content ||
        req.body?.body ||
        req.query?.text ||
        req.query?.message ||
        (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

    if (!amount) {
        db.insertNotification(0, rawText, 0, null);
        return res.status(400).json({
            success: false,
            message: 'Nominal pembayaran tidak ditemukan di teks notifikasi. Pastikan format teks berisi angka nominal (contoh: "Rp 10.000" atau "sebesar 10000")',
            received: {
                body: req.body,
                query: req.query,
                extracted_text: rawText
            }
        });
    }

    // Pencocokan FIFO di SQLite
    const matched = db.matchAndPayOldestPending(amount, req.body);
    const timestamp = new Date().toISOString();

    if (matched) {
        db.insertNotification(amount, rawText, 1, matched.trx_id);
        console.log(`[${timestamp}] [NOTIF-PAID] QRIS ID: ${matched.qris_id} | TRX: ${matched.trx_id} | Lunas Rp ${amount}`);
        return res.json({
            success: true,
            matched: true,
            message: 'Pembayaran berhasil dicocokkan dan diverifikasi LUNAS',
            data: {
                qris_id: matched.qris_id,
                trx_id: matched.trx_id,
                amount: matched.amount,
                status: 'PAID',
                paid_at: matched.paid_at
            }
        });
    }

    db.insertNotification(amount, rawText, 0, null);
    console.log(`[${timestamp}] [NOTIF-UNMATCHED] Nominal Rp ${amount} diterima, tapi tidak ada QRIS PENDING yang cocok`);
    return res.json({
        success: true,
        matched: false,
        message: 'Notifikasi dicatat, namun tidak ada QRIS PENDING aktif yang cocok dengan nominal tersebut',
        data: {
            amount,
            received_at: timestamp
        }
    });
});

// Endpoint Cek Status Pembayaran (API Publik kasir / frontend)
app.get('/api/qr-status/:id', (req, res) => {
    const tx = db.getTransactionByQrisId(req.params.id);
    if (!tx) {
        return res.status(404).json({ success: false, status: 'NOT_FOUND', message: 'QRIS tidak ditemukan' });
    }

    res.json({
        success: true,
        qris_id: tx.qris_id,
        trx_id: tx.trx_id,
        amount: tx.amount,
        status: tx.status,
        paid: tx.status === 'PAID',
        paid_at: tx.paid_at || null,
        expires_at: tx.expires_at
    });
});

// Endpoint Cek Status Transaksi Umum (Backend External / Toko Online)
app.all('/check-payment', apiKeyAuth, (req, res) => {
    const qrisId = req.query.qris_id || req.body?.qris_id;
    const trxId = req.query.trx_id || req.body?.trx_id;

    let tx = null;
    if (qrisId) {
        tx = db.getTransactionByQrisId(qrisId);
    } else if (trxId) {
        tx = db.getTransactionByTrxId(trxId);
    }

    if (!tx) {
        return res.status(404).json({
            success: false,
            message: 'Transaksi tidak ditemukan'
        });
    }

    res.json({
        success: true,
        data: {
            qris_id: tx.qris_id,
            trx_id: tx.trx_id,
            amount: tx.amount,
            status: tx.status,
            paid: tx.status === 'PAID',
            paid_at: tx.paid_at || null
        }
    });
});

// Detail data QRIS via API (JSON)
app.get('/api/qr/:id', (req, res) => {
    const tx = db.getTransactionByQrisId(req.params.id);
    if (!tx) {
        return res.status(404).json({ success: false, message: 'QRIS tidak ditemukan atau kedaluwarsa' });
    }
    res.json({
        success: true,
        data: {
            qris_id: tx.qris_id,
            trx_id: tx.trx_id,
            amount: tx.amount,
            qris_code: tx.qris_code,
            status: tx.status,
            paid: tx.status === 'PAID',
            paid_at: tx.paid_at || null,
            expires_at: tx.expires_at
        }
    });
});

// Halaman Display Kasir QRIS Interaktif dengan Auto-Polling
app.get('/qr/:id', (req, res) => {
    const tx = db.getTransactionByQrisId(req.params.id);
    if (!tx) {
        return res.status(404).send('<h3 style="font-family:sans-serif;text-align:center;margin-top:40px;">QRIS tidak ditemukan atau telah kedaluwarsa</h3>');
    }

    if (req.query.format === 'raw' || req.query.raw === '1') {
        if (tx.status === 'EXPIRED') {
            return res.status(410).send('QRIS Kedaluwarsa');
        }
        const qrServerUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(tx.qris_code)}`;
        return res.redirect(302, qrServerUrl);
    }

    const formattedAmount = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(tx.amount);

    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(tx.qris_code)}`;
    const expiresTimestamp = new Date(tx.expires_at).getTime();
    const initialPaid = tx.status === 'PAID';

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
        .trx-id { font-size: 12px; color: #64748b; margin-bottom: 8px; font-mono: monospace; }
        .amount-title { font-size: 14px; color: #94a3b8; margin-bottom: 4px; }
        .amount-value { font-size: 28px; font-weight: 700; color: #38bdf8; letter-spacing: -0.5px; margin-bottom: 20px; }
        .qr-wrapper { background: #ffffff; padding: 16px; border-radius: 16px; display: inline-block; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); margin-bottom: 20px; transition: opacity 0.3s; }
        .qr-wrapper img { display: block; width: 240px; height: 240px; border-radius: 8px; }
        .timer-box { font-size: 14px; color: #cbd5e1; background: #0b1220; padding: 10px 16px; border-radius: 12px; border: 1px solid #1f2937; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
        .timer-val { font-weight: 700; color: #f59e0b; font-family: monospace; font-size: 16px; }
        .btn-copy { width: 100%; background: #1e293b; color: #38bdf8; border: 1px solid #334155; font-weight: 600; font-size: 14px; padding: 12px; border-radius: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s; }
        .btn-copy:hover { background: #334155; color: #fff; }
        .copy-success { color: #4ade80; font-size: 12px; margin-top: 8px; display: none; }
        .status-badge { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; border-radius: 12px; font-weight: 600; font-size: 14px; margin-bottom: 16px; }
        .status-pending { background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }
        .status-paid { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
        .status-expired { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    </style>
</head>
<body>
    <div class="card">
        <div class="badge-qris">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            QRIS Dinamis
        </div>
        <div class="trx-id">${tx.trx_id}</div>
        <div class="amount-title">Total Pembayaran</div>
        <div class="amount-value">${formattedAmount}</div>
        <div class="qr-wrapper" id="qr-box"><img src="${qrImageUrl}" alt="QRIS Code"></div>
        
        <div class="status-badge ${initialPaid ? 'status-paid' : (tx.status === 'EXPIRED' ? 'status-expired' : 'status-pending')}" id="status-badge">
            <span id="status-icon">${initialPaid ? '🟢' : (tx.status === 'EXPIRED' ? '🔴' : '🟡')}</span>
            <span id="status-text">${initialPaid ? 'Pembayaran Berhasil / Lunas' : (tx.status === 'EXPIRED' ? 'QRIS Kedaluwarsa' : 'Menunggu Pembayaran')}</span>
        </div>

        <div class="timer-box" id="timer-box" style="${initialPaid || tx.status === 'EXPIRED' ? 'display:none;' : ''}">
            <span>Batas Waktu Pembayaran</span>
            <span class="timer-val" id="timer-text">05:00</span>
        </div>

        <button class="btn-copy" id="btn-copy" onclick="copyQrisCode()">
            <span>📋 Salin String QRIS</span>
        </button>
        <div class="copy-success" id="copy-msg">Teks QRIS berhasil disalin ke clipboard!</div>
    </div>
    <script>
        const qrisId = "${tx.qris_id}";
        const qrisCode = ${JSON.stringify(tx.qris_code)};
        const expiresTimestamp = ${expiresTimestamp};
        let isPaid = ${initialPaid ? 'true' : 'false'};
        let isExpired = ${tx.status === 'EXPIRED' ? 'true' : 'false'};

        function updateCountdown() {
            if (isPaid || isExpired) return;
            const diff = expiresTimestamp - Date.now();
            if (diff <= 0) {
                isExpired = true;
                document.getElementById('timer-text').innerText = "00:00";
                const badge = document.getElementById('status-badge');
                badge.className = "status-badge status-expired";
                document.getElementById('status-icon').innerText = "🔴";
                document.getElementById('status-text').innerText = "QRIS Kedaluwarsa";
                document.getElementById('qr-box').style.opacity = '0.2';
                clearInterval(countdownInterval);
                clearInterval(pollInterval);
                return;
            }
            const m = Math.floor(diff / 60000), s = Math.floor((diff % 60000) / 1000);
            document.getElementById('timer-text').innerText = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
        }
        const countdownInterval = setInterval(updateCountdown, 1000);
        updateCountdown();

        // Polling status ke server secara otomatis
        async function checkPaymentStatus() {
            if (isPaid || isExpired) return;
            try {
                const res = await fetch('/api/qr-status/' + qrisId);
                const data = await res.json();
                if (data.success && data.paid) {
                    isPaid = true;
                    clearInterval(pollInterval);
                    clearInterval(countdownInterval);
                    const badge = document.getElementById('status-badge');
                    badge.className = "status-badge status-paid";
                    document.getElementById('status-icon').innerText = "🟢";
                    document.getElementById('status-text').innerText = "Pembayaran Berhasil / Lunas";
                    document.getElementById('timer-box').style.display = "none";
                }
            } catch (e) {
                console.error(e);
            }
        }
        const pollInterval = (!isPaid && !isExpired) ? setInterval(checkPaymentStatus, 3000) : null;

        function copyQrisCode() {
            navigator.clipboard.writeText(qrisCode).then(() => {
                const msg = document.getElementById('copy-msg');
                msg.style.display = 'block';
                setTimeout(() => { msg.style.display = 'none'; }, 2500);
            }).catch(() => {
                prompt("Salin string QRIS manual:", qrisCode);
            });
        }
    </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[SYSTEM] QRIS Dynamic Gateway berjalan pada port ${PORT}`);
        console.log(`[SYSTEM] Dashboard Admin: http://localhost:${PORT}/dashboard`);
    });
}

module.exports = { app, generateDynamicQRIS, calculateCRC16, extractAmountFromPayload };
