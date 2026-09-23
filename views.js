// ponytail: lightweight SSR HTML renderers with zero templating engine dependencies

function formatRupiah(num) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(num || 0);
}

function formatDate(isoStr) {
    if (!isoStr) return '-';
    try {
        const d = new Date(isoStr);
        return d.toLocaleString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    } catch {
        return isoStr;
    }
}

function renderLoginPage(error = null) {
    return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - QRIS Gateway Admin</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
        body { background: #0b1220; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
        .login-card { background: #111827; border: 1px solid #1f2937; border-radius: 16px; width: 100%; max-width: 380px; padding: 32px 28px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
        .logo-box { text-align: center; margin-bottom: 24px; }
        .badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(56, 189, 248, 0.1); color: #38bdf8; font-weight: 600; font-size: 13px; padding: 6px 14px; border-radius: 20px; border: 1px solid rgba(56, 189, 248, 0.2); margin-bottom: 12px; }
        h1 { font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 6px; }
        p.sub { font-size: 13px; color: #94a3b8; }
        .form-group { margin-bottom: 18px; }
        label { display: block; font-size: 13px; font-weight: 500; color: #cbd5e1; margin-bottom: 6px; }
        input[type="text"], input[type="password"] { width: 100%; padding: 12px 14px; background: #0b1220; border: 1px solid #334155; border-radius: 10px; color: #fff; font-size: 14px; outline: none; transition: border-color 0.2s; }
        input[type="text"]:focus, input[type="password"]:focus { border-color: #38bdf8; }
        .btn-submit { width: 100%; background: #0284c7; color: #fff; border: none; font-weight: 600; font-size: 14px; padding: 12px; border-radius: 10px; cursor: pointer; transition: background 0.2s; margin-top: 6px; }
        .btn-submit:hover { background: #0369a1; }
        .error-box { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; font-size: 13px; padding: 10px 14px; border-radius: 8px; margin-bottom: 18px; text-align: center; }
    </style>
</head>
<body>
    <div class="login-card">
        <div class="logo-box">
            <div class="badge">QRIS Dynamic Gateway</div>
            <h1>Admin Login</h1>
            <p class="sub">Masuk untuk melihat riwayat & status QRIS</p>
        </div>
        ${error ? `<div class="error-box">${error}</div>` : ''}
        <form method="POST" action="/login">
            <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" name="username" required autocomplete="username" placeholder="Masukkan username" autofocus>
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="Masukkan password">
            </div>
            <button type="submit" class="btn-submit">Masuk ke Dashboard</button>
        </form>
    </div>
</body>
</html>`;
}

function renderDashboardPage(stats, transactions, notifications, activeTab = 'transactions') {
    return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - QRIS Dynamic Gateway</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
        body { background: #0b1220; color: #f8fafc; min-height: 100vh; padding: 24px 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #1f2937; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .brand-badge { background: #0284c7; color: #fff; font-weight: 700; font-size: 13px; padding: 6px 12px; border-radius: 8px; }
        .brand h1 { font-size: 18px; font-weight: 700; }
        .nav-actions { display: flex; align-items: center; gap: 12px; }
        .btn-refresh { background: #1e293b; border: 1px solid #334155; color: #cbd5e1; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
        .btn-refresh:hover { background: #334155; color: #fff; }
        .btn-logout { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; text-decoration: none; }
        .btn-logout:hover { background: rgba(239, 68, 68, 0.25); }

        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 28px; }
        .stat-card { background: #111827; border: 1px solid #1f2937; border-radius: 14px; padding: 20px; }
        .stat-label { font-size: 12px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
        .stat-value { font-size: 24px; font-weight: 700; color: #f8fafc; margin-bottom: 4px; }
        .stat-sub { font-size: 13px; color: #64748b; }
        .stat-paid { border-left: 4px solid #22c55e; }
        .stat-pending { border-left: 4px solid #f59e0b; }
        .stat-expired { border-left: 4px solid #ef4444; }
        .stat-notifs { border-left: 4px solid #38bdf8; }

        .tabs { display: flex; gap: 10px; margin-bottom: 18px; border-bottom: 1px solid #1f2937; padding-bottom: 12px; flex-wrap: wrap; }
        .tab-btn { background: #111827; border: 1px solid #1f2937; color: #94a3b8; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
        .tab-btn.active { background: #0284c7; color: #fff; border-color: #0284c7; }
        .tab-btn:hover:not(.active) { background: #1e293b; color: #f8fafc; }

        .card-table { background: #111827; border: 1px solid #1f2937; border-radius: 14px; overflow: hidden; }
        table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
        th { background: #0f172a; color: #94a3b8; font-weight: 600; padding: 14px 16px; border-bottom: 1px solid #1f2937; }
        td { padding: 14px 16px; border-bottom: 1px solid #1a2234; color: #cbd5e1; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: rgba(255,255,255,0.02); }

        .badge-status { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; }
        .badge-paid { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
        .badge-pending { background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }
        .badge-expired { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
        .badge-matched { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }

        .amount-bold { font-weight: 700; color: #f8fafc; }
        .code-box { font-family: monospace; font-size: 12px; color: #94a3b8; background: #0b1220; padding: 4px 8px; border-radius: 6px; }
        .btn-view { color: #38bdf8; text-decoration: none; font-weight: 600; font-size: 12px; padding: 4px 8px; border-radius: 6px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); }
        .btn-view:hover { background: rgba(56, 189, 248, 0.2); }
        .empty-row { text-align: center; padding: 40px; color: #64748b; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="brand">
                <div class="brand-badge">QRIS GATEWAY</div>
                <h1>Payment Monitoring Dashboard</h1>
            </div>
            <div class="nav-actions">
                <a href="/dashboard" class="btn-refresh">🔄 Refresh</a>
                <a href="/logout" class="btn-logout">Logout</a>
            </div>
        </header>

        <!-- Stats Overview -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Total Generate</div>
                <div class="stat-value">${stats.total.count}</div>
                <div class="stat-sub">${formatRupiah(stats.total.amount)}</div>
            </div>
            <div class="stat-card stat-paid">
                <div class="stat-label">Lunas / Berhasil</div>
                <div class="stat-value" style="color:#4ade80;">${stats.paid.count}</div>
                <div class="stat-sub">${formatRupiah(stats.paid.amount)}</div>
            </div>
            <div class="stat-card stat-pending">
                <div class="stat-label">Menunggu (Pending)</div>
                <div class="stat-value" style="color:#f59e0b;">${stats.pending.count}</div>
                <div class="stat-sub">${formatRupiah(stats.pending.amount)}</div>
            </div>
            <div class="stat-card stat-expired">
                <div class="stat-label">Kedaluwarsa (Expired)</div>
                <div class="stat-value" style="color:#f87171;">${stats.expired.count}</div>
                <div class="stat-sub">${formatRupiah(stats.expired.amount)}</div>
            </div>
            <div class="stat-card stat-notifs">
                <div class="stat-label">Notifikasi HP Masuk</div>
                <div class="stat-value" style="color:#38bdf8;">${stats.notifications.total}</div>
                <div class="stat-sub">${stats.notifications.matched} Cocok · ${stats.notifications.unmatched} Tidak Cocok</div>
            </div>
        </div>

        <!-- Filter Tabs -->
        <div class="tabs">
            <a href="/dashboard?tab=all" class="tab-btn ${activeTab === 'all' || activeTab === 'transactions' ? 'active' : ''}">Semua Transaksi</a>
            <a href="/dashboard?tab=paid" class="tab-btn ${activeTab === 'paid' ? 'active' : ''}">🟢 Berhasil (PAID)</a>
            <a href="/dashboard?tab=pending" class="tab-btn ${activeTab === 'pending' ? 'active' : ''}">🟡 Pending</a>
            <a href="/dashboard?tab=expired" class="tab-btn ${activeTab === 'expired' ? 'active' : ''}">🔴 Expired</a>
            <a href="/dashboard?tab=notifications" class="tab-btn ${activeTab === 'notifications' ? 'active' : ''}">📩 Log Notifikasi HP (${stats.notifications.total})</a>
        </div>

        <!-- Table View -->
        <div class="card-table">
            ${activeTab === 'notifications' ? renderNotificationsTable(notifications) : renderTransactionsTable(transactions)}
        </div>
    </div>
</body>
</html>`;
}

function renderTransactionsTable(transactions) {
    if (!transactions || transactions.length === 0) {
        return `<div class="empty-row">Belum ada data transaksi yang tersimpan.</div>`;
    }

    const rows = transactions.map(tx => {
        let badgeClass = 'badge-pending';
        let badgeLabel = 'PENDING';
        if (tx.status === 'PAID') {
            badgeClass = 'badge-paid';
            badgeLabel = 'PAID / LUNAS';
        } else if (tx.status === 'EXPIRED') {
            badgeClass = 'badge-expired';
            badgeLabel = 'EXPIRED';
        }

        return `<tr>
            <td>${formatDate(tx.created_at)}</td>
            <td><span class="code-box">${tx.trx_id}</span></td>
            <td><span class="code-box">${tx.qris_id}</span></td>
            <td class="amount-bold">${formatRupiah(tx.amount)}</td>
            <td><span class="badge-status ${badgeClass}">${badgeLabel}</span></td>
            <td>${tx.status === 'PAID' ? formatDate(tx.paid_at) : (tx.status === 'EXPIRED' ? 'Kedaluwarsa' : formatDate(tx.expires_at))}</td>
            <td><a href="/qr/${tx.qris_id}" target="_blank" class="btn-view">Buka QR ↗</a></td>
        </tr>`;
    }).join('');

    return `<table>
        <thead>
            <tr>
                <th>Waktu Dibuat</th>
                <th>TRX ID</th>
                <th>QRIS ID</th>
                <th>Nominal</th>
                <th>Status</th>
                <th>Waktu Bayar / Expired</th>
                <th>Aksi</th>
            </tr>
        </thead>
        <tbody>
            ${rows}
        </tbody>
    </table>`;
}

function renderNotificationsTable(notifications) {
    if (!notifications || notifications.length === 0) {
        return `<div class="empty-row">Belum ada log notifikasi yang diterima dari handphone.</div>`;
    }

    const rows = notifications.map(notif => {
        const isMatched = notif.matched === 1;
        const badgeClass = isMatched ? 'badge-paid' : 'badge-expired';
        const badgeText = isMatched ? 'COCOK (LUNAS)' : 'TIDAK COCOK';

        return `<tr>
            <td>${formatDate(notif.received_at)}</td>
            <td class="amount-bold">${formatRupiah(notif.amount)}</td>
            <td><span class="badge-status ${badgeClass}">${badgeText}</span></td>
            <td>${notif.trx_id ? `<span class="code-box">${notif.trx_id}</span>` : '-'}</td>
            <td style="color:#94a3b8; font-size:12px; max-width:320px; word-break:break-all;">${escapeHtml(notif.raw_text || '-')}</td>
        </tr>`;
    }).join('');

    return `<table>
        <thead>
            <tr>
                <th>Waktu Diterima</th>
                <th>Nominal Terdeteksi</th>
                <th>Hasil Matching</th>
                <th>Terkait TRX ID</th>
                <th>Teks Mentah Notifikasi HP</th>
            </tr>
        </thead>
        <tbody>
            ${rows}
        </tbody>
    </table>`;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = {
    renderLoginPage,
    renderDashboardPage
};
