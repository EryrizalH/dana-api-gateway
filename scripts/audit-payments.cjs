const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dana-payment-audit-'));
const originalCwd = process.cwd();
const nativeFetch = globalThis.fetch;
const originalLog = console.log;
const callbackUrl = 'http://127.0.0.1:1/audit-callback';
const fixtureEnv = {
    NODE_ENV: 'test',
    DATABASE_PATH: path.join(tempDir, 'audit.sqlite'),
    DATA_DIR: tempDir,
    API_KEY: 'audit-synthetic-key',
    QRIS_STATIC: '',
    PAYMENT_WEBHOOK_URL: callbackUrl,
    PAYMENT_WEBHOOK_SECRET: 'audit-synthetic-callback-secret',
    ADMIN_USERNAME: 'audit-synthetic-admin',
    ADMIN_PASSWORD: 'audit-synthetic-password'
};
const previousEnv = Object.fromEntries(
    Object.keys(fixtureEnv).map(key => [key, process.env[key]])
);
const callbacks = [];
let gateway;
let database;
let crashChild;
let observed = 0;

function report(group, detail) {
    observed += 1;
    process.stdout.write(`OBSERVED [${group}] ${detail}\n`);
}

function tlv(tag, value) {
    return `${tag}${String(value.length).padStart(2, '0')}${value}`;
}

function readTags(payload) {
    const tags = [];
    let position = 0;
    while (position < payload.length) {
        const header = payload.slice(position, position + 4);
        assert.match(header, /^\d{4}$/);
        const length = Number(header.slice(2));
        const value = payload.slice(position + 4, position + 4 + length);
        assert.equal(value.length, length);
        tags.push({ tag: header.slice(0, 2), value });
        position += 4 + length;
    }
    return tags;
}

async function observeNotificationCrash(template) {
    const childDir = path.join(tempDir, 'crash-child');
    fs.mkdirSync(childDir);
    const childDatabasePath = path.join(childDir, 'fixture.sqlite');
    const childCode = `
        const http = require('node:http');
        globalThis.fetch = async () => { throw new Error('Unexpected callback dispatch'); };
        const { app } = require(${JSON.stringify(path.join(root, 'server.js'))});
        const database = require(${JSON.stringify(path.join(root, 'db.js'))});
        database.insertTransaction({
            qris_id: 'audit-crash-qris', trx_id: 'TRX-AUDIT-CRASH', amount: 25000,
            qris_code: ${JSON.stringify(template)}, reference_id: 'audit-crash-order',
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 300000).toISOString()
        });
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => console.log('AUDIT_PORT ' + server.address().port));
    `;
    crashChild = spawn(process.execPath, ['-e', childCode], {
        cwd: childDir,
        env: {
            ...process.env,
            ...fixtureEnv,
            DATABASE_PATH: childDatabasePath,
            DATA_DIR: childDir,
            QRIS_STATIC: template
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const child = crashChild;
    let output = '';
    let errors = '';
    child.stderr.on('data', data => { errors += data; });
    const exit = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
        const port = await new Promise((resolve, reject) => {
            child.stdout.on('data', data => {
                output += data;
                const match = output.match(/AUDIT_PORT (\d+)/);
                if (match) resolve(Number(match[1]));
            });
            child.once('error', reject);
            child.once('exit', () => reject(new Error('Crash fixture exited before listening')));
        });
        const request = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': fixtureEnv.API_KEY },
            body: JSON.stringify({ amount: 25000, text: { unexpected: 'object' } }),
            redirect: 'manual',
            signal: AbortSignal.timeout(5000)
        };
        let connectionFailed = false;
        try {
            await nativeFetch(`http://127.0.0.1:${port}/api/notifications`, request);
        } catch {
            connectionFailed = true;
        }
        const result = await exit;
        assert.equal(result.code, 1, 'Invalid text reproduces an unhandled route rejection');
        assert.equal(result.signal, null);
        assert.equal(connectionFailed, true, 'The HTTP request loses its connection');
        assert.match(errors, /TypeError: Provided value cannot be bound to SQLite parameter 2/);
        const readOnlyDatabase = new DatabaseSync(childDatabasePath, { readOnly: true });
        try {
            const transaction = readOnlyDatabase.prepare(
                'SELECT status FROM transactions WHERE qris_id = ?'
            ).get('audit-crash-qris');
            const notifications = readOnlyDatabase.prepare(
                'SELECT COUNT(*) AS count FROM notifications'
            ).get();
            assert.equal(transaction.status, 'PAID');
            assert.equal(notifications.count, 0);
        } finally {
            readOnlyDatabase.close();
        }
        report('invalid-text-crash', 'JSON text object: process exit 1, HTTP disconnected, PAID persisted, zero notification records; callback was never reached.');
    } finally {
        clearTimeout(timeout);
        if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
            await exit;
        }
        crashChild = undefined;
    }
}

async function main() {
    process.chdir(tempDir);
    Object.assign(process.env, fixtureEnv);
    console.log = () => {};
    globalThis.fetch = async (url, options) => {
        assert.equal(String(url), callbackUrl, 'Runtime fetch is restricted to the callback mock');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['x-webhook-secret'], fixtureEnv.PAYMENT_WEBHOOK_SECRET);
        callbacks.push(JSON.parse(options.body));
        return new Response(null, { status: 200 });
    };

    const { app, calculateCRC16, extractAmountFromPayload } = require(path.join(root, 'server.js'));
    database = require(path.join(root, 'db.js'));
    const template = (name = 'TOKO FIXTURE', merchant = '123456789012345') => {
        const prefix = tlv('00', '01') + tlv('01', '11') +
            tlv('26', tlv('00', 'ID.CO.DANA.WWW') + tlv('01', merchant)) +
            tlv('52', '0000') + tlv('53', '360') + tlv('58', 'ID') +
            tlv('59', name) + tlv('60', 'JAKARTA') + '6304';
        return prefix + calculateCRC16(prefix);
    };
    process.env.QRIS_STATIC = template();
    gateway = http.createServer(app);
    await new Promise((resolve, reject) => {
        gateway.once('error', reject);
        gateway.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${gateway.address().port}`;
    async function request(route, body, contentType = 'application/json') {
        const target = new URL(route, base);
        assert.equal(target.origin, base, 'Probe requests must stay on the fixture gateway');
        const response = await nativeFetch(target, {
            method: 'POST',
            headers: { 'Content-Type': contentType, 'x-api-key': fixtureEnv.API_KEY },
            body: contentType === 'application/json' ? JSON.stringify(body) : body,
            redirect: 'manual',
            signal: AbortSignal.timeout(5000)
        });
        const text = await response.text();
        let json;
        try { json = JSON.parse(text); } catch { json = null; }
        return { status: response.status, json };
    }
    async function create(body) {
        const result = await request('/create-qris', body);
        assert.equal(result.status, 200);
        assert.equal(result.json.success, true);
        return result.json.data;
    }
    async function notify(body) {
        const result = await request('/api/notifications', body);
        assert.equal(result.status, 200);
        assert.equal(result.json.success, true);
        return result.json;
    }

    assert.equal(calculateCRC16('123456789'), '29B1');
    const normal = await create({ amount: 25000, reference_id: 'audit-control' });
    const normalTags = readTags(normal.qris_code);
    assert.equal(normal.amount, 25000);
    assert.equal(normal.status, 'PENDING');
    assert.equal(normalTags.find(tag => tag.tag === '01').value, '12');
    assert.equal(normalTags.find(tag => tag.tag === '54').value, '25000');
    process.stdout.write('VALIDATED [fixture-control] Integer create returns PENDING with amount 25000 and dynamic tag 01; CRC check vector is 29B1.\n');

    const exponent = await create({ amount: '1e4' });
    const fraction = await create({ amount: 10000.99 });
    const infinity = await request('/create-qris', { amount: 'Infinity' });
    assert.equal(exponent.amount, 1);
    assert.equal(fraction.amount, 10000);
    assert.equal(infinity.status, 500);
    assert.equal(infinity.json, null);
    report('amount-coercion', 'Create accepts "1e4" as 1 and 10000.99 as 10000; "Infinity" produces HTTP 500 with a non-JSON response.');

    for (const invalidTemplate of ['not-qris', ' ']) {
        const invalid = await create({ amount: 23456, qris_static: invalidTemplate });
        assert.deepEqual(readTags(invalid.qris_code).map(tag => tag.tag), ['54', '63']);
    }
    const nameTruncated = await create({ amount: 23456, qris_static: template('TOKO 6304 BARU') });
    const nameTags = readTags(nameTruncated.qris_code);
    assert.equal(nameTags.find(tag => tag.tag === '59').value, 'TOKO ');
    assert.equal(nameTags.some(tag => tag.tag === '60'), false);
    const merchantTruncated = await create({
        amount: 23456, qris_static: template('TOKO FIXTURE', '12630489012345')
    });
    const merchantTags = readTags(merchantTruncated.qris_code);
    assert.equal(merchantTags.find(tag => tag.tag === '26').value, '0014ID.CO.DANA.WWW011412');
    assert.equal(merchantTags.some(tag => tag.tag === '53'), false);
    report('malformed-tlv', 'Malformed/blank templates return HTTP 200 containing only tags 54 and 63; a 6304 substring inside merchant/name values truncates the template and loses fields.');

    assert.equal(extractAmountFromPayload({ body: { amount: -15000 } }), 15000);
    assert.equal(extractAmountFromPayload({ body: { amount: '15000.00' } }), 1500000);
    assert.equal(extractAmountFromPayload({ body: { amount: '15.000,00' } }), 1500000);
    const negative = await create({ amount: 15000, reference_id: 'audit-negative' });
    const negativeResult = await notify({ amount: -15000, text: 'Synthetic negative amount' });
    assert.equal(negativeResult.matched, true);
    assert.equal(negativeResult.data.qris_id, negative.qris_id);
    assert.equal(negativeResult.data.status, 'PAID');
    const decimal = await create({ amount: 1500000, reference_id: 'audit-decimal' });
    const decimalResult = await notify({ text: 'Anda menerima Rp 15.000,00' });
    assert.equal(decimalResult.data.qris_id, decimal.qris_id);
    assert.equal(decimalResult.data.amount, 1500000);
    assert.equal(decimalResult.data.status, 'PAID');
    assert.equal(callbacks.at(-1).amount, 1500000);
    report('notification-amount', 'Negative -15000 pays a 15000 order; synthetic "Rp 15.000,00" pays a 1500000 order and the callback mock receives that amount.');

    const failure = await create({ amount: 43210, reference_id: 'audit-failed-text' });
    const failureResult = await notify({ text: 'Pembayaran gagal Rp 43210' });
    assert.equal(failureResult.data.qris_id, failure.qris_id);
    assert.equal(failureResult.data.status, 'PAID');
    assert.equal(extractAmountFromPayload({ body: { text: 'DANA: Anda mengirim Rp 15000' } }), 15000);
    assert.equal(extractAmountFromPayload({ body: { text: 'Kode OTP DANA 15000' } }), 15000);
    report('notification-semantics', 'Failed-payment text pays the matched order; outgoing and OTP text also yield an amount. The sender must filter notification meaning.');

    const first = await create({ amount: 22222, reference_id: 'audit-duplicate-reference' });
    const second = await create({ amount: 22222, reference_id: 'audit-duplicate-reference' });
    assert.notEqual(first.qris_id, second.qris_id);
    const duplicateBody = { text: 'Anda menerima Rp 22.222' };
    const firstPaid = await notify(duplicateBody);
    const secondPaid = await notify(duplicateBody);
    assert.equal(firstPaid.data.qris_id, first.qris_id);
    assert.equal(secondPaid.data.qris_id, second.qris_id);
    assert.equal(firstPaid.data.status, 'PAID');
    assert.equal(secondPaid.data.status, 'PAID');
    report('duplicate-fifo', 'Two creates with the same reference produce distinct orders; one identical notification sent twice pays both in FIFO order.');

    const plain = await request('/api/notifications', 'Anda menerima Rp 33333', 'text/plain');
    assert.equal(plain.status, 400);
    assert.equal(plain.json.success, false);
    report('plain-text', 'A text/plain notification containing a valid-looking nominal is rejected with HTTP 400; the body middleware does not parse it.');

    const expired = await create({ amount: 44444, reference_id: 'audit-expired-control' });
    database.db.prepare('UPDATE transactions SET expires_at = ? WHERE qris_id = ?').run(
        new Date(Date.now() - 1000).toISOString(), expired.qris_id
    );
    const late = await notify({ amount: 44444 });
    assert.equal(late.matched, false);
    assert.equal(database.getTransactionByQrisId(expired.qris_id).status, 'EXPIRED');
    process.stdout.write('VALIDATED [expiry-control] A transaction past its expiry is not matched and becomes EXPIRED.\n');

    await observeNotificationCrash(template());
    process.stdout.write(`Audit reproduction complete: ${observed} observed defect/limitation groups. Assertions confirm reproduction, not payment safety. No production verification.\n`);
}

main().catch(error => {
    process.stderr.write(`AUDIT FAILED: ${error.message}\n`);
    process.exitCode = 1;
}).finally(async () => {
    if (crashChild && crashChild.exitCode === null && crashChild.signalCode === null) {
        const exited = new Promise(resolve => crashChild.once('exit', resolve));
        crashChild.kill('SIGKILL');
        await exited;
    }
    if (gateway) await new Promise(resolve => gateway.close(resolve));
    if (database) database.db.close();
    globalThis.fetch = nativeFetch;
    console.log = originalLog;
    process.chdir(originalCwd);
    for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
});
