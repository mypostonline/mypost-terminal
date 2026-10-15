const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('node:events');
const { FiscalReceiptSync, parseFiscalQr } = require('./fiscal-receipt-sync');

const qr = 't=20261013T1206&s=50.00&fn=7381440901358112&i=247&fp=88689612&n=1';
const now = () => Date.parse('2026-10-13T09:06:42Z');
const silentLogger = { log () {}, error () {} };

function makeSync(outboxFile, fetchImpl) {
    return new FiscalReceiptSync({
        terminal: new EventEmitter(),
        cashPayments: new EventEmitter(),
        cardPayments: new EventEmitter(),
        config: {
            apiUrl: 'https://api.example.test',
            outboxFile, timezoneOffsetMinutes: 180,
        },
        logger: silentLogger, fetchImpl, now,
    });
}

test('matches the observed cash QR and retries a persisted delivery after restart', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mypost-receipt-'));
    const outboxFile = path.join(directory, 'outbox.json');
    t.after(() => {
        if (fs.existsSync(outboxFile)) fs.unlinkSync(outboxFile);
        fs.rmdirSync(directory);
    });
    const first = makeSync(outboxFile, async () => { throw new Error('offline'); });
    first.handlePayment('cash', {
        event: 'completed', session: {
            id: '4404d842-37db-4a35-8836-240c36c81824',
            orderId: '55586', completedAt: '2026-10-13T09:06:21Z',
            acceptedAmountMinor: 5000,
            fiscalization: { state: 'completed', eventNumber: '16', amountMinor: 5000 },
        },
    });
    first.handleMessage({ fiscalQr: qr, eventNumber: '16', operationNumber: '2' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(first.outbox.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(outboxFile, 'utf8')).outbox[0].orderId, 55586);

    const calls = [];
    const restarted = makeSync(outboxFile, async (url, options) => {
        calls.push({ url, options });
        return { ok: true };
    });
    restarted.start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(restarted.outbox.length, 0);
    assert.equal(calls[0].url, 'https://api.example.test/orders/55586/fiscal-receipt');
    assert.deepEqual(calls[0].options.headers, { 'content-type': 'application/json' });
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        qr, payment_method: 'cash',
        terminal_session_id: '4404d842-37db-4a35-8836-240c36c81824',
        accepted_amount_minor: 5000,
        vendotek_event_number: '16',
    });
    restarted.handleMessage({ fiscalQr: qr, eventNumber: '16' });
    assert.equal(restarted.pendingQr.length, 0);
    restarted.stop();
});

test('does not assign a QR when matching sessions are ambiguous', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mypost-ambiguous-'));
    const outboxFile = path.join(directory, 'outbox.json');
    const sync = makeSync(outboxFile, async () => ({ ok: true }));
    for (const orderId of [ 1, 2 ]) {
        sync.handlePayment('card', {
            event: 'completed', session: {
                id: `4404d842-37db-4a35-8836-240c36c8182${orderId}`,
                orderId: String(orderId), operationNumber: '2',
                approvedAmountMinor: 5000, completedAt: '2026-10-13T09:06:20Z',
            },
        });
    }
    sync.handleMessage({ fiscalQr: qr, operationNumber: '2' });
    assert.equal(sync.outbox.length, 0);
    assert.equal(sync.pendingQr.length, 1);
    fs.unlinkSync(outboxFile);
    fs.rmdirSync(directory);
});

test('keeps the completed session across restart while waiting for the QR', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mypost-pending-'));
    const outboxFile = path.join(directory, 'outbox.json');
    t.after(() => {
        if (fs.existsSync(outboxFile)) fs.unlinkSync(outboxFile);
        fs.rmdirSync(directory);
    });
    const first = makeSync(outboxFile, async () => ({ ok: true }));
    first.handlePayment('cash', {
        event: 'completed', session: {
            id: '4404d842-37db-4a35-8836-240c36c81824',
            orderId: '55586', completedAt: '2026-10-13T09:06:21Z',
            acceptedAmountMinor: 10000,
            fiscalization: { state: 'completed', eventNumber: '16', amountMinor: 5000 },
        },
    });
    const calls = [];
    const restarted = makeSync(outboxFile, async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return { ok: true };
    });
    restarted.start();
    restarted.handleMessage({ fiscalQr: qr, eventNumber: '16' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].accepted_amount_minor, 10000);
    restarted.stop();
});

test('parses the fiscal amount and rejects incomplete QR data', () => {
    assert.deepEqual(parseFiscalQr(qr, 180), {
        qr, amountMinor: 5000,
        fiscalAt: Date.parse('2026-10-13T09:06:00Z'),
        fn: '7381440901358112', documentNumber: '247', sign: '88689612',
    });
    assert.equal(parseFiscalQr('t=20261013T1206&s=50.00', 180), null);
});
