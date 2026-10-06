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

function renderDashboardPage(stats, transactions, notifications, activeTab = 'transactions', options = {}) {
    const dashboardUrl = (tab) => escapeHtml('/dashboard?tab=' + encodeURIComponent(tab) +
        (options.selectedId ? '&payment=' + encodeURIComponent(options.selectedId) : ''));
    return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - QRIS Dynamic Gateway</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="/assets/dashboard.js" defer></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
        body { background: #0b1220; color: #f8fafc; min-height: 100vh; padding: 24px 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        header { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #1f2937; }
        .brand { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-width: 0; }
        .brand-badge { background: #0369a1; color: #fff; font-weight: 700; font-size: 13px; padding: 6px 12px; border-radius: 8px; }
        .brand h1 { font-size: 18px; font-weight: 700; }
        .nav-actions { display: flex; align-items: center; gap: 12px; }
        .btn-refresh { background: #1e293b; border: 1px solid #334155; color: #cbd5e1; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
        .btn-refresh:hover { background: #334155; color: #fff; }
        .btn-logout { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; text-decoration: none; }
        .btn-logout:hover { background: rgba(239, 68, 68, 0.25); }

        a, button, input { min-height: 44px; }
        a { align-content: center; }
        a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid #38bdf8; outline-offset: 3px; }
        [hidden] { display: none !important; }
        .payment-panel { background: #111827; border: 1px solid #334155; border-radius: 14px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 28px; padding: 24px; margin-bottom: 28px; }
        .payment-form, .payment-result { min-width: 0; }
        .payment-form h2 { font-size: 20px; margin-bottom: 10px; }
        .payment-help { font-size: 13px; line-height: 1.65; color: #94a3b8; }
        .payment-form label, .payment-link-label { display: block; font-size: 13px; font-weight: 600; margin: 22px 0 8px; color: #cbd5e1; }
        .payment-input, .payment-link { width: 100%; background: #0b1220; color: #f8fafc; border: 1px solid #475569; border-radius: 8px; padding: 12px; font-size: 15px; }
        .payment-input { margin-bottom: 8px; }
        .payment-input::placeholder { color: #94a3b8; }
        .payment-create { margin-top: 20px; width: 100%; background: #0369a1; color: #fff; border: 1px solid #0369a1; border-radius: 8px; padding: 12px 16px; font-weight: 600; font-size: 14px; cursor: pointer; }
        .payment-create:hover { background: #075985; }
        button:disabled, input:disabled { opacity: 0.65; cursor: not-allowed; }
        .payment-message { font-size: 13px; line-height: 1.6; color: #fca5a5; margin-top: 12px; overflow-wrap: anywhere; }
        .payment-result { border-left: 1px solid #334155; padding-left: 28px; }
        .payment-empty { min-height: 240px; display: flex; flex-direction: column; justify-content: center; gap: 8px; }
        .payment-empty h3 { font-size: 17px; }
        .payment-summary { display: flex; align-items: flex-start; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
        .payment-amount { font-size: 28px; font-weight: 700; margin-top: 4px; }
        .payment-display { display: grid; grid-template-columns: minmax(0, 200px) minmax(0, 1fr); gap: 20px; align-items: center; }
        .payment-qr-box { background: #fff; padding: 12px; border-radius: 8px; }
        .payment-qr { width: 100%; height: auto; display: block; }
        .payment-qr-box.inactive { display: none; }
        .payment-details { margin: 0; min-width: 0; }
        .payment-details dt { font-size: 12px; color: #94a3b8; margin-top: 12px; }
        .payment-details dt:first-child { margin-top: 0; }
        .payment-details dd { font-size: 13px; color: #f8fafc; margin-top: 4px; overflow-wrap: anywhere; }
        .payment-countdown { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .payment-link { font-size: 12px; }
        .payment-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
        .payment-action { background: #1e293b; border: 1px solid #475569; color: #e2e8f0; padding: 10px 12px; border-radius: 8px; font-size: 13px; text-decoration: none; cursor: pointer; }
        .payment-feedback { color: #cbd5e1; font-size: 13px; line-height: 1.6; margin-top: 10px; }

        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 28px; }
        .stat-card { background: #111827; border: 1px solid #1f2937; border-radius: 14px; padding: 20px; }
        .stat-label { font-size: 12px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
        .stat-value { font-size: 24px; font-weight: 700; color: #f8fafc; margin-bottom: 4px; }
        .stat-sub { font-size: 13px; color: #94a3b8; }
        .stat-paid { border-left: 4px solid #22c55e; }
        .stat-pending { border-left: 4px solid #f59e0b; }
        .stat-expired { border-left: 4px solid #ef4444; }
        .stat-notifs { border-left: 4px solid #38bdf8; }

        .tabs { display: flex; gap: 10px; margin-bottom: 18px; border-bottom: 1px solid #1f2937; padding-bottom: 12px; flex-wrap: wrap; }
        .tab-btn { background: #111827; border: 1px solid #1f2937; color: #94a3b8; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
        .tab-btn.active { background: #0369a1; color: #fff; border-color: #0369a1; }
        .tab-btn:hover:not(.active) { background: #1e293b; color: #f8fafc; }

        .card-table { background: #111827; border: 1px solid #1f2937; border-radius: 14px; overflow-x: auto; }
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
        .btn-view { color: #38bdf8; text-decoration: none; font-weight: 600; font-size: 12px; padding: 10px 8px; border-radius: 6px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); display: inline-block; white-space: nowrap; }
        .btn-view:hover { background: rgba(56, 189, 248, 0.2); }
        .empty-row { text-align: center; padding: 40px; color: #94a3b8; }
        @media (max-width: 850px) {
            .payment-panel { grid-template-columns: minmax(0, 1fr); }
            .payment-result { border-left: 0; border-top: 1px solid #334155; padding: 24px 0 0; }
            .payment-empty { min-height: 120px; }
        }
        @media (max-width: 480px) {
            body { padding: 20px 12px; }
            .payment-panel { padding: 20px 16px; gap: 20px; }
            .payment-display { grid-template-columns: minmax(0, 1fr); }
            .payment-qr-box { width: 200px; max-width: 100%; margin: 0 auto; }
            .payment-details { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px 12px; }
            .payment-details dt, .payment-details dt:first-child { margin-top: 0; }
            .payment-details dd { margin-top: 0; }
            .payment-actions > * { flex: 1; text-align: center; }
            .stats-grid { grid-template-columns: minmax(0, 1fr); }
        }
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
                <a href="${dashboardUrl(activeTab)}" class="btn-refresh">🔄 Refresh</a>
                <a href="/logout" class="btn-logout">Logout</a>
            </div>
        </header>

        <section class="payment-panel" aria-labelledby="payment-title">
            <form class="payment-form" id="payment-form" action="/dashboard/create-qris" method="POST">
                <h2 id="payment-title">Buat Pembayaran QRIS</h2>
                <p class="payment-help">Buat QRIS untuk pembayaran manual. Berlaku selama 5 menit dan tidak mengirim callback ke aplikasi konsumen.</p>
                <input type="hidden" name="csrf_token" value="${escapeHtml(options.csrfToken || '')}">
                <input type="hidden" name="tab" value="${escapeHtml(activeTab)}">
                <input type="hidden" name="payment" value="${escapeHtml(options.selectedId || '')}">
                <label for="payment-amount">Nominal (Rp)</label>
                <input class="payment-input" id="payment-amount" name="amount" type="text" inputmode="numeric" pattern="[0-9]+" required autocomplete="off" placeholder="25000" value="${escapeHtml(options.formAmount || '')}" aria-describedby="amount-help${options.error ? ' payment-error' : ''}" ${options.qrisConfigured ? '' : 'disabled'}>
                <p class="payment-help" id="amount-help">Masukkan rupiah tanpa titik atau koma, contoh: 25000.</p>
                ${options.error ? `<p class="payment-message" id="payment-error" role="alert">${escapeHtml(options.error)}</p>` : ''}
                ${options.qrisConfigured || options.error ? '' : '<p class="payment-message" role="alert">QRIS statis belum dikonfigurasi. Pembuatan pembayaran belum tersedia.</p>'}
                <button class="payment-create" id="payment-create" type="submit" ${options.qrisConfigured ? '' : 'disabled'}>Buat QRIS</button>
            </form>
            ${renderPaymentResult(options.payment, options.paymentError)}
        </section>

        <!-- Stats Overview -->
        <div class="stats-grid" id="dashboard-stats">
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
        <div class="tabs" id="dashboard-tabs">
            <a href="${dashboardUrl('all')}" class="tab-btn ${activeTab === 'all' || activeTab === 'transactions' ? 'active' : ''}">Semua Transaksi</a>
            <a href="${dashboardUrl('paid')}" class="tab-btn ${activeTab === 'paid' ? 'active' : ''}">🟢 Berhasil (PAID)</a>
            <a href="${dashboardUrl('pending')}" class="tab-btn ${activeTab === 'pending' ? 'active' : ''}">🟡 Pending</a>
            <a href="${dashboardUrl('expired')}" class="tab-btn ${activeTab === 'expired' ? 'active' : ''}">🔴 Expired</a>
            <a href="${dashboardUrl('notifications')}" class="tab-btn ${activeTab === 'notifications' ? 'active' : ''}">📩 Log Notifikasi HP (${stats.notifications.total})</a>
        </div>

        <!-- Table View -->
        <div class="card-table" id="dashboard-table" role="region" aria-label="Riwayat dashboard" tabindex="0">
            ${activeTab === 'notifications' ? renderNotificationsTable(notifications) : renderTransactionsTable(transactions)}
        </div>
    </div>
</body>
</html>`;
}

function renderPaymentResult(payment, error) {
    if (!payment) {
        return `<div class="payment-result payment-empty">
            <h3>QRIS pembayaran</h3>
            <p class="payment-help">QR dan status pembayaran akan muncul di sini setelah Anda mengisi nominal.</p>
            ${error ? `<p class="payment-message" role="alert">${escapeHtml(error)}</p>` : ''}
        </div>`;
    }
    const pending = payment.status === 'PENDING';
    const paid = payment.status === 'PAID';
    const statusClass = paid ? 'badge-paid' : pending ? 'badge-pending' : 'badge-expired';
    const statusText = paid ? 'PAID / LUNAS' : pending ? 'PENDING' : 'EXPIRED';
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=' + encodeURIComponent(payment.qris_code);
    const checkoutPath = '/qr/' + encodeURIComponent(payment.qris_id);
    return `<div class="payment-result" id="payment-result" data-qris-id="${escapeHtml(payment.qris_id)}" data-status="${escapeHtml(payment.status)}" data-expires-at="${escapeHtml(payment.expires_at)}">
        <div class="payment-summary">
            <div><p class="payment-help">Nominal pembayaran</p><p class="payment-amount">${formatRupiah(payment.amount)}</p></div>
            <span class="badge-status ${statusClass}" id="payment-status" role="status">${statusText}</span>
        </div>
        <div class="payment-display">
            <div class="payment-qr-box${pending ? '' : ' inactive'}" id="payment-qr-box">
                <img class="payment-qr" id="payment-qr" src="${escapeHtml(qrUrl)}" alt="QRIS pembayaran ${escapeHtml(formatRupiah(payment.amount))}" width="260" height="260">
            </div>
            <dl class="payment-details">
                <dt>ID transaksi</dt><dd>${escapeHtml(payment.trx_id)}</dd>
                <dt>ID QRIS</dt><dd>${escapeHtml(payment.qris_id)}</dd>
                <dt id="payment-timer-label" ${pending ? '' : 'hidden'}>Sisa waktu</dt><dd id="payment-timer" ${pending ? '' : 'hidden'}><span class="payment-countdown" id="payment-countdown">--:--</span></dd>
                <dt>Berlaku sampai</dt><dd>${formatDate(payment.expires_at)}</dd>
            </dl>
        </div>
        <p class="payment-feedback" id="payment-image-loading" ${pending ? '' : 'hidden'}>Memuat gambar QRIS…</p>
        <p class="payment-message" id="payment-image-error" role="alert" hidden>Gambar QRIS gagal dimuat. Muat ulang halaman atau buka halaman pembayaran.</p>
        <p class="payment-feedback" id="payment-state-message" role="status">${paid ? 'Pembayaran berhasil diterima.' : pending ? 'Menunggu pembayaran. Status diperiksa otomatis.' : 'QRIS telah kedaluwarsa. Buat pembayaran baru jika diperlukan.'}</p>
        <p class="payment-message" id="payment-poll-error" role="alert" hidden></p>
        <label class="payment-link-label" for="payment-link">Tautan pembayaran</label>
        <input class="payment-link" id="payment-link" type="text" value="${escapeHtml(checkoutPath)}" readonly>
        <div class="payment-actions">
            <button class="payment-action" id="payment-copy" type="button">Salin tautan</button>
            <a class="payment-action" href="${escapeHtml(checkoutPath)}" target="_blank" rel="noopener">Buka pembayaran</a>
        </div>
        <p class="payment-feedback" id="payment-copy-message" role="status" hidden></p>
    </div>`;
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
