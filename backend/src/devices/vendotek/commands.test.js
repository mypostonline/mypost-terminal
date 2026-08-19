const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createCashSaleIdl,
    createFin,
    createIdl,
    createVrp,
} = require('./commands');
const { decodeTlvs, tlvsToObject } = require('./protocol');

const decodeCommand = command => {
    return tlvsToObject(decodeTlvs(Buffer.concat(command.tlvs)));
};

test('creates IDL with operation and event numbers', () => {
    const command = createIdl({
        operationNumber: 7,
        eventNumber: 3,
    });

    assert.equal(command.label, 'IDL');
    assert.deepEqual(decodeCommand(command), {
        messageName: 'IDL',
        operationNumber: '7',
        eventNumber: '3',
    });
});

test('creates a cash sale IDL for fiscalization', () => {
    const command = createCashSaleIdl({
        operationNumber: 7,
        eventNumber: 4,
        amountMinor: 10_000,
        productId: 12,
        productName: 'WASH',
    });

    assert.deepEqual(decodeCommand(command), {
        messageName: 'IDL',
        operationNumber: '7',
        amount: '10000',
        eventName: 'CSAPP',
        eventNumber: '4',
        productId: '12',
        productName: 'WASH',
    });
});

test('rejects an invalid cash sale product code', () => {
    assert.throws(
        () => createCashSaleIdl({
            operationNumber: 7,
            eventNumber: 4,
            amountMinor: 10_000,
            productId: 'product-12',
            productName: 'WASH',
        }),
        /productId/
    );
});

test('creates VRP with product metadata', () => {
    const command = createVrp({
        operationNumber: 8,
        amountMinor: 10000,
        productId: 1,
        productName: 'WASH',
    });

    assert.deepEqual(decodeCommand(command), {
        messageName: 'VRP',
        operationNumber: '8',
        amount: '10000',
        productId: '1',
        productName: 'WASH',
    });
});

test('allows zero only for FIN commands', () => {
    assert.doesNotThrow(() => createFin({
        operationNumber: 9,
        amountMinor: 0,
    }));
    assert.throws(
        () => createVrp({ operationNumber: 9, amountMinor: 0 }),
        /positive integer/
    );
});
