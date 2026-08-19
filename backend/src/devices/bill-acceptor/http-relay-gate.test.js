const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('events');
const { HttpRelayGate } = require('./http-relay-gate');

const createGate = () => {
    const requests = [];
    let failure = null;
    const gate = new HttpRelayGate({
        enabled: true,
        url: 'http://127.0.0.1:3181/bill-acceptor/relay',
        leaseMs: 15_000,
        renewIntervalMs: 5_000,
        requestTimeoutMs: 1_000,
        sendRequest: async ({ body }) => {
            requests.push(body);
            if (failure) {
                throw failure;
            }
            return {
                ok: true,
                requestId: body.requestId,
                enabled: body.enabled,
                expiresAt: body.enabled
                    ? new Date(Date.now() + 15_000).toISOString()
                    : null,
            };
        },
    });

    return {
        gate,
        requests,
        setFailure: value => {
            failure = value;
        },
    };
};

test('waits for HTTP acknowledgement before enabling acceptance', async () => {
    const { gate, requests } = createGate();
    await gate.start();

    assert.equal(gate.getStatus().state, 'ready');
    assert.equal(gate.getStatus().connected, true);
    assert.equal(requests[0].enabled, false);

    await gate.enable();
    assert.equal(gate.getStatus().relayEnabled, true);
    assert.equal(gate.getStatus().state, 'enabled');
    assert.equal(requests[1].enabled, true);

    await gate.disable();
    assert.equal(gate.getStatus().relayEnabled, false);
    assert.equal(gate.getStatus().state, 'ready');
    assert.equal(requests[2].enabled, false);

    await gate.close();
});

test('reports loss of relay control when lease renewal fails', async () => {
    const { gate, setFailure } = createGate();
    await gate.start();
    await gate.enable();

    const lostEvent = once(gate, 'lost');
    setFailure(new Error('master is unavailable'));
    await gate.renewLease();
    const [ error ] = await lostEvent;

    assert.match(error.message, /master is unavailable/);
    assert.equal(gate.getStatus().state, 'error');
    assert.equal(gate.getStatus().connected, false);
    assert.equal(gate.getStatus().relayEnabled, false);
    await gate.close();
});

test('rejects a response for a different request', async () => {
    const gate = new HttpRelayGate({
        enabled: true,
        sendRequest: async ({ body }) => ({
            ok: true,
            requestId: `${body.requestId}-wrong`,
            enabled: body.enabled,
        }),
    });

    await assert.rejects(
        gate.start(),
        /wrong requestId/
    );
    assert.equal(gate.getStatus().available, false);
    await gate.close();
});

test('sends the relay command through the local HTTP API', async () => {
    const requests = [];
    const server = http.createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', chunk => {
            body += chunk;
        });
        request.on('end', () => {
            const command = JSON.parse(body);
            requests.push(command);
            const payload = JSON.stringify({
                ok: true,
                requestId: command.requestId,
                enabled: command.enabled,
                expiresAt: null,
            });
            response.writeHead(200, {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
            });
            response.end(payload);
        });
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const gate = new HttpRelayGate({
        enabled: true,
        url: `http://127.0.0.1:${port}/bill-acceptor/relay`,
    });

    try {
        await gate.start();
        await gate.enable();
        await gate.disable();
        assert.deepEqual(
            requests.slice(0, 3).map(request => request.enabled),
            [ false, true, false ]
        );
    }
    finally {
        await gate.close();
        await new Promise(resolve => server.close(resolve));
    }
});
