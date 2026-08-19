const EventEmitter = require('events');
const { randomUUID } = require('crypto');

const requestJson = async ({ url, body, timeoutMs }) => {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    timer.unref?.();

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'accept': 'application/json',
            },
            body: JSON.stringify(body),
            signal: abortController.signal,
        });
        const responseText = await response.text();
        let payload = {};

        if (responseText) {
            try {
                payload = JSON.parse(responseText);
            }
            catch {
                throw new Error(
                    'Bill acceptor relay API returned invalid JSON'
                );
            }
        }

        if (!response.ok) {
            throw new Error(
                payload.error ||
                `Bill acceptor relay API returned HTTP ${response.status}`
            );
        }

        return payload;
    }
    catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(
                `Bill acceptor relay API timeout after ${timeoutMs} ms`
            );
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
};

class HttpRelayGate extends EventEmitter {
    constructor ({
        enabled = false,
        url = 'http://127.0.0.1:3181/bill-acceptor/relay',
        leaseMs = 15_000,
        renewIntervalMs = 5_000,
        requestTimeoutMs = 3_000,
        sendRequest = requestJson,
        debug = false,
    } = {}) {
        super();

        this.enabled = Boolean(enabled);
        this.url = String(url || '').trim();
        this.leaseMs = Number(leaseMs);
        this.renewIntervalMs = Number(renewIntervalMs);
        this.requestTimeoutMs = Number(requestTimeoutMs);
        this.sendRequest = sendRequest;
        this.debug = Boolean(debug);

        if (this.enabled && !this.url) {
            throw new Error('Bill acceptor relay HTTP URL is required');
        }
        if (this.enabled) {
            let parsedUrl;
            try {
                parsedUrl = new URL(this.url);
            }
            catch {
                throw new Error('Bill acceptor relay HTTP URL is invalid');
            }
            if (![ 'http:', 'https:' ].includes(parsedUrl.protocol)) {
                throw new Error(
                    'Bill acceptor relay URL must use HTTP or HTTPS'
                );
            }
        }
        for (const [ name, value ] of [
            [ 'leaseMs', this.leaseMs ],
            [ 'renewIntervalMs', this.renewIntervalMs ],
            [ 'requestTimeoutMs', this.requestTimeoutMs ],
        ]) {
            if (!Number.isFinite(value) || value <= 0) {
                throw new Error(`${name} must be positive`);
            }
        }
        if (this.renewIntervalMs >= this.leaseMs) {
            throw new Error('renewIntervalMs must be less than leaseMs');
        }

        this.connected = false;
        this.state = this.enabled ? 'disconnected' : 'disabled';
        this.relayEnabled = false;
        this.renewTimer = null;
        this.renewPromise = null;
        this.recoveryTimer = null;
        this.recoveryPromise = null;
        this.startPromise = null;
        this.closing = false;
    }

    log (...args) {
        if (this.debug) {
            console.log(
                new Date().toISOString(),
                '[Bill acceptor relay]',
                ...args
            );
        }
    }

    emitStatus () {
        const status = this.getStatus();
        this.emit('status', status);
        return status;
    }

    getStatus () {
        return {
            enabled: this.enabled,
            connected: this.connected,
            available: !this.enabled || (
                this.connected &&
                [ 'ready', 'enabled' ].includes(this.state)
            ),
            state: this.state,
            relayEnabled: this.relayEnabled,
            leaseMs: this.leaseMs,
            renewIntervalMs: this.renewIntervalMs,
            url: this.enabled ? this.url : null,
        };
    }

    start () {
        if (!this.enabled) {
            return Promise.resolve(this.emitStatus());
        }
        if (this.state === 'ready' || this.state === 'enabled') {
            return Promise.resolve(this.getStatus());
        }
        if (this.startPromise) {
            return this.startPromise;
        }

        this.closing = false;
        this.state = 'connecting';
        this.emitStatus();
        this.startPromise = this.requestRelay(false)
            .then(() => {
                this.connected = true;
                this.relayEnabled = false;
                this.state = 'ready';
                return this.emitStatus();
            })
            .catch(error => {
                this.connected = false;
                this.relayEnabled = false;
                this.state = 'error';
                this.emitStatus();
                this.scheduleRecovery();
                throw error;
            })
            .finally(() => {
                this.startPromise = null;
            });

        return this.startPromise;
    }

    async requestRelay (enabled) {
        const requestId = randomUUID();
        const response = await this.sendRequest({
            url: this.url,
            timeoutMs: this.requestTimeoutMs,
            body: { requestId, enabled },
        });

        if (!response || response.ok !== true) {
            throw new Error(
                response?.error || 'Bill acceptor relay rejected the command'
            );
        }
        if (response.requestId !== requestId) {
            throw new Error('Bill acceptor relay returned a wrong requestId');
        }
        if (Boolean(response.enabled) !== enabled) {
            throw new Error(
                'Bill acceptor relay returned an unexpected state'
            );
        }

        return response;
    }

    async enable () {
        if (!this.enabled) {
            return this.getStatus();
        }
        if (!this.connected || this.state !== 'ready') {
            if (this.relayEnabled && this.state === 'enabled') {
                return this.getStatus();
            }
            throw new Error('Bill acceptor relay is unavailable');
        }

        this.stopRecovery();
        this.state = 'enabling';
        this.emitStatus();

        try {
            await this.requestRelay(true);
            this.connected = true;
            this.relayEnabled = true;
            this.state = 'enabled';
            this.startRenewal();
            return this.emitStatus();
        }
        catch (error) {
            this.connected = false;
            this.relayEnabled = false;
            this.state = 'error';
            this.emitStatus();
            this.scheduleRecovery();
            throw error;
        }
    }

    async disable () {
        this.stopRenewal();
        if (!this.enabled) {
            return this.getStatus();
        }

        if (this.renewPromise) {
            await this.renewPromise;
        }
        this.stopRecovery();

        this.state = 'disabling';
        this.emitStatus();

        try {
            await this.requestRelay(false);
            this.connected = true;
            this.relayEnabled = false;
            this.state = 'ready';
            return this.emitStatus();
        }
        catch (error) {
            this.connected = false;
            this.state = 'error';
            this.emitStatus();
            this.scheduleRecovery();
            throw error;
        }
    }

    startRenewal () {
        this.stopRenewal();
        this.renewTimer = setInterval(
            () => void this.renewLease(),
            this.renewIntervalMs
        );
        this.renewTimer.unref?.();
    }

    stopRenewal () {
        if (this.renewTimer) {
            clearInterval(this.renewTimer);
            this.renewTimer = null;
        }
    }

    async renewLease () {
        if (!this.relayEnabled || this.renewPromise) {
            return;
        }

        this.renewPromise = this.requestRelay(true)
            .catch(error => this.loseControl(error))
            .finally(() => {
                this.renewPromise = null;
            });
        await this.renewPromise;
    }

    loseControl (error) {
        if (!this.relayEnabled && this.state === 'error') {
            return;
        }

        this.stopRenewal();
        const wasEnabled = this.relayEnabled;
        this.connected = false;
        this.relayEnabled = false;
        this.state = 'error';
        this.emitStatus();
        this.scheduleRecovery();
        if (wasEnabled) {
            this.emit('lost', error);
        }
    }

    scheduleRecovery () {
        if (
            this.closing ||
            !this.enabled ||
            this.recoveryTimer ||
            this.recoveryPromise
        ) {
            return;
        }

        this.recoveryTimer = setTimeout(
            () => void this.recover(),
            this.renewIntervalMs
        );
        this.recoveryTimer.unref?.();
    }

    stopRecovery () {
        if (this.recoveryTimer) {
            clearTimeout(this.recoveryTimer);
            this.recoveryTimer = null;
        }
    }

    async recover () {
        this.recoveryTimer = null;
        if (this.closing || !this.enabled || this.recoveryPromise) {
            return;
        }

        this.recoveryPromise = this.requestRelay(false)
            .then(() => {
                this.connected = true;
                this.relayEnabled = false;
                this.state = 'ready';
                this.emitStatus();
            })
            .catch(error => {
                this.connected = false;
                this.relayEnabled = false;
                this.state = 'error';
                this.log('Relay API recovery failed', error.message);
                this.emitStatus();
                this.scheduleRecovery();
            })
            .finally(() => {
                this.recoveryPromise = null;
                if (
                    !this.closing &&
                    this.enabled &&
                    this.state === 'error'
                ) {
                    this.scheduleRecovery();
                }
            });

        await this.recoveryPromise;
    }

    async close () {
        this.closing = true;
        this.stopRenewal();
        this.stopRecovery();

        if (this.renewPromise) {
            await this.renewPromise;
        }
        if (this.recoveryPromise) {
            await this.recoveryPromise;
        }

        if (this.enabled) {
            try {
                await this.requestRelay(false);
            }
            catch (error) {
                this.log(
                    'Failed to disable relay while closing',
                    error.message
                );
            }
        }

        this.connected = false;
        this.relayEnabled = false;
        this.state = this.enabled ? 'disconnected' : 'disabled';
        return this.emitStatus();
    }
}

module.exports = { HttpRelayGate, requestJson };
