(() => {
    'use strict';

    const form = document.getElementById('payment-form');
    const submit = document.getElementById('payment-create');
    const amount = document.getElementById('payment-amount');
    let submitting = false;

    amount.addEventListener('input', () => {
        amount.setCustomValidity('');
        if (/^\d+$/.test(amount.value) &&
            (!Number.isSafeInteger(Number(amount.value)) || Number(amount.value) <= 0)) {
            amount.setCustomValidity('Masukkan nominal rupiah berupa bilangan bulat positif yang valid.');
        }
    });
    form.addEventListener('submit', (event) => {
        if (submitting) {
            event.preventDefault();
            return;
        }
        submitting = true;
        submit.disabled = true;
        submit.textContent = 'Membuat QRIS…';
        form.setAttribute('aria-busy', 'true');
    });
    window.addEventListener('pageshow', () => {
        submitting = false;
        submit.disabled = amount.disabled;
        submit.textContent = 'Buat QRIS';
        form.removeAttribute('aria-busy');
    });

    const result = document.getElementById('payment-result');
    if (!result) return;
    const summaryUrl = new URL('/dashboard', window.location.origin);
    summaryUrl.searchParams.set('tab', form.elements.tab.value);
    summaryUrl.searchParams.set('payment', result.dataset.qrisId);

    const link = document.getElementById('payment-link');
    const copyMessage = document.getElementById('payment-copy-message');
    link.value = new URL(link.value, window.location.origin).href;
    document.getElementById('payment-copy').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(link.value);
            copyMessage.textContent = 'Tautan pembayaran berhasil disalin.';
        } catch {
            link.focus();
            link.select();
            copyMessage.textContent = 'Salin tautan yang dipilih secara manual.';
        }
        copyMessage.hidden = false;
    });

    const qr = document.getElementById('payment-qr');
    const qrBox = document.getElementById('payment-qr-box');
    const imageLoading = document.getElementById('payment-image-loading');
    const imageError = document.getElementById('payment-image-error');
    const countdown = document.getElementById('payment-countdown');
    const status = document.getElementById('payment-status');
    const stateMessage = document.getElementById('payment-state-message');
    const pollError = document.getElementById('payment-poll-error');
    const expiresAt = Date.parse(result.dataset.expiresAt);
    let stopped = result.dataset.status !== 'PENDING';
    let polling = false;
    let pollTimer = null;
    let countdownTimer = null;
    let activeController = null;

    function imageLoaded() {
        imageLoading.hidden = true;
        imageError.hidden = true;
    }
    function imageFailed() {
        imageLoading.hidden = true;
        imageError.hidden = stopped;
        qrBox.hidden = true;
    }
    qr.addEventListener('load', imageLoaded);
    qr.addEventListener('error', imageFailed);
    if (qr.complete) {
        if (qr.naturalWidth > 0) imageLoaded();
        else imageFailed();
    }

    function updateCountdown() {
        if (stopped) return;
        const remaining = Math.max(0, expiresAt - Date.now());
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        countdown.textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
        if (remaining === 0) stateMessage.textContent = 'Memastikan status pembayaran…';
    }

    async function request(url, read) {
        const controller = new AbortController();
        activeController = controller;
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(url, {
                credentials: 'same-origin',
                cache: 'no-store',
                signal: controller.signal
            });
            if (!response.ok) throw new Error('Request failed');
            return await read(response);
        } finally {
            clearTimeout(timeout);
            if (activeController === controller) activeController = null;
        }
    }

    async function refreshSummary() {
        try {
            const html = await request(summaryUrl.href, (response) => response.text());
            const page = new DOMParser().parseFromString(html, 'text/html');
            for (const id of ['dashboard-stats', 'dashboard-tabs', 'dashboard-table']) {
                if (!page.getElementById(id)) throw new Error('Dashboard unavailable');
            }
            for (const id of ['dashboard-stats', 'dashboard-tabs', 'dashboard-table']) {
                document.getElementById(id).replaceChildren(...page.getElementById(id).childNodes);
            }
        } catch {
            pollError.textContent = 'Status pembayaran sudah diperbarui, tetapi ringkasan gagal dimuat. Gunakan Refresh untuk memuat riwayat terbaru.';
            pollError.hidden = false;
        }
    }

    async function poll() {
        if (stopped || polling) return;
        polling = true;
        try {
            const data = await request('/api/qr-status/' + encodeURIComponent(result.dataset.qrisId),
                (response) => response.json());
            if (!data.success || data.qris_id !== result.dataset.qrisId ||
                !['PENDING', 'PAID', 'EXPIRED'].includes(data.status)) {
                throw new Error('Invalid status');
            }
            pollError.hidden = true;
            if (data.status === 'PENDING') return;

            stopped = true;
            result.dataset.status = data.status;
            clearTimeout(pollTimer);
            clearInterval(countdownTimer);
            const paid = data.status === 'PAID';
            status.textContent = paid ? 'PAID / LUNAS' : 'EXPIRED';
            status.className = 'badge-status ' + (paid ? 'badge-paid' : 'badge-expired');
            stateMessage.textContent = paid ? 'Pembayaran berhasil diterima.' :
                'QRIS telah kedaluwarsa. Buat pembayaran baru jika diperlukan.';
            qrBox.hidden = true;
            imageLoading.hidden = true;
            imageError.hidden = true;
            document.getElementById('payment-timer-label').hidden = true;
            document.getElementById('payment-timer').hidden = true;
            await refreshSummary();
        } catch {
            pollError.textContent = 'Status belum dapat diperiksa. Mencoba kembali otomatis; status terakhir tetap ditampilkan.';
            pollError.hidden = false;
        } finally {
            polling = false;
            if (!stopped) pollTimer = setTimeout(poll, 3000);
        }
    }

    window.addEventListener('pagehide', () => {
        stopped = true;
        clearTimeout(pollTimer);
        clearInterval(countdownTimer);
        activeController?.abort();
    });
    window.addEventListener('pageshow', (event) => {
        if (event.persisted && result.dataset.status === 'PENDING') {
            stopped = false;
            updateCountdown();
            clearInterval(countdownTimer);
            countdownTimer = setInterval(updateCountdown, 1000);
            poll();
        }
    });

    if (!stopped) {
        updateCountdown();
        countdownTimer = setInterval(updateCountdown, 1000);
        poll();
    }
})();
