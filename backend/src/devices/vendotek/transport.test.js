const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('events');
const {
    POS_DISCRIMINATOR,
    buildMessage,
    encodeAscii,
    encodeTlv,
} = require('./protocol');
const { VendotekTransport } = require('./transport');

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
        return true;
    }

    end() {
        this.ended = true;
    }

    destroy() {
        this.destroyed = true;
    }
}

const createTransport = () => {
    const sockets = [];
    const connectionOptions = [];
    const transport = new VendotekTransport({
        host: '127.0.0.1',
        port: 62801,
        createConnection: options => {
            connectionOptions.push(options);
            const socket = new FakeSocket();
            sockets.push(socket);
            return socket;
        },
    });

    return { connectionOptions, sockets, transport };
};

const connectTransport = async context => {
    const connectPromise = context.transport.connect();
    const socket = context.sockets.at(-1);
    socket.emit('connect');
    await connectPromise;
    return socket;
};

test('connects and sends framed data through the socket', async () => {
    const context = createTransport();
    const socket = await connectTransport(context);
    const frame = Buffer.from([ 1, 2, 3 ]);

    context.transport.send(frame);

    assert.deepEqual(context.connectionOptions, [ {
        host: '127.0.0.1',
        port: 62801,
    } ]);
    assert.equal(context.transport.connected, true);
    assert.equal(socket.noDelay, true);
    assert.deepEqual(socket.keepAlive, {
        enabled: true,
        delay: 10000,
    });
    assert.deepEqual(socket.writes, [ frame ]);

    context.transport.close();
    socket.emit('close');
});

test('assembles protocol frames split across TCP chunks', async () => {
    const context = createTransport();
    const socket = await connectTransport(context);
    const frame = buildMessage(POS_DISCRIMINATOR, [
        encodeTlv(0x01, encodeAscii('IDL')),
    ]);
    const frameEvent = once(context.transport, 'frame');

    socket.emit('data', frame.subarray(0, 5));
    socket.emit('data', frame.subarray(5));

    const [ parsedFrame ] = await frameEvent;
    assert.equal(parsedFrame.discriminator, POS_DISCRIMINATOR);
    assert.deepEqual(
        parsedFrame.appMessage,
        frame.subarray(4)
    );

    context.transport.close();
    socket.emit('close');
});

test('destroys the socket after malformed framing data', async () => {
    const context = createTransport();
    const socket = await connectTransport(context);
    const protocolError = once(context.transport, 'protocolError');

    socket.emit('data', Buffer.from([ 0x00, 0x01, 0x00, 0x00 ]));

    const [ error ] = await protocolError;
    assert.match(error.message, /Invalid VTK payload length/);
    assert.equal(socket.destroyed, true);

    socket.emit('close');
});

test('ignores events from a superseded socket', async () => {
    const context = createTransport();
    const firstSocket = await connectTransport(context);

    context.transport.close();
    const secondConnectPromise = context.transport.connect();
    const secondSocket = context.sockets.at(-1);

    firstSocket.emit('close');
    assert.equal(context.transport.socket, secondSocket);
    assert.equal(context.transport.isConnecting, true);

    secondSocket.emit('connect');
    await secondConnectPromise;

    assert.equal(context.transport.socket, secondSocket);
    assert.equal(context.transport.connected, true);

    context.transport.close();
    secondSocket.emit('close');
});
