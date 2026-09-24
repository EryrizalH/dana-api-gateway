const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// ponytail: native node:sqlite DatabaseSync with WAL mode, zero npm deps
const dataDir = process.env.DATA_DIR || (fs.existsSync(path.join(__dirname, 'data')) ? path.join(__dirname, 'data') : __dirname);
if (!fs.existsSync(dataDir)) {
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
}
const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'database.sqlite');
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qris_id TEXT UNIQUE NOT NULL,
    trx_id TEXT UNIQUE NOT NULL,
    amount INTEGER NOT NULL,
    qris_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    paid_at TEXT,
    payment_details TEXT,
    reference_id TEXT,
    expiry_webhook_sent INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount INTEGER NOT NULL,
    raw_text TEXT,
    matched INTEGER NOT NULL DEFAULT 0,
    trx_id TEXT,
    received_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tx_status_amount ON transactions(status, amount);
  CREATE INDEX IF NOT EXISTS idx_tx_qris_id ON transactions(qris_id);
  CREATE INDEX IF NOT EXISTS idx_tx_trx_id ON transactions(trx_id);
`);

const transactionColumns = db.prepare('PRAGMA table_info(transactions)').all();
if (!transactionColumns.some((column) => column.name === 'reference_id')) {
    db.exec('ALTER TABLE transactions ADD COLUMN reference_id TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_tx_reference_id ON transactions(reference_id)');

if (!transactionColumns.some((column) => column.name === 'expiry_webhook_sent')) {
    db.exec('ALTER TABLE transactions ADD COLUMN expiry_webhook_sent INTEGER DEFAULT 0');
}

function insertTransaction({ qris_id, trx_id, amount, qris_code, status, created_at, expires_at, reference_id }) {
    const stmt = db.prepare(`
        INSERT INTO transactions (qris_id, trx_id, amount, qris_code, status, created_at, expires_at, reference_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(qris_id, trx_id, amount, qris_code, status || 'PENDING', created_at, expires_at, reference_id || null);
}

function updateExpiredTransactions() {
    const nowIso = new Date().toISOString();
    db.prepare(`
        UPDATE transactions
        SET status = 'EXPIRED'
        WHERE status = 'PENDING' AND expires_at < ?
    `).run(nowIso);
}

function getPendingExpiryWebhooks() {
    return db.prepare(`
        SELECT * FROM transactions
        WHERE status = 'EXPIRED'
          AND reference_id IS NOT NULL
          AND (expiry_webhook_sent IS NULL OR expiry_webhook_sent = 0)
    `).all();
}

function markExpiryWebhookSent(id) {
    db.prepare(`
        UPDATE transactions
        SET expiry_webhook_sent = 1
        WHERE id = ?
    `).run(id);
}

function resetExpiredWebhooks() {
    db.exec(`
        UPDATE transactions
        SET expiry_webhook_sent = 0
        WHERE status = 'EXPIRED'
    `);
}


function getTransactionByQrisId(qrisId) {
    updateExpiredTransactions();
    return db.prepare('SELECT * FROM transactions WHERE qris_id = ?').get(qrisId);
}

function getTransactionByTrxId(trxId) {
    updateExpiredTransactions();
    return db.prepare('SELECT * FROM transactions WHERE trx_id = ?').get(trxId);
}

function matchAndPayOldestPending(amount, rawDetails) {
    updateExpiredTransactions();
    const nowIso = new Date().toISOString();

    const tx = db.prepare(`
        SELECT * FROM transactions
        WHERE status = 'PENDING' AND amount = ? AND expires_at >= ?
        ORDER BY created_at ASC
        LIMIT 1
    `).get(amount, nowIso);

    if (tx) {
        const detailsJson = typeof rawDetails === 'object' ? JSON.stringify(rawDetails) : String(rawDetails || '');
        db.prepare(`
            UPDATE transactions
            SET status = 'PAID', paid_at = ?, payment_details = ?
            WHERE id = ?
        `).run(nowIso, detailsJson, tx.id);
        return { ...tx, status: 'PAID', paid_at: nowIso, payment_details: detailsJson };
    }
    return null;
}

function insertNotification(amount, rawText, matched, trxId) {
    db.prepare(`
        INSERT INTO notifications (amount, raw_text, matched, trx_id, received_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(amount, rawText || '', matched ? 1 : 0, trxId || null, new Date().toISOString());
}

function getDashboardStats() {
    updateExpiredTransactions();
    const nowIso = new Date().toISOString();

    const total = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM transactions').get();
    const paid = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM transactions WHERE status = 'PAID'").get();
    const pending = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM transactions WHERE status = 'PENDING' AND expires_at >= ?").get(nowIso);
    const expired = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM transactions WHERE status = 'EXPIRED'").get();
    const notifs = db.prepare('SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN matched = 1 THEN 1 ELSE 0 END), 0) as matched, COALESCE(SUM(CASE WHEN matched = 0 THEN 1 ELSE 0 END), 0) as unmatched FROM notifications').get();

    return {
        total: { count: Number(total.count), amount: Number(total.total) },
        paid: { count: Number(paid.count), amount: Number(paid.total) },
        pending: { count: Number(pending.count), amount: Number(pending.total) },
        expired: { count: Number(expired.count), amount: Number(expired.total) },
        notifications: {
            total: Number(notifs.total),
            matched: Number(notifs.matched),
            unmatched: Number(notifs.unmatched)
        }
    };
}

function getTransactions(status = 'ALL', limit = 100) {
    updateExpiredTransactions();
    if (status && status !== 'ALL') {
        return db.prepare('SELECT * FROM transactions WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit);
    }
    return db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT ?').all(limit);
}

function getNotifications(limit = 100) {
    return db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = {
    db,
    insertTransaction,
    getTransactionByQrisId,
    getTransactionByTrxId,
    updateExpiredTransactions,
    matchAndPayOldestPending,
    insertNotification,
    getDashboardStats,
    getTransactions,
    getNotifications,
    getPendingExpiryWebhooks,
    markExpiryWebhookSent,
    resetExpiredWebhooks
};
