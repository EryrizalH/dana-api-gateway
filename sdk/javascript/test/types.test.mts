import { DanaGatewayClient, GatewayError, parsePaymentCallback, type PaymentStatus } from '../index.js';

const client = new DanaGatewayClient({ baseUrl: 'https://gateway.example.invalid', apiKey: 'fixture' });
const qr = await client.createQris({ amount: 25000, referenceId: 'ORDER' });
const status: PaymentStatus = (await client.getStatus(qr.trx_id)).status;
const details: string = (await client.getQris(qr.qris_id)).qris_code;
const matched = await client.notifyPayment({ amount: 25000 });
if (matched.matched) {
    const delivery: string = matched.data.callback.status;
    void delivery;
} else {
    const receivedAt: string = matched.data.received_at;
    void receivedAt;
}
const callback = await parsePaymentCallback(new Request('https://consumer.example.invalid'), 'fixture');
if (callback.event === 'payment.paid') {
    const paidAt: string | null = callback.paid_at;
    void paidAt;
} else {
    const expiredAt: string = callback.expired_at;
    void expiredAt;
}
// @ts-expect-error SDK amounts must be numbers, not formatted currency strings.
client.createQris({ amount: '25000' });
// @ts-expect-error create response does not claim that a payment was already made.
const paid: boolean = qr.paid;
const error = new GatewayError('fixture', 'HTTP_ERROR', 404);
void [status, details, error, paid];
