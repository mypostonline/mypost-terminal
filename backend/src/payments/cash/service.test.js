const test = require('node:test');
const assert = require('node:assert/strict');
const {
    BillAcceptorClient,
} = require('../../devices/bill-acceptor/client');
const { CashChangeCreditService } = require('./change-credit');
const { CashPaymentService } = require('./service');

const createService = async (options = {}) => {
    const acceptor = new BillAcceptorClient({ mode: 'mock' });
    await acceptor.start();
    const service = new CashPaymentService({
        acceptor,
        sessionTimeoutSec: 60,
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
    service.insertMockBill(5_000);
    assert.equal(service.getSession().remainingAmountMinor, 5_000);
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
