const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { loadConfig } = require('./config/env');
const { startBackend } = require('./bootstrap');

const silentLogger = {
    log () {},
    error () {},
};

const getJson = ({ port, path }) => new Promise((resolve, reject) => {
    const request = http.get({
        host: '127.0.0.1',
        port,
        path,
        agent: false,
    }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
            body += chunk;
        });
        response.on('end', () => {
            resolve({
                body: JSON.parse(body),
                status: response.statusCode,
            });
        });
    });

    request.on('error', reject);
});

const postJson = ({ port, path, data }) => new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const request = http.request({
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        agent: false,
        headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
        },
    }, response => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
            responseBody += chunk;
        });
        response.on('end', () => {
            resolve({
                body: JSON.parse(responseBody),
                status: response.statusCode,
            });
        });
    });

    request.on('error', reject);
    request.end(body);
});

test('starts the assembled backend and serves its status endpoint', async t => {
    const config = loadConfig({
        envFile: null,
        env: {
            VENDETEK_ENABLED: 'false',
            BILL_ACCEPTOR_MODE: 'mock',
        },
    });
    config.server.port = 0;

    const backend = await startBackend({ config, logger: silentLogger });
    t.after(() => backend.stop());

    const { port } = backend.server.address();
    const response = await getJson({ port, path: '/api/status' });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.vendotek.enabled, false);
    assert.equal(response.body.billAcceptor.mode, 'mock');
});

test('accepts several mock bills and returns a signed change QR', async t => {
    const config = loadConfig({
        envFile: null,
        env: {
            VENDETEK_ENABLED: 'false',
            BILL_ACCEPTOR_MODE: 'mock',
            CASH_CHANGE_CREDIT_URL_TEMPLATE:
                'https://app.example/change?token={token}',
            CASH_CHANGE_TOKEN_SECRET: 'integration-test-secret',
        },
    });
    config.server.port = 0;

    const backend = await startBackend({ config, logger: silentLogger });
    t.after(() => backend.stop());
    const { port } = backend.server.address();

    const started = await postJson({
        port,
        path: '/api/cash/start',
        data: { orderId: 'order-with-change', amountMinor: 12_000 },
    });
    assert.equal(started.status, 201);

    for (const amountMinor of [ 5_000, 5_000, 5_000 ]) {
        await postJson({
            port,
            path: '/api/cash/mock/insert',
            data: { amountMinor },
        });
    }

    const status = await getJson({ port, path: '/api/cash/status' });
    assert.equal(status.body.session.state, 'completed');
    assert.equal(status.body.session.acceptedAmountMinor, 15_000);
    assert.equal(status.body.session.bills.length, 3);
    assert.equal(status.body.session.changeCredit.amountMinor, 3_000);

    const token = new URL(
        status.body.session.changeCredit.qrPayload
    ).searchParams.get('token');
    const payload = backend.services.cashChangeCredit.verifyToken(token);
    assert.equal(payload.orderId, 'order-with-change');
    assert.equal(payload.amountMinor, 3_000);
});
