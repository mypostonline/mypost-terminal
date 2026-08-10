const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
