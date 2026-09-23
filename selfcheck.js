const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qris-gateway-selfcheck-'));
process.env.DATABASE_PATH = path.join(tempDir, 'database.sqlite');

const {
    generateDynamicQRIS,
    calculateCRC16,
    normalizeReferenceId,
    sendPaymentWebhook
} = require('./server');
const db = require('./db');

function tlv(tag, val) {
    return tag + String(val.length).padStart(2, '0') + val;
}

const staticNoCrc =
    tlv('00', '01') +
    tlv('01', '11') +
    tlv('26', tlv('00', 'ID.CO.DANA.WWW') + tlv('01', '123456789012345')) +
    tlv('52', '0000') +
    tlv('53', '360') +
    tlv('58', 'ID') +
    tlv('59', 'TOKO CONTOH') +
    tlv('60', 'JAKARTA');

const withCrc = staticNoCrc + '6304' + calculateCRC16(staticNoCrc + '6304');
const dyn = generateDynamicQRIS(withCrc, 25000);
assert.ok(dyn, 'dynamic QRIS harus ter-generate');
assert.ok(dyn.includes('010212'), 'point of initiation harus dynamic (12)');
assert.ok(dyn.includes('540525000'), 'tag 54 amount 25000');
assert.ok(/6304[0-9A-F]{4}$/.test(dyn), 'CRC tag 63 valid');

const dyn2 = generateDynamicQRIS(withCrc, 30000);
assert.notStrictEqual(dyn, dyn2);
assert.ok(dyn2.includes('540530000'), 'tag 54 amount 30000');

const referenceId = normalizeReferenceId('  SELF-CHECK-001  ');
db.insertTransaction({
    qris_id: 'selfcheck-qris',
    trx_id: 'TRX-SELFCHECK',
    amount: 25000,
    qris_code: dyn,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300000).toISOString(),
    reference_id: referenceId
});
assert.strictEqual(db.getTransactionByQrisId('selfcheck-qris').reference_id, referenceId);
assert.strictEqual(db.getTransactionByTrxId('TRX-SELFCHECK').reference_id, referenceId);

const paid = db.matchAndPayOldestPending(25000, { text: 'selfcheck payment' });
assert.strictEqual(paid.reference_id, referenceId);

let callbackRequest;
const callbackResult = sendPaymentWebhook(
    paid,
    { url: 'http://worker.local/api/webhooks/qris', secret: 'selfcheck-secret' },
    async (url, options) => {
        callbackRequest = { url, options };
        return new Response(null, { status: 204 });
    }
);

callbackResult.then((result) => {
    assert.deepStrictEqual(result, { status: 'delivered', attempts: 1 });
    const payload = JSON.parse(callbackRequest.options.body);
    assert.deepStrictEqual(payload, {
        event: 'payment.paid',
        reference_id: referenceId,
        qris_id: 'selfcheck-qris',
        trx_id: 'TRX-SELFCHECK',
        amount: 25000,
        status: 'paid',
        paid_at: paid.paid_at,
        payment_details: { text: 'selfcheck payment' }
    });
    assert.strictEqual(callbackRequest.options.headers['x-webhook-secret'], 'selfcheck-secret');
    db.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('selfcheck OK');
    console.log(' sample dynamic length:', dyn.length);
}).catch((error) => {
    db.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
});
