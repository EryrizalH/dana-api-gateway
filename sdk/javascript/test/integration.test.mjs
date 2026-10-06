import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DanaGatewayClient, parsePaymentCallback } from '../index.js';

test('SDK works against real gateway HTTP and SQLite with loopback callbacks', async () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dana-sdk-'));
    const cwd = process.cwd();
    const savedEnv = { ...process.env };
    const savedFetch = globalThis.fetch;
    const ports = new Set();
    const callbacks = [];
    let gateway, receiver, database;
    let receiverStatus = 204;
    async function listen(server) {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        ports.add(String(server.address().port));
        return `http://127.0.0.1:${server.address().port}`;
    }
    async function close(server) {
        if (!server?.listening) return;
        await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
    }
    try {
        process.chdir(temp);
        Object.assign(process.env, { DATABASE_PATH: path.join(temp, 'db.sqlite'), DATA_DIR: temp,
            API_KEY: 'fixture-key', ADMIN_USERNAME: 'fixture', ADMIN_PASSWORD: 'fixture',
            QRIS_STATIC: '', PAYMENT_WEBHOOK_URL: '', PAYMENT_WEBHOOK_SECRET: 'fixture-secret' });
        globalThis.fetch = (input, options = {}) => {
            const url = new URL(input);
            assert.equal(url.protocol, 'http:');
            assert.equal(url.hostname, '127.0.0.1');
            assert.ok(ports.has(url.port));
            return savedFetch(input, { ...options, redirect: 'error' });
        };
        receiver = http.createServer(async (req, res) => {
            let body = '';
            for await (const chunk of req) body += chunk;
            try {
                const request = new Request('http://127.0.0.1/callback', { method: req.method, headers: req.headers, body });
                callbacks.push(await parsePaymentCallback(request, 'fixture-secret'));
                res.writeHead(receiverStatus).end();
            } catch { res.writeHead(400).end(); }
        });
        process.env.PAYMENT_WEBHOOK_URL = (await listen(receiver)) + '/callback';
        const require = createRequire(import.meta.url);
        const { app, calculateCRC16, processExpiredWebhooks } = require(path.join(root, 'server.js'));
        database = require(path.join(root, 'db.js'));
        const tlv = (tag, value) => `${tag}${String(value.length).padStart(2, '0')}${value}`;
        const template = tlv('00', '01') + tlv('01', '11') + tlv('26', tlv('00', 'ID.CO.DANA.WWW') + tlv('01', '123456789012345')) +
            tlv('52', '0000') + tlv('53', '360') + tlv('58', 'ID') + tlv('59', 'TOKO FIXTURE') + tlv('60', 'JAKARTA') + '6304';
        process.env.QRIS_STATIC = template + calculateCRC16(template);
        gateway = http.createServer(app);
        const baseUrl = await listen(gateway);
        const client = new DanaGatewayClient({ baseUrl, apiKey: 'fixture-key' });
        const publicClient = new DanaGatewayClient({ baseUrl });
        assert.equal((await client.health()).status, 'OK');
        const created = await client.createQris({ amount: 25000, referenceId: 'SDK-ORDER' });
        assert.equal(created.status, 'PENDING');
        assert.equal((await publicClient.getStatus(created.trx_id)).qris_id, created.qris_id);
        assert.equal((await publicClient.getQris(created.qris_id)).qris_code, created.qris_code);
        const paid = await client.notifyPayment({ amount: 25000, text: 'Fixture menerima Rp 25.000' });
        assert.equal(paid.matched, true);
        assert.equal(paid.data.callback.status, 'delivered');
        assert.equal(callbacks[0].event, 'payment.paid');
        assert.equal((await client.checkPayment(created.trx_id)).status, 'PAID');
        assert.equal((await publicClient.getStatus(created.qris_id)).paid, true);
        const expired = await client.createQris({ amount: 26000, referenceId: 'SDK-EXPIRED' });
        database.db.prepare('UPDATE transactions SET expires_at = ? WHERE qris_id = ?').run(new Date(Date.now() - 1000).toISOString(), expired.qris_id);
        await processExpiredWebhooks();
        assert.equal((await client.getStatus(expired.qris_id)).status, 'EXPIRED');
        assert.equal(callbacks.at(-1).event, 'payment.expired');
        const failed = await client.createQris({ amount: 27000, referenceId: 'SDK-FAILED-CALLBACK' });
        receiverStatus = 503;
        assert.equal((await client.notifyPayment({ amount: 27000 })).data.callback.status, 'failed');
        assert.equal((await client.checkPayment(failed.trx_id)).status, 'PAID');
        assert.equal((await client.notifyPayment({ amount: 99000 })).matched, false);
        await assert.rejects(client.getStatus('missing-fixture'), error => error.code === 'HTTP_ERROR' && error.status === 404);
    } finally {
        await close(gateway);
        await close(receiver);
        database?.db.close();
        globalThis.fetch = savedFetch;
        for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
        Object.assign(process.env, savedEnv);
        process.chdir(cwd);
        fs.rmSync(temp, { recursive: true, force: true });
    }
});
