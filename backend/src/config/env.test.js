const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('./env');

test('loads backend defaults without an env file', () => {
    const config = loadConfig({ env: {}, envFile: null });

    assert.equal(config.server.port, 3001);
    assert.equal(config.server.corsOrigin, 'http://localhost:5173');
    assert.equal(config.cardTerminal.enabled, true);
    assert.equal(config.cardTerminal.driver, 'vendotek');
    assert.equal(config.billAcceptor.enabled, false);
    assert.equal(config.billAcceptor.driver, 'gpio-pulse');
    assert.equal(config.billAcceptor.mode, 'disabled');
    assert.equal(config.billAcceptor.debounceMs, 70);
    assert.equal(config.billAcceptor.maxPacketTimeMs, 3000);
    assert.deepEqual(
        config.billAcceptor.validAmountsRub,
        [ 50, 100, 500, 1000 ]
    );
    assert.equal(config.cashPayment.timeoutSec, 300);
});

test('normalizes configured backend values', () => {
    const config = loadConfig({
        envFile: null,
        env: {
            PORT: '3100',
            CORS_ORIGIN: 'http://terminal.local',
            CARD_TERMINAL_ENABLED: 'false',
            CARD_TERMINAL_DRIVER: 'mock',
            BILL_ACCEPTOR_ENABLED: 'true',
            BILL_ACCEPTOR_DRIVER: 'mock',
            BILL_ACCEPTOR_VALID_AMOUNTS: '100, 200,500',
        },
    });

    assert.equal(config.server.port, 3100);
    assert.equal(config.server.corsOrigin, 'http://terminal.local');
    assert.equal(config.cardTerminal.enabled, false);
    assert.equal(config.cardTerminal.driver, 'mock');
    assert.equal(config.billAcceptor.enabled, true);
    assert.equal(config.billAcceptor.driver, 'mock');
    assert.equal(config.billAcceptor.mode, 'mock');
    assert.deepEqual(config.billAcceptor.validAmountsRub, [ 100, 200, 500 ]);
});

test('rejects invalid boolean and device driver configuration', () => {
    assert.throws(
        () => loadConfig({
            envFile: null,
            env: { CARD_TERMINAL_ENABLED: 'yes' },
        }),
        /CARD_TERMINAL_ENABLED/
    );
    assert.throws(
        () => loadConfig({
            envFile: null,
            env: { BILL_ACCEPTOR_DRIVER: 'unknown' },
        }),
        /BILL_ACCEPTOR_DRIVER/
    );
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
