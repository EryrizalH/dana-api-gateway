import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DanaGatewayClient, GatewayError, CallbackValidationError, parsePaymentCallback } from '../index.js';

const fixture = { qris_id: 'fixture', trx_id: 'TRX-FIXTURE', amount: 25000, status: 'PENDING' };
const createdFixture = { ...fixture, reference_id: 'ORDER-1', qris_url: 'https://gateway.example.invalid/qr/fixture',
    qris_code: 'fixture', expires_at: '2026-10-06T12:00:00Z', expires_in: '5 menit' };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('create uses header auth and strict amounts, returns unwrapped data', async () => {
    let calls = 0;
    const client = new DanaGatewayClient({
        baseUrl: 'https://gateway.example.invalid/prefix/', apiKey: 'synthetic-key',
        fetch: async (url, options) => {
            calls++;
            assert.equal(url, 'https://gateway.example.invalid/prefix/create-qris');
            assert.equal(options.method, 'POST');
            assert.equal(options.headers['x-api-key'], 'synthetic-key');
            assert.equal(options.redirect, 'error');
            assert.equal(options.credentials, 'omit');
            assert.deepEqual(JSON.parse(options.body), { amount: 25000, reference_id: 'ORDER-1' });
            return json({ success: true, data: createdFixture });
        }
    });
    assert.deepEqual(await client.createQris({ amount: 25000, referenceId: ' ORDER-1 ' }), createdFixture);
    for (const amount of [0, -1, 1.5, '1e4', Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
        await assert.rejects(client.createQris({ amount }), TypeError);
    }
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(client).includes('synthetic-key'));
});

test('normalizes flat status and nested check/detail while preserving encoded IDs', async () => {
    const calls = [];
    const publicClient = new DanaGatewayClient({ baseUrl: 'https://gateway.example.invalid', fetch: async (url, options) => {
        calls.push(url);
        assert.equal(options.headers['x-api-key'], undefined);
        return json({ success: true, ...fixture, paid: false, paid_at: null, expires_at: '2026-10-06T12:00:00Z' });
    } });
    const status = await publicClient.getStatus('a/b ?');
    assert.equal(status.success, undefined);
    assert.equal(status.status, 'PENDING');
    assert.equal(calls[0], 'https://gateway.example.invalid/api/qr-status/a%2Fb%20%3F');
    await assert.rejects(publicClient.checkPayment('fixture'), TypeError);
    const authenticated = new DanaGatewayClient({ baseUrl: 'https://gateway.example.invalid', apiKey: 'fixture', fetch: async (url, options) => {
        calls.push(url);
        return json({ success: true, data: { ...fixture, paid: false, paid_at: null, qris_code: 'fixture', expires_at: '2026-10-06T12:00:00Z' } });
    } });
    assert.equal((await authenticated.checkPayment('TRX &')).qris_id, 'fixture');
    assert.equal(calls.at(-1), 'https://gateway.example.invalid/check-payment?trx_id=TRX%20%26');
    assert.equal((await authenticated.getQris('fixture')).qris_code, 'fixture');
});

test('unmatched notifications are successful observations and bad input is rejected', async () => {
    let count = 0;
    const client = new DanaGatewayClient({ baseUrl: 'https://gateway.example.invalid', apiKey: 'fixture', fetch: async () => {
        count++;
        return json({ success: true, matched: false, message: 'Fixture unmatched', data: { amount: 25000, received_at: 'fixture' } });
    } });
    assert.equal((await client.notifyPayment({ amount: 25000 })).matched, false);
    await assert.rejects(client.notifyPayment({ amount: -25000 }), TypeError);
    await assert.rejects(client.notifyPayment({ amount: 25000, text: {} }), TypeError);
    assert.equal(count, 1);
});

test('HTTP and malformed response errors are safe; no automatic retry', async () => {
    for (const status of [400, 401, 404, 500]) {
        let calls = 0;
        const client = new DanaGatewayClient({ baseUrl: 'https://gateway.example.invalid', fetch: async () => {
            calls++;
            return new Response('sensitive server error body', { status });
        } });
        await assert.rejects(client.getStatus('fixture'), error => {
            assert.ok(error instanceof GatewayError);
            assert.equal(error.code, 'HTTP_ERROR');
            assert.equal(error.status, status);
            assert.ok(!String(error).includes('sensitive'));
            return true;
        });
        assert.equal(calls, 1);
    }
    for (const response of [new Response('<html>error</html>'), json({ success: true }), json({ success: true, ...fixture, status: 'paid' })]) {
        const client = new DanaGatewayClient({ baseUrl: 'https://gateway.example.invalid', fetch: async () => response });
        await assert.rejects(client.getStatus('fixture'), error => error.code === 'INVALID_RESPONSE');
    }
});

test('timeout and abort cancel fetch, network errors do not disclose underlying errors', async () => {
    const stall = async (url, { signal }) => new Promise((resolve, reject) => {
        if (signal.aborted) reject(new Error('aborted'));
        else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const client = new DanaGatewayClient({ baseUrl: 'https://gateway.example.invalid', timeoutMs: 20, fetch: stall });
    await assert.rejects(client.health(), error => error.code === 'TIMEOUT');
    const controller = new AbortController();
    const pending = client.getStatus('fixture', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error.code === 'ABORTED');
    await assert.rejects(client.health({ signal: controller.signal }), error => error.code === 'ABORTED');
    const network = new DanaGatewayClient({ baseUrl: 'https://gateway.example.invalid', fetch: async () => { throw new Error('secret in upstream error'); } });
    await assert.rejects(network.health(), error => error.code === 'NETWORK_ERROR' && !String(error).includes('secret'));
});

test('incomplete method-specific responses fail instead of violating declared return types', async () => {
    const client = new DanaGatewayClient({ baseUrl: 'https://gateway.example.invalid', apiKey: 'fixture',
        fetch: async () => json({ success: true, ...fixture, data: fixture }) });
    for (const call of [() => client.createQris({ amount: 25000 }), () => client.getStatus('fixture'),
        () => client.getQris('fixture'), () => client.checkPayment('fixture')]) {
        await assert.rejects(call(), error => error.code === 'INVALID_RESPONSE');
    }
    const callback = new DanaGatewayClient({ baseUrl: 'https://gateway.example.invalid', apiKey: 'fixture',
        fetch: async () => json({ success: true, matched: true, message: 'Fixture', data: { ...fixture,
            status: 'PAID', paid_at: '2026-10-06T12:00:00Z', reference_id: null, callback: { status: 'unknown', attempts: 1 } } }) });
    await assert.rejects(callback.notifyPayment({ amount: 25000 }), error => error.code === 'INVALID_RESPONSE');
});

test('callback validates credentials, JSON, event/state and required payment fields', async () => {
    const payload = { ...fixture, reference_id: 'ORDER-1', event: 'payment.paid', status: 'paid',
        paid_at: '2026-10-06T11:00:00.000Z', payment_details: { text: 'Fixture' } };
    const request = (body = payload, key = 'fixture-secret', type = 'application/json') => new Request('https://consumer.example.invalid/callback', {
        method: 'POST', headers: { 'Content-Type': type, 'x-webhook-secret': key }, body: JSON.stringify(body)
    });
    assert.deepEqual(await parsePaymentCallback(request(), 'fixture-secret'), payload);
    const expired = { ...fixture, reference_id: 'ORDER-1', event: 'payment.expired', status: 'expired', expired_at: '2026-10-06T11:05:00Z' };
    assert.deepEqual(await parsePaymentCallback(request(expired), 'fixture-secret'), expired);
    await assert.rejects(parsePaymentCallback(request(payload, 'wrong'), 'fixture-secret'), error => error instanceof CallbackValidationError && error.status === 401);
    await assert.rejects(parsePaymentCallback(request(payload, 'fixture-secret', 'text/plain'), 'fixture-secret'), error => error.status === 415);
    const { payment_details, ...missingDetails } = payload;
    for (const bad of [{ ...payload, amount: -1 }, { ...payload, status: 'PAID' }, { ...payload, reference_id: '' },
        { ...expired, expired_at: 'no date' }, missingDetails]) {
        await assert.rejects(parsePaymentCallback(request(bad), 'fixture-secret'), error => error.status === 400);
    }
    await assert.rejects(parsePaymentCallback(new Request('https://consumer.example.invalid/callback'), 'fixture-secret'), error => error.status === 405);
    await assert.rejects(parsePaymentCallback(request(), ''), TypeError);
});
