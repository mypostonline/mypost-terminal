const test = require('node:test');
const assert = require('node:assert/strict');
const {
    BillAcceptorClient,
} = require('../../devices/bill-acceptor/client');
const { CashChangeCreditService } = require('./change-credit');
const { CashPaymentService } = require('./service');

const createFiscalizer = ({ registerCashSale } = {}) => ({
    driver: 'vendotek',
    getState: () => ({
        connected: true,
        handshaked: true,
        terminalState: 'idle',
        operationActive: false,
        paymentInProgress: false,
        cashSaleInProgress: false,
    }),
    registerCashSale: registerCashSale || (async options => ({
        eventNumber: 1,
        amountMinor: options.amountMinor,
    })),
});

const createService = async (options = {}) => {
    const acceptor = new BillAcceptorClient({ mode: 'mock' });
    await acceptor.start();
    const service = new CashPaymentService({
        acceptor,
        billTimeoutSec: 120,
        partialDecisionTimeoutSec: 600,
        ...options,
    });

    return { acceptor, service };
};

test('completes a cash payment after receiving the target amount', async () => {
    const { service } = await createService();
    const events = [];
    service.on('event', event => events.push(event.event));

    const started = await service.start({
        orderId: 15,
        amountMinor: 10_000,
    });

    assert.equal(started.state, 'accepting');
    assert.equal(started.acceptanceTimeoutSec, 120);
    service.insertMockBill(5_000);
    assert.equal(service.getSession().remainingAmountMinor, 5_000);
    assert.equal(service.getSession().acceptanceTimeoutSec, 120);
    assert.equal(service.getSession().bills[0].sequence, 1);
    assert.ok(service.getSession().bills[0].id);
    service.insertMockBill(5_000);

    const completed = service.getSession();
    assert.equal(completed.state, 'completed');
    assert.equal(completed.acceptedAmountMinor, 10_000);
    assert.equal(completed.remainingAmountMinor, 0);
    assert.deepEqual(
        completed.bills.map(bill => bill.amountMinor),
        [ 5_000, 5_000 ]
    );
    assert.deepEqual(events, [
        'session_started',
        'accepting',
        'bill_accepted',
        'bill_accepted',
        'completed',
    ]);
});

test('fiscalizes a completed cash sale before approving it', async () => {
    let resolveFiscalization;
    let fiscalizationRequest = null;
    const fiscalizationResult = new Promise(resolve => {
        resolveFiscalization = resolve;
    });
    const fiscalizer = createFiscalizer({
        registerCashSale: options => {
            fiscalizationRequest = options;
            return fiscalizationResult;
        },
    });
    const { service } = await createService({
        fiscalizer,
        fiscalizationEnabled: true,
    });
    const events = [];
    service.on('event', event => events.push(event.event));

    await service.start({
        orderId: 'fiscalized-cash',
        amountMinor: 10_000,
        productId: 12,
        productName: 'WASH',
    });
    service.insertMockBill(10_000);

    assert.equal(service.getSession().state, 'fiscalizing');
    assert.deepEqual(fiscalizationRequest, {
        amountMinor: 10_000,
        productId: '12',
        productName: 'WASH',
        eventName: 'CSAPP',
    });

    resolveFiscalization({ eventNumber: 7 });
    const completed = await service.waitForSettlement();

    assert.equal(completed.state, 'completed');
    assert.equal(completed.fiscalization.state, 'completed');
    assert.equal(completed.fiscalization.eventNumber, 7);
    assert.ok(events.includes('fiscalization_started'));
    assert.equal(events.at(-1), 'completed');
});

test('requires attention when the fiscalization outcome is unknown', async () => {
    const fiscalizer = createFiscalizer({
        registerCashSale: async () => {
            const error = new Error('Vendotek response timeout');
            error.outcomeUnknown = true;
            throw error;
        },
    });
    const { service } = await createService({
        fiscalizer,
        fiscalizationEnabled: true,
    });

    await service.start({
        orderId: 'unknown-fiscalization',
        amountMinor: 5_000,
    });
    service.insertMockBill(5_000);
    const session = await service.waitForSettlement();

    assert.equal(session.state, 'attention_required');
    assert.equal(session.error, 'cash_fiscalization_outcome_unknown');
    assert.equal(session.fiscalization.state, 'outcome_unknown');

    await assert.rejects(
        service.start({
            orderId: 'another-order-after-unknown-result',
            amountMinor: 5_000,
        }),
        error => error.code === 'cash_payment_busy'
    );
});

test('accepts multiple bills and creates a QR claim for change', async () => {
    const changeCreditService = new CashChangeCreditService({
        urlTemplate: 'https://app.example/change?token={token}',
        tokenSecret: 'test-secret',
    });
    const { service } = await createService({ changeCreditService });
    await service.start({
        orderId: 'cash-with-change',
        amountMinor: 12_000,
    });

    service.insertMockBill(5_000);
    service.insertMockBill(5_000);
    service.insertMockBill(5_000);

    const completed = service.getSession();
    assert.equal(completed.state, 'completed');
    assert.equal(completed.acceptedAmountMinor, 15_000);
    assert.equal(completed.overpaymentAmountMinor, 3_000);
    assert.deepEqual(
        completed.bills.map(bill => bill.amountMinor),
        [ 5_000, 5_000, 5_000 ]
    );
    assert.equal(completed.changeCredit.status, 'pending');
    assert.equal(completed.changeCredit.amountMinor, 3_000);
    assert.match(completed.changeCredit.qrPayload, /^https:\/\/app\.example/);
});

test('requires change-credit configuration instead of exposing an unsigned QR', async () => {
    const { service } = await createService();
    await service.start({
        orderId: 'cash-with-unconfigured-change',
        amountMinor: 5_000,
    });

    service.insertMockBill(10_000);

    assert.deepEqual(service.getSession().changeCredit, {
        status: 'configuration_required',
        amountMinor: 5_000,
        qrPayload: null,
        expiresAt: null,
    });
});

test('requires operator attention for an unrecognized pulse packet', async () => {
    const { acceptor, service } = await createService();
    await service.start({
        orderId: 'cash-invalid-packet',
        amountMinor: 5_000,
    });

    acceptor.emit('invalidBill', {
        amountMinor: 15_000,
        amountRub: 150,
        pulses: 3,
    });

    const session = service.getSession();
    assert.equal(session.state, 'attention_required');
    assert.equal(session.error, 'bill_amount_unrecognized');
    assert.equal(session.acceptedAmountMinor, 0);
});

test('returns the same active session for the same order', async () => {
    const { service } = await createService();
    const first = await service.start({
        orderId: '20',
        amountMinor: 1_000,
    });
    const second = await service.start({
        orderId: '20',
        amountMinor: 1_000,
    });

    assert.equal(second.id, first.id);
});

test('does not start a second session for a completed order', async () => {
    const { service } = await createService();
    const first = await service.start({
        orderId: '20-completed',
        amountMinor: 1_000,
    });
    service.insertMockBill(1_000);

    const second = await service.start({
        orderId: '20-completed',
        amountMinor: 1_000,
    });

    assert.equal(second.id, first.id);
    assert.equal(second.state, 'completed');
});

test('rejects a parallel cash payment', async () => {
    const { service } = await createService();
    await service.start({
        orderId: '21',
        amountMinor: 1_000,
    });

    await assert.rejects(
        service.start({
            orderId: '22',
            amountMinor: 1_000,
        }),
        error => error.code === 'cash_payment_busy' && error.statusCode === 409,
    );
});

test('always completes after a correctly recognized overpayment', async () => {
    const { acceptor, service } = await createService();
    await service.start({
        orderId: '23-overpayment',
        amountMinor: 5_000,
    });

    acceptor.simulateBill(10_000);

    const session = service.getSession();
    assert.equal(session.state, 'completed');
    assert.equal(session.acceptedAmountMinor, 10_000);
    assert.equal(session.overpaymentAmountMinor, 5_000);
    assert.equal(session.error, null);
    assert.equal(session.changeCredit.amountMinor, 5_000);
});

test('allows cancellation only before accepting cash', async () => {
    const { service } = await createService();
    const session = await service.start({
        orderId: '24',
        amountMinor: 5_000,
    });
    const canceled = await service.cancel({
        sessionId: session.id,
    });
    assert.equal(canceled.state, 'canceled');

    const next = await service.start({
        orderId: '25',
        amountMinor: 5_000,
    });
    service.insertMockBill(1_000);

    await assert.rejects(
        service.cancel({ sessionId: next.id }),
        error => error.code === 'cash_already_accepted',
    );
});

test('pauses a partial payment and resumes it with the accepted amount', async () => {
    const { acceptor, service } = await createService();
    const events = [];
    service.on('event', event => events.push(event.event));
    const started = await service.start({
        orderId: 'partial-resume',
        amountMinor: 10_000,
    });

    service.insertMockBill(5_000);
    service.handleSessionTimeout();

    const paused = service.getSession();
    assert.equal(paused.state, 'partial_payment');
    assert.equal(paused.acceptedAmountMinor, 5_000);
    assert.equal(paused.remainingAmountMinor, 5_000);
    assert.equal(paused.decisionTimeoutSec, 600);
    assert.ok(paused.decisionDeadlineAt);
    assert.equal(acceptor.getStatus().state, 'ready');

    const resumed = await service.resume({ sessionId: started.id });
    assert.equal(resumed.state, 'accepting');
    assert.equal(resumed.acceptedAmountMinor, 5_000);
    assert.equal(resumed.acceptanceTimeoutSec, 120);
    assert.equal(resumed.decisionDeadlineAt, null);
    assert.ok(events.includes('partial_payment'));
    assert.ok(events.includes('resumed'));
});

test('requires balance credit after the partial-payment decision timeout', async () => {
    const { service } = await createService();
    const started = await service.start({
        orderId: 'partial-credit',
        amountMinor: 10_000,
    });
    service.insertMockBill(5_000);
    service.handleSessionTimeout();

    service.handlePartialDecisionTimeout();
    const required = service.getSession();
    assert.equal(required.state, 'balance_credit_required');
    assert.equal(required.acceptedAmountMinor, 5_000);
    assert.equal(required.decisionDeadlineAt, null);

    const credited = service.confirmBalanceCredit({
        sessionId: started.id,
        creditUrl: 'https://app.example/balance/credit',
    });
    assert.equal(credited.state, 'balance_credit_ready');
    assert.deepEqual(credited.balanceCredit, {
        amountMinor: 5_000,
        creditUrl: 'https://app.example/balance/credit',
        confirmedAt: credited.balanceCredit.confirmedAt,
    });
    assert.ok(credited.balanceCredit.confirmedAt);
});

test('does not replace an unresolved partial payment with another order', async () => {
    const { service } = await createService();
    await service.start({
        orderId: 'partial-owner',
        amountMinor: 10_000,
    });
    service.insertMockBill(5_000);
    service.handleSessionTimeout();

    await assert.rejects(
        service.start({
            orderId: 'another-order',
            amountMinor: 10_000,
        }),
        error => error.code === 'cash_payment_busy',
    );
});

test('releases a partial payment and allows a new cash order', async () => {
    const { service } = await createService();
    const first = await service.start({
        orderId: 'released-partial',
        amountMinor: 10_000,
    });
    service.insertMockBill(5_000);
    service.handleSessionTimeout();

    const released = service.release({ sessionId: first.id });
    assert.equal(released.state, 'released');
    assert.equal(released.acceptedAmountMinor, 5_000);
    assert.equal(released.bills.length, 1);
    assert.ok(released.releasedAt);

    const next = await service.start({
        orderId: 'new-cash-order',
        amountMinor: 10_000,
    });
    assert.notEqual(next.id, first.id);
    assert.equal(next.state, 'accepting');
    assert.equal(next.acceptedAmountMinor, 0);
});
