const EventEmitter = require('events');
const { randomUUID } = require('crypto');

const ACTIVE_STATES = new Set([
    'processing',
    'canceling',
    'finalizing',
]);
const REUSABLE_STATES = new Set([
    ...ACTIVE_STATES,
    'completed',
    'declined',
    'attention_required',
]);

class CardPaymentError extends Error {
    constructor (
        message,
        { code = 'card_payment_error', statusCode = 400 } = {}
    ) {
        super(message);
        this.name = 'CardPaymentError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

class CardPaymentService extends EventEmitter {
    constructor ({
        terminal,
        enabled = true,
        debug = false,
    }) {
        super();

        if (!terminal) {
            throw new Error('Card terminal is required');
        }

        this.terminal = terminal;
        this.enabled = Boolean(enabled);
        this.debug = Boolean(debug);
        this.session = null;
        this.executionPromise = null;
    }

    log (...args) {
        if (this.debug) {
            console.log(new Date().toISOString(), '[Card payment]', ...args);
        }
    }

    getSession () {
        return this.session ? { ...this.session } : null;
    }

    getDeviceStatus () {
        const terminalState = this.terminal.getState();
        const sessionActive = ACTIVE_STATES.has(this.session?.state);
        const available = this.enabled &&
            terminalState.connected &&
            terminalState.handshaked &&
            terminalState.terminalState === 'idle' &&
            !terminalState.operationActive &&
            !terminalState.paymentInProgress &&
            !terminalState.cashSaleInProgress &&
            !sessionActive;

        return {
            enabled: this.enabled,
            driver: this.terminal.driver || 'unknown',
            testMode: this.terminal.driver === 'mock',
            available,
            connected: terminalState.connected,
            handshaked: terminalState.handshaked,
            state: this.enabled
                ? terminalState.terminalState
                : 'disabled',
            busy: sessionActive ||
                terminalState.operationActive ||
                terminalState.paymentInProgress ||
                terminalState.cashSaleInProgress,
        };
    }

    getStatus () {
        return {
            device: this.getDeviceStatus(),
            session: this.getSession(),
        };
    }

    updateSession (changes) {
        if (!this.session) {
            return;
        }

        Object.assign(this.session, changes, {
            updatedAt: new Date().toISOString(),
        });
    }

    emitSession (event) {
        const payload = {
            event,
            session: this.getSession(),
        };

        this.log(event, payload.session);
        this.emit('event', payload);
        return payload;
    }

    start ({
        orderId,
        amountMinor,
        productId = 1,
        productName = 'WASH',
    }) {
        const normalizedOrderId = String(orderId || '').trim();
        const normalizedAmount = Number(amountMinor);

        if (!normalizedOrderId) {
            throw new CardPaymentError('orderId is required', {
                code: 'invalid_order_id',
            });
        }
        if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
            throw new CardPaymentError(
                'amountMinor must be a positive integer',
                { code: 'invalid_amount' }
            );
        }

        if (
            this.session &&
            this.session.orderId === normalizedOrderId &&
            this.session.targetAmountMinor === normalizedAmount &&
            REUSABLE_STATES.has(this.session.state)
        ) {
            return this.getSession();
        }

        if (ACTIVE_STATES.has(this.session?.state)) {
            throw new CardPaymentError(
                'Another card payment is already in progress',
                {
                    code: 'card_payment_busy',
                    statusCode: 409,
                }
            );
        }

        const deviceStatus = this.getDeviceStatus();
        if (!deviceStatus.available) {
            throw new CardPaymentError('Card terminal is not available', {
                code: 'card_terminal_unavailable',
                statusCode: 503,
            });
        }

        const now = new Date().toISOString();
        this.session = {
            id: randomUUID(),
            orderId: normalizedOrderId,
            state: 'processing',
            targetAmountMinor: normalizedAmount,
            approvedAmountMinor: 0,
            productId,
            productName,
            operationNumber: null,
            error: null,
            reason: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
        };
        this.emitSession('session_started');

        this.executionPromise = this.execute()
            .catch(error => {
                this.log('unexpected execution error', error);
            })
            .finally(() => {
                this.executionPromise = null;
            });

        return this.getSession();
    }

    cancel ({ sessionId, orderId } = {}) {
        if (!this.session || !ACTIVE_STATES.has(this.session.state)) {
            throw new CardPaymentError('There is no active card payment', {
                code: 'card_payment_not_active',
                statusCode: 409,
            });
        }
        if (sessionId && this.session.id !== sessionId) {
            throw new CardPaymentError('Card payment session not found', {
                code: 'card_payment_not_found',
                statusCode: 404,
            });
        }
        if (
            orderId &&
            this.session.orderId !== String(orderId).trim()
        ) {
            throw new CardPaymentError('Card payment session not found', {
                code: 'card_payment_not_found',
                statusCode: 404,
            });
        }
        if (this.session.state === 'canceling') {
            return this.getSession();
        }
        if (this.session.state !== 'processing') {
            throw new CardPaymentError(
                'Card payment cannot be canceled after approval',
                {
                    code: 'card_payment_already_approved',
                    statusCode: 409,
                }
            );
        }

        try {
            this.terminal.cancelPayment('customer_canceled');
        }
        catch (error) {
            throw new CardPaymentError(error.message, {
                code: 'card_payment_cancel_failed',
                statusCode: 503,
            });
        }

        this.updateSession({
            state: 'canceling',
            reason: 'customer_canceled',
        });
        this.emitSession('cancel_requested');

        return this.getSession();
    }

    async execute () {
        try {
            const payment = await this.terminal.startPayment({
                amountMinor: this.session.targetAmountMinor,
                productId: this.session.productId,
                productName: this.session.productName,
            });

            if (!payment.approved) {
                this.updateSession({
                    state: 'declined',
                    approvedAmountMinor: Number(payment.approvedAmount || 0),
                    operationNumber: payment.operationNumber ?? null,
                    reason: payment.reason || 'declined',
                    completedAt: new Date().toISOString(),
                });
                this.emitSession('declined');
                return;
            }

            this.updateSession({
                state: 'finalizing',
                approvedAmountMinor: Number(payment.approvedAmount),
                operationNumber: payment.operationNumber ?? null,
            });
            this.emitSession('approved');

            await this.terminal.finalizeSuccess(
                this.session.approvedAmountMinor,
                this.session.productId,
                this.session.productName,
            );

            this.updateSession({
                state: 'completed',
                completedAt: new Date().toISOString(),
            });
            this.emitSession('completed');
        }
        catch (error) {
            const paymentWasApproved =
                Number(this.session?.approvedAmountMinor || 0) > 0;

            this.updateSession({
                state: 'attention_required',
                error: paymentWasApproved
                    ? 'card_finalization_outcome_unknown'
                    : 'card_payment_outcome_unknown',
                reason: error.message,
                completedAt: new Date().toISOString(),
            });
            this.emitSession('attention_required');
        }
    }

    async waitForSettlement () {
        await this.executionPromise;
        return this.getSession();
    }
}

module.exports = {
    ACTIVE_STATES,
    CardPaymentError,
    CardPaymentService,
};
