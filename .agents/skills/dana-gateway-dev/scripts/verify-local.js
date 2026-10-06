#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../../..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dana-gateway-verify-'));
const originalCwd = process.cwd();
const nativeFetch = globalThis.fetch;
const loopbackPorts = new Set();
const callbacks = [];
const fixtureEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_PATH: path.join(tempDir, 'http.sqlite'),
    DATA_DIR: tempDir,
    API_KEY: 'local-fixture-api-key',
    ADMIN_USERNAME: 'fixture-admin',
    ADMIN_PASSWORD: 'local-fixture-password',
    QRIS_STATIC: '',
    PAYMENT_WEBHOOK_URL: '',
    PAYMENT_WEBHOOK_SECRET: 'local-fixture-webhook-secret'
};
let gateway;
let receiver;
let database;
let callbackStatus = 204;

function runNode(args, cwd = root) {
    const result = spawnSync(process.execPath, args, {
        cwd,
        env: fixtureEnv,
        encoding: 'utf8',
        timeout: 30000
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Node check failed: ${path.basename(args.at(-1))}`);
}

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            loopbackPorts.add(String(server.address().port));
            resolve(server);
        });
    });
}

async function close(server) {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections?.();
    });
}

async function main() {
    const { DatabaseSync } = require('node:sqlite');
    assert.equal(typeof DatabaseSync, 'function', 'Node runtime needs native SQLite');
    for (const file of ['server.js', 'db.js', 'views.js', 'public/dashboard.js', 'selfcheck.js']) {
        runNode(['--check', path.join(root, file)]);
    }
    runNode(['--check', __filename]);
    console.log('syntax checks OK');
    runNode(['--test', path.join(root, 'scripts/dashboard-client.test.cjs')], tempDir);

    // dotenv resolves .env from cwd; the selfcheck and app must run outside the checkout.
    runNode([path.join(root, 'selfcheck.js')], tempDir);
    process.chdir(tempDir);
    Object.assign(process.env, fixtureEnv);

    globalThis.fetch = (input, options = {}) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        assert.equal(url.protocol, 'http:', 'Verification permits local HTTP only');
        assert.equal(url.hostname, '127.0.0.1', 'Verification blocks external fetch');
        assert.ok(loopbackPorts.has(url.port), 'Verification blocks unrelated local services');
        return nativeFetch(input, {
            ...options,
            redirect: 'manual',
            signal: options.signal || AbortSignal.timeout(5000)
        });
    };

    receiver = http.createServer((req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                assert.equal(req.method, 'POST');
                assert.equal(req.url, '/callback');
                assert.equal(req.headers['x-webhook-secret'], fixtureEnv.PAYMENT_WEBHOOK_SECRET);
                callbacks.push(JSON.parse(body));
                res.writeHead(callbackStatus).end();
            } catch {
                res.writeHead(400).end();
            }
        });
    });
    await listen(receiver);
    process.env.PAYMENT_WEBHOOK_URL = `http://127.0.0.1:${receiver.address().port}/callback`;

    const { app, calculateCRC16, processExpiredWebhooks } = require(path.join(root, 'server.js'));
    database = require(path.join(root, 'db.js'));
    assert.equal(calculateCRC16('123456789'), '29B1', 'CRC16 must match the standard check vector');
    const tlv = (tag, value) => `${tag}${String(value.length).padStart(2, '0')}${value}`;
    const template = tlv('00', '01') + tlv('01', '11') +
        tlv('26', tlv('00', 'ID.CO.DANA.WWW') + tlv('01', '123456789012345')) +
        tlv('52', '0000') + tlv('53', '360') + tlv('58', 'ID') +
        tlv('59', 'TOKO FIXTURE') + tlv('60', 'JAKARTA') + '6304';
    process.env.QRIS_STATIC = template + calculateCRC16(template);

    gateway = http.createServer(app);
    await listen(gateway);
    const base = `http://127.0.0.1:${gateway.address().port}`;
    const auth = { 'x-api-key': fixtureEnv.API_KEY };
    const request = (route, options) => fetch(base + route, options);
    async function json(route, options, status = 200) {
        const response = await request(route, options);
        assert.equal(response.status, status, `${route}: unexpected HTTP status`);
        return response.json();
    }
    const post = (body) => ({
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    async function create(amount, reference_id) {
        const start = Date.now();
        const result = await json('/create-qris', post({ amount, reference_id }));
        assert.equal(result.success, true);
        assert.equal(result.data.status, 'PENDING');
        assert.equal(result.data.amount, amount);
        assert.equal(result.data.reference_id, reference_id?.trim() || null);
        const expiry = Date.parse(result.data.expires_at) - start;
        assert.ok(expiry >= 299000 && expiry <= 301000, 'QRIS expiry should be five minutes');
        assert.ok(result.data.qris_url.startsWith(base + '/qr/'));
        return result.data;
    }

    assert.equal((await json('/api/health')).status, 'OK');
    await json('/create-qris', { method: 'POST' }, 401);
    await json('/create-qris', post({ amount: 0 }), 400);
    assert.equal((await json('/api/qr-status/missing-fixture', undefined, 404)).status, 'NOT_FOUND');
    assert.equal((await request('/dashboard')).status, 302);
    const badLogin = await request('/login', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: 'fixture-admin', password: 'incorrect' })
    });
    assert.equal(badLogin.status, 401);
    const login = await request('/login', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: fixtureEnv.ADMIN_USERNAME, password: fixtureEnv.ADMIN_PASSWORD })
    });
    assert.equal(login.status, 302);
    const cookieHeader = login.headers.get('set-cookie');
    assert.ok(cookieHeader?.includes('HttpOnly'));
    const cookie = cookieHeader.split(';')[0];
    const webHeaders = { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' };
    const dashboard = await request('/dashboard', { headers: webHeaders });
    assert.equal(dashboard.status, 200);
    const dashboardHtml = await dashboard.text();
    const csrf = dashboardHtml.match(/name="csrf_token" value="([a-f0-9]+)"/)?.[1];
    assert.ok(csrf, 'Dashboard provides a CSRF token');
    assert.ok(!dashboardHtml.includes(fixtureEnv.API_KEY), 'API key must stay out of dashboard HTML');
    const client = await request('/assets/dashboard.js');
    assert.equal(client.status, 200);
    assert.ok(client.headers.get('content-type').includes('javascript'));
    const transactionCount = () => database.db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count;
    const initialCount = transactionCount();
    const submitPayment = (fields, headers = webHeaders) => request('/dashboard/create-qris', {
        method: 'POST', headers, body: new URLSearchParams(fields)
    });
    assert.equal((await submitPayment({ amount: '41000', csrf_token: csrf }, {
        'Content-Type': 'application/x-www-form-urlencoded', ...auth
    })).status, 302, 'API key alone cannot create dashboard payments');
    assert.equal((await submitPayment({ amount: '41000' })).status, 403);
    assert.equal((await submitPayment({ amount: '41000', csrf_token: 'incorrect' })).status, 403);
    const otherLogin = await request('/login', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: fixtureEnv.ADMIN_USERNAME, password: fixtureEnv.ADMIN_PASSWORD })
    });
    const otherCookie = otherLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await submitPayment({ amount: '41000', csrf_token: csrf }, {
        ...webHeaders, Cookie: otherCookie
    })).status, 403, 'CSRF tokens are bound to the authenticated session');
    await request('/logout', { headers: { Cookie: otherCookie } });
    for (const invalid of ['', '0', '-1', '1.5', '1e4', '25.000', '25,000', 'Infinity', '9007199254740992']) {
        assert.equal((await submitPayment({ amount: invalid, csrf_token: csrf })).status, 400);
    }
    const unsafeInput = await submitPayment({ amount: '<script>alert(1)</script>', csrf_token: csrf });
    assert.equal(unsafeInput.status, 400);
    assert.ok(!(await unsafeInput.text()).includes('value="<script>'), 'Form values must be escaped');
    const configuredTemplate = process.env.QRIS_STATIC;
    process.env.QRIS_STATIC = '   ';
    const missingTemplate = await submitPayment({ amount: '41000', csrf_token: csrf });
    assert.equal(missingTemplate.status, 500);
    assert.equal((await missingTemplate.text()).match(/QRIS statis belum dikonfigurasi/g).length, 1,
        'Configuration errors should only be shown once');
    assert.match(await (await request('/dashboard', { headers: webHeaders })).text(), /QRIS statis belum dikonfigurasi/);
    process.env.QRIS_STATIC = configuredTemplate;
    const insert = database.insertTransaction;
    try {
        database.insertTransaction = () => { throw new Error('fixture write failure'); };
        const failureResponse = await submitPayment({ amount: '41000', csrf_token: csrf });
        assert.equal(failureResponse.status, 500);
        assert.match(await failureResponse.text(), /Pembayaran gagal dibuat/);
    } finally {
        database.insertTransaction = insert;
    }
    assert.equal(transactionCount(), initialCount, 'Invalid and failed requests cannot insert payments');

    const manual = await submitPayment({
        amount: '41000', csrf_token: csrf, reference_id: 'IGNORE-MANUAL-REFERENCE', qris_static: 'ignore-template'
    });
    assert.equal(manual.status, 303);
    const location = manual.headers.get('location');
    assert.match(location, /^\/dashboard\?tab=all&payment=[a-z0-9]+$/);
    const manualId = new URL(location, base).searchParams.get('payment');
    const manualTx = database.getTransactionByQrisId(manualId);
    assert.equal(manualTx.amount, 41000);
    assert.equal(manualTx.status, 'PENDING');
    assert.equal(manualTx.reference_id, null);
    assert.equal(Date.parse(manualTx.expires_at) - Date.parse(manualTx.created_at), 300000);
    assert.match(manualTx.qris_code, /TOKO FIXTURE/);
    const countAfterCreate = transactionCount();
    for (const tab of ['all', 'paid', 'pending', 'expired', 'notifications', 'unknown']) {
        const response = await request(`/dashboard?tab=${tab}&payment=${manualId}`, { headers: webHeaders });
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.ok(html.includes(`data-qris-id="${manualId}"`));
        assert.ok(html.includes(`&amp;payment=${manualId}`), 'Navigation retains selected payment');
    }
    await request(location, { headers: webHeaders });
    assert.equal(transactionCount(), countAfterCreate, 'Refresh and tab changes cannot create more payments');
    const manualCallbacks = callbacks.length;
    const manualPaid = await json('/api/notifications', post({ amount: 41000 }));
    assert.equal(manualPaid.data.qris_id, manualId);
    assert.equal(manualPaid.data.callback.status, 'skipped');
    assert.equal((await json(`/api/qr-status/${manualId}`)).status, 'PAID');
    const paidDashboard = await request(location, { headers: webHeaders });
    assert.match(await paidDashboard.text(), /data-status="PAID"/);
    const expiringManual = await submitPayment({ amount: '42000', csrf_token: csrf });
    assert.equal(expiringManual.status, 303);
    const expiringId = new URL(expiringManual.headers.get('location'), base).searchParams.get('payment');
    database.db.prepare('UPDATE transactions SET expires_at = ? WHERE qris_id = ?')
        .run(new Date(Date.now() - 1000).toISOString(), expiringId);
    assert.equal((await json(`/api/qr-status/${expiringId}`)).status, 'EXPIRED');
    assert.equal((await processExpiredWebhooks()).length, 0);
    assert.equal(callbacks.length, manualCallbacks, 'Manual paid/expired payments do not dispatch callbacks');
    const missing = await request('/dashboard?payment=missing-fixture', { headers: webHeaders });
    assert.equal(missing.status, 200);
    assert.match(await missing.text(), /Pembayaran tidak ditemukan/);
    assert.equal((await request('/logout', { headers: { Cookie: cookie } })).status, 302);
    assert.equal((await request('/dashboard', { headers: { Cookie: cookie } })).status, 302);
    assert.equal((await submitPayment({ amount: '41000', csrf_token: csrf })).status, 302);

    const first = await create(25000, '  LOCAL-ORDER-1  ');
    const second = await create(25000, 'LOCAL-ORDER-2');
    for (const id of [first.qris_id, first.trx_id]) {
        const status = await json(`/api/qr-status/${id}`);
        assert.equal(status.qris_id, first.qris_id);
        assert.equal(status.status, 'PENDING');
    }
    assert.equal((await json(`/api/qr/${first.qris_id}`)).data.qris_code, first.qris_code);
    assert.equal((await request(`/qr/${first.qris_id}`)).status, 200);
    const raw = await request(`/qr/${first.qris_id}?format=raw`);
    assert.equal(raw.status, 302);
    assert.equal(new URL(raw.headers.get('location')).hostname, 'api.qrserver.com');
    const paid = await json('/api/notifications', post({ text: 'Fixture menerima Rp 25.000' }));
    assert.equal(paid.matched, true);
    assert.equal(paid.data.qris_id, first.qris_id, 'Amount matching must select the oldest active QRIS');
    assert.equal(paid.data.callback.status, 'delivered');
    assert.equal(callbacks[0].event, 'payment.paid');
    assert.equal(callbacks[0].status, 'paid');
    assert.equal(callbacks[0].reference_id, 'LOCAL-ORDER-1');
    assert.equal(callbacks[0].amount, 25000);
    assert.equal((await json(`/api/qr-status/${second.qris_id}`)).status, 'PENDING');
    const check = await json(`/check-payment?trx_id=${first.trx_id}`, { headers: auth });
    assert.equal(check.data.status, 'PAID');

    const legacy = await create(27000);
    const callbackCount = callbacks.length;
    const form = await json('/webhook/dana', {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ text: 'Fixture menerima Rp 27.000' })
    });
    assert.equal(form.data.qris_id, legacy.qris_id);
    assert.equal(form.data.callback.status, 'skipped');
    assert.equal(callbacks.length, callbackCount);
    const unmatched = await json('/api/notifications', post({ amount: 99000 }));
    assert.equal(unmatched.matched, false);
    await json('/api/notifications', post({ text: 'fixture tanpa nominal' }), 400);
    await json('/api/notifications', {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{'
    }, 400);

    const failure = await create(32000, 'LOCAL-CALLBACK-FAILURE');
    callbackStatus = 503;
    const failedPaid = await json('/api/notifications', post({ amount: 32000 }));
    callbackStatus = 204;
    assert.equal(failedPaid.data.callback.status, 'failed');
    assert.equal(failedPaid.data.callback.attempts, 3);
    assert.equal((await json(`/api/qr-status/${failure.qris_id}`)).status, 'PAID',
        'Callback failure must preserve the local payment');

    const expired = await create(15000, 'LOCAL-EXPIRED');
    database.db.prepare('UPDATE transactions SET expires_at = ? WHERE qris_id = ?')
        .run(new Date(Date.now() - 10000).toISOString(), expired.qris_id);
    const expiryDispatch = await processExpiredWebhooks();
    assert.equal(expiryDispatch.length, 1);
    assert.equal(expiryDispatch[0].callback.status, 'delivered');
    const expiryCallback = callbacks.at(-1);
    assert.equal(expiryCallback.event, 'payment.expired');
    assert.equal(expiryCallback.status, 'expired');
    assert.equal(expiryCallback.reference_id, 'LOCAL-EXPIRED');
    assert.equal((await processExpiredWebhooks()).length, 0, 'Delivered expiry must not dispatch again');
    assert.equal((await json(`/api/qr-status/${expired.trx_id}`)).status, 'EXPIRED');
    assert.equal((await request(`/qr/${expired.qris_id}?format=raw`)).status, 410);

    console.log('HTTP smoke OK: dashboard create/CSRF/validation, auth, create/status, FIFO, notifications, paid/expired callbacks');
    console.log('Local verification OK (temporary SQLite, loopback only; production unverified)');
}

main().catch(error => {
    console.error('Local verification failed:', error.message);
    process.exitCode = 1;
}).finally(async () => {
    try {
        await close(gateway);
        await close(receiver);
        database?.db.close();
    } finally {
        globalThis.fetch = nativeFetch;
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
