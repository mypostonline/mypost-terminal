const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config/env');
const { useMockDrivers } = require('./start-mock');

test('uses .env payment timers while replacing only hardware drivers', () => {
    const config = loadConfig({
        envFile: null,
        env: {
            CASH_PAYMENT_BILL_TIMEOUT_SEC: '75',
            CASH_PAYMENT_PARTIAL_DECISION_TIMEOUT_SEC: '360',
        },
    });

    const mockConfig = useMockDrivers(config);

    assert.equal(mockConfig.cardTerminal.enabled, true);
    assert.equal(mockConfig.cardTerminal.driver, 'mock');
    assert.equal(mockConfig.billAcceptor.enabled, true);
    assert.equal(mockConfig.billAcceptor.driver, 'mock');
    assert.equal(mockConfig.billAcceptor.mode, 'mock');
    assert.equal(mockConfig.billAcceptor.relay.enabled, false);
    assert.equal(mockConfig.cashPayment.billTimeoutSec, 75);
    assert.equal(mockConfig.cashPayment.partialDecisionTimeoutSec, 360);
});
