const EventEmitter = require('events');
const { spawn } = require('child_process');

const SUPPORTED_MODES = new Set([ 'disabled', 'mock', 'gpio-pulse' ]);

class BillAcceptorClient extends EventEmitter {
    constructor ({
        mode = 'disabled',
        gpioChip = 'gpiochip0',
        gpioLine = '17',
        rubPerPulse = 50,
        debounceMs = 70,
        packetGapMs = 1200,
        maxPacketTimeMs = 3000,
        validAmountsRub = [ 50, 100, 500, 1000 ],
        gpiomonCommand = 'gpiomon',
        spawnProcess = spawn,
        now = () => Date.now(),
        debug = false,
    } = {}) {
        super();

        if (!SUPPORTED_MODES.has(mode)) {
            throw new Error(`Unsupported bill acceptor mode: ${mode}`);
        }

        const amountMinorPerPulse = Math.round(Number(rubPerPulse) * 100);
        if (!Number.isInteger(amountMinorPerPulse) || amountMinorPerPulse <= 0) {
            throw new Error('rubPerPulse must be a positive amount');
        }
        if (!Number.isFinite(Number(debounceMs)) || Number(debounceMs) < 0) {
            throw new Error('debounceMs must be zero or positive');
        }
        if (!Number.isFinite(Number(packetGapMs)) || Number(packetGapMs) <= 0) {
            throw new Error('packetGapMs must be positive');
        }
        if (
            !Number.isFinite(Number(maxPacketTimeMs)) ||
            Number(maxPacketTimeMs) <= 0
        ) {
            throw new Error('maxPacketTimeMs must be positive');
        }

        const normalizedAmounts = Array.from(validAmountsRub || [])
            .map(value => Number(value));
        if (
            normalizedAmounts.length === 0 ||
            normalizedAmounts.some(
                value => !Number.isFinite(value) || value <= 0
            )
        ) {
            throw new Error('validAmountsRub must contain positive amounts');
        }

        this.mode = mode;
        this.gpioChip = String(gpioChip);
        this.gpioLine = String(gpioLine);
        this.amountMinorPerPulse = amountMinorPerPulse;
        this.debounceMs = Number(debounceMs);
        this.packetGapMs = Number(packetGapMs);
        this.maxPacketTimeMs = Number(maxPacketTimeMs);
        this.validAmountsRub = new Set(normalizedAmounts);
        this.gpiomonCommand = String(gpiomonCommand);
        this.spawnProcess = spawnProcess;
        this.now = now;
        this.debug = debug;

        this.state = 'disconnected';
        this.monitor = null;
        this.stdoutBuffer = '';
        this.pulses = 0;
        this.lastPulseAt = 0;
        this.firstPulseAt = 0;
        this.packetTimer = null;
        this.packetWasAccepting = false;
        this.isStopping = false;
        this.processErrorReported = false;
    }

    log (...args) {
        if (this.debug) {
            console.log(new Date().toISOString(), '[Bill acceptor]', ...args);
        }
    }

    setState (state) {
        this.state = state;
        const status = this.getStatus();
        this.log('state', status);
        this.emit('status', status);
    }

    async start () {
        if (this.mode === 'disabled') {
            this.setState('disabled');
            return this.getStatus();
        }

        if (this.mode === 'mock') {
            this.setState('ready');
            return this.getStatus();
        }

        if (this.monitor) {
            return this.getStatus();
        }

        return new Promise((resolve, reject) => {
            const args = [
                '--chip', this.gpioChip,
                '--edges=rising',
                '--bias=pull-up',
                this.gpioLine,
            ];

            this.log('starting', this.gpiomonCommand, args);
            this.processErrorReported = false;
            this.isStopping = false;

            const monitor = this.spawnProcess(this.gpiomonCommand, args, {
                stdio: [ 'ignore', 'pipe', 'pipe' ],
            });
            this.monitor = monitor;

            monitor.stdout?.on('data', data => this.handleMonitorOutput(data));
            monitor.stderr?.on('data', data => {
                const message = data.toString().trim();
                if (message) {
                    this.log('gpiomon stderr', message);
                    this.emit('diagnostic', { message });
                }
            });

            monitor.once('spawn', () => {
                this.setState('ready');
                resolve(this.getStatus());
            });

            monitor.once('error', error => {
                this.handleMonitorFailure(error, monitor);
                reject(error);
            });

            monitor.once('close', (code, signal) => {
                this.handleMonitorClose(monitor, code, signal);
            });
        });
    }

    async stop () {
        this.clearPacket();

        if (!this.monitor) {
            if (this.mode !== 'disabled' && this.state !== 'disconnected') {
                this.setState('disconnected');
            }
            return this.getStatus();
        }

        const monitor = this.monitor;
        this.isStopping = true;

        await new Promise(resolve => {
            let isResolved = false;
            let forceTimer = null;
            const finish = () => {
                if (isResolved) {
                    return;
                }
                isResolved = true;
                if (forceTimer) {
                    clearTimeout(forceTimer);
                }
                resolve();
            };

            monitor.once('close', finish);

            forceTimer = setTimeout(() => {
                try {
                    monitor.kill('SIGKILL');
                }
                catch (error) {
                    this.log('failed to force-stop gpiomon', error);
                }
                finish();
            }, 2000);
            forceTimer.unref?.();

            try {
                if (monitor.kill('SIGINT') === false) {
                    finish();
                }
            }
            catch (error) {
                this.log('failed to stop gpiomon', error);
                finish();
            }
        });

        this.monitor = null;
        if (this.state !== 'disconnected') {
            this.setState('disconnected');
        }
        return this.getStatus();
    }

    async enableAcceptance () {
        if (this.mode === 'disabled') {
            throw new Error('Bill acceptor is disabled');
        }
        if (this.state !== 'ready') {
            throw new Error(`Bill acceptor is not ready: ${this.state}`);
        }
        if (this.pulses > 0) {
            throw new Error('A bill pulse packet is still being processed');
        }

        this.setState('accepting');
        return this.getStatus();
    }

    async disableAcceptance () {
        if (this.mode === 'disabled') {
            return this.getStatus();
        }
        if (this.pulses > 0) {
            throw new Error('A bill pulse packet is still being processed');
        }

        if (this.state === 'accepting') {
            this.setState('ready');
        }

        return this.getStatus();
    }

    simulateBill (amountMinor) {
        if (this.mode !== 'mock') {
            throw new Error('Bill simulation is available only in mock mode');
        }
        if (this.state !== 'accepting') {
            throw new Error('Bill acceptor is not accepting bills');
        }
        if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
            throw new Error('amountMinor must be a positive integer');
        }

        return this.emitBill({
            amountMinor,
            pulses: null,
        });
    }

    handleMonitorOutput (data) {
        this.stdoutBuffer += data.toString();
        const lines = this.stdoutBuffer.split(/\r?\n/);
        this.stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim()) {
                this.handlePulse(line);
            }
        }
    }

    handlePulse (sourceLine) {
        const receivedAt = this.getEventTime(sourceLine);
        const deltaMs = this.lastPulseAt > 0
            ? receivedAt - this.lastPulseAt
            : null;

        if (deltaMs !== null && deltaMs < this.debounceMs) {
            return;
        }

        this.lastPulseAt = receivedAt;
        if (this.pulses === 0) {
            this.packetWasAccepting = this.state === 'accepting';
            this.firstPulseAt = receivedAt;
        }
        else if (receivedAt - this.firstPulseAt > this.maxPacketTimeMs) {
            const event = {
                type: 'packet_timeout',
                pulses: this.pulses,
                elapsedMs: receivedAt - this.firstPulseAt,
            };
            this.log('packet timeout', event);
            this.emit('diagnostic', event);
            this.clearPacket();
            return;
        }
        this.pulses += 1;

        const event = {
            pulseNumber: this.pulses,
            receivedAt: new Date(receivedAt).toISOString(),
            sourceLine,
        };
        this.log('pulse', event);
        this.emit('pulse', event);

        if (this.packetTimer) {
            clearTimeout(this.packetTimer);
        }
        this.packetTimer = setTimeout(
            () => this.flushPacket(),
            this.packetGapMs,
        );
        this.packetTimer.unref?.();
    }

    getEventTime (sourceLine) {
        const timestampSeconds = Number.parseFloat(
            String(sourceLine).trim().split(/\s+/, 1)[0]
        );

        return Number.isFinite(timestampSeconds)
            ? timestampSeconds * 1000
            : this.now();
    }

    flushPacket () {
        if (this.pulses === 0) {
            return null;
        }

        const pulses = this.pulses;
        const wasAccepting = this.packetWasAccepting;
        const amountMinor = pulses * this.amountMinorPerPulse;
        const amountRub = amountMinor / 100;

        this.clearPacket();

        if (!this.validAmountsRub.has(amountRub)) {
            const event = {
                amountMinor,
                amountRub,
                pulses,
                detectedAt: new Date().toISOString(),
            };
            this.log('invalid bill pulse packet', event);
            this.emit('invalidBill', event);
            return event;
        }

        if (!wasAccepting) {
            const event = {
                amountMinor,
                pulses,
                detectedAt: new Date().toISOString(),
            };
            this.log('unexpected bill', event);
            this.emit('unexpectedBill', event);
            return event;
        }

        return this.emitBill({
            amountMinor,
            pulses,
        });
    }

    clearPacket () {
        if (this.packetTimer) {
            clearTimeout(this.packetTimer);
            this.packetTimer = null;
        }
        this.pulses = 0;
        this.firstPulseAt = 0;
        this.packetWasAccepting = false;
    }

    emitBill ({ amountMinor, pulses }) {
        const event = {
            amountMinor,
            amountRub: amountMinor / 100,
            pulses,
            acceptedAt: new Date().toISOString(),
        };

        this.log('bill accepted', event);
        this.emit('bill', event);
        return event;
    }

    handleMonitorFailure (error, monitor = this.monitor) {
        if (this.monitor && this.monitor !== monitor) {
            return;
        }
        if (this.processErrorReported) {
            return;
        }

        this.processErrorReported = true;
        this.monitor = null;
        this.clearPacket();
        this.setState('error');
        this.emit('error', error);
    }

    handleMonitorClose (monitor, code, signal) {
        if (this.monitor && this.monitor !== monitor) {
            return;
        }

        if (this.monitor === monitor) {
            this.monitor = null;
        }
        this.clearPacket();

        if (this.isStopping) {
            this.isStopping = false;
            this.setState('disconnected');
            return;
        }

        const error = new Error(
            `gpiomon exited unexpectedly: code=${code} signal=${signal || 'none'}`
        );
        this.handleMonitorFailure(error, monitor);
    }

    getStatus () {
        const baseAvailable =
            this.state === 'ready' || this.state === 'accepting';

        return {
            mode: this.mode,
            enabled: this.mode !== 'disabled',
            driver: this.mode === 'disabled' ? null : this.mode,
            testMode: this.mode === 'mock',
            supportedAmountsRub: [ ...this.validAmountsRub ],
            state: this.state,
            available: baseAvailable && (
                this.state === 'accepting' || this.pulses === 0
            ),
            accepting: this.state === 'accepting',
            pendingPulses: this.pulses,
            ...(this.mode === 'gpio-pulse' ? {
                gpio: {
                    chip: this.gpioChip,
                    line: this.gpioLine,
                    rubPerPulse: this.amountMinorPerPulse / 100,
                    debounceMs: this.debounceMs,
                    packetGapMs: this.packetGapMs,
                    maxPacketTimeMs: this.maxPacketTimeMs,
                    validAmountsRub: [ ...this.validAmountsRub ],
                },
            } : {}),
        };
    }
}

module.exports = { BillAcceptorClient };
