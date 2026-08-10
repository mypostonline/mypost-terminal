import { spawn } from 'node:child_process';

const RUB_PER_PULSE = 50;

const GPIO_CHIP = 'gpiochip0';
const GPIO_LINE = '17';

// Настройки фильтрации
const DEBOUNCE_MS = 70;          // ложный фронт ~51 мс, полезный ~102 мс
const PACKET_TIMEOUT_MS = 1200;  // конец пачки импульсов
const MAX_PACKET_TIME_MS = 3000; // максимальная длина пачки

const VALID_AMOUNTS = [
    50,
    100,
    500,
    1000
];

let pulses = 0;
let lastPulseAt = 0;
let firstPulseAt = 0;
let packetTimer = null;
let stdoutBuffer = '';


const mon = spawn('gpiomon', [
    '--chip',
    GPIO_CHIP,
    '--edges=rising',
    '--bias=pull-up',
    GPIO_LINE,
]);


console.log(`Listening ${GPIO_CHIP} line ${GPIO_LINE}`);
console.log('Counting rising edges');


function resetPacket() {
    pulses = 0;
    firstPulseAt = 0;

    clearTimeout(packetTimer);
    packetTimer = null;
}


function finishPacket() {

    if (pulses === 0) {
        return;
    }

    const amount = pulses * RUB_PER_PULSE;

    console.log('-----------------------');

    if (VALID_AMOUNTS.includes(amount)) {
        console.log('Accepted bill');
        console.log('Pulses:', pulses);
        console.log('Amount:', amount, 'RUB');

        // Здесь дальше можно отправлять событие в backend
        // emit('bill', amount);

    } else {
        console.log('Ignored invalid pulse packet');
        console.log('Pulses:', pulses);
        console.log('Calculated:', amount);
    }

    console.log('-----------------------');

    resetPacket();
}


function getEventTime(line) {
    const timestampSeconds = Number.parseFloat(
        line.trim().split(/\s+/, 1)[0]
    );

    return Number.isFinite(timestampSeconds)
        ? timestampSeconds * 1000
        : Date.now();
}


function handleMonitorLine(line) {
    const now = getEventTime(line);
    const deltaMs = lastPulseAt > 0
        ? now - lastPulseAt
        : null;

    // антидребезг
    if (deltaMs !== null && deltaMs < DEBOUNCE_MS) {
        console.log(
            'Ignored duplicate edge:',
            `${deltaMs.toFixed(1)} ms`,
            '|',
            line
        );
        return;
    }

    lastPulseAt = now;

    if (pulses === 0) {
        firstPulseAt = now;
    }

    // слишком длинная пачка - сбрасываем
    if (now - firstPulseAt > MAX_PACKET_TIME_MS) {
        console.log('Packet timeout reset');
        resetPacket();
        return;
    }

    pulses++;

    console.log(
        'Pulse:',
        pulses,
        '| delta:',
        deltaMs === null ? 'first' : `${deltaMs.toFixed(1)} ms`,
        '|',
        line
    );

    clearTimeout(packetTimer);

    packetTimer = setTimeout(() => {
        finishPacket();
    }, PACKET_TIMEOUT_MS);
}


mon.stdout.on('data', (data) => {
    // stdout является потоком: одна строка gpiomon может прийти частями,
    // а несколько строк — одним data-событием.
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';


    for (const line of lines) {
        if (line.trim()) {
            handleMonitorLine(line);
        }
    }
});


mon.stderr.on('data', (data) => {
    console.error(
        'gpiomon error:',
        data.toString()
    );
});


mon.on('close', (code) => {
    console.log(
        `gpiomon exited with code ${code}`
    );
});


process.on('SIGINT', () => {

    console.log('\nStopping...');

    resetPacket();

    mon.kill('SIGINT');

    process.exit();
});
