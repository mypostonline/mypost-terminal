const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('./env');

test('loads backend defaults without an env file', () => {
    const config = loadConfig({ env: {}, envFile: null });

    assert.equal(config.server.port, 3001);
    assert.equal(config.server.corsOrigin, 'http://localhost:5173');
    assert.equal(config.vendotek.enabled, true);
    assert.equal(config.billAcceptor.mode, 'disabled');
    assert.equal(config.billAcceptor.debounceMs, 70);
    assert.equal(config.billAcceptor.maxPacketTimeMs, 3000);
    assert.deepEqual(
        config.billAcceptor.validAmountsRub,
        [ 50, 100, 500, 1000 ]
    );
    assert.equal(config.cashPayment.allowOverpayment, true);
    assert.equal(config.cashPayment.timeoutSec, 300);
});

test('normalizes configured backend values', () => {
    const config = loadConfig({
        envFile: null,
        env: {
            PORT: '3100',
            CORS_ORIGIN: 'http://terminal.local',
            VENDETEK_ENABLED: 'false',
            BILL_ACCEPTOR_MODE: 'mock',
            BILL_ACCEPTOR_VALID_AMOUNTS: '100, 200,500',
            CASH_ALLOW_OVERPAYMENT: 'true',
        },
    });

    assert.equal(config.server.port, 3100);
    assert.equal(config.server.corsOrigin, 'http://terminal.local');
    assert.equal(config.vendotek.enabled, false);
    assert.equal(config.billAcceptor.mode, 'mock');
    assert.deepEqual(config.billAcceptor.validAmountsRub, [ 100, 200, 500 ]);
    assert.equal(config.cashPayment.allowOverpayment, true);
});

test('rejects invalid numeric configuration', () => {
    assert.throws(
        () => loadConfig({
            envFile: null,
            env: { VTK_PORT: 'not-a-port' },
        }),
        /VTK_PORT/
    );
});
