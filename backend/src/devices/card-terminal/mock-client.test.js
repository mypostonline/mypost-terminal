const test = require('node:test');
const assert = require('node:assert/strict');
const { MockCardTerminal } = require('./mock-client');

test('approves a pending mock card payment', async () => {
    const terminal = new MockCardTerminal();
    await terminal.start();

    const paymentPromise = terminal.startPayment({ amountMinor: 12_000 });
    terminal.simulateApprove();
    const result = await paymentPromise;

    assert.equal(result.approved, true);
    assert.equal(result.approvedAmount, 12_000);
    assert.equal(terminal.getState().terminalState, 'finalizing');

    await terminal.finalizeSuccess();
    assert.equal(terminal.getState().terminalState, 'idle');
});

test('declines and cancels pending mock card payments', async () => {
    const terminal = new MockCardTerminal();
    await terminal.start();

    const declinedPromise = terminal.startPayment({ amountMinor: 5_000 });
    terminal.simulateDecline('test_declined');
    assert.deepEqual(await declinedPromise, {
        approved: false,
        approvedAmount: 0,
        operationNumber: 1,
        reason: 'test_declined',
    });

    const canceledPromise = terminal.startPayment({ amountMinor: 5_000 });
    terminal.cancelPayment();
    assert.equal((await canceledPromise).reason, 'customer_canceled');
});
