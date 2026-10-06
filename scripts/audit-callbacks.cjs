#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

// These assertions reproduce the audited behavior, including defects. A passing
// probe confirms the observations; it does not certify correct gateway behavior.
const root = path.resolve(__dirname, '..');
const originalCwd = process.cwd();
const nativeFetch = globalThis.fetch;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dana-callback-audit-'));
const callbackUrl = 'http://127.0.0.1:1/audit-mock';
const callbackConfig = { url: callbackUrl, secret: 'fixture-webhook-secret' };
let server;
let database;
let base;
let callbackStatus = 503;
let paidAttempts = 0;

function observed(name, evidence) {
    console.log(`OBSERVED ${name}: ${JSON.stringify(evidence)}`);
}

function insertExpired(id) {
    database.insertTransaction({
        qris_id: id,
        trx_id: `TRX-${id}`,
        amount: 1000,
        qris_code: 'fixture-qris',
        created_at: new Date(Date.now() - 600000).toISOString(),
        expires_at: new Date(Date.now() - 1000).toISOString(),
        reference_id: `ORDER-${id}`
    });
}

async function request(route, options = {}) {
    const url = new URL(route, base);
    assert.equal(url.origin, base, 'Audit HTTP requests must stay on the fixture server');
    return nativeFetch(url, {
        ...options,
        redirect: 'manual',
        signal: AbortSignal.timeout(5000)
    });
}

function post(body) {
    return {
        method: 'POST',
        headers: { 'x-api-key': 'fixture-api-key', 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

async function json(route, options, expectedStatus = 200) {
    const response = await request(route, options);
    assert.equal(response.status, expectedStatus, `${route}: unexpected fixture status`);
    return response.json();
}

function cashierContext(initialNow) {
    let now = initialNow;
    let nextTimer = 0;
    let fetchCalls = 0;
    const nodes = new Map();
    const timers = new Map();
    const context = {
        Date: { now: () => now },
        document: {
            getElementById(id) {
                if (!nodes.has(id)) nodes.set(id, { style: {}, innerText: '', className: '' });
                return nodes.get(id);
            }
        },
        setInterval(fn, delay) {
            timers.set(++nextTimer, { fn, delay });
            return nextTimer;
        },
        clearInterval(id) { timers.delete(id); },
        navigator: { clipboard: { writeText: async () => {} } },
        setTimeout() {},
        prompt() {},
        console,
        fetch: async () => {
            fetchCalls += 1;
            return { json: async () => ({ success: true, paid: true, status: 'PAID' }) };
        }
    };
    return {
        context, nodes, timers,
        setNow(value) { now = value; },
        fetchCalls() { return fetchCalls; }
    };
}

async function main() {
    process.chdir(tempDir);
    Object.assign(process.env, {
        NODE_ENV: 'test',
        DATABASE_PATH: path.join(tempDir, 'audit.sqlite'),
        DATA_DIR: tempDir,
        API_KEY: 'fixture-api-key',
        ADMIN_USERNAME: 'fixture-admin',
        ADMIN_PASSWORD: 'fixture-admin-password',
        QRIS_STATIC: '',
        PAYMENT_WEBHOOK_URL: callbackUrl,
        PAYMENT_WEBHOOK_SECRET: callbackConfig.secret
    });
    globalThis.fetch = async (url) => {
        assert.equal(String(url), callbackUrl, 'Gateway callback must use the in-memory fixture');
        paidAttempts += 1;
        return new Response(null, { status: callbackStatus });
    };

    const gateway = require(path.join(root, 'server.js'));
    database = require(path.join(root, 'db.js'));

    insertExpired('concurrent-1');
    insertExpired('concurrent-2');
    const concurrencyCalls = [];
    let releaseFirst;
    const firstBlocked = new Promise(resolve => { releaseFirst = resolve; });
    const concurrentFetch = async (_, options) => {
        const id = JSON.parse(options.body).qris_id;
        concurrencyCalls.push(id);
        if (id === 'concurrent-1') await firstBlocked;
        return new Response(null, { status: 204 });
    };
    const sweepA = gateway.processExpiredWebhooks(callbackConfig, concurrentFetch);
    try {
        await gateway.processExpiredWebhooks(callbackConfig, concurrentFetch);
    } finally {
        releaseFirst();
    }
    await sweepA;
    assert.deepEqual(concurrencyCalls, ['concurrent-1', 'concurrent-2', 'concurrent-2']);
    observed('concurrent expiry sends one transaction twice', { calls: concurrencyCalls });

    insertExpired('expired-failure');
    let failedExpiryAttempts = 0;
    const expiredFailure = await gateway.processExpiredWebhooks(callbackConfig, async () => {
        failedExpiryAttempts += 1;
        return new Response(null, { status: 503 });
    });
    let recoveryCalls = 0;
    const recovery = await gateway.processExpiredWebhooks(callbackConfig, async () => {
        recoveryCalls += 1;
        return new Response(null, { status: 204 });
    });
    const flag = database.db.prepare('SELECT expiry_webhook_sent FROM transactions WHERE qris_id = ?')
        .get('expired-failure').expiry_webhook_sent;
    assert.deepEqual(expiredFailure[0].callback, { status: 'failed', attempts: 3 });
    assert.equal(failedExpiryAttempts, 3);
    assert.equal(flag, 1);
    assert.equal(recoveryCalls, 0);
    assert.equal(recovery.length, 0);
    observed('failed expiry stops dispatch despite receiver recovery', {
        callback: expiredFailure[0].callback, expiry_webhook_sent: flag, recoveryCalls
    });

    const tlv = (tag, value) => `${tag}${String(value.length).padStart(2, '0')}${value}`;
    const template = tlv('00', '01') + tlv('01', '11') +
        tlv('26', tlv('00', 'ID.CO.DANA.WWW') + tlv('01', '123456789012345')) +
        tlv('52', '0000') + tlv('53', '360') + tlv('58', 'ID') +
        tlv('59', 'TOKO FIXTURE') + tlv('60', 'JAKARTA') + '6304';
    process.env.QRIS_STATIC = template + gateway.calculateCRC16(template);
    server = http.createServer(gateway.app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;

    const paid = (await json('/create-qris', post({ amount: 4100, reference_id: 'PAID-FAILURE' }))).data;
    const notification = await json('/api/notifications', post({ amount: 4100 }));
    callbackStatus = 204;
    const afterPaidFailure = await json(`/api/qr-status/${paid.qris_id}`);
    const paidRecovery = await gateway.processExpiredWebhooks();
    assert.deepEqual(notification.data.callback, { status: 'failed', attempts: 3 });
    assert.equal(afterPaidFailure.status, 'PAID');
    assert.equal(paidAttempts, 3);
    assert.equal(paidRecovery.length, 0);
    observed('paid callback failure has no later redispatch', {
        status: afterPaidFailure.status, callback: notification.data.callback,
        callbackCallsIncludingRecovery: paidAttempts, expiryDispatcherResults: paidRecovery.length
    });

    const login = await request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: 'fixture-admin', password: 'fixture-admin-password' })
    });
    assert.equal(login.status, 302);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/dashboard', { headers: { Cookie: cookie } })).status, 200);
    const malformed = await request('/dashboard', { headers: { Cookie: `${cookie}; unrelated=%` } });
    assert.equal(malformed.status, 500);
    observed('unrelated malformed cookie breaks authenticated dashboard', { status: malformed.status });

    const cashier = (await json('/create-qris', post({ amount: 4200, reference_id: 'UI-FIXTURE' }))).data;
    const response = await request(`/qr/${cashier.qris_id}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const expiresAt = Date.parse(cashier.expires_at);
    const delayed = cashierContext(expiresAt + 1);
    let initializationError;
    try {
        vm.runInNewContext(script, delayed.context);
    } catch (error) {
        initializationError = error;
    }
    assert.equal(initializationError?.name, 'ReferenceError');
    assert.match(initializationError.message, /pollInterval.*before initialization/);
    observed('cashier script arriving after deadline throws', {
        name: initializationError.name, message: initializationError.message
    });

    const boundary = cashierContext(expiresAt - 1000);
    vm.runInNewContext(script, boundary.context);
    boundary.setNow(expiresAt + 1);
    for (const timer of [...boundary.timers.values()]) {
        if (timer.delay === 1000) timer.fn();
    }
    await boundary.context.checkPaymentStatus();
    assert.equal(boundary.nodes.get('status-text').innerText, 'QRIS Kedaluwarsa');
    assert.equal(boundary.fetchCalls(), 0);
    assert.equal(boundary.timers.size, 0);
    observed('cashier deadline blocks a final paid status read', {
        statusText: boundary.nodes.get('status-text').innerText,
        fetchCalls: boundary.fetchCalls(), timersLeft: boundary.timers.size,
        serverStatusFixture: 'PAID'
    });
    console.log('Audit probes reproduced six observations (temporary SQLite, loopback HTTP, callback mocks, cashier VM).');
}

main().catch(error => {
    console.error('Audit probe failed to reproduce the expected observation:', error.message);
    process.exitCode = 1;
}).finally(async () => {
    try {
        if (server?.listening) {
            await new Promise((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
                server.closeAllConnections?.();
            });
        }
        database?.db.close();
    } finally {
        globalThis.fetch = nativeFetch;
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
