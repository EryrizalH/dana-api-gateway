const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/dashboard.js'), 'utf8');

function element() {
    const listeners = new Map();
    return {
        dataset: {}, hidden: false, disabled: false, value: '', textContent: '', childNodes: [],
        complete: false, naturalWidth: 0, attributes: {},
        addEventListener(type, callback) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(callback);
        },
        async emit(type, event = {}) {
            for (const callback of listeners.get(type) || []) await callback(event);
        },
        setAttribute(name, value) { this.attributes[name] = value; },
        removeAttribute(name) { delete this.attributes[name]; },
        setCustomValidity(message) { this.validationMessage = message; },
        replaceChildren(...children) { this.childNodes = children; },
        focus() { this.focused = true; },
        select() { this.selected = true; }
    };
}

function browser({ status = 'PENDING', now = 1000000, expiresAt = now + 300000, fetchStatus, summaryFails = false, empty = false } = {}) {
    const ids = ['payment-form', 'payment-create', 'payment-amount', 'payment-result', 'payment-link',
        'payment-copy', 'payment-copy-message', 'payment-qr', 'payment-qr-box', 'payment-image-loading',
        'payment-image-error', 'payment-countdown', 'payment-status', 'payment-state-message',
        'payment-poll-error', 'payment-timer-label', 'payment-timer', 'dashboard-stats', 'dashboard-tabs', 'dashboard-table'];
    const nodes = Object.fromEntries(ids.map(id => [id, element()]));
    nodes['payment-form'].elements = { tab: { value: 'pending' } };
    nodes['payment-result'].dataset = { qrisId: 'fixture-qris', status, expiresAt: new Date(expiresAt).toISOString() };
    nodes['payment-status'].textContent = status;
    nodes['payment-link'].value = '/qr/fixture-qris';
    nodes['payment-poll-error'].hidden = true;
    const timers = new Map();
    const intervals = new Map();
    const requests = [];
    const copied = [];
    const window = element();
    window.location = { origin: 'http://127.0.0.1:3000', href: 'http://127.0.0.1:3000/dashboard?tab=pending&payment=fixture-qris' };
    let timerId = 0;
    const context = {
        document: { getElementById: id => empty && id === 'payment-result' ? null : nodes[id] },
        window, URL, AbortController,
        navigator: { clipboard: { writeText: async (value) => { copied.push(value); } } },
        Date: class extends Date { static now() { return now; } },
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        setInterval(callback, delay) { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
        clearInterval(id) { intervals.delete(id); },
        fetch: async (url, options) => {
            requests.push({ url, options });
            if (url.startsWith('/api/')) {
                const data = fetchStatus ? await fetchStatus(requests.filter(r => r.url.startsWith('/api/')).length) : { status: 'PENDING' };
                return { ok: true, json: async () => ({ success: true, qris_id: 'fixture-qris', ...data }) };
            }
            return { ok: !summaryFails, text: async () => 'fixture-dashboard-html' };
        },
        DOMParser: class {
            parseFromString() {
                return { getElementById: id => ({ childNodes: [`updated-${id}`] }) };
            }
        }
    };
    vm.runInNewContext(source, context);
    return {
        nodes, timers, intervals, requests, copied, window, context,
        advance(ms) { now += ms; for (const { callback } of intervals.values()) callback(); },
        async tickPoll() {
            const entry = [...timers].find(([, timer]) => timer.delay === 3000);
            assert.ok(entry, 'A pending payment schedules another check');
            timers.delete(entry[0]);
            await entry[1].callback();
        }
    };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('server PAID wins even when the local deadline has already passed', async () => {
    const b = browser({ expiresAt: 999000, fetchStatus: () => ({ status: 'PAID' }) });
    await settle();
    assert.equal(b.nodes['payment-status'].textContent, 'PAID / LUNAS');
    assert.equal(b.nodes['payment-result'].dataset.status, 'PAID');
    assert.equal(b.nodes['payment-qr-box'].hidden, true);
    assert.equal(b.nodes['payment-timer'].hidden, true);
    assert.deepEqual(b.nodes['dashboard-stats'].childNodes, ['updated-dashboard-stats']);
    assert.deepEqual(b.nodes['dashboard-tabs'].childNodes, ['updated-dashboard-tabs']);
    assert.deepEqual(b.nodes['dashboard-table'].childNodes, ['updated-dashboard-table']);
    assert.equal(b.timers.size + b.intervals.size, 0);
});

test('deadline stays PENDING until the server confirms EXPIRED', async () => {
    const b = browser({ expiresAt: 999000, fetchStatus: count => ({ status: count === 1 ? 'PENDING' : 'EXPIRED' }) });
    await settle();
    assert.equal(b.nodes['payment-countdown'].textContent, '00:00');
    assert.equal(b.nodes['payment-result'].dataset.status, 'PENDING');
    assert.match(b.nodes['payment-state-message'].textContent, /Memastikan/);
    await b.tickPoll();
    assert.equal(b.nodes['payment-status'].textContent, 'EXPIRED');
    assert.equal(b.timers.size + b.intervals.size, 0);
});

test('network failure recovers and payment near the deadline becomes PAID', async () => {
    const b = browser({ expiresAt: 1001000, fetchStatus: count => {
        if (count === 1) throw new Error('fixture offline');
        return { status: 'PAID' };
    } });
    await settle();
    assert.equal(b.nodes['payment-poll-error'].hidden, false);
    assert.equal(b.nodes['payment-result'].dataset.status, 'PENDING');
    b.advance(3000);
    assert.equal(b.nodes['payment-countdown'].textContent, '00:00');
    await b.tickPoll();
    assert.equal(b.nodes['payment-status'].textContent, 'PAID / LUNAS');
    assert.equal(b.nodes['payment-poll-error'].hidden, true);
});

test('slow status requests cannot overlap, including page restoration', async () => {
    let release;
    const b = browser({ fetchStatus: () => new Promise(resolve => { release = resolve; }) });
    await settle();
    b.advance(5000);
    await b.window.emit('pageshow', { persisted: true });
    assert.equal(b.requests.length, 1);
    assert.equal([...b.timers.values()].filter(timer => timer.delay === 3000).length, 0);
    release({ status: 'PENDING' });
    await settle();
    assert.equal([...b.timers.values()].filter(timer => timer.delay === 3000).length, 1);
    await b.window.emit('pagehide');
    assert.equal(b.timers.size + b.intervals.size, 0);
});

test('terminal pages start without polling', async () => {
    for (const status of ['PAID', 'EXPIRED']) {
        const b = browser({ status });
        await settle();
        assert.equal(b.requests.length, 0);
        assert.equal(b.timers.size + b.intervals.size, 0);
        await b.nodes['payment-qr'].emit('error');
        assert.equal(b.nodes['payment-image-error'].hidden, true);
    }
});

test('failed summary refresh preserves the confirmed payment state', async () => {
    const b = browser({ fetchStatus: () => ({ status: 'PAID' }), summaryFails: true });
    await settle();
    assert.equal(b.nodes['payment-status'].textContent, 'PAID / LUNAS');
    assert.match(b.nodes['payment-poll-error'].textContent, /ringkasan gagal dimuat/);
    assert.equal(b.timers.size + b.intervals.size, 0);
});

test('status changes can refresh the dashboard even after a failed form POST', async () => {
    const b = browser({ fetchStatus: () => ({ status: 'PAID' }) });
    b.window.location.href = 'http://127.0.0.1:3000/dashboard/create-qris';
    await settle();
    assert.equal(b.nodes['payment-status'].textContent, 'PAID / LUNAS');
    assert.ok(b.requests.some(r => r.url === 'http://127.0.0.1:3000/dashboard?tab=pending&payment=fixture-qris'));
    assert.equal(b.nodes['payment-poll-error'].hidden, true);
    assert.deepEqual(b.nodes['dashboard-table'].childNodes, ['updated-dashboard-table']);
});

test('unrecognized status remains pending and retries', async () => {
    const b = browser({ fetchStatus: count => ({ status: count === 1 ? 'UNKNOWN' : 'PAID' }) });
    await settle();
    assert.equal(b.nodes['payment-result'].dataset.status, 'PENDING');
    assert.equal(b.nodes['payment-poll-error'].hidden, false);
    await b.tickPoll();
    assert.equal(b.nodes['payment-result'].dataset.status, 'PAID');
});

test('copy supports clipboard and manual selection fallback', async () => {
    const b = browser({ status: 'PAID' });
    await b.nodes['payment-copy'].emit('click');
    assert.deepEqual(b.copied, ['http://127.0.0.1:3000/qr/fixture-qris']);
    assert.match(b.nodes['payment-copy-message'].textContent, /berhasil disalin/);
    b.context.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    await b.nodes['payment-copy'].emit('click');
    assert.equal(b.nodes['payment-link'].focused, true);
    assert.equal(b.nodes['payment-link'].selected, true);
    assert.match(b.nodes['payment-copy-message'].textContent, /secara manual/);
});

test('form blocks duplicate submission and resets after browser back', async () => {
    const b = browser({ empty: true });
    await b.nodes['payment-form'].emit('submit');
    assert.equal(b.nodes['payment-create'].disabled, true);
    assert.equal(b.nodes['payment-form'].attributes['aria-busy'], 'true');
    let prevented = false;
    await b.nodes['payment-form'].emit('submit', { preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    await b.window.emit('pageshow', { persisted: true });
    assert.equal(b.nodes['payment-create'].disabled, false);
    b.nodes['payment-amount'].value = '9007199254740992';
    await b.nodes['payment-amount'].emit('input');
    assert.ok(b.nodes['payment-amount'].validationMessage);
    b.nodes['payment-amount'].value = '25000';
    await b.nodes['payment-amount'].emit('input');
    assert.equal(b.nodes['payment-amount'].validationMessage, '');
    assert.equal(b.requests.length, 0);
});

test('QR image failure has visible feedback and does not stop status checks', async () => {
    const b = browser();
    await settle();
    await b.nodes['payment-qr'].emit('error');
    assert.equal(b.nodes['payment-image-loading'].hidden, true);
    assert.equal(b.nodes['payment-image-error'].hidden, false);
    assert.equal(b.nodes['payment-qr-box'].hidden, true);
    assert.equal(b.nodes['payment-result'].dataset.status, 'PENDING');
    assert.ok([...b.timers.values()].some(timer => timer.delay === 3000));
});
