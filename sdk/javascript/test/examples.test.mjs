import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const runtimes = [
    { name: 'Node', executable: process.execPath, script: 'node-client.mjs' },
    { name: 'PHP', executable: 'php', script: 'php-client.php', probe: ['-r', 'exit(extension_loaded("curl") ? 0 : 1);'] },
    { name: 'Python', executable: 'python3', script: 'python-client.py' },
];

for (const runtime of runtimes) {
    const available = spawnSync(runtime.executable, runtime.probe || ['--version'], { stdio: 'ignore' }).status === 0;
    test(`${runtime.name} example sends create/check with fixture-only HTTP`, { skip: !available && 'Optional runtime unavailable' }, async () => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dana-examples-'));
        const observations = [];
        const receiver = http.createServer(async (req, res) => {
            try {
                assert.equal(req.headers['x-api-key'], 'example-fixture-key');
                observations.push(req.url);
                let data;
                if (req.url === '/create-qris') {
                    assert.equal(req.method, 'POST');
                    assert.equal(req.headers['content-type'], 'application/json');
                    let text = '';
                    for await (const chunk of req) text += chunk;
                    assert.deepEqual(JSON.parse(text), { amount: 25000, reference_id: 'EXAMPLE-ORDER' });
                    data = { qris_id: 'fixture', trx_id: 'TRX-FIXTURE', reference_id: 'EXAMPLE-ORDER',
                        amount: 25000, status: 'PENDING', expires_at: '2026-10-06T12:05:00Z', expires_in: '5 menit',
                        qris_code: 'fixture-qris', qris_url: `http://127.0.0.1:${receiver.address().port}/qr/fixture` };
                } else {
                    assert.equal(req.url, '/check-payment?trx_id=TRX-FIXTURE');
                    assert.equal(req.method, 'GET');
                    data = { qris_id: 'fixture', trx_id: 'TRX-FIXTURE', amount: 25000,
                        status: 'PENDING', paid: false, paid_at: null };
                }
                res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true, data }));
            } catch {
                res.writeHead(400).end();
            }
        });
        let child;
        try {
            await new Promise((resolve, reject) => { receiver.once('error', reject); receiver.listen(0, '127.0.0.1', resolve); });
            const result = await new Promise((resolve, reject) => {
                child = spawn(runtime.executable, [path.join(root, 'examples', runtime.script), 'EXAMPLE-ORDER'], {
                    cwd: temp, env: { ...process.env, DANA_GATEWAY_URL: `http://127.0.0.1:${receiver.address().port}`,
                        DANA_GATEWAY_API_KEY: 'example-fixture-key' }, stdio: ['ignore', 'pipe', 'pipe']
                });
                let output = '';
                child.stdout.on('data', chunk => { output += chunk; });
                // Never expose inherited environment or arbitrary error bodies in test output.
                child.stderr.resume();
                const timeout = setTimeout(() => child.kill(), 10000);
                child.once('error', error => { clearTimeout(timeout); reject(error); });
                child.once('exit', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, output }); });
            });
            assert.equal(result.code, 0, `${runtime.name} fixture example failed`);
            assert.equal(result.signal, null);
            assert.ok(result.output.includes('PENDING'));
            assert.ok(result.output.includes('TRX-FIXTURE'));
            assert.ok(!result.output.includes('example-fixture-key'));
            assert.deepEqual(observations, ['/create-qris', '/check-payment?trx_id=TRX-FIXTURE']);
        } finally {
            if (child && child.exitCode === null) child.kill();
            await new Promise(resolve => { receiver.close(resolve); receiver.closeAllConnections?.(); });
            fs.rmSync(temp, { recursive: true, force: true });
        }
    });
}
