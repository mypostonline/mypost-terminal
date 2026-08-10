const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('events');
const { PassThrough } = require('stream');
const { BillAcceptorClient } = require('./client');

const createFakeMonitor = () => {
    const monitor = new EventEmitter();
    monitor.stdout = new PassThrough();
    monitor.stderr = new PassThrough();
    monitor.killCalls = [];
    monitor.kill = signal => {
        monitor.killCalls.push(signal);
        setImmediate(() => monitor.emit('close', 0, signal));
        return true;
    };
    return monitor;
};

const createGpioClient = async (options = {}) => {
    const monitor = createFakeMonitor();
    const spawnCalls = [];
    const spawnProcess = (command, args, spawnOptions) => {
        spawnCalls.push({ command, args, options: spawnOptions });
        setImmediate(() => monitor.emit('spawn'));
        return monitor;
    };
    const client = new BillAcceptorClient({
        mode: 'gpio-pulse',
        packetGapMs: 5,
        debounceMs: 0,
        spawnProcess,
        ...options,
    });

    client.on('error', () => {});
    await client.start();

    return {
        client,
        monitor,
        spawnCalls,
    };
};

test('starts gpiomon with the configured Raspberry Pi GPIO line', async () => {
    const { client, spawnCalls } = await createGpioClient({
        gpioChip: 'gpiochip2',
        gpioLine: '23',
    });

    assert.deepEqual(spawnCalls, [ {
        command: 'gpiomon',
        args: [
            '--chip', 'gpiochip2',
            '--edges=rising',
            '--bias=pull-up',
            '23',
        ],
        options: {
            stdio: [ 'ignore', 'pipe', 'pipe' ],
        },
    } ]);
    assert.equal(client.getStatus().state, 'ready');

    await client.stop();
});

test('combines rising edges into one bill event', async () => {
    const { client, monitor } = await createGpioClient({
        rubPerPulse: 50,
    });
    await client.enableAcceptance();

    const billEvent = once(client, 'bill');
    monitor.stdout.write('rising edge 1\nrising');
    monitor.stdout.write(' edge 2\n');

    const [ bill ] = await billEvent;
    assert.equal(bill.pulses, 2);
    assert.equal(bill.amountMinor, 10_000);
    assert.equal(bill.amountRub, 100);
    assert.equal(client.getStatus().pendingPulses, 0);

    await client.disableAcceptance();
    await client.stop();
});

test('filters duplicate edges inside the debounce interval', async () => {
    const timestamps = [ 1000, 1010, 1030 ];
    const { client } = await createGpioClient({
        debounceMs: 20,
        now: () => timestamps.shift(),
    });
    await client.enableAcceptance();

    const billEvent = once(client, 'bill');
    client.handlePulse('first');
    client.handlePulse('duplicate');
    client.handlePulse('second');

    const [ bill ] = await billEvent;
    assert.equal(bill.pulses, 2);
    assert.equal(bill.amountMinor, 10_000);

    await client.disableAcceptance();
    await client.stop();
});

test('uses gpiomon timestamps when filtering duplicate edges', async () => {
    const { client } = await createGpioClient({
        debounceMs: 70,
        now: () => {
            throw new Error('timestamp fallback should not be used');
        },
    });
    await client.enableAcceptance();

    const billEvent = once(client, 'bill');
    client.handlePulse('1000.000 rising edge');
    client.handlePulse('1000.051 false edge');
    client.handlePulse('1000.102 rising edge');

    const [ bill ] = await billEvent;
    assert.equal(bill.pulses, 2);
    assert.equal(bill.amountMinor, 10_000);

    await client.disableAcceptance();
    await client.stop();
});

test('does not accept an unsupported pulse packet as a bill', async () => {
    const { client } = await createGpioClient();
    await client.enableAcceptance();

    const invalidEvent = once(client, 'invalidBill');
    client.handlePulse('first');
    client.handlePulse('second');
    client.handlePulse('third');

    const [ bill ] = await invalidEvent;
    assert.equal(bill.pulses, 3);
    assert.equal(bill.amountRub, 150);
    assert.equal(client.getStatus().pendingPulses, 0);

    await client.disableAcceptance();
    await client.stop();
});

test('resets a pulse packet that exceeds the maximum duration', async () => {
    const { client } = await createGpioClient({
        maxPacketTimeMs: 100,
    });
    await client.enableAcceptance();

    const diagnosticEvent = once(client, 'diagnostic');
    client.handlePulse('1000.000 rising edge');
    client.handlePulse('1000.200 rising edge');

    const [ event ] = await diagnosticEvent;
    assert.equal(event.type, 'packet_timeout');
    assert.equal(event.pulses, 1);
    assert.equal(client.getStatus().pendingPulses, 0);

    await client.disableAcceptance();
    await client.stop();
});

test('reports a bill packet detected outside an active session', async () => {
    const { client, monitor } = await createGpioClient();

    const unexpectedEvent = once(client, 'unexpectedBill');
    monitor.stdout.write('rising edge\n');

    const [ bill ] = await unexpectedEvent;
    assert.equal(bill.pulses, 1);
    assert.equal(bill.amountMinor, 5_000);
    assert.equal(client.getStatus().state, 'ready');

    await client.stop();
});

test('marks the acceptor unavailable when gpiomon exits', async () => {
    const { client, monitor } = await createGpioClient();

    const errorEvent = once(client, 'error');
    monitor.emit('close', 1, null);
    const [ error ] = await errorEvent;

    assert.match(error.message, /gpiomon exited unexpectedly/);
    assert.equal(client.getStatus().state, 'error');
    assert.equal(client.getStatus().available, false);
});
