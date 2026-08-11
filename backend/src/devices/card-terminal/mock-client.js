const EventEmitter = require('events');

class MockCardTerminal extends EventEmitter {
    constructor ({ debug = false } = {}) {
        super();
        this.driver = 'mock';
        this.debug = Boolean(debug);
        this.operationNumber = 0;
        this.pendingPayment = null;
        this.state = {
            connected: false,
            handshaked: false,
            terminalState: 'disconnected',
            operationActive: false,
            paymentInProgress: false,
        };
    }

    log (...args) {
        if (this.debug) {
            console.log(new Date().toISOString(), '[Mock card terminal]', ...args);
        }
    }

    getState () {
        return { ...this.state };
    }

    updateState (changes) {
        Object.assign(this.state, changes);
        const status = this.getState();
        this.log('state', status);
        this.emit('status', status);
        return status;
    }

    async start () {
        return this.updateState({
            connected: true,
            handshaked: true,
            terminalState: 'idle',
            operationActive: false,
            paymentInProgress: false,
        });
    }

    close () {
        if (this.pendingPayment) {
            this.simulateDecline('terminal_closed');
        }
        return this.updateState({
            connected: false,
            handshaked: false,
            terminalState: 'disconnected',
            operationActive: false,
            paymentInProgress: false,
        });
    }

    async startPayment ({ amountMinor }) {
        const normalizedAmount = Number(amountMinor);
        if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
            throw new Error('amountMinor must be a positive integer');
        }
        if (
            !this.state.connected ||
            this.state.terminalState !== 'idle' ||
            this.pendingPayment
        ) {
            throw new Error('Mock card terminal is busy');
        }

        this.operationNumber += 1;
        this.updateState({
            terminalState: 'processing',
            operationActive: true,
            paymentInProgress: true,
        });

        return new Promise(resolve => {
            this.pendingPayment = {
                amountMinor: normalizedAmount,
                operationNumber: this.operationNumber,
                resolve,
            };
        });
    }

    getPendingPayment () {
        if (!this.pendingPayment) {
            throw new Error('There is no pending mock card payment');
        }
        return this.pendingPayment;
    }

    simulateApprove (amountMinor) {
        const pending = this.getPendingPayment();
        const approvedAmount = amountMinor === undefined
            ? pending.amountMinor
            : Number(amountMinor);
        if (!Number.isInteger(approvedAmount) || approvedAmount <= 0) {
            throw new Error('Approved amount must be a positive integer');
        }

        this.pendingPayment = null;
        this.updateState({
            terminalState: 'finalizing',
            paymentInProgress: false,
        });
        pending.resolve({
            approved: true,
            approvedAmount,
            operationNumber: pending.operationNumber,
        });

        return {
            approved: true,
            approvedAmount,
            operationNumber: pending.operationNumber,
        };
    }

    simulateDecline (reason = 'declined') {
        const pending = this.getPendingPayment();
        this.pendingPayment = null;
        this.updateState({
            terminalState: 'idle',
            operationActive: false,
            paymentInProgress: false,
        });
        pending.resolve({
            approved: false,
            approvedAmount: 0,
            operationNumber: pending.operationNumber,
            reason,
        });

        return {
            approved: false,
            approvedAmount: 0,
            operationNumber: pending.operationNumber,
            reason,
        };
    }

    cancelPayment (reason = 'customer_canceled') {
        return this.simulateDecline(reason);
    }

    async finalizeSuccess () {
        if (this.state.terminalState !== 'finalizing') {
            throw new Error('Mock card payment is not ready for finalization');
        }

        this.updateState({
            terminalState: 'idle',
            operationActive: false,
            paymentInProgress: false,
        });
        return { ok: true };
    }
}

module.exports = { MockCardTerminal };
