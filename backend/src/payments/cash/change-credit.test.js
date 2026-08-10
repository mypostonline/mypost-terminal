const test = require('node:test');
const assert = require('node:assert/strict');
const { CashChangeCreditService } = require('./change-credit');

const NOW = Date.parse('2026-08-10T10:00:00.000Z');

test('creates a signed URL for a cash change claim', () => {
    const service = new CashChangeCreditService({
        urlTemplate: 'https://app.example/change?token={token}',
        tokenSecret: 'test-secret',
        tokenTtlSec: 3600,
        now: () => NOW,
    });

    const claim = service.createClaim({
        sessionId: 'session-1',
        orderId: '42',
        amountMinor: 5000,
    });
    const token = new URL(claim.qrPayload).searchParams.get('token');
    const payload = service.verifyToken(token);

    assert.equal(claim.status, 'pending');
    assert.equal(claim.amountMinor, 5000);
    assert.equal(claim.expiresAt, '2026-08-10T11:00:00.000Z');
    assert.equal(payload.sessionId, 'session-1');
    assert.equal(payload.orderId, '42');
    assert.equal(payload.amountMinor, 5000);
});

test('does not expose an unsigned QR when change credit is unconfigured', () => {
    const service = new CashChangeCreditService();
    const claim = service.createClaim({
        sessionId: 'session-2',
        orderId: '43',
        amountMinor: 1000,
    });

    assert.deepEqual(claim, {
        status: 'configuration_required',
        amountMinor: 1000,
        qrPayload: null,
        expiresAt: null,
    });
});

test('rejects a modified cash change token', () => {
    const service = new CashChangeCreditService({
        urlTemplate: 'https://app.example/change',
        tokenSecret: 'test-secret',
        now: () => NOW,
    });
    const claim = service.createClaim({
        sessionId: 'session-3',
        orderId: '44',
        amountMinor: 1000,
    });
    const token = new URL(claim.qrPayload).searchParams.get('token');

    assert.throws(
        () => service.verifyToken(`${token}modified`),
        /signature/
    );
});
