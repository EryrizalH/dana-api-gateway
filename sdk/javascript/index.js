const paymentStates = new Set(['PENDING', 'PAID', 'EXPIRED']);

export class GatewayError extends Error {
    constructor(message, code, status) {
        super(message);
        this.name = 'GatewayError';
        this.code = code;
        if (status !== undefined) this.status = status;
    }
}

export class CallbackValidationError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'CallbackValidationError';
        this.status = status;
    }
}

function positiveInteger(value) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError('amount must be a positive safe integer in rupiah');
    }
}

function transactionId(value) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError('transaction ID must be a non-empty string');
    }
    return value.trim();
}

function paymentData(value) {
    if (!value || typeof value.qris_id !== 'string' || typeof value.trx_id !== 'string' ||
        !paymentStates.has(value.status) || !Number.isSafeInteger(value.amount) || value.amount <= 0) {
        throw new GatewayError('Gateway returned an invalid transaction', 'INVALID_RESPONSE');
    }
    return value;
}

function stringFields(value, fields) {
    if (fields.some(field => typeof value[field] !== 'string' || !value[field])) {
        throw new GatewayError('Gateway returned incomplete transaction data', 'INVALID_RESPONSE');
    }
    return value;
}

function nullableString(value) {
    return value === null || typeof value === 'string';
}

function paymentCheck(value) {
    const data = paymentData(value);
    if (typeof data.paid !== 'boolean' || data.paid !== (data.status === 'PAID') || !nullableString(data.paid_at)) {
        throw new GatewayError('Gateway returned invalid payment status data', 'INVALID_RESPONSE');
    }
    return data;
}

function deliveryResult(value) {
    if (!value || !Number.isSafeInteger(value.attempts) || value.attempts < 0 ||
        (['skipped', 'not_configured'].includes(value.status)
            ? value.attempts !== 0
            : !['delivered', 'rejected', 'failed'].includes(value.status) || value.attempts < 1 || value.attempts > 3) ||
        (value.status === 'rejected' && ![400, 404, 422].includes(value.httpStatus))) {
        throw new GatewayError('Gateway returned invalid callback delivery data', 'INVALID_RESPONSE');
    }
}

export class DanaGatewayClient {
    #baseUrl;
    #apiKey;
    #fetch;
    #timeoutMs;

    constructor({ baseUrl, apiKey, timeoutMs = 20000, fetch: fetchImpl = globalThis.fetch } = {}) {
        const url = new URL(baseUrl);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new TypeError('baseUrl must be an HTTP(S) URL without credentials, query, or fragment');
        }
        if (apiKey !== undefined && (typeof apiKey !== 'string' || !apiKey.trim())) {
            throw new TypeError('apiKey must be a non-empty string when supplied');
        }
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
            throw new TypeError('timeoutMs must be a positive integer up to 2147483647');
        }
        if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
        this.#baseUrl = url.href.replace(/\/+$/, '');
        this.#apiKey = apiKey;
        this.#timeoutMs = timeoutMs;
        this.#fetch = fetchImpl;
    }

    async #request(path, { method = 'GET', body, authenticated = false, signal } = {}) {
        if (authenticated && !this.#apiKey) throw new TypeError('This operation requires an apiKey');
        if (signal?.aborted) throw new GatewayError('Request aborted', 'ABORTED');
        const headers = { Accept: 'application/json' };
        if (authenticated) headers['x-api-key'] = this.#apiKey;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const controller = new AbortController();
        let timedOut = false;
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, this.#timeoutMs);
        try {
            const response = await this.#fetch(this.#baseUrl + path, {
                method, headers, body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal, redirect: 'error', credentials: 'omit'
            });
            if (!response.ok) {
                throw new GatewayError(`Gateway returned HTTP ${response.status}`, 'HTTP_ERROR', response.status);
            }
            let result;
            try {
                result = await response.json();
            } catch {
                if (controller.signal.aborted) throw new Error('aborted');
                throw new GatewayError('Gateway returned invalid JSON', 'INVALID_RESPONSE', response.status);
            }
            if (!result || typeof result !== 'object' || Array.isArray(result)) {
                throw new GatewayError('Gateway returned an invalid response', 'INVALID_RESPONSE', response.status);
            }
            return result;
        } catch (error) {
            if (error instanceof GatewayError) throw error;
            if (timedOut) throw new GatewayError('Gateway request timed out; outcome may be unknown', 'TIMEOUT');
            if (signal?.aborted) throw new GatewayError('Request aborted; outcome may be unknown', 'ABORTED');
            throw new GatewayError('Gateway request failed; outcome may be unknown', 'NETWORK_ERROR');
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
        }
    }

    async health(options = {}) {
        const result = await this.#request('/api/health', options);
        if (result.status !== 'OK' || typeof result.service !== 'string' || typeof result.timestamp !== 'string') {
            throw new GatewayError('Gateway returned invalid health data', 'INVALID_RESPONSE');
        }
        return result;
    }

    async createQris({ amount, referenceId, qrisStatic } = {}, options = {}) {
        positiveInteger(amount);
        if (referenceId !== undefined && (typeof referenceId !== 'string' || !referenceId.trim())) {
            throw new TypeError('referenceId must be a non-empty string when supplied');
        }
        if (qrisStatic !== undefined && (typeof qrisStatic !== 'string' || !qrisStatic.trim())) {
            throw new TypeError('qrisStatic must be a non-empty string when supplied');
        }
        const result = await this.#request('/create-qris', {
            ...options, method: 'POST', authenticated: true,
            body: { amount, reference_id: referenceId?.trim(), qris_static: qrisStatic }
        });
        if (result.success !== true) throw new GatewayError('Gateway did not confirm creation', 'INVALID_RESPONSE');
        const data = stringFields(paymentData(result.data), ['qris_url', 'qris_code', 'expires_at', 'expires_in']);
        if (data.status !== 'PENDING' || !nullableString(data.reference_id)) {
            throw new GatewayError('Gateway returned invalid creation data', 'INVALID_RESPONSE');
        }
        return data;
    }

    async getStatus(id, options = {}) {
        const result = await this.#request('/api/qr-status/' + encodeURIComponent(transactionId(id)), options);
        if (result.success !== true) throw new GatewayError('Gateway did not return status', 'INVALID_RESPONSE');
        const { success, ...data } = result;
        return stringFields(paymentCheck(data), ['expires_at']);
    }

    async getQris(id, options = {}) {
        const result = await this.#request('/api/qr/' + encodeURIComponent(transactionId(id)), options);
        if (result.success !== true) throw new GatewayError('Gateway did not return QRIS', 'INVALID_RESPONSE');
        return stringFields(paymentCheck(result.data), ['qris_code', 'expires_at']);
    }

    async checkPayment(id, options = {}) {
        const result = await this.#request('/check-payment?trx_id=' + encodeURIComponent(transactionId(id)), {
            ...options, authenticated: true
        });
        if (result.success !== true) throw new GatewayError('Gateway did not return payment', 'INVALID_RESPONSE');
        return paymentCheck(result.data);
    }

    async notifyPayment({ amount, text } = {}, options = {}) {
        if (amount !== undefined) positiveInteger(amount);
        if (text !== undefined && (typeof text !== 'string' || !text.trim())) {
            throw new TypeError('text must be a non-empty string when supplied');
        }
        if (amount === undefined && text === undefined) throw new TypeError('amount or text is required');
        const result = await this.#request('/api/notifications', {
            ...options, method: 'POST', authenticated: true, body: { amount, text }
        });
        if (result.success !== true || typeof result.matched !== 'boolean' || typeof result.message !== 'string' || !result.data) {
            throw new GatewayError('Gateway returned invalid notification data', 'INVALID_RESPONSE');
        }
        if (result.matched) {
            const data = stringFields(paymentData(result.data), ['paid_at']);
            if (data.status !== 'PAID' || !nullableString(data.reference_id)) {
                throw new GatewayError('Gateway returned invalid matched payment data', 'INVALID_RESPONSE');
            }
            deliveryResult(data.callback);
        } else if (!Number.isSafeInteger(result.data.amount) || result.data.amount <= 0 ||
            typeof result.data.received_at !== 'string' || !result.data.received_at) {
            throw new GatewayError('Gateway returned invalid unmatched notification data', 'INVALID_RESPONSE');
        }
        return result;
    }
}

export async function parsePaymentCallback(request, secret) {
    if (typeof secret !== 'string' || !secret) throw new TypeError('Callback secret is required');
    if (request.method !== 'POST') throw new CallbackValidationError('POST required', 405);
    const supplied = request.headers.get('x-webhook-secret');
    if (!supplied) throw new CallbackValidationError('Invalid callback credentials', 401);
    const encode = value => new TextEncoder().encode(value);
    const [expectedHash, suppliedHash] = await Promise.all([
        crypto.subtle.digest('SHA-256', encode(secret)),
        crypto.subtle.digest('SHA-256', encode(supplied))
    ]);
    const left = new Uint8Array(expectedHash);
    const right = new Uint8Array(suppliedHash);
    let difference = 0;
    for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
    if (difference !== 0) throw new CallbackValidationError('Invalid callback credentials', 401);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new CallbackValidationError('JSON required', 415);
    }
    let payload;
    try {
        payload = await request.json();
    } catch {
        throw new CallbackValidationError('Invalid JSON', 400);
    }
    const isPaid = payload?.event === 'payment.paid' && payload?.status === 'paid';
    const isExpired = payload?.event === 'payment.expired' && payload?.status === 'expired';
    const hasText = value => typeof value === 'string' && value.trim().length > 0;
    const hasDate = value => hasText(value) && Number.isFinite(Date.parse(value));
    if ((!isPaid && !isExpired) || !hasText(payload.reference_id) || !hasText(payload.qris_id) ||
        !hasText(payload.trx_id) || !Number.isSafeInteger(payload.amount) || payload.amount <= 0 ||
        (isPaid && (payload.paid_at !== null && !hasDate(payload.paid_at) || !Object.hasOwn(payload, 'payment_details'))) ||
        (isExpired && !hasDate(payload.expired_at))) {
        throw new CallbackValidationError('Invalid payment callback', 400);
    }
    return payload;
}
