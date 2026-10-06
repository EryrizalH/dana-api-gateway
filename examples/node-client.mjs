import { DanaGatewayClient } from '../sdk/javascript/index.js';

const baseUrl = process.env.DANA_GATEWAY_URL;
const apiKey = process.env.DANA_GATEWAY_API_KEY;
const referenceId = process.argv[2];
if (!baseUrl || !apiKey || !referenceId) {
    throw new Error('Set DANA_GATEWAY_URL and DANA_GATEWAY_API_KEY; pass a unique order reference');
}

const gateway = new DanaGatewayClient({ baseUrl, apiKey });
const qr = await gateway.createQris({ amount: 25000, referenceId });
// Di aplikasi nyata, simpan binding order dan QR ini ke database sebelum checkout.
console.log(JSON.stringify({ reference_id: qr.reference_id, qris_id: qr.qris_id,
    trx_id: qr.trx_id, amount: qr.amount, expires_at: qr.expires_at, qris_url: qr.qris_url }, null, 2));
const status = await gateway.checkPayment(qr.trx_id);
console.log(JSON.stringify({ status: status.status, paid: status.paid }));
