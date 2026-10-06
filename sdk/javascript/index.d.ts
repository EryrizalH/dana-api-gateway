export type PaymentStatus = 'PENDING' | 'PAID' | 'EXPIRED';
export interface RequestOptions { signal?: AbortSignal }
export interface ClientOptions {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
}
export interface PaymentIdentity {
    qris_id: string;
    trx_id: string;
    amount: number;
    status: PaymentStatus;
}
export interface CreatedQris extends PaymentIdentity {
    reference_id: string | null;
    qris_url: string;
    qris_code: string;
    expires_at: string;
    expires_in: string;
}
export interface PaymentCheck extends PaymentIdentity {
    paid: boolean;
    paid_at: string | null;
}
export interface PublicStatus extends PaymentCheck { expires_at: string }
export interface QrisDetails extends PublicStatus { qris_code: string }
export type DeliveryResult =
    | { status: 'skipped' | 'not_configured'; attempts: 0 }
    | { status: 'delivered'; attempts: number }
    | { status: 'rejected'; attempts: number; httpStatus: number }
    | { status: 'failed'; attempts: number };
export type NotificationResult =
    | { success: true; matched: true; message: string; data: PaymentIdentity & {
        status: 'PAID'; reference_id: string | null; paid_at: string; callback: DeliveryResult;
    } }
    | { success: true; matched: false; message: string; data: { amount: number; received_at: string } };
export interface CallbackIdentity {
    reference_id: string;
    qris_id: string;
    trx_id: string;
    amount: number;
}
export type PaymentCallback =
    | (CallbackIdentity & { event: 'payment.paid'; status: 'paid'; paid_at: string | null; payment_details: unknown })
    | (CallbackIdentity & { event: 'payment.expired'; status: 'expired'; expired_at: string });
export class GatewayError extends Error {
    code: 'HTTP_ERROR' | 'TIMEOUT' | 'ABORTED' | 'NETWORK_ERROR' | 'INVALID_RESPONSE';
    status?: number;
    constructor(message: string, code: GatewayError['code'], status?: number);
}
export class CallbackValidationError extends Error {
    status: number;
    constructor(message: string, status: number);
}
export class DanaGatewayClient {
    constructor(options: ClientOptions);
    health(options?: RequestOptions): Promise<{ status: 'OK'; service: string; timestamp: string }>;
    createQris(input: { amount: number; referenceId?: string; qrisStatic?: string }, options?: RequestOptions): Promise<CreatedQris>;
    getStatus(id: string, options?: RequestOptions): Promise<PublicStatus>;
    getQris(id: string, options?: RequestOptions): Promise<QrisDetails>;
    checkPayment(id: string, options?: RequestOptions): Promise<PaymentCheck>;
    notifyPayment(input: { amount?: number; text?: string }, options?: RequestOptions): Promise<NotificationResult>;
}
export function parsePaymentCallback(request: Request, secret: string): Promise<PaymentCallback>;
