const test = require('node:test');
const assert = require('node:assert/strict');
const { CardPaymentService } = require('./service');

class FakeTerminal {
    constructor () {
        this.state = {
            connected: true,
            handshaked: true,
            terminalState: 'idle',
            operationActive: false,
            paymentInProgress: false,
        };
        this.startCalls = 0;
        this.cancelCalls = 0;
        this.finalizeCalls = 0;
        this.paymentResult = {
            approved: true,
            approvedAmount: 10_000,
            operationNumber: 7,
        };
        this.finalizeError = null;
    }

    getState () {
        return { ...this.state };
    }

    async startPayment () {
        this.startCalls += 1;
        return this.paymentResult;
    }

    cancelPayment () {
        this.cancelCalls += 1;
        return { operationNumber: 7 };
    }

    async finalizeSuccess () {
        this.finalizeCalls += 1;
        if (this.finalizeError) {
            throw this.finalizeError;
        }
        return { ok: true };
    }
}

test('reuses a completed session for the same order', async () => {
    const terminal = new FakeTerminal();
    const service = new CardPaymentService({ terminal });

    const firstSession = service.start({
        orderId: '42',
        amountMinor: 10_000,
    });
    await service.waitForSettlement();

    const secondSession = service.start({
        orderId: '42',
        amountMinor: 10_000,
    });

    assert.equal(firstSession.id, secondSession.id);
    assert.equal(secondSession.state, 'completed');
    assert.equal(terminal.startCalls, 1);
    assert.equal(terminal.finalizeCalls, 1);
});

test('marks a declined payment as safe failure', async () => {
    const terminal = new FakeTerminal();
    terminal.paymentResult = {
        approved: false,
        approvedAmount: 0,
        operationNumber: 8,
        reason: 'declined',
    };
    const service = new CardPaymentService({ terminal });

    service.start({
        orderId: '43',
        amountMinor: 5_000,
    });
    const session = await service.waitForSettlement();

    assert.equal(session.state, 'declined');
    assert.equal(session.reason, 'declined');
    assert.equal(terminal.finalizeCalls, 0);
});

test('cancels a payment before card approval', async () => {
    const terminal = new FakeTerminal();
    let resolvePayment;
    terminal.startPayment = () => {
        terminal.startCalls += 1;
        return new Promise(resolve => {
            resolvePayment = resolve;
        });
    };
    const service = new CardPaymentService({ terminal });

    const started = service.start({
        orderId: '46',
        amountMinor: 5_000,
    });
    const canceling = service.cancel({
        sessionId: started.id,
        orderId: '46',
    });

    assert.equal(canceling.state, 'canceling');
    assert.equal(terminal.cancelCalls, 1);

    resolvePayment({
        approved: false,
        approvedAmount: 0,
        operationNumber: 9,
        reason: 'customer_canceled',
    });
    const session = await service.waitForSettlement();

    assert.equal(session.state, 'declined');
    assert.equal(session.reason, 'customer_canceled');
    assert.equal(terminal.finalizeCalls, 0);
});

test('does not cancel a payment after card approval', async () => {
    const terminal = new FakeTerminal();
    let resolveFinalization;
    terminal.finalizeSuccess = () => {
        terminal.finalizeCalls += 1;
        return new Promise(resolve => {
            resolveFinalization = resolve;
        });
    };
    const service = new CardPaymentService({ terminal });

    service.start({
        orderId: '47',
        amountMinor: 10_000,
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(service.getSession().state, 'finalizing');
    assert.throws(
        () => service.cancel({ orderId: '47' }),
        error => error.code === 'card_payment_already_approved' &&
            error.statusCode === 409
    );

    resolveFinalization({ ok: true });
    await service.waitForSettlement();
});

test('requires operator attention when finalization outcome is unknown', async () => {
    const terminal = new FakeTerminal();
    terminal.finalizeError = new Error('connection lost');
    const service = new CardPaymentService({ terminal });

    service.start({
        orderId: '44',
        amountMinor: 10_000,
    });
    const session = await service.waitForSettlement();

    assert.equal(session.state, 'attention_required');
    assert.equal(session.error, 'card_finalization_outcome_unknown');
    assert.equal(session.approvedAmountMinor, 10_000);
});

test('rejects a payment when the card terminal is unavailable', () => {
    const terminal = new FakeTerminal();
    terminal.state.connected = false;
    terminal.state.terminalState = 'disconnected';
    const service = new CardPaymentService({ terminal });

    assert.throws(
        () => service.start({
            orderId: '45',
            amountMinor: 10_000,
        }),
        error => error.code === 'card_terminal_unavailable' &&
            error.statusCode === 503
    );
});
