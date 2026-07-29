/**
 * Runnable self-check (no network): CRC16 + dynamic QRIS generation.
 * node selfcheck.js
 */
const assert = require('assert');
const { generateDynamicQRIS, calculateCRC16 } = require('./server');

function tlv(tag, val) {
    return tag + String(val.length).padStart(2, '0') + val;
}

// Minimal valid EMVCo-ish static payload (bukan merchant real)
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
assert.strictEqual(withCrc.slice(-4).length, 4);

const dyn = generateDynamicQRIS(withCrc, 25000);
assert.ok(dyn, 'dynamic QRIS harus ter-generate');
assert.ok(dyn.includes('010212'), 'point of initiation harus dynamic (12)');
assert.ok(dyn.includes('540525000'), 'tag 54 amount 25000');
assert.ok(/6304[0-9A-F]{4}$/.test(dyn), 'CRC tag 63 valid');

const dyn2 = generateDynamicQRIS(withCrc, 30000);
assert.notStrictEqual(dyn, dyn2);
assert.ok(dyn2.includes('540530000'), 'tag 54 amount 30000');

console.log('selfcheck OK');
console.log(' sample dynamic length:', dyn.length);
