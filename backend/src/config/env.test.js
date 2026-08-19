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
    assert.equal(config.billAcceptor.relay.enabled, false);
    assert.equal(
        config.billAcceptor.relay.url,
        'http://127.0.0.1:3181/bill-acceptor/relay'
    );
    assert.equal(config.billAcceptor.relay.leaseMs, 15_000);
    assert.equal(config.billAcceptor.relay.renewIntervalMs, 5_000);
    assert.equal(config.billAcceptor.relay.requestTimeoutMs, 3_000);
    assert.deepEqual(
        config.billAcceptor.validAmountsRub,
        [ 50, 100, 500, 1000 ]
    );
    assert.equal(config.cashPayment.billTimeoutSec, 120);
    assert.equal(config.cashPayment.partialDecisionTimeoutSec, 600);
    assert.equal(config.cashPayment.fiscalizationEnabled, false);
    assert.equal(config.cashPayment.fiscalProductId, '1');
    assert.equal(config.cashPayment.fiscalProductName, 'WASH');
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
            BILL_ACCEPTOR_RELAY_ENABLED: 'true',
            BILL_ACCEPTOR_RELAY_URL:
                'http://127.0.0.1:4181/bill-acceptor/relay',
            BILL_ACCEPTOR_RELAY_LEASE_MS: '12000',
            BILL_ACCEPTOR_RELAY_RENEW_INTERVAL_MS: '4000',
            BILL_ACCEPTOR_RELAY_REQUEST_TIMEOUT_MS: '2500',
            CASH_PAYMENT_BILL_TIMEOUT_SEC: '90',
            CASH_PAYMENT_PARTIAL_DECISION_TIMEOUT_SEC: '480',
            CASH_FISCALIZATION_ENABLED: 'true',
            CASH_FISCALIZATION_PRODUCT_ID: '12',
            CASH_FISCALIZATION_PRODUCT_NAME: 'CAR_WASH',
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
    assert.equal(config.billAcceptor.relay.enabled, true);
    assert.equal(
        config.billAcceptor.relay.url,
        'http://127.0.0.1:4181/bill-acceptor/relay'
    );
    assert.equal(config.billAcceptor.relay.leaseMs, 12_000);
    assert.equal(config.billAcceptor.relay.renewIntervalMs, 4_000);
    assert.equal(config.billAcceptor.relay.requestTimeoutMs, 2_500);
    assert.equal(config.cashPayment.billTimeoutSec, 90);
    assert.equal(config.cashPayment.partialDecisionTimeoutSec, 480);
    assert.equal(config.cashPayment.fiscalizationEnabled, true);
    assert.equal(config.cashPayment.fiscalProductId, '12');
    assert.equal(config.cashPayment.fiscalProductName, 'CAR_WASH');
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
