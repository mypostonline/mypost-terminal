const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { VtkClient } = require('./client');
const { decodeTlvs, tlvsToObject } = require('./protocol');

class FakeSocket extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
        this.ended = false;
        this.writes = [];
        this.noDelay = null;
        this.keepAlive = null;
    }

    setNoDelay(value) {
        this.noDelay = value;
    }

    setKeepAlive(enabled, delay) {
        this.keepAlive = { enabled, delay };
    }

    write(data) {
        this.writes.push(data);
        this.onWrite?.(data);
        return true;
    }

    end() {
        this.ended = true;
    }

    destroy() {
        this.destroyed = true;
    }
}

const createClient = (options = {}) => {
    const sockets = [];
    const client = new VtkClient({
        host: '127.0.0.1',
        debug: false,
        createConnection: () => {
            const socket = new FakeSocket();
            sockets.push(socket);
            return socket;
        },
        ...options,
    });

    client.on('error', () => {});

    return { client, sockets };
};

const connectClient = async clientContext => {
    const connectPromise = clientContext.client.connect();
    const socket = clientContext.sockets.at(-1);
    socket.emit('connect');
    await connectPromise;
    return socket;
};

const buildPosResponse = ({
    messageName,
    operationNumber,
    amount,
    eventNumber,
}) => {
    const tlvs = [
        [ 0x01, messageName ],
        [ 0x03, String(operationNumber) ],
    ];
    if (amount !== undefined) {
        tlvs.push([ 0x04, String(amount) ]);
    }
    if (eventNumber !== undefined) {
        tlvs.push([ 0x08, String(eventNumber) ]);
    }

    const appMessage = Buffer.concat(tlvs.map(([ tag, value ]) => {
        const valueBuffer = Buffer.from(value, 'ascii');
        return Buffer.concat([
            Buffer.from([ tag, valueBuffer.length ]),
            valueBuffer,
        ]);
    }));
    const header = Buffer.alloc(4);
    header.writeUInt16BE(appMessage.length + 2, 0);
    header.writeUInt16BE(0x97fb, 2);
    return Buffer.concat([ header, appMessage ]);
};

const readOutboundMessageName = frame => {
    const valueLength = frame[5];
    return frame.subarray(6, 6 + valueLength).toString('ascii');
};

test('allows payment wait equal to operation timeout and clamps it later', () => {
    const { client } = createClient({
        operationTimeoutSec: 60,
        paymentWaitSec: 60,
    });

    assert.equal(client.operationTimeoutSec, 60);
    assert.equal(client.paymentWaitSec, 60);
});

test('ignores close events from a superseded TCP socket', async () => {
    const context = createClient();
    const firstSocket = await connectClient(context);

    context.client.close();
    context.client.manualClose = false;

    const secondConnectPromise = context.client.connect();
    const secondSocket = context.sockets.at(-1);

    firstSocket.emit('close');
    assert.equal(context.client.socket, secondSocket);
    assert.equal(context.client.terminalState, 'connecting');

    secondSocket.emit('connect');
    await secondConnectPromise;

    assert.equal(context.client.socket, secondSocket);
    assert.equal(context.client.connected, true);

    context.client.close();
    secondSocket.emit('close');
});

test('destroys the current socket after a malformed frame', async () => {
    const context = createClient();
    const statuses = [];
    context.client.on('status', status => statuses.push(status.type));
    const socket = await connectClient(context);

    socket.emit('data', Buffer.from([ 0x00, 0x01, 0x00, 0x00 ]));

    assert.equal(socket.destroyed, true);
    assert.ok(statuses.includes('protocol_error'));

    context.client.close();
    socket.emit('close');
});

test('installs the VRP response waiter before sending the request', async () => {
    const { client } = createClient();
    client.connected = true;
    client.handshaked = true;
    client.terminalState = 'idle';

    client.sendVrp = () => {
        client.operationNumber += 1;
        client.emit('message', {
            messageName: 'VRP',
            operationNumber: String(client.operationNumber),
            amount: '10000',
        });
        return client.operationNumber;
    };

    const result = await client.startPayment({
        amountMinor: 10000,
        productId: 1,
        productName: 'WASH',
    });

    assert.equal(result.approved, true);
    assert.equal(result.approvedAmount, 10000);
    assert.equal(client.currentOperation.state, 'awaiting_fin');
    assert.equal(client.listenerCount('message'), 0);
    assert.equal(client.listenerCount('close'), 0);

    client.close();
});

test('cancels an active payment and returns safely to idle', async () => {
    const { client } = createClient();
    client.connected = true;
    client.handshaked = true;
    client.terminalState = 'idle';

    client.sendVrp = () => {
        client.operationNumber += 1;
        return client.operationNumber;
    };
    client.sendAbr = operationNumber => {
        setImmediate(() => client.emit('message', {
            messageName: 'VRP',
            operationNumber: String(operationNumber),
            amount: '0',
        }));
    };
    client.returnToIdle = async () => {
        client.terminalState = 'idle';
        return { messageName: 'IDL' };
    };

    const paymentPromise = client.startPayment({
        amountMinor: 10000,
        productId: 1,
        productName: 'WASH',
    });
    const cancellation = client.cancelPayment('customer_canceled');
    const result = await paymentPromise;

    assert.equal(cancellation.reason, 'customer_canceled');
    assert.equal(result.approved, false);
    assert.equal(result.canceled, true);
    assert.equal(result.reason, 'customer_canceled');
    assert.equal(client.currentOperation, null);
    assert.equal(client.operationActive, false);

    client.close();
});

test('rejects invalid payment input without breaking the connection', async () => {
    const { client } = createClient();
    const socket = new FakeSocket();
    client.socket = socket;
    client.connected = true;
    client.handshaked = true;
    client.terminalState = 'idle';

    await assert.rejects(
        client.startPayment({
            amountMinor: 0,
            productId: 1,
            productName: 'WASH',
        }),
        /amountMinor must be a positive integer/
    );

    assert.equal(socket.destroyed, false);
    assert.equal(client.terminalState, 'idle');
    assert.equal(client.operationActive, false);
    assert.equal(client.paymentInProgress, false);
    assert.equal(client.currentOperation, null);
});

test('registers a cash sale with the next event number', async () => {
    const { client } = createClient();
    client.connected = true;
    client.handshaked = true;
    client.terminalState = 'idle';
    client.operationNumber = 7;
    client.eventNumber = 3;

    let outbound = null;
    client.sendCommand = command => {
        outbound = tlvsToObject(
            decodeTlvs(Buffer.concat(command.tlvs))
        );
        setImmediate(() => client.emit('message', {
            messageName: 'IDL',
            operationNumber: '7',
            eventNumber: '4',
        }));
    };

    const result = await client.registerCashSale({
        amountMinor: 10_000,
        productId: 12,
        productName: 'WASH',
    });

    assert.deepEqual(outbound, {
        messageName: 'IDL',
        operationNumber: '7',
        amount: '10000',
        eventName: 'CSAPP',
        eventNumber: '4',
        productId: '12',
        productName: 'WASH',
    });
    assert.equal(result.eventNumber, 4);
    assert.equal(client.eventNumber, 4);
    assert.equal(client.terminalState, 'idle');
    assert.equal(client.cashSaleInProgress, false);
    assert.equal(client.listenerCount('message'), 0);
});

test('does not automatically retry an unconfirmed cash sale', async () => {
    const { client } = createClient();
    const socket = new FakeSocket();
    let sent = 0;
    client.socket = socket;
    client.connected = true;
    client.handshaked = true;
    client.terminalState = 'idle';
    client.sendCommand = () => {
        sent += 1;
    };
    client.waitForMessage = async (
        predicate,
        timeoutMs,
        description,
        send
    ) => {
        send();
        throw new Error('timeout');
    };

    await assert.rejects(
        client.registerCashSale({
            amountMinor: 5_000,
            productId: 1,
            productName: 'WASH',
        }),
        error => (
            error.code === 'cash_fiscalization_outcome_unknown' &&
            error.outcomeUnknown === true
        )
    );

    assert.equal(sent, 1);
    assert.equal(socket.destroyed, true);
    assert.equal(client.cashSaleInProgress, false);
});

test('installs the FIN response waiter before sending finalization', async () => {
    const { client } = createClient();
    client.connected = true;
    client.handshaked = true;
    client.terminalState = 'awaiting_fin';
    client.operationActive = true;
    client.currentOperation = {
        operationNumber: 42,
        approvedAmount: 10000,
        productId: 1,
        productName: 'WASH',
        state: 'awaiting_fin',
    };

    client.sendFin = ({ operationNumber }) => {
        client.emit('message', {
            messageName: 'FIN',
            operationNumber: String(operationNumber),
            amount: '10000',
        });
    };
    client.returnToIdle = async () => {
        client.terminalState = 'idle';
        return { messageName: 'IDL' };
    };

    const result = await client.finalizeSuccess(10000);

    assert.equal(result.finResponse.messageName, 'FIN');
    assert.equal(client.operationActive, false);
    assert.equal(client.currentOperation, null);
    assert.equal(client.listenerCount('message'), 0);
    assert.equal(client.listenerCount('error'), 1);
    assert.equal(client.listenerCount('close'), 0);
});

test('forces reconnect after an unknown finalization error', async () => {
    const { client } = createClient();
    const socket = new FakeSocket();
    const statuses = [];

    client.on('status', status => statuses.push(status.type));
    client.socket = socket;
    client.connected = true;
    client.handshaked = true;
    client.terminalState = 'awaiting_fin';
    client.operationActive = true;
    client.currentOperation = {
        operationNumber: 7,
        approvedAmount: 5000,
        productId: 1,
        productName: 'WASH',
        state: 'awaiting_fin',
    };
    client.sendFin = () => {
        throw new Error('write failed');
    };

    await assert.rejects(
        client.finalizeSuccess(5000),
        /write failed/
    );

    assert.equal(socket.destroyed, true);
    assert.equal(client.operationActive, true);
    assert.equal(client.currentOperation.state, 'finalizing');
    assert.ok(statuses.includes('finalization_error'));
    assert.equal(client.listenerCount('message'), 0);
    assert.equal(client.listenerCount('close'), 0);
});

test('runs handshake, payment and finalization through framed TCP messages', async () => {
    const context = createClient();
    const startPromise = context.client.start();
    const socket = context.sockets[0];
    const outboundMessages = [];

    socket.onWrite = frame => {
        const messageName = readOutboundMessageName(frame);
        outboundMessages.push(messageName);

        if (messageName === 'IDL') {
            setImmediate(() => socket.emit('data', buildPosResponse({
                messageName: 'IDL',
                operationNumber: context.client.operationNumber,
            })));
        } else if (messageName === 'VRP') {
            setImmediate(() => socket.emit('data', buildPosResponse({
                messageName: 'VRP',
                operationNumber: context.client.operationNumber,
                amount: 10000,
            })));
        } else if (messageName === 'FIN') {
            setImmediate(() => socket.emit('data', buildPosResponse({
                messageName: 'FIN',
                operationNumber: context.client.operationNumber,
                amount: 10000,
            })));
        }
    };

    socket.emit('connect');
    await startPromise;

    const payment = await context.client.startPayment({
        amountMinor: 10000,
        productId: 1,
        productName: 'WASH',
    });
    const finalization = await context.client.finalizeSuccess(10000);

    assert.equal(payment.approved, true);
    assert.equal(finalization.finResponse.messageName, 'FIN');
    assert.equal(finalization.idleResponse.messageName, 'IDL');
    assert.deepEqual(outboundMessages, [ 'IDL', 'VRP', 'FIN', 'IDL' ]);
    assert.equal(context.client.terminalState, 'idle');
    assert.equal(context.client.operationActive, false);
    assert.equal(context.client.currentOperation, null);

    context.client.close();
    socket.emit('close');
});
